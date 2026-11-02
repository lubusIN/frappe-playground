"""Unit tests for site_ops database functions."""

import os
import sqlite3
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "runtime", "python"))

from site_ops import (  # noqa: E402
    checkpoint_database,
    mark_setup_complete,
    repair_completed_site_defaults,
    reset_fresh_site_setup_state,
    sqlite_connection,
)


class SiteOpsTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = os.path.join(self.temp_dir.name, "test_site.db")
        conn = sqlite3.connect(self.db_path)
        try:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("CREATE TABLE tabSingles (doctype TEXT, field TEXT, value TEXT)")
            conn.execute("CREATE TABLE 'tabInstalled Application' (app_name TEXT, is_setup_complete INT)")
            conn.execute("CREATE TABLE tabDefaultValue (name TEXT, parent TEXT, defkey TEXT, defvalue TEXT)")
            conn.execute("INSERT INTO 'tabInstalled Application' VALUES ('frappe', 1), ('erpnext', 1)")
            conn.execute("INSERT INTO tabSingles VALUES ('System Settings', 'setup_complete', '1')")
            conn.execute(
                "INSERT INTO tabDefaultValue VALUES ('__default:desktop:home_page', '__default', 'desktop:home_page', 'workspace')"
            )
            conn.commit()
        finally:
            conn.close()

    def tearDown(self):
        self.temp_dir.cleanup()

    def query_one(self, sql):
        conn = sqlite3.connect(self.db_path)
        try:
            row = conn.execute(sql).fetchone()
            return row[0] if row else None
        finally:
            conn.close()

    def test_checkpoint_database(self):
        checkpoint_database(self.db_path)
        # Should complete without error on a valid database

    def test_sqlite_connection_context_manager(self):
        with sqlite_connection(self.db_path) as conn:
            self.assertIsNotNone(conn.execute("SELECT 1").fetchone())

    def test_reset_fresh_site_setup_state(self):
        reset_fresh_site_setup_state(self.db_path)
        self.assertEqual(
            self.query_one("SELECT value FROM tabSingles WHERE doctype='System Settings' AND field='setup_complete'"),
            "0",
        )
        self.assertEqual(
            self.query_one("SELECT is_setup_complete FROM 'tabInstalled Application' WHERE app_name='frappe'"),
            0,
        )
        self.assertEqual(
            self.query_one("SELECT defvalue FROM tabDefaultValue WHERE parent='__default' AND defkey='desktop:home_page'"),
            "setup-wizard",
        )

    def test_mark_setup_complete(self):
        reset_fresh_site_setup_state(self.db_path)
        mark_setup_complete(self.db_path)
        self.assertEqual(
            self.query_one("SELECT value FROM tabSingles WHERE doctype='System Settings' AND field='setup_complete'"),
            "1",
        )
        self.assertEqual(
            self.query_one("SELECT is_setup_complete FROM 'tabInstalled Application' WHERE app_name='frappe'"),
            1,
        )
        self.assertEqual(
            self.query_one("SELECT defvalue FROM tabDefaultValue WHERE parent='__default' AND defkey='desktop:home_page'"),
            "workspace",
        )

    def test_repair_completed_site_defaults(self):
        conn = sqlite3.connect(self.db_path)
        try:
            conn.execute(
                "UPDATE tabDefaultValue SET defvalue='setup-wizard' WHERE parent='__default' AND defkey='desktop:home_page'"
            )
            conn.commit()
        finally:
            conn.close()

        self.assertEqual(
            self.query_one("SELECT defvalue FROM tabDefaultValue WHERE parent='__default' AND defkey='desktop:home_page'"),
            "setup-wizard",
        )

        repair_completed_site_defaults(self.db_path)

        self.assertEqual(
            self.query_one("SELECT defvalue FROM tabDefaultValue WHERE parent='__default' AND defkey='desktop:home_page'"),
            "workspace",
        )

    def test_repair_completed_site_defaults_remaps_wiki_docs_route(self):
        conn = sqlite3.connect(self.db_path)
        try:
            conn.execute("CREATE TABLE 'tabWiki Space' (name TEXT, route TEXT)")
            conn.execute("CREATE TABLE 'tabWiki Document' (name TEXT, route TEXT)")
            conn.execute("INSERT INTO 'tabWiki Space' VALUES ('Wiki', 'docs')")
            conn.execute("INSERT INTO 'tabWiki Document' VALUES ('root', 'docs'), ('child', 'docs/welcome-to-frappe-wiki')")
            conn.commit()
        finally:
            conn.close()

        repair_completed_site_defaults(self.db_path)

        space_route = self.query_one("SELECT route FROM 'tabWiki Space' WHERE name = 'Wiki'")
        self.assertEqual(space_route, "wiki")
        root_route = self.query_one("SELECT route FROM 'tabWiki Document' WHERE name = 'root'")
        self.assertEqual(root_route, "wiki")
        child_route = self.query_one("SELECT route FROM 'tabWiki Document' WHERE name = 'child'")
        self.assertEqual(child_route, "wiki/welcome-to-frappe-wiki")


if __name__ == "__main__":
    unittest.main()
