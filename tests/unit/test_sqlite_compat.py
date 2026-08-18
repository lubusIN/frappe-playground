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

from sqlite_compat import register_sqlite_functions, translate_query  # noqa: E402


class SQLiteCompatTest(unittest.TestCase):
    def setUp(self):
        self.conn = register_sqlite_functions(sqlite3.connect(":memory:"))
        self.conn.execute(
            "create table t (posting_date text, posting_time text, due_date text, "
            "transaction_date text, delivery_date text, last_login text, "
            "first_responded_on text, response_by text, qty int, name text)"
        )
        self.conn.execute(
            "insert into t values ('2026-01-15','10:30:00','2026-02-01','2026-01-01',"
            "'2026-03-01','2026-08-01 09:00:00','2026-01-01 08:00:00',"
            "'2026-01-01 10:00:00', 5, 'A')"
        )

    def tearDown(self):
        self.conn.close()

    def run_sql(self, sql):
        return self.conn.execute(translate_query(sql)).fetchone()

    # ── queries lifted from erpnext version-16 ──────────────────────────

    def test_datediff_between_columns(self):
        # supplier_scorecard_variable.py
        row = self.run_sql("select SUM(DATEDIFF(delivery_date, posting_date) * qty) from t")
        self.assertEqual(row[0], 225)

    def test_datediff_against_current_date(self):
        # sales_order_analysis.py
        self.assertIsNotNone(self.run_sql("select DATEDIFF(CURRENT_DATE, delivery_date) from t"))

    def test_date_sub_with_curdate_interval(self):
        # company.py: transaction_date > date_sub(curdate(), interval 1 year)
        row = self.run_sql(
            "select name from t where transaction_date > date_sub(curdate(), interval 1 year)"
        )
        self.assertEqual(row[0], "A")

    def test_date_sub_with_now_interval(self):
        # activity.py: last_login > date_sub(now(), interval 2 day)
        self.conn.execute("update t set last_login = datetime('now')")
        row = self.run_sql("select name from t where last_login > date_sub(now(), interval 2 day)")
        self.assertEqual(row[0], "A")

    def test_date_add_negative_interval(self):
        # project_update.py: DATE_ADD(CURRENT_DATE, INTERVAL -1 DAY)
        self.conn.execute("update t set posting_date = date('now', '-1 day')")
        row = self.run_sql(
            "select name from t where posting_date = DATE_ADD(CURRENT_DATE, INTERVAL -1 DAY)"
        )
        self.assertEqual(row[0], "A", "date arithmetic must stay comparable to a DATE column")

    def test_date_add_preserves_mysql_return_type(self):
        # MySQL returns a DATE for a DATE input and a DATETIME for a DATETIME
        # input. SQLite's datetime() always returns a datetime, which silently
        # breaks equality against date-only columns.
        self.assertEqual(
            self.run_sql("select DATE_ADD('2026-01-15', INTERVAL 1 DAY)")[0], "2026-01-16"
        )
        self.assertEqual(
            self.run_sql("select DATE_ADD('2026-01-15 10:30:00', INTERVAL 1 DAY)")[0],
            "2026-01-16 10:30:00",
        )

    def test_month_arithmetic_clamps_to_valid_day(self):
        # MySQL clamps 31 Jan + 1 month to 28/29 Feb rather than overflowing.
        self.assertEqual(
            self.run_sql("select DATE_ADD('2026-01-31', INTERVAL 1 MONTH)")[0], "2026-02-28"
        )

    def test_bind_parameter_is_not_duplicated(self):
        # Duplicating the value expression would double a bind parameter and
        # desynchronise the argument list.
        translated = translate_query("select DATE_ADD(%s, INTERVAL 1 DAY)")
        self.assertEqual(translated.count("%s"), 1)

    def test_date_add_month(self):
        # set_valid_till_date_in_supplier_quotation.py
        row = self.run_sql("select DATE_ADD(transaction_date , INTERVAL 1 MONTH) from t")
        self.assertTrue(row[0].startswith("2026-02-01"))

    def test_timestampdiff_bare_unit_keyword(self):
        # update_response_by_variance.py — MySQL passes the unit unquoted.
        row = self.run_sql(
            "select timestampdiff(Second, first_responded_on, response_by) from t"
        )
        self.assertEqual(row[0], 7200)

    def test_date_format(self):
        # update_posting_datetime_and_dropped_indexes.py
        row = self.run_sql("select DATE_FORMAT(posting_date, '%Y-%m-%d %H:%i:%s') from t")
        self.assertEqual(row[0], "2026-01-15 00:00:00")

    def test_nested_call_inside_date_add(self):
        row = self.run_sql(
            "select DATE_ADD(IFNULL(transaction_date, posting_date), INTERVAL 3 MONTH) from t"
        )
        self.assertTrue(row[0].startswith("2026-04-01"))

    def test_if_becomes_iif(self):
        self.assertEqual(self.run_sql("select IF(qty > 3, 'many', 'few') from t")[0], "many")

    def test_week_interval_is_scaled_to_days(self):
        row = self.run_sql("select DATE_ADD(posting_date, INTERVAL 2 WEEK) from t")
        self.assertTrue(row[0].startswith("2026-01-29"))

    def test_on_duplicate_key_becomes_on_conflict(self):
        # update_total_qty_field.py
        translated = translate_query(
            "INSERT INTO t (name) VALUES ('B') ON DUPLICATE KEY UPDATE name = VALUES(name)"
        )
        self.assertIn("ON CONFLICT DO UPDATE SET", translated)

    # ── things that must NOT be rewritten ───────────────────────────────

    def test_ifnull_is_left_alone(self):
        # SQLite supports IFNULL natively; rewriting it to IIF would be wrong.
        self.assertEqual(self.run_sql("select IFNULL(name, 'x') from t")[0], "A")
        self.assertNotIn("IIF", translate_query("select IFNULL(a, b) from t"))

    def test_group_concat_is_left_alone(self):
        self.assertIn("GROUP_CONCAT", translate_query("select GROUP_CONCAT(name) from t"))

    def test_translation_is_idempotent(self):
        once = translate_query("select DATE_ADD(posting_date, INTERVAL 1 DAY) from t")
        self.assertEqual(once, translate_query(once))


if __name__ == "__main__":
    unittest.main(verbosity=2)
