"""v58.13.132gd — Drift-check for the platform manual.

Compares the current codebase state against the values baked into
`docs/paneltec_group_platform_manual.md` and warns if the drift
exceeds ~5 % on any axis. Intended for a git pre-commit hook or a
CI smoke run.

Exit code:
  0 · manual is in sync (all axes within tolerance)
  1 · usage error
  2 · drift detected — suggest a regeneration

Usage:
    python3 scripts/check_manual_drift.py
"""
from __future__ import annotations

import re
import sys
from pathlib import Path
from collections import defaultdict

APP_ROOT = Path(__file__).resolve().parents[1]
BACKEND = APP_ROOT / "backend"
FRONTEND = APP_ROOT / "frontend"
DOCS = APP_ROOT / "docs"
MANUAL = DOCS / "paneltec_group_platform_manual.md"

TOLERANCE = 0.05  # 5 %


def _read(p: Path) -> str:
    try:
        return p.read_text(encoding="utf-8", errors="replace")
    except FileNotFoundError:
        return ""


def _count_endpoints_now() -> int:
    verb_re = re.compile(
        r'@\w*_?router\.(?:get|post|put|patch|delete)\(\s*"',
    )
    total = 0
    for py in BACKEND.glob("*.py"):
        total += len(verb_re.findall(_read(py)))
    return total


def _count_collections_now() -> int:
    coll_re = re.compile(
        r'\bdb\.([a-z_][a-z0-9_]+)\.(?:find|find_one|insert_one|'
        r'insert_many|update_one|update_many|delete_one|delete_many|'
        r'aggregate|count_documents|distinct|create_index)',
    )
    touches: set[str] = set()
    for py in BACKEND.glob("*.py"):
        for m in coll_re.finditer(_read(py)):
            touches.add(m.group(1))
    return len(touches)


def _count_pages_now() -> int:
    return len(list((FRONTEND / "src" / "pages").glob("*.jsx")))


def _parse_manual_counts() -> dict:
    """Extract the three counts the manual bakes into its executive
    summary paragraph."""
    src = _read(MANUAL)
    m = re.search(
        r"exposes\s*\*\*(\d+)\*\*\s+authenticated HTTP endpoints "
        r"across\s*\*\*(\d+)\*\*\s+backend modules,\s*tracks state in\s*"
        r"\*\*(\d+)\*\*\s+MongoDB collections, and renders\s*"
        r"\*\*(\d+)\*\*\s+distinct React pages",
        src,
    )
    if not m:
        return {}
    return {
        "endpoints_grep": int(m.group(1)),  # grep-based (exec summary)
        "modules": int(m.group(2)),
        "collections": int(m.group(3)),
        "pages": int(m.group(4)),
    }


def _drift(current: int, declared: int) -> float:
    if declared == 0:
        return 1.0 if current else 0.0
    return abs(current - declared) / declared


def main() -> int:
    if not MANUAL.exists():
        print(f"! manual missing at {MANUAL} — run "
              "`python3 scripts/regenerate_manual.py`")
        return 2
    declared = _parse_manual_counts()
    if not declared:
        print(f"! could not parse the executive summary counts in "
              f"{MANUAL} — regenerate the manual to reset the anchor.")
        return 2

    now = {
        "endpoints_grep": _count_endpoints_now(),
        "collections": _count_collections_now(),
        "pages": _count_pages_now(),
    }
    print(f"[drift] manual anchor: "
          f"endpoints={declared['endpoints_grep']} · "
          f"collections={declared['collections']} · "
          f"pages={declared['pages']}")
    print(f"[drift] codebase now : "
          f"endpoints={now['endpoints_grep']} · "
          f"collections={now['collections']} · "
          f"pages={now['pages']}")

    drift_flag = False
    for key in ("endpoints_grep", "collections", "pages"):
        d = _drift(now[key], declared[key])
        marker = "✓" if d <= TOLERANCE else "✗"
        print(f"  {marker} {key:16s} drift {d*100:5.1f} %")
        if d > TOLERANCE:
            drift_flag = True

    if drift_flag:
        print()
        print("Manual is out of sync with the codebase. Regenerate:")
        print("    python3 scripts/regenerate_manual.py")
        print("Then commit the refreshed docs/*.md + docs/*.docx.")
        return 2

    print("[drift] manual is within tolerance — no regeneration needed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
