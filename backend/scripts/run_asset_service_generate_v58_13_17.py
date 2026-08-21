#!/usr/bin/env python3
"""v58.13.17 — Manual invocation of the asset-service-generate cron.

Default: dry-run (no writes). Add `--commit` to actually persist.
"""
from __future__ import annotations
import argparse, asyncio, os, sys
from pathlib import Path

_BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_BACKEND))
_env = _BACKEND / ".env"
if _env.exists():
    for _line in _env.read_text(encoding="utf-8").splitlines():
        _line = _line.strip()
        if not _line or _line.startswith("#") or "=" not in _line: continue
        _k, _, _v = _line.partition("=")
        os.environ.setdefault(_k.strip(), _v.strip().strip('"').strip("'"))

from cron_asset_service_generate import run_generate  # noqa: E402


async def _main():
    p = argparse.ArgumentParser()
    p.add_argument("--commit", action="store_true",
                   help="Actually write records (default: dry-run)")
    args = p.parse_args()
    mode = "COMMIT" if args.commit else "DRY-RUN"
    print(f"[v58.13.17] running in {mode} mode")
    stats = await run_generate(commit=args.commit)
    print(f"[v58.13.17] scanned={stats['scanned']} fired={stats['fired']}")
    print(f"[v58.13.17] skipped_stale={stats['skipped_stale']} "
          f"skipped_no_asset={stats['skipped_no_asset']} "
          f"skipped_no_track={stats['skipped_no_track']} "
          f"not_yet_due={stats['not_yet_due']} errors={stats['errors']}")
    print(f"[v58.13.17] duration_ms={stats['duration_ms']}")
    if stats["generated"]:
        print(f"[v58.13.17] would-generate ({len(stats['generated'])} records):"
              if not args.commit else "[v58.13.17] generated records:")
        for r in stats["generated"][:20]:
            print(f"  · schedule_id={r['schedule_id']} asset_id={r['asset_id']} "
                  f"title={r['title']!r} hours_at={r['hours_at']} km_at={r['km_at']}")
        if len(stats["generated"]) > 20:
            print(f"  … and {len(stats['generated']) - 20} more")


if __name__ == "__main__":
    sys.exit(asyncio.run(_main()) or 0)
