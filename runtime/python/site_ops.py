"""Site operations and database lifecycle utilities for Frappe Playground."""

import sqlite3
from contextlib import contextmanager

__all__ = [
    "checkpoint_database",
    "repair_completed_site_defaults",
    "reset_fresh_site_setup_state",
    "mark_setup_complete",
    "frappe_site_context",
    "install_app",
    "install_frappe_app",
    "remove_app",
    "uninstall_frappe_app",
    "sqlite_connection",
]


@contextmanager
def sqlite_connection(db_path: str):
    """Context manager for SQLite connections ensuring clean closure."""
    conn = sqlite3.connect(db_path)
    try:
        yield conn
    finally:
        conn.close()


def checkpoint_database(db_path: str) -> None:
    """Checkpoint SQLite WAL to ensure all transactions are merged before saving."""
    with sqlite_connection(db_path) as conn:
        checkpoint = conn.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()
        if checkpoint[0] != 0:
            raise RuntimeError("Database checkpoint is busy; state was not saved.")


def repair_completed_site_defaults(db_path: str) -> None:
    """Ensure desktop home_page points to workspace if setup is completed."""
    with sqlite_connection(db_path) as conn:
        system_setup = conn.execute(
            "select value from tabSingles where doctype='System Settings' and field='setup_complete'"
        ).fetchone()
        if system_setup and str(system_setup[0]) == "1":
            conn.execute(
                "update 'tabInstalled Application' set is_setup_complete=1 where app_name in ('frappe', 'erpnext')"
            )
            conn.execute(
                "update tabDefaultValue set defvalue='workspace' where parent='__default' and defkey='desktop:home_page'"
            )
            conn.commit()
        else:
            values = [
                row[0]
                for row in conn.execute(
                    "select is_setup_complete from 'tabInstalled Application' where app_name in ('frappe', 'erpnext')"
                ).fetchall()
            ]
            home_page = conn.execute(
                "select defvalue from tabDefaultValue where parent='__default' and defkey='desktop:home_page'"
            ).fetchone()
            if values and all(bool(value) for value in values) and home_page and home_page[0] == "setup-wizard":
                conn.execute(
                    "update tabDefaultValue set defvalue='workspace' where parent='__default' and defkey='desktop:home_page'"
                )
                conn.commit()

        # Remap default Wiki Space route to avoid colliding with host playground docs
        try:
            has_wiki_space = conn.execute(
                "select 1 from sqlite_master where type='table' and name='tabWiki Space'"
            ).fetchone()
            if has_wiki_space:
                conn.execute("update 'tabWiki Space' set route='wiki' where route='docs'")
                has_wiki_doc = conn.execute(
                    "select 1 from sqlite_master where type='table' and name='tabWiki Document'"
                ).fetchone()
                if has_wiki_doc:
                    conn.execute(
                        "update 'tabWiki Document' set route = 'wiki' || substr(route, 5) where route = 'docs' or route like 'docs/%'"
                    )
                conn.commit()
        except Exception:
            pass


def reset_fresh_site_setup_state(db_path: str) -> None:
    """Reset site state so the setup wizard runs on fresh playground boot."""
    with sqlite_connection(db_path) as conn:
        conn.execute("update tabSingles set value='0' where doctype='System Settings' and field='setup_complete'")
        conn.execute("update 'tabInstalled Application' set is_setup_complete=0")
        updated = conn.execute(
            "update tabDefaultValue set defvalue='setup-wizard' where parent='__default' and defkey='desktop:home_page'"
        ).rowcount
        if not updated:
            conn.execute(
                "insert into tabDefaultValue (name, parent, defkey, defvalue) values (?, '__default', 'desktop:home_page', 'setup-wizard')",
                ("__default:desktop:home_page",),
            )
        conn.commit()


def mark_setup_complete(db_path: str) -> None:
    """Mark setup complete in SQLite database upon setup wizard completion."""
    with sqlite_connection(db_path) as conn:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute(
            "update 'tabInstalled Application' set is_setup_complete=1 where app_name in ('frappe', 'erpnext')"
        )
        conn.execute("update tabSingles set value='1' where doctype='System Settings' and field='setup_complete'")
        conn.execute(
            "update tabDefaultValue set defvalue='workspace' where parent='__default' and defkey='desktop:home_page'"
        )
        conn.commit()


@contextmanager
def frappe_site_context(site_name: str = "site1", sites_path: str = "/home/pyodide/bench/sites"):
    """Context manager for executing Frappe commands against a site."""
    import frappe

    frappe.init(site=site_name, sites_path=sites_path)
    frappe.connect()
    try:
        yield frappe
    finally:
        frappe.destroy()


def install_app(app_id: str, site_name: str = "site1", sites_path: str = "/home/pyodide/bench/sites") -> None:
    """Install an app into Frappe site if not already installed."""
    from frappe.installer import install_app as _install_app

    with frappe_site_context(site_name, sites_path) as frappe:
        if app_id not in frappe.get_installed_apps():
            had_setup_complete = bool(
                frappe.db.get_single_value("System Settings", "setup_complete")
                or frappe.db.get_value("Installed Application", {"app_name": "frappe"}, "is_setup_complete")
            )
            _install_app(app_id)
            # ERPNext requires company setup through its setup wizard screen.
            # Other apps do not have a setup wizard and retain setup completion.
            if had_setup_complete and app_id != "erpnext":
                frappe.db.sql(
                    "UPDATE `tabInstalled Application` SET is_setup_complete = 1 WHERE app_name = %s",
                    (app_id,),
                )
                frappe.db.set_single_value("System Settings", "setup_complete", 1)
                frappe.db.set_default("desktop:home_page", "workspace")
                frappe.clear_cache()
            if app_id == "wiki":
                try:
                    frappe.db.sql("update `tabWiki Space` set route='wiki' where route='docs'")
                    frappe.db.sql(
                        "update `tabWiki Document` set route = 'wiki' || substr(route, 5) where route = 'docs' or route like 'docs/%'"
                    )
                    from frappe.website.utils import clear_cache as clear_website_cache
                    clear_website_cache()
                except Exception as error:
                    print(f"[playground] notice: could not remap wiki space route: {error}")
            frappe.db.commit()


install_frappe_app = install_app


def remove_app(app_id: str, site_name: str = "site1", sites_path: str = "/home/pyodide/bench/sites") -> None:
    """Uninstall an app from Frappe site if installed."""
    from frappe.installer import remove_app as _remove_app

    with frappe_site_context(site_name, sites_path) as frappe:
        if app_id in frappe.get_installed_apps():
            had_setup_complete = bool(
                frappe.db.get_single_value("System Settings", "setup_complete")
                or frappe.db.get_value("Installed Application", {"app_name": "frappe"}, "is_setup_complete")
            )
            _remove_app(app_id, yes=True, no_backup=True)
            if had_setup_complete:
                frappe.db.set_single_value("System Settings", "setup_complete", 1)
                frappe.db.set_default("desktop:home_page", "workspace")
                frappe.clear_cache()
            frappe.db.commit()


uninstall_frappe_app = remove_app
