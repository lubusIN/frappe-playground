"""Verify the MariaDB -> SQLite translation against real ERPNext query shapes.

Every query below is taken from erpnext version-16. They are executed against a
real in-memory SQLite database, so a translation that produces syntactically
valid but unexecutable SQL still fails.
"""

import os
import sqlite3
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "runtime", "python"))

from mariadb_polyfills import attach_mariadb_functions, rewrite_sql_for_sqlite  # noqa: E402


class MariaDBPolyfillsTest(unittest.TestCase):
    def setUp(self):
        self.conn = attach_mariadb_functions(sqlite3.connect(":memory:"))
        self.conn.execute(
            "create table erpnext_dummy (posting_date text, posting_time text, due_date text, "
            "transaction_date text, delivery_date text, last_login text, "
            "first_responded_on text, response_by text, qty int, name text)"
        )
        self.conn.execute(
            "insert into erpnext_dummy values ('2027-04-10','14:00:00','2027-05-01','2027-03-01',"
            "'2027-04-20','2027-08-01 09:00:00','2027-03-01 08:00:00',"
            "'2027-03-01 10:00:00', 10, 'TEST_DOC')"
        )

    def tearDown(self):
        self.conn.close()

    def run_sql(self, sql):
        return self.conn.execute(rewrite_sql_for_sqlite(sql)).fetchone()

    # ── queries lifted from erpnext version-16 ──────────────────────────

    def test_datediff_between_columns(self):
        # supplier_scorecard_variable.py
        row = self.run_sql("select SUM(DATEDIFF(delivery_date, posting_date) * qty) from erpnext_dummy")
        self.assertEqual(row[0], 100)

    def test_datediff_against_current_date(self):
        # sales_order_analysis.py
        self.assertIsNotNone(self.run_sql("select DATEDIFF(CURRENT_DATE, delivery_date) from erpnext_dummy"))

    def test_date_sub_with_curdate_interval(self):
        # company.py: transaction_date > date_sub(curdate(), interval 1 year)
        row = self.run_sql(
            "select name from erpnext_dummy where transaction_date > date_sub(curdate(), interval 1 year)"
        )
        self.assertEqual(row[0], "TEST_DOC")

    def test_date_sub_with_now_interval(self):
        # activity.py: last_login > date_sub(now(), interval 2 day)
        self.conn.execute("update erpnext_dummy set last_login = datetime('now')")
        row = self.run_sql("select name from erpnext_dummy where last_login > date_sub(now(), interval 2 day)")
        self.assertEqual(row[0], "TEST_DOC")

    def test_date_add_negative_interval(self):
        # project_update.py: DATE_ADD(CURRENT_DATE, INTERVAL -1 DAY)
        self.conn.execute("update erpnext_dummy set posting_date = date('now', '-1 day')")
        row = self.run_sql(
            "select name from erpnext_dummy where posting_date = DATE_ADD(CURRENT_DATE, INTERVAL -1 DAY)"
        )
        self.assertEqual(row[0], "TEST_DOC", "date arithmetic must stay comparable to a DATE column")

    def test_date_add_preserves_mysql_return_type(self):
        # MySQL returns a DATE for a DATE input and a DATETIME for a DATETIME
        # input. SQLite's datetime() always returns a datetime, which silently
        # breaks equality against date-only columns.
        self.assertEqual(
            self.run_sql("select DATE_ADD('2027-04-10', INTERVAL 1 DAY)")[0], "2027-04-11"
        )
        self.assertEqual(
            self.run_sql("select DATE_ADD('2027-04-10 14:00:00', INTERVAL 1 DAY)")[0],
            "2027-04-11 14:00:00",
        )

    def test_month_arithmetic_clamps_to_valid_day(self):
        # MySQL clamps 31 Jan + 1 month to 28/29 Feb rather than overflowing.
        self.assertEqual(
            self.run_sql("select DATE_ADD('2027-01-31', INTERVAL 1 MONTH)")[0], "2027-02-28"
        )

    def test_bind_parameter_is_not_duplicated(self):
        # Duplicating the value expression would double a bind parameter and
        # desynchronise the argument list.
        translated = rewrite_sql_for_sqlite("select DATE_ADD(%s, INTERVAL 1 DAY)")
        self.assertEqual(translated.count("%s"), 1)

    def test_date_add_month(self):
        # set_valid_till_date_in_supplier_quotation.py
        row = self.run_sql("select DATE_ADD(transaction_date , INTERVAL 1 MONTH) from erpnext_dummy")
        self.assertTrue(row[0].startswith("2027-04-01"))

    def test_timestampdiff_bare_unit_keyword(self):
        # update_response_by_variance.py — MySQL passes the unit unquoted.
        row = self.run_sql(
            "select timestampdiff(Second, first_responded_on, response_by) from erpnext_dummy"
        )
        self.assertEqual(row[0], 7200)

    def test_date_format(self):
        # update_posting_datetime_and_dropped_indexes.py
        row = self.run_sql("select DATE_FORMAT(posting_date, '%Y-%m-%d %H:%i:%s') from erpnext_dummy")
        self.assertEqual(row[0], "2027-04-10 00:00:00")

    def test_nested_call_inside_date_add(self):
        row = self.run_sql(
            "select DATE_ADD(IFNULL(transaction_date, posting_date), INTERVAL 3 MONTH) from erpnext_dummy"
        )
        self.assertTrue(row[0].startswith("2027-06-01"))

    def test_if_becomes_iif(self):
        self.assertEqual(self.run_sql("select IF(qty > 3, 'many', 'few') from erpnext_dummy")[0], "many")

    def test_week_interval_is_scaled_to_days(self):
        row = self.run_sql("select DATE_ADD(posting_date, INTERVAL 2 WEEK) from erpnext_dummy")
        self.assertTrue(row[0].startswith("2027-04-24"))

    def test_on_duplicate_key_becomes_on_conflict(self):
        # update_total_qty_field.py
        translated = rewrite_sql_for_sqlite(
            "INSERT INTO erpnext_dummy (name) VALUES ('TEST_DOC_2') ON DUPLICATE KEY UPDATE name = VALUES(name)"
        )
        self.assertIn("ON CONFLICT DO UPDATE SET", translated)

    # ── things that must NOT be rewritten ───────────────────────────────

    def test_ifnull_is_left_alone(self):
        # SQLite supports IFNULL natively; rewriting it to IIF would be wrong.
        self.assertEqual(self.run_sql("select IFNULL(name, 'x') from erpnext_dummy")[0], "TEST_DOC")
        self.assertNotIn("IIF", rewrite_sql_for_sqlite("select IFNULL(a, b) from erpnext_dummy"))

    def test_group_concat_is_left_alone(self):
        self.assertIn("GROUP_CONCAT", rewrite_sql_for_sqlite("select GROUP_CONCAT(name) from erpnext_dummy"))

    def test_translation_is_idempotent(self):
        once = rewrite_sql_for_sqlite("select DATE_ADD(posting_date, INTERVAL 1 DAY) from erpnext_dummy")
        self.assertEqual(once, rewrite_sql_for_sqlite(once))


if __name__ == "__main__":
    unittest.main(verbosity=2)
