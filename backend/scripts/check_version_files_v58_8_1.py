#!/usr/bin/env python3
"""v58.8.1 — Version-file sanity guard.

The v58.8.1 P0 was a duplicate `export const RUNNING_VERSION` in
`frontend/src/lib/version.js` that broke the babel build. Root cause:
this session's version-bump pattern was "append a new comment block
+ `export const` line" without deleting the previous export. Once the
comment block was later cleaned up, the orphan export was left behind.

This script hard-fails when any of the 3 canonical version files
carries more than one canonical export declaration. Wire it into any
pre-commit or CI hook — a duplicate export must never ship again.

Also enforces:
  · All three canonical version strings AGREE (same version suffix).
  · The version string matches the expected `paneltec-vN.N.N.N.N`
    shape.

Usage:
  python backend/scripts/check_version_files_v58_8_1.py
    → exits 0 on pass, 1 on any violation. Prints a human-readable
      diagnosis.
"""
from __future__ import annotations
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
FILES = [
    (REPO / "frontend/src/lib/version.js",         r"^export const RUNNING_VERSION\s*=\s*'([^']+)'"),
    (REPO / "mobile/src/lib/version.ts",           r"^export const MOBILE_BUNDLE_VERSION\s*=\s*'([^']+)'"),
    (REPO / "frontend/public/service-worker.js",   r"^const CACHE_VERSION\s*=\s*'([^']+)'"),
]
VERSION_SHAPE = re.compile(r"^paneltec-v\d+\.\d+\.\d+\.\d+(?:\.\d+)*$")


def main() -> int:
    errors: list[str] = []
    versions: dict[str, str] = {}
    for path, pattern in FILES:
        if not path.exists():
            errors.append(f"MISSING: {path}")
            continue
        pat = re.compile(pattern, re.MULTILINE)
        matches = pat.findall(path.read_text(encoding="utf-8"))
        if len(matches) == 0:
            errors.append(f"NO EXPORT: {path.relative_to(REPO)} has "
                          f"no `{pattern}` line — was the file "
                          f"accidentally cleaned up?")
        elif len(matches) > 1:
            errors.append(f"DUPLICATE: {path.relative_to(REPO)} has "
                          f"{len(matches)} canonical exports; expected "
                          f"exactly 1. Values: {matches}")
        else:
            v = matches[0]
            versions[str(path.relative_to(REPO))] = v
            if not VERSION_SHAPE.match(v):
                errors.append(f"BAD SHAPE: {path.relative_to(REPO)} "
                              f"has non-canonical version string {v!r}")

    if len(set(versions.values())) > 1:
        errors.append(f"MISMATCH: version strings don't agree "
                      f"across the 3 canonical files: {versions}")

    if errors:
        print("Version-file sanity guard FAILED")
        for e in errors:
            print(f"  · {e}")
        return 1
    print(f"Version-file sanity guard OK — all 3 files agree on "
          f"{list(versions.values())[0]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
