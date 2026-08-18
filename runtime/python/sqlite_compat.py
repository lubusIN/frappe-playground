"""MariaDB -> SQLite query compatibility for apps that assume MariaDB.

Frappe's own SQLite driver already rewrites backticks, ``locate()`` and
``from tabX``, and registers ``regexp``/``regexp_replace``. It does not handle
MariaDB's date functions, which ERPNext uses in roughly a dozen files.

Two mechanisms are used here:

* Bare function calls (``DATEDIFF``, ``DATE_FORMAT``, ``CURDATE`` ...) are
  registered as SQLite user functions, so no rewriting is needed and nested
  expressions keep working.
* Constructs that are *syntax* rather than function calls (``INTERVAL n UNIT``,
  ``ON DUPLICATE KEY UPDATE``, ``IF(...)``) are rewritten textually, using a
  paren-aware scanner rather than a flat regex, because ERPNext nests calls
  such as ``DATE_ADD(IFNULL(a, b), INTERVAL 1 DAY)``.

Known limitation: textual rewriting does not parse string literals, so a
literal containing e.g. "ON DUPLICATE KEY UPDATE" would be rewritten too. No
such literal exists in the checked ERPNext source.
"""

import re
from datetime import datetime, timedelta

__all__ = ["translate_query", "register_sqlite_functions", "install"]

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
    """Rewrite DATE_ADD/DATE_SUB to the mysql_dateadd user function.

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
    return f"mysql_dateadd({args[0]}, ({amount}) * {1 if sign == '+' else -1}, '{unit}')"


def _translate_if(args):
    return f"IIF({', '.join(args)})" if len(args) == 3 else None


def _translate_timestampdiff(args):
    # MySQL passes the unit as a bare keyword; SQLite would read it as a column.
    if len(args) != 3:
        return None
    return f"timestampdiff('{args[0].strip().strip(chr(39))}', {args[1]}, {args[2]})"


def translate_query(sql):
    """Apply every MariaDB -> SQLite translation to one query string."""
    sql = str(sql)

    sql = _rewrite_calls(sql, "DATE_ADD", lambda args: _date_add(args, "+"))
    sql = _rewrite_calls(sql, "ADDDATE", lambda args: _date_add(args, "+"))
    sql = _rewrite_calls(sql, "DATE_SUB", lambda args: _date_add(args, "-"))
    sql = _rewrite_calls(sql, "SUBDATE", lambda args: _date_add(args, "-"))
    sql = _rewrite_calls(sql, "IF", _translate_if)
    sql = _rewrite_calls(sql, "TIMESTAMPDIFF", _translate_timestampdiff)

    # Upsert syntax. Frappe's SQLite driver already emits the ON CONFLICT form
    # for its own writes; this covers app-authored SQL.
    sql = re.sub(
        r"ON\s+DUPLICATE\s+KEY\s+UPDATE",
        "ON CONFLICT DO UPDATE SET",
        sql,
        flags=re.IGNORECASE,
    )
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


def _mysql_dateadd(value, amount, unit):
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


def register_sqlite_functions(connection):
    """Register MariaDB-compatible helpers on one SQLite connection."""
    connection.create_function("mysql_dateadd", 3, _mysql_dateadd)
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
    """Patch Frappe's SQLite driver. Safe to call more than once.

    Must run before ``frappe.connect()``: the user functions are registered in
    ``get_connection``, and a connection opened before the patch would not have
    them. Failure is raised rather than swallowed, because the alternative is a
    confusing "no such function: date_format" much later in a request.
    """
    try:
        from frappe.database.sqlite import database as sqlite_database
    except ImportError as error:
        raise ImportError(
            "Could not patch Frappe's SQLite driver for MariaDB compatibility: "
            f"{error}. The runtime archive may be incomplete, or this Frappe "
            "version may have moved frappe.database.sqlite.database."
        ) from error

    if getattr(sqlite_database, "_playground_compat_installed", False):
        return

    original_modify_query = sqlite_database.modify_query

    def modify_query(query):
        return translate_query(original_modify_query(query))

    sqlite_database.modify_query = modify_query

    original_get_connection = sqlite_database.SQLiteDatabase.get_connection

    def get_connection(self, read_only=False):
        return register_sqlite_functions(original_get_connection(self, read_only=read_only))

    sqlite_database.SQLiteDatabase.get_connection = get_connection
    sqlite_database._playground_compat_installed = True
    print("[playground] MariaDB->SQLite compatibility installed.")
