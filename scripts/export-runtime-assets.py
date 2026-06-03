#!/usr/bin/env python3
import argparse
import re
import shutil
import sys
from pathlib import Path


RUNTIME_ASSET_RE = re.compile(
    r"/?assets/frappe/node_modules/[A-Za-z0-9@._~+%/-]+"
)
SCAN_SUFFIXES = {
    ".css",
    ".html",
    ".js",
    ".json",
    ".svg",
    ".txt",
}
EXCLUDED_DIRS = {"node_modules", "scss", "less"}
NODE_MODULES_PREFIX = "assets/frappe/node_modules"
DEPLOY_SAFE_NODE_MODULES_PREFIX = "assets/frappe/runtime_modules"
ACE_LAZY_DIRS = (
    "assets/frappe/node_modules/ace-builds/src-noconflict",
    "assets/frappe/node_modules/ace-builds/src-min-noconflict",
)


def ignore_asset_entries(_directory, names):
    return [name for name in names if name in EXCLUDED_DIRS]


def copy_asset_tree(sites_dir, export_dir):
    source_assets = sites_dir / "assets"
    target_assets = export_dir / "assets"

    if not source_assets.is_dir():
        raise RuntimeError(f"Missing assets directory: {source_assets}")

    if target_assets.exists():
        shutil.rmtree(target_assets)

    shutil.copytree(source_assets, target_assets, ignore=ignore_asset_entries)


def normalize_runtime_path(path):
    path = path.lstrip("/")

    for ace_dir in ACE_LAZY_DIRS:
        if path.startswith(ace_dir):
            return ace_dir

    return path.rstrip("/")


def deploy_relative_path(path):
    if path.startswith(f"{NODE_MODULES_PREFIX}/"):
        return path.replace(NODE_MODULES_PREFIX, DEPLOY_SAFE_NODE_MODULES_PREFIX, 1)

    return path


def discover_runtime_paths(scan_dir):
    runtime_paths = set()

    for file_path in scan_dir.rglob("*"):
        if not file_path.is_file() or file_path.suffix not in SCAN_SUFFIXES:
            continue

        try:
            contents = file_path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            contents = file_path.read_text(encoding="utf-8", errors="ignore")

        for match in RUNTIME_ASSET_RE.finditer(contents):
            runtime_paths.add(normalize_runtime_path(match.group(0)))

    return sorted(runtime_paths)


def copy_runtime_path(sites_dir, export_dir, relative_path):
    source = sites_dir / relative_path
    target = export_dir / deploy_relative_path(relative_path)

    if source.is_dir():
        if target.exists():
            shutil.rmtree(target)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(source, target)
        return True

    if source.is_file():
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
        return True

    return False


def main():
    parser = argparse.ArgumentParser(
        description="Export Frappe assets and the node_modules runtime files they reference."
    )
    parser.add_argument("sites_dir", type=Path)
    parser.add_argument("export_dir", type=Path)
    args = parser.parse_args()

    sites_dir = args.sites_dir.resolve()
    export_dir = args.export_dir.resolve()

    export_dir.mkdir(parents=True, exist_ok=True)
    copy_asset_tree(sites_dir, export_dir)

    runtime_paths = discover_runtime_paths(export_dir / "assets")
    missing_paths = [
        path
        for path in runtime_paths
        if not copy_runtime_path(sites_dir, export_dir, path)
    ]

    if missing_paths:
        print("Missing runtime asset references:", file=sys.stderr)
        for path in missing_paths:
            print(f"  - {path}", file=sys.stderr)
        return 1

    if runtime_paths:
        print("Exported runtime node_modules assets:")
        for path in runtime_paths:
            print(f"  - {path}")
    else:
        print("No runtime node_modules assets referenced.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
