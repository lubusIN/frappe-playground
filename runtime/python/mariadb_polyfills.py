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


def attach_mariadb_functions(connection):
    """Register MariaDB-compatible helpers on one SQLite connection."""
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

    original_is_primary_key_violation = sqlite_database.SQLiteDatabase.is_primary_key_violation

    def is_primary_key_violation(e):
        if hasattr(e, "sqlite_errorcode"):
            # 1555: SQLITE_CONSTRAINT_PRIMARYKEY
            # 2067: SQLITE_CONSTRAINT_UNIQUE
            # We treat both as PK violation so `ignore_if_duplicate` works
            if getattr(e, "sqlite_errorcode") in (1555, 2067):
                return True
        return original_is_primary_key_violation(e)

    sqlite_database.SQLiteDatabase.is_primary_key_violation = staticmethod(is_primary_key_violation)

    original_execute_query = sqlite_database.SQLiteDatabase.execute_query

    def execute_query(self, query, values=None):
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
    sqlite_database._mariadb_polyfills_attached = True
    print("[playground] MariaDB->SQLite compatibility installed.")
