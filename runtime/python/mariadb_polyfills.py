"""Provides MariaDB-specific SQL function support for SQLite.

Since ERPNext is heavily optimized for MariaDB, it relies on several custom
date and time functions (e.g., DATE_ADD, DATEDIFF). Frappe's native SQLite
engine doesn't Polyfill these specific functions, causing ERPNext to crash
during database operations in the browser.

This module acts as a translation layer by:
1. Registering missing functions natively into the SQLite connection.
2. Textually rewriting specific SQL constructs that are syntax rather than
   simple function calls (like INTERVAL, ON DUPLICATE KEY UPDATE).
"""

import re
import sqlite3
from datetime import datetime, timedelta

__all__ = ["rewrite_sql_for_sqlite", "attach_mariadb_functions", "install"]

_INTERVAL_UNITS = {
    "MICROSECOND": "seconds",
    "SECOND": "seconds",
    "MINUTE": "minutes",
    "HOUR": "hours",
    "DAY": "days",
    "WEEK": "days",
    "MONTH": "months",
    "QUARTER": "months",
    "YEAR": "years",
}
_UNIT_SCALE = {"WEEK": 7, "QUARTER": 3}

# MySQL DATE_FORMAT specifiers -> strftime equivalents.
_DATE_FORMAT_MAP = {
    "%Y": "%Y", "%y": "%y", "%m": "%m", "%c": "%m", "%d": "%d", "%e": "%d",
    "%H": "%H", "%k": "%H", "%i": "%M", "%s": "%S", "%S": "%S",
    "%f": "%f", "%j": "%j", "%W": "%w", "%w": "%w", "%%": "%%",
}


def _split_args(text):
    """Split a function argument list on top-level commas only."""
    args, depth, current, quote = [], 0, [], None
    for char in text:
        if quote:
            current.append(char)
            if char == quote:
                quote = None
            continue
        if char in "'\"":
            quote = char
            current.append(char)
        elif char == "(":
            depth += 1
            current.append(char)
        elif char == ")":
            depth -= 1
            current.append(char)
        elif char == "," and depth == 0:
            args.append("".join(current).strip())
            current = []
        else:
            current.append(char)
    if current:
        args.append("".join(current).strip())
    return args


def _rewrite_calls(sql, name, handler):
    """Rewrite every ``name(...)`` call using a paren-aware scan.

    Scanning resumes *after* each replacement rather than restarting, so a
    handler may legitimately re-emit a call with the same name (as the
    TIMESTAMPDIFF handler does when it quotes the unit) without looping.
    """
    pattern = re.compile(rf"\b{name}\s*\(", re.IGNORECASE)
    offset = 0
    while True:
        match = pattern.search(sql, offset)
        if not match:
            return sql
        start = match.end()
        depth, index, quote = 1, start, None
        while index < len(sql) and depth:
            char = sql[index]
            if quote:
                if char == quote:
                    quote = None
            elif char in "'\"":
                quote = char
            elif char == "(":
                depth += 1
            elif char == ")":
                depth -= 1
            index += 1
        if depth:
            return sql  # unbalanced; leave the query alone
        inner = sql[start:index - 1]
        replacement = handler(_split_args(inner))
        if replacement is None:
            offset = index  # cannot translate this call; skip past it
            continue
        sql = sql[:match.start()] + replacement + sql[index:]
        offset = match.start() + len(replacement)


def _parse_interval(expression):
    """Split ``INTERVAL 3 MONTH`` into (amount_sql, unit)."""
    match = re.match(r"INTERVAL\s+(.+?)\s+(\w+)\s*$", expression.strip(), re.IGNORECASE)
    if not match:
        return None
    unit = match.group(2).upper()
    if unit not in _INTERVAL_UNITS:
        return None
    return match.group(1).strip(), unit


def _date_add(args, sign):
    """Rewrite DATE_ADD/DATE_SUB to the mariadb_date_math user function.

    A textual rewrite to SQLite's datetime() cannot reproduce MySQL's return
    type: DATE_ADD on a DATE yields a DATE, but datetime() always yields
    'YYYY-MM-DD HH:MM:SS', which breaks equality against date-only columns.
    Delegating to a Python function keeps that behavior and avoids duplicating
    the value expression (which would double any bind parameter it contains).
    """
    if len(args) != 2:
        return None
    parsed = _parse_interval(args[1])
    if parsed is None:
        return None
    amount, unit = parsed
    return f"mariadb_date_math({args[0]}, ({amount}) * {1 if sign == '+' else -1}, '{unit}')"


def _translate_if(args):
    return f"IIF({', '.join(args)})" if len(args) == 3 else None


def _translate_timestampdiff(args):
    # MySQL passes the unit as a bare keyword; SQLite would read it as a column.
    if len(args) != 3:
        return None
    return f"timestampdiff('{args[0].strip().strip(chr(39))}', {args[1]}, {args[2]})"


def _strip_union_parentheses(sql):
    """
    Remove parentheses around SELECT statements that are operands of UNION.
    MariaDB allows `(SELECT ...) UNION (SELECT ...)`, but SQLite only allows
    `SELECT ... UNION SELECT ...`.
    """
    while True:
        changed = False
        
        for match in re.finditer(r"\)\s*UNION\b(?:\s*ALL\b)?\s*\(?", sql, flags=re.IGNORECASE):
            union_str = match.group(0)
            start_idx = match.start()
            end_idx = match.end()
            
            depth = 0
            left_paren_idx = -1
            for i in range(start_idx, -1, -1):
                if sql[i] == ')':
                    depth += 1
                elif sql[i] == '(':
                    depth -= 1
                    if depth == 0:
                        left_paren_idx = i
                        break
            
            can_unwrap_left = False
            if left_paren_idx != -1:
                before_left = sql[:left_paren_idx].strip()
                if not before_left or before_left[-1] == '(' or re.search(r'\b(?:UNION|INTERSECT|EXCEPT)(?:\s+ALL)?$', before_left, re.IGNORECASE):
                    can_unwrap_left = True
                    
            right_paren_idx = -1
            can_unwrap_right = False
            has_right_paren = union_str.rstrip().endswith('(')
            if has_right_paren:
                depth = 0
                for i in range(end_idx - 1, len(sql)):
                    if sql[i] == '(':
                        depth += 1
                    elif sql[i] == ')':
                        depth -= 1
                        if depth == 0:
                            right_paren_idx = i
                            break
                if right_paren_idx != -1:
                    after_right = sql[right_paren_idx+1:].strip()
                    if not after_right or after_right[0] == ')' or re.search(r'^(?:UNION|INTERSECT|EXCEPT|ORDER\s+BY|LIMIT|OFFSET)\b', after_right, re.IGNORECASE):
                        can_unwrap_right = True

            if can_unwrap_left or can_unwrap_right:
                new_sql = list(sql)
                if can_unwrap_left:
                    new_sql[left_paren_idx] = ' '
                    actual_rparen = sql.rfind(')', 0, start_idx + 1)
                    if actual_rparen != -1:
                        new_sql[actual_rparen] = ' '
                if can_unwrap_right:
                    actual_lparen = sql.find('(', end_idx - 1)
                    if actual_lparen != -1:
                        new_sql[actual_lparen] = ' '
                    new_sql[right_paren_idx] = ' '
                
                sql = "".join(new_sql)
                changed = True
                break
                
        if not changed:
            break
            
    return sql


def rewrite_sql_for_sqlite(sql):
    """Apply every MariaDB -> SQLite translation to one query string."""
    sql = str(sql)
    
    # Strip top-level parentheses e.g. `(SELECT ...)`
    stripped = sql.strip()
    while stripped.startswith('(') and stripped.endswith(')'):
        depth = 0
        matches = True
        for i in range(len(stripped) - 1):
            if stripped[i] == '(':
                depth += 1
            elif stripped[i] == ')':
                depth -= 1
            if depth == 0:
                matches = False
                break
        if matches:
            stripped = stripped[1:-1].strip()
        else:
            break
    sql = stripped

    sql = _rewrite_calls(sql, "DATE_ADD", lambda args: _date_add(args, "+"))
    sql = _rewrite_calls(sql, "ADDDATE", lambda args: _date_add(args, "+"))
    sql = _rewrite_calls(sql, "DATE_SUB", lambda args: _date_add(args, "-"))
    sql = _rewrite_calls(sql, "SUBDATE", lambda args: _date_add(args, "-"))
    sql = _rewrite_calls(sql, "IF", _translate_if)
    sql = _rewrite_calls(sql, "TIMESTAMPDIFF", _translate_timestampdiff)

    # Quote unquoted or backticked sequence names in nextval and setval
    sql = re.sub(r"\bnextval\s*\(\s*[`'\"]?([a-zA-Z0-9_]+)[`'\"]?\s*\)", r"nextval('\1')", sql, flags=re.IGNORECASE)
    sql = re.sub(r"\bsetval\s*\(\s*[`'\"]?([a-zA-Z0-9_]+)[`'\"]?\s*,", r"setval('\1',", sql, flags=re.IGNORECASE)

    # Ensure SQLite TEXT primary keys use NOCASE collation like MariaDB utf8mb4_unicode_ci
    sql = re.sub(
        r"\bname\s+TEXT\s+(?!COLLATE\s+NOCASE\s+)PRIMARY\s+KEY\b",
        "name TEXT COLLATE NOCASE PRIMARY KEY",
        sql,
        flags=re.IGNORECASE,
    )

    # Convert MariaDB's ON DUPLICATE KEY UPDATE to SQLite's ON CONFLICT DO UPDATE SET
    sql = re.sub(
        r"ON\s+DUPLICATE\s+KEY\s+UPDATE",
        "ON CONFLICT DO UPDATE SET",
        sql,
        flags=re.IGNORECASE,
    )
    
    sql = _strip_union_parentheses(sql)
    return sql


# ── SQLite user functions ────────────────────────────────────────────────

def _to_datetime(value):
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    text = str(value).strip()
    for fmt in ("%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d", "%H:%M:%S"):
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        return None


def _sql_date_format(value, fmt):
    moment = _to_datetime(value)
    if moment is None or fmt is None:
        return None
    converted = re.sub(
        r"%.",
        lambda m: _DATE_FORMAT_MAP.get(m.group(0), m.group(0)),
        str(fmt),
    )
    return moment.strftime(converted)


def _sql_datediff(left, right):
    a, b = _to_datetime(left), _to_datetime(right)
    if a is None or b is None:
        return None
    return (a.date() - b.date()).days


def _sql_timestampdiff(unit, left, right):
    a, b = _to_datetime(left), _to_datetime(right)
    if a is None or b is None:
        return None
    delta = b - a
    unit = str(unit).upper()
    if unit == "SECOND":
        return int(delta.total_seconds())
    if unit == "MINUTE":
        return int(delta.total_seconds() // 60)
    if unit == "HOUR":
        return int(delta.total_seconds() // 3600)
    if unit == "DAY":
        return delta.days
    if unit == "WEEK":
        return delta.days // 7
    if unit == "MONTH":
        return (b.year - a.year) * 12 + (b.month - a.month)
    if unit == "YEAR":
        return b.year - a.year
    return None


def _mariadb_date_math(value, amount, unit):
    """MySQL DATE_ADD/DATE_SUB semantics, including DATE vs DATETIME result."""
    moment = _to_datetime(value)
    if moment is None or amount is None:
        return None
    unit = str(unit).upper()
    amount = int(amount)

    if unit in ("YEAR", "MONTH", "QUARTER"):
        months = amount * (3 if unit == "QUARTER" else 1) * (12 if unit == "YEAR" else 1)
        total = moment.year * 12 + (moment.month - 1) + months
        year, month = divmod(total, 12)
        month += 1
        # Clamp to the last valid day, as MySQL does for 31 Jan + 1 month.
        day = min(moment.day, _days_in_month(year, month))
        shifted = moment.replace(year=year, month=month, day=day)
    else:
        delta_days = amount * (7 if unit == "WEEK" else 1)
        shifted = moment + timedelta(**(
            {"days": delta_days} if unit in ("DAY", "WEEK")
            else {_INTERVAL_UNITS[unit]: amount}
        ))

    date_only = len(str(value).strip()) <= 10 and unit in ("DAY", "WEEK", "MONTH", "QUARTER", "YEAR")
    return shifted.strftime("%Y-%m-%d" if date_only else "%Y-%m-%d %H:%M:%S")


def _days_in_month(year, month):
    import calendar
    return calendar.monthrange(year, month)[1]


def _to_str(val):
    if isinstance(val, bytes):
        return val.decode("utf-8", errors="replace")
    return str(val)


def _sql_concat(*args):
    """MariaDB CONCAT(str1, str2, ...). Returns NULL if any argument is NULL."""
    if any(arg is None for arg in args):
        return None
    return "".join(_to_str(arg) for arg in args)


def _sql_concat_ws(separator, *args):
    """MariaDB CONCAT_WS(separator, str1, str2, ...). Skips NULLs after separator."""
    if separator is None:
        return None
    sep = _to_str(separator)
    return sep.join(_to_str(arg) for arg in args if arg is not None)


def _sql_field(target, *values):
    """MariaDB FIELD(val, val1, val2, ...). Returns 1-based index or 0."""
    if target is None:
        return 0
    t = str(target).lower() if isinstance(target, str) else target
    for i, val in enumerate(values, 1):
        if val is None:
            continue
        v = str(val).lower() if isinstance(val, str) else val
        if t == v:
            return i
    return 0


def _sql_locate(*args):
    """MariaDB LOCATE(substr, str[, pos]). Returns 1-based index or 0."""
    if len(args) < 2 or any(a is None for a in args):
        return None
    substr = _to_str(args[0])
    string = _to_str(args[1])
    pos = 1
    if len(args) > 2 and args[2] is not None:
        try:
            pos = int(args[2])
        except (ValueError, TypeError):
            return 0
    if pos < 1:
        return 0
    idx = string.lower().find(substr.lower(), pos - 1)
    return idx + 1 if idx != -1 else 0


def _is_truthy(val):
    if isinstance(val, str):
        return val.strip().lower() in ("true", "1", "t")
    return bool(val)


def _ensure_sequence_table(conn):
    if getattr(conn, "_frappe_sequences_ready", False):
        return
    try:
        conn.execute(
            "CREATE TABLE IF NOT EXISTS __frappe_sequences ("
            "name TEXT PRIMARY KEY, current_val INTEGER NOT NULL)"
        )
        conn._frappe_sequences_ready = True
    except Exception:
        pass


def _sqlite_setval(conn, seq_name, next_val, is_used=True):
    _ensure_sequence_table(conn)
    seq_name = str(seq_name).strip().strip("'\"`")
    next_val = int(next_val)
    stored_val = next_val if _is_truthy(is_used) else next_val - 1
    try:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO __frappe_sequences (name, current_val) VALUES (?, ?) "
            "ON CONFLICT(name) DO UPDATE SET current_val = ?",
            (seq_name, stored_val, stored_val),
        )
    except sqlite3.OperationalError as e:
        if "readonly" in str(e).lower():
            mem_seqs = getattr(conn, "_memory_sequences", None)
            if mem_seqs is None:
                mem_seqs = {}
                conn._memory_sequences = mem_seqs
            mem_seqs[seq_name] = stored_val
            return next_val
        raise
    return next_val


def _sqlite_nextval(conn, seq_name):
    _ensure_sequence_table(conn)
    seq_name = str(seq_name).strip().strip("'\"`")
    try:
        cur = conn.cursor()
        cur.execute("SELECT current_val FROM __frappe_sequences WHERE name = ?", (seq_name,))
        row = cur.fetchone()
        if row is not None:
            next_val = row[0] + 1
            cur.execute("UPDATE __frappe_sequences SET current_val = ? WHERE name = ?", (next_val, seq_name))
            return next_val

        # If not present in __frappe_sequences, determine starting value from existing table/sequence
        start_val = 0
        base_name = seq_name
        if base_name.endswith("_id_seq"):
            base_name = base_name[:-7]

        try:
            cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
            tables = [r[0] for r in cur.fetchall()]
        except Exception:
            tables = []

        matched_table = None
        for tbl in tables:
            clean = tbl[3:] if tbl.startswith("tab") else tbl
            scrubbed = re.sub(r"[-\s]+", "_", clean).lower()
            if scrubbed == base_name or tbl == base_name or tbl == f"tab{base_name}":
                matched_table = tbl
                break

        if matched_table:
            try:
                cur.execute(f'SELECT MAX(CAST(name AS INTEGER)) FROM "{matched_table}"')
                max_row = cur.fetchone()
                if max_row and max_row[0] is not None:
                    start_val = max(start_val, int(max_row[0]))
            except Exception:
                pass

            try:
                cur.execute("SELECT seq FROM sqlite_sequence WHERE name = ?", (matched_table,))
                seq_row = cur.fetchone()
                if seq_row and seq_row[0] is not None:
                    start_val = max(start_val, int(seq_row[0]))
            except Exception:
                pass

        next_val = start_val + 1
        cur.execute(
            "INSERT INTO __frappe_sequences (name, current_val) VALUES (?, ?) "
            "ON CONFLICT(name) DO UPDATE SET current_val = __frappe_sequences.current_val + 1",
            (seq_name, next_val),
        )
        cur.execute("SELECT current_val FROM __frappe_sequences WHERE name = ?", (seq_name,))
        result = cur.fetchone()
        return result[0] if result else next_val

    except sqlite3.OperationalError as e:
        if "readonly" in str(e).lower():
            mem_seqs = getattr(conn, "_memory_sequences", None)
            if mem_seqs is None:
                mem_seqs = {}
                conn._memory_sequences = mem_seqs
            val = mem_seqs.get(seq_name, 0) + 1
            mem_seqs[seq_name] = val
            return val
        raise


def attach_mariadb_functions(connection):
    """Register MariaDB-compatible helpers on one SQLite connection."""
    _ensure_sequence_table(connection)
    connection.create_function("nextval", 1, lambda seq: _sqlite_nextval(connection, seq))
    connection.create_function("setval", 2, lambda seq, val: _sqlite_setval(connection, seq, val, True))
    connection.create_function("setval", 3, lambda seq, val, used: _sqlite_setval(connection, seq, val, used))
    connection.create_function("mariadb_date_math", 3, _mariadb_date_math)
    connection.create_function("date_format", 2, _sql_date_format)
    connection.create_function("datediff", 2, _sql_datediff)
    connection.create_function("timestampdiff", 3, _sql_timestampdiff)
    connection.create_function("now", 0, lambda: datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
    connection.create_function("curdate", 0, lambda: datetime.now().strftime("%Y-%m-%d"))
    connection.create_function(
        "timestamp", 2,
        lambda day, clock: f"{str(day).split(' ')[0]} {clock}" if day and clock else day,
    )
    connection.create_function("curtime", 0, lambda: datetime.now().strftime("%H:%M:%S"))
    connection.create_function(
        "from_unixtime", 1,
        lambda value: datetime.fromtimestamp(float(value)).strftime("%Y-%m-%d %H:%M:%S")
        if value is not None else None,
    )
    connection.create_function(
        "unix_timestamp", 1,
        lambda value: (_to_datetime(value) - datetime(1970, 1, 1)).total_seconds()
        if _to_datetime(value) else None,
    )
    connection.create_function("concat", -1, _sql_concat)
    connection.create_function("concat_ws", -1, _sql_concat_ws)
    connection.create_function("field", -1, _sql_field)
    connection.create_function("locate", -1, _sql_locate)
    try:
        connection._mariadb_polyfills_attached = True
    except (AttributeError, TypeError):
        pass
    return connection


def install():
    """Patch Frappe's SQLite driver. Safe to call more than once."""
    try:
        from frappe.database.sqlite import database as sqlite_database
    except ImportError as error:
        print(f"[playground] skipping mariadb polyfills: {error}")
        return

    original_modify_query = sqlite_database.modify_query

    def modify_query(query):
        return rewrite_sql_for_sqlite(original_modify_query(query))

    sqlite_database.modify_query = modify_query

    original_multisql = getattr(sqlite_database.SQLiteDatabase, "multisql", None)

    def multisql(self, sql_dict, values=(), **kwargs):
        current_dialect = self.db_type or "sqlite"
        query = (
            sql_dict.get(current_dialect)
            or sql_dict.get("mariadb")
            or sql_dict.get("*")
        )
        return self.sql(query, values, **kwargs)

    sqlite_database.SQLiteDatabase.multisql = multisql

    def create_sequence(self, doctype_name, *args, **kwargs):
        try:
            from frappe import scrub
        except ImportError:
            scrub = lambda s: re.sub(r"[-\s]+", "_", str(s)).lower()
        slug = kwargs.get("slug", "_id_seq")
        sequence_name = scrub(f"{doctype_name}{slug}")
        start_value = kwargs.get("start_value", 0)
        if start_value:
            self.sql(f"SELECT setval('{sequence_name}', {int(start_value)}, false)")
        return sequence_name

    sqlite_database.SQLiteDatabase.create_sequence = create_sequence

    def get_next_sequence_val(self, doctype_name, slug="_id_seq"):
        try:
            from frappe import scrub
        except ImportError:
            scrub = lambda s: re.sub(r"[-\s]+", "_", str(s)).lower()
        sequence_name = scrub(f"{doctype_name}{slug}")
        return self.sql(f"SELECT nextval('{sequence_name}')")[0][0]

    sqlite_database.SQLiteDatabase.get_next_sequence_val = get_next_sequence_val

    def set_next_sequence_val(self, doctype_name, next_val, slug="_id_seq", is_val_used=False):
        try:
            from frappe import scrub
        except ImportError:
            scrub = lambda s: re.sub(r"[-\s]+", "_", str(s)).lower()
        sequence_name = scrub(f"{doctype_name}{slug}")
        is_used = "true" if is_val_used else "false"
        return self.sql(f"SELECT setval('{sequence_name}', {int(next_val)}, {is_used})")[0][0]

    sqlite_database.SQLiteDatabase.set_next_sequence_val = set_next_sequence_val

    original_get_values = sqlite_database.SQLiteDatabase.get_values

    def get_values(self, doctype, filters=None, *args, **kwargs):
        res = original_get_values(self, doctype, filters, *args, **kwargs)
        if res or not kwargs.get("run", True):
            return res

        # Case-insensitive fallback for SQLite when filtering on document name
        docname = None
        if isinstance(filters, str):
            docname = filters
        elif isinstance(filters, dict) and "name" in filters and isinstance(filters["name"], str):
            docname = filters["name"]
        elif isinstance(filters, list):
            for item in filters:
                if isinstance(item, (list, tuple)) and len(item) >= 3:
                    if item[0] == "name" and item[1] in ("=", "==") and isinstance(item[2], str):
                        docname = item[2]
                        break
                    elif len(item) == 4 and item[1] == "name" and item[2] in ("=", "==") and isinstance(item[3], str):
                        docname = item[3]
                        break

        if docname:
            try:
                import frappe
                from frappe.model.utils import is_single_doctype
                if not is_single_doctype(doctype):
                    table_name = frappe.utils.get_table_name(doctype)
                    matches = self.sql(
                        f'SELECT name FROM `{table_name}` WHERE name = ? COLLATE NOCASE LIMIT 1',
                        (docname,),
                    )
                    if matches and matches[0][0] and matches[0][0] != docname:
                        canonical_name = matches[0][0]
                        if isinstance(filters, str):
                            new_filters = canonical_name
                        elif isinstance(filters, dict):
                            new_filters = dict(filters)
                            new_filters["name"] = canonical_name
                        elif isinstance(filters, list):
                            new_filters = []
                            for item in filters:
                                if isinstance(item, (list, tuple)) and len(item) >= 3:
                                    if item[0] == "name" and item[1] in ("=", "==") and item[2] == docname:
                                        item = list(item)
                                        item[2] = canonical_name
                                        new_filters.append(item)
                                    elif len(item) == 4 and item[1] == "name" and item[2] in ("=", "==") and item[3] == docname:
                                        item = list(item)
                                        item[3] = canonical_name
                                        new_filters.append(item)
                                    else:
                                        new_filters.append(item)
                                else:
                                    new_filters.append(item)
                        else:
                            new_filters = filters

                        fallback_res = original_get_values(self, doctype, new_filters, *args, **kwargs)
                        if fallback_res:
                            try:
                                if hasattr(self, "value_cache") and isinstance(self.value_cache, dict):
                                    if doctype in self.value_cache:
                                        self.value_cache[doctype][docname] = self.value_cache[doctype].get(canonical_name, {})
                            except Exception:
                                pass
                            return fallback_res
            except Exception:
                pass

        return res

    sqlite_database.SQLiteDatabase.get_values = get_values

    original_is_primary_key_violation = getattr(sqlite_database.SQLiteDatabase, "is_primary_key_violation", None)

    def is_primary_key_violation(e):
        if hasattr(e, "sqlite_errorcode"):
            # 1555: SQLITE_CONSTRAINT_PRIMARYKEY
            # 2067: SQLITE_CONSTRAINT_UNIQUE
            # We treat both as PK violation so `ignore_if_duplicate` works
            if getattr(e, "sqlite_errorcode") in (1555, 2067):
                return True
        msg = str(e).lower()
        if "unique constraint failed" in msg or "primary key constraint failed" in msg:
            return True
        if original_is_primary_key_violation:
            return original_is_primary_key_violation(e)
        return False

    sqlite_database.SQLiteDatabase.is_primary_key_violation = staticmethod(is_primary_key_violation)

    original_execute_query = sqlite_database.SQLiteDatabase.execute_query

    def execute_query(self, query, values=None):
        if getattr(self, "_conn", None) and not getattr(self, "_mariadb_polyfills_attached", False):
            attach_mariadb_functions(self._conn)
            self._mariadb_polyfills_attached = True

        if re.match(r"^\s*CREATE\s+(?:TEMPORARY\s+)?SEQUENCE\b", str(query), re.IGNORECASE):
            m = re.search(
                r"CREATE\s+(?:TEMPORARY\s+)?SEQUENCE\s+(?:IF\s+NOT\s+EXISTS\s+)?([`'\"a-zA-Z0-9_]+)",
                str(query),
                re.IGNORECASE,
            )
            if m:
                seq_name = m.group(1).strip("`'\"")
                start_m = re.search(r"\bSTART\s+(\d+)", str(query), re.IGNORECASE)
                start_val = int(start_m.group(1)) if start_m else 1
                try:
                    _sqlite_setval(self._conn, seq_name, start_val, False)
                except Exception:
                    pass
            return self._cursor.execute("SELECT 1 WHERE 0")

        query = query.replace("%s", "?")
        try:
            if isinstance(values, dict):
                _values = {}
                for k, v in values.items():
                    if isinstance(v, (list, tuple)):
                        v_escaped = []
                        for item in v:
                            if isinstance(item, str) and "'" in item:
                                v_escaped.append(self.escape(item))
                            else:
                                v_escaped.append(f"'{item}'")
                        _values[k] = "(" + ", ".join(v_escaped) + ")"
                    elif isinstance(v, str) and "'" in v:
                        _values[k] = self.escape(v)
                    else:
                        _values[k] = f"'{v}'"
                query = query % _values
        except TypeError:
            pass
        return self._cursor.execute(query, values or ())

    sqlite_database.SQLiteDatabase.execute_query = execute_query

    original_get_connection = sqlite_database.SQLiteDatabase.get_connection

    def get_connection(self, read_only=False):
        return attach_mariadb_functions(original_get_connection(self, read_only=read_only))

    sqlite_database.SQLiteDatabase.get_connection = get_connection

    try:
        from frappe.model.document import Document
        original_load_from_db = Document.load_from_db

        def load_from_db(self):
            try:
                return original_load_from_db(self)
            except Exception as e:
                import frappe
                if (
                    isinstance(e, frappe.DoesNotExistError)
                    and not getattr(self.meta, "issingle", False)
                    and isinstance(self.name, str)
                ):
                    try:
                        table_name = frappe.utils.get_table_name(self.doctype)
                        matches = frappe.db.sql(
                            f'SELECT name FROM `{table_name}` WHERE name = ? COLLATE NOCASE LIMIT 1',
                            (self.name,),
                        )
                        if matches and matches[0][0] and matches[0][0] != self.name:
                            self.name = matches[0][0]
                            return original_load_from_db(self)
                    except Exception:
                        pass
                raise

        Document.load_from_db = load_from_db
    except ImportError:
        pass

    try:
        import frappe
        if getattr(frappe, "db", None) and getattr(frappe.db, "_conn", None):
            attach_mariadb_functions(frappe.db._conn)
    except Exception:
        pass

    sqlite_database._mariadb_polyfills_attached = True
    print("[playground] MariaDB->SQLite compatibility installed.")
