#!/usr/bin/env python3
"""Patch SQLite database driver in Frappe to handle SQLite constraint errors in ignore_if_duplicate."""

import re
import sys
from pathlib import Path


def patch_file(file_path: Path):
    if not file_path.is_file():
        print(f"Skipping non-existent file: {file_path}")
        return

    text = file_path.read_text(encoding="utf-8")

    # 1. If SQLiteExceptionUtil has is_primary_key_violation checking 1555, update it to include 2067
    if "return e.sqlite_errorcode == 1555" in text:
        text = text.replace(
            "return e.sqlite_errorcode == 1555",
            "return e.sqlite_errorcode in (1555, 2067)",
        )
        file_path.write_text(text, encoding="utf-8")
        print(f"Successfully patched sqlite_errorcode in {file_path}")
        return

    # 2. If already using (1555, 2067), nothing to do
    if "1555, 2067" in text:
        print(f"Already patched: {file_path}")
        return

    # 3. Fallback: inject method into SQLiteDatabase class
    match = re.search(r"^class SQLiteDatabase(\([^)]*\))?:", text, re.MULTILINE)
    if not match:
        raise ValueError(f"Could not find class SQLiteDatabase in {file_path}")

    lines = text[match.end():].splitlines(keepends=True)
    indent = "\t"
    for line in lines:
        if line.strip() and not line.strip().startswith("#"):
            indent = line[:len(line) - len(line.lstrip())]
            break

    sub_indent = indent + indent
    method_lines = [
        f"{indent}@staticmethod",
        f"{indent}def is_primary_key_violation(e, *args):",
        f"{sub_indent}if args:",
        f"{sub_indent}{indent}e = args[0]",
        f"{sub_indent}if hasattr(e, 'sqlite_errorcode'):",
        f"{sub_indent}{indent}return getattr(e, 'sqlite_errorcode') in (1555, 2067)",
        f"{sub_indent}msg = str(e).lower()",
        f"{sub_indent}return 'unique constraint failed' in msg or 'primary key constraint failed' in msg",
        "",
    ]
    method_str = "\n" + "\n".join(method_lines)

    new_text = text[:match.end()] + method_str + text[match.end():]
    file_path.write_text(new_text, encoding="utf-8")
    print(f"Successfully patched {file_path}")


def main():
    if len(sys.argv) < 2:
        print("Usage: patch-sqlite-database.py <path-to-database.py> ...")
        sys.exit(1)

    for arg in sys.argv[1:]:
        patch_file(Path(arg))


if __name__ == "__main__":
    main()
