"""v58.13.132le — Phase 1 mirror CLI.

Usage:
    python backend/scripts/dropbox_phase1_mirror.py --dry-run
    python backend/scripts/dropbox_phase1_mirror.py

Both are safe to re-run — the mirror is idempotent (keyed on
`dropbox_folder_id`).
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

BE_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BE_ROOT))
load_dotenv(BE_ROOT / ".env")

from dropbox_folder_mirror import run_mirror  # noqa: E402


def _on_progress(evt: dict) -> None:
    phase = evt.get("phase")
    if phase == "walk":
        print(f"[walk]   folders_seen={evt.get('folders_seen')}")
    elif phase == "upsert":
        print(
            f"[upsert] {evt.get('index')}/{evt.get('total')} "
            f"depth={evt.get('depth')} created={evt.get('created')} "
            f"updated={evt.get('updated')} "
            f"path={evt.get('current_path')}"
        )
    elif phase == "done":
        t = evt.get("totals", {})
        print(
            f"[done]   created={t.get('created')} "
            f"updated={t.get('updated')} "
            f"skipped_missing_parent={t.get('skipped_missing_parent')} "
            f"max_depth={t.get('max_depth')} "
            f"elapsed={t.get('elapsed_s'):.1f}s"
        )


async def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--dry-run", action="store_true",
                     help="Read-only walk; no writes to doc_folders.")
    p.add_argument("--json", action="store_true",
                     help="Emit machine-readable summary at end.")
    args = p.parse_args()

    summary = await run_mirror(
        dry_run=args.dry_run,
        on_progress=_on_progress,
    )
    print()
    if args.json:
        print(json.dumps(summary, indent=2, default=str))
    else:
        print("──── SUMMARY ────")
        for k, v in summary.items():
            print(f"  {k:28s} = {v}")
    return 0 if not summary.get("errors") else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
