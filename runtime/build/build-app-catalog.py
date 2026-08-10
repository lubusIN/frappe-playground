#!/usr/bin/env python3
import hashlib
import json
import subprocess
import sys
import zipfile
from pathlib import Path


FIXED_ZIP_TIME = (2020, 1, 1, 0, 0, 0)
EXCLUDED_PARTS = {".git", "__pycache__", "node_modules"}


def run(command, cwd=None):
    subprocess.run(command, cwd=cwd, check=True)


def clone_at_commit(repository, ref, target):
    run(["git", "init", str(target)])
    run(["git", "-C", str(target), "remote", "add", "origin", repository])
    run(["git", "-C", str(target), "fetch", "--depth", "1", "origin", ref])
    run(["git", "-C", str(target), "checkout", "--detach", "FETCH_HEAD"])


def deterministic_zip(source, archive, package_root, archive_excludes):
    files = sorted(
        path for path in source.rglob("*")
        if path.is_file()
        and not any(part in EXCLUDED_PARTS for part in path.parts)
        and path.suffix != ".pyc"
        and path.relative_to(source).parts[0] not in archive_excludes
        and not path.name.startswith("test_")
    )
    archive.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as output:
        for file_path in files:
            relative = file_path.relative_to(source)
            info = zipfile.ZipInfo(str(Path(package_root) / relative), FIXED_ZIP_TIME)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            output.writestr(info, file_path.read_bytes(), compresslevel=9)


def main():
    if len(sys.argv) != 4:
        raise SystemExit("Usage: build-app-catalog.py <catalog> <bench-dir> <output-dir>")

    catalog_path = Path(sys.argv[1]).resolve()
    bench_dir = Path(sys.argv[2]).resolve()
    output_dir = Path(sys.argv[3]).resolve()
    catalog = json.loads(catalog_path.read_text())
    source_catalog_sha256 = hashlib.sha256(json.dumps(
        catalog,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode()).hexdigest()
    generated_apps = []

    for app in catalog["apps"]:
        app_dir = bench_dir / "apps" / app["id"]
        clone_at_commit(app["source"]["repository"], app["source"]["ref"], app_dir)
        python = bench_dir / "env" / "bin" / "python"
        run([str(python), "-m", "pip", "install", "-e", str(app_dir)])
        if (app_dir / "package.json").is_file():
            run(["yarn", "install", "--frozen-lockfile"], cwd=app_dir)
        apps_file = bench_dir / "sites" / "apps.txt"
        installed_apps = apps_file.read_text().splitlines()
        if app["id"] not in installed_apps:
            apps_file.write_text(f"{apps_file.read_text().rstrip()}\n{app['id']}\n")
        run(["bench", "build", "--app", app["id"]], cwd=bench_dir)

        archive = output_dir / app["archive"]
        deterministic_zip(
            app_dir / app["packageRoot"],
            archive,
            app["packageRoot"],
            set(app.get("archiveExcludes", [])),
        )
        contents = archive.read_bytes()
        generated_apps.append({
            **app,
            "archiveBytes": len(contents),
            "archiveSha256": hashlib.sha256(contents).hexdigest(),
        })

    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "apps" / "catalog.json").write_text(json.dumps({
        "schemaVersion": catalog["schemaVersion"],
        "sourceCatalogSha256": source_catalog_sha256,
        "apps": generated_apps,
    }, indent=2) + "\n")


if __name__ == "__main__":
    main()
