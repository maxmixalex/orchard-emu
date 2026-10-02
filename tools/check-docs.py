#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Check TOML navigation/local Markdown links; not a replacement for Zensical."""
from pathlib import Path
import re
import sys
import tomllib
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent.parent


def walk(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, list):
        for item in value:
            yield from walk(item)
    elif isinstance(value, dict):
        for item in value.values():
            yield from walk(item)


def main() -> int:
    with (ROOT / "zensical.toml").open("rb") as stream:
        config = tomllib.load(stream)["project"]
    docs = ROOT / config.get("docs_dir", "docs")
    errors = []
    navigation = set(walk(config["nav"]))
    pages = sorted(docs.rglob("*.md"))
    for relative in navigation:
        if not (docs / relative).is_file():
            errors.append(f"Missing navigation page: {relative}")
    for page in pages:
        if page.relative_to(docs).as_posix() not in navigation:
            errors.append(f"Page not in navigation: {page.relative_to(docs)}")
    for page in pages + [ROOT / "README.md"]:
        for target in re.findall(r"\]\(([^\s)]+)\)", page.read_text(encoding="utf-8")):
            parts = urlsplit(target)
            if parts.scheme or parts.netloc or not parts.path:
                continue
            resolved = (page.parent / unquote(parts.path)).resolve()
            if not resolved.is_relative_to(ROOT) or not resolved.exists():
                errors.append(f"Broken local link in {page.relative_to(ROOT)}: {target}")
    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1
    print(f"{len(pages)} documentation pages: navigation and local link targets OK")
    print("Zensical rendering and link anchors require a separate strict build.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
