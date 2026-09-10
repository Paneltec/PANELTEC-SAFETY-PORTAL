#!/usr/bin/env python3
"""v58.8.1 + v58.13.132db — Version-file sanity guard.

Locks all four canonical version strings together:
  · frontend/src/lib/version.js#RUNNING_VERSION
  · frontend/src/lib/version.js#EXPECTED_CACHE_VERSION
  · frontend/public/service-worker.js#CACHE_VERSION
  · mobile/src/lib/version.ts#MOBILE_BUNDLE_VERSION

Escape hatch (.132db):
  Set env `MOBILE_VERSION_SYNC_OPTIONAL=true` to WARN-only on the
  mobile file when it lags. This exists specifically because the
  web-side agent is under a hard `/app/mobile/` edit ban and the
  Expo specialist bumps the mobile version on a separate ship
  cycle (typically one letter behind).

Note on `--no-verify`:
  This hook enforces the AT-COMMIT-TIME invariant. `git commit
  --no-verify` bypasses it, and CI on GitHub Actions is what
  ultimately protects `main`. If you --no-verify past this hook,
  make a note in the commit message so the post-merge CI diff
  is legible.

Usage:
  python backend/scripts/check_version_files_v58_8_1.py
    → exits 0 on pass, 1 on violation. Prints diagnosis.
"""
from __future__ import annotations
import os
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
FILES = [
    # (path, pattern, kind: 'strict' | 'mobile')
    (REPO / "frontend/src/lib/version.js",
     r"^export const RUNNING_VERSION\s*=\s*'([^']+)'", "strict"),
    (REPO / "frontend/src/lib/version.js",
     r"^export const EXPECTED_CACHE_VERSION\s*=\s*'([^']+)'", "strict"),
    (REPO / "frontend/public/service-worker.js",
     r"^const CACHE_VERSION\s*=\s*'([^']+)'", "strict"),
    (REPO / "mobile/src/lib/version.ts",
     r"^export const MOBILE_BUNDLE_VERSION\s*=\s*'([^']+)'", "mobile"),
]
VERSION_SHAPE = re.compile(r"^paneltec-v\d+\.\d+\.\d+\.\d+(?:\.\d+[a-z]*)*$")

MOBILE_OPTIONAL = os.environ.get("MOBILE_VERSION_SYNC_OPTIONAL", "").lower() in ("1", "true", "yes")


def main() -> int:
    errors: list[str] = []
    warnings: list[str] = []
    strict_versions: dict[str, str] = {}
    mobile_versions: dict[str, str] = {}
    for path, pattern, kind in FILES:
        if not path.exists():
            (warnings if kind == "mobile" else errors).append(
                f"MISSING: {path.relative_to(REPO)}"
            )
            continue
        pat = re.compile(pattern, re.MULTILINE)
        matches = pat.findall(path.read_text(encoding="utf-8"))
        rel = str(path.relative_to(REPO))
        if len(matches) == 0:
            (warnings if kind == "mobile" else errors).append(
                f"NO EXPORT: {rel} has no `{pattern}` line — was the "
                f"file accidentally cleaned up?"
            )
        elif len(matches) > 1:
            (warnings if kind == "mobile" else errors).append(
                f"DUPLICATE: {rel} has {len(matches)} canonical exports; "
                f"expected exactly 1. Values: {matches}"
            )
        else:
            v = matches[0]
            if not VERSION_SHAPE.match(v):
                (warnings if kind == "mobile" else errors).append(
                    f"BAD SHAPE: {rel} has non-canonical version string {v!r}"
                )
            elif kind == "mobile":
                mobile_versions[rel] = v
            else:
                # Use "rel#slot_name" so multiple slots per file don't collide.
                slot = "RUNNING" if "RUNNING_VERSION" in pattern \
                    else "EXPECTED" if "EXPECTED_CACHE_VERSION" in pattern \
                    else "CACHE"
                strict_versions[f"{rel}#{slot}"] = v

    # Strict slot must all agree.
    if len(set(strict_versions.values())) > 1:
        errors.append(
            f"MISMATCH (STRICT): the 3 web version strings don't agree: "
            f"{strict_versions}"
        )

    # Mobile must agree with strict, unless MOBILE_VERSION_SYNC_OPTIONAL.
    if mobile_versions and strict_versions:
        strict_v = next(iter(set(strict_versions.values())), None)
        mobile_v = next(iter(set(mobile_versions.values())), None)
        if strict_v and mobile_v and strict_v != mobile_v:
            msg = (
                f"MISMATCH (MOBILE): mobile lags — web={strict_v!r}, "
                f"mobile={mobile_v!r}. Expo specialist should bump "
                f"mobile/src/lib/version.ts on the next Expo ship."
            )
            if MOBILE_OPTIONAL:
                warnings.append(msg)
            else:
                errors.append(msg)
                errors.append(
                    "  To ship the web side alone, re-run with "
                    "MOBILE_VERSION_SYNC_OPTIONAL=true or "
                    "`git commit --no-verify` (leave a note in the "
                    "commit message)."
                )

    if warnings:
        print("Version-file sanity guard — WARNINGS")
        for w in warnings:
            print(f"  ⚠ {w}")
    if errors:
        print("Version-file sanity guard FAILED")
        for e in errors:
            print(f"  · {e}")
        return 1
    all_versions = {**strict_versions, **mobile_versions}
    print(f"Version-file sanity guard OK — {len(all_versions)} slots "
          f"agree on {next(iter(set(strict_versions.values())))!r}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
