"""Package Python while omitting verified browser-only Frappe assets."""

import argparse
import gettext
from pathlib import Path
import struct
import tarfile


# Keep scripts used by Python hooks, icon directories inspected during boot,
# and CSS/SCSS/templates that server-side rendering or theme code can read.
BROWSER_ONLY_DIRECTORIES = ("css/fonts", "images", "sounds")


def package_runtime(archive_root, published_assets, destination):
    for source in sorted((archive_root / "frappe/locale").glob("*.po")):
        compiled = published_assets / "locale" / source.stem / "LC_MESSAGES/frappe.mo"
        try:
            with compiled.open("rb") as catalog:
                gettext.GNUTranslations(catalog)
        except (OSError, EOFError, ValueError, struct.error) as error:
            raise RuntimeError(f"Missing or invalid compiled Frappe catalog: {source.stem}") from error

    public_root = archive_root / "frappe/public"
    omitted = set()
    for directory in BROWSER_ONLY_DIRECTORIES:
        for source in sorted((public_root / directory).rglob("*")):
            if not source.is_file():
                continue
            relative = source.relative_to(public_root)
            published = published_assets / "frappe" / relative
            if not published.is_file() or source.read_bytes() != published.read_bytes():
                raise RuntimeError(f"Missing or different published Frappe asset: {relative}")
            omitted.add(source.relative_to(archive_root).as_posix())

    def include(member):
        name = member.name.removeprefix("./")
        if name in omitted:
            return None
        if name.startswith("frappe/locale/") and name.endswith((".po", ".pot")):
            return None
        return member

    with tarfile.open(destination, "w:gz", compresslevel=6) as archive:
        archive.add(archive_root, arcname=".", filter=include)
    print(f"Core archive: omitted {len(omitted)} verified browser-only asset copies.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive_root", type=Path)
    parser.add_argument("published_assets", type=Path)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    package_runtime(args.archive_root, args.published_assets, args.destination)
