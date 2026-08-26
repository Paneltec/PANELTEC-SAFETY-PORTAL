"""v58.13.56 — HR-merge lite migration (Ship A, additive).

Copies four HR flags from `hr_employees` onto matching `workers` rows.
Non-destructive: `hr_employees` collection is NOT touched. On
`--dry-run` (default) nothing is written; on `--commit` matched
workers are updated.

Matching precedence:
  1. hr_employees.linked_worker_id → workers.id (authoritative)
  2. Case-insensitive `email` (both trimmed)
  3. Case-insensitive `first_name` + `last_name` (both trimmed)

Fields copied: `employee_id`, `date_employee_added`, `working_visa`,
`do_not_rehire`. HR values normalised: string 'true' / 'y' / '1' →
True; anything else → False. `working_visa` and `do_not_rehire`
land as booleans. `date_employee_added` copied as-is.

Report written to `db.app_state.hr_merge_v58_13_56` and stdout:
  matched_by_link / matched_by_email / matched_by_name / conflicts
  / no_match / would_update / written.

Ship B (v58.13.57) will retire the HR page + drawer + linker
wizards + PII reveal endpoints. Nothing in this script prepares
that retirement — additive-only.
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys
from pathlib import Path
from typing import Any, Dict, Optional


_BACKEND = Path(__file__).resolve().parent.parent
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))
_env = _BACKEND / ".env"
if _env.exists():
    for _line in _env.read_text(encoding="utf-8").splitlines():
        _line = _line.strip()
        if not _line or _line.startswith("#") or "=" not in _line:
            continue
        _k, _, _v = _line.partition("=")
        os.environ.setdefault(_k.strip(), _v.strip().strip('"').strip("'"))

from motor.motor_asyncio import AsyncIOMotorClient

logging.basicConfig(level=logging.INFO,
                    format="[%(asctime)s] %(levelname)s %(message)s")
log = logging.getLogger("v58_13_56_hr_merge")

_TRUE = {"true", "t", "yes", "y", "1"}


def _to_bool(v: Any) -> bool:
    if isinstance(v, bool):
        return v
    if v is None:
        return False
    return str(v).strip().lower() in _TRUE


def _norm(s: Optional[str]) -> str:
    return (s or "").strip().lower() if isinstance(s, str) else ""


def _extract_hr_fields(h: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "employee_id": (h.get("employee_id") or None),
        "date_employee_added": (h.get("date_employee_added") or None),
        "working_visa": _to_bool(h.get("working_visa")),
        "do_not_rehire": _to_bool(h.get("do_not_rehire")),
    }


async def main(commit: bool) -> Dict[str, Any]:
    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME", "test_database")
    if not mongo_url:
        raise SystemExit("MONGO_URL not set in env")
    c = AsyncIOMotorClient(mongo_url, serverSelectionTimeoutMS=10_000)
    db = c[db_name]
    log.info("Connected to %s (commit=%s)", db_name, commit)

    # Build worker lookup indexes (org-agnostic — this migration is per-tenant
    # in practice but we don't scope org here, single-tenant preview).
    workers_by_id: Dict[str, Dict[str, Any]] = {}
    workers_by_email: Dict[str, Dict[str, Any]] = {}
    workers_by_name: Dict[str, Dict[str, Any]] = {}
    async for w in db.workers.find({"deleted_at": None}, {"_id": 0}):
        workers_by_id[w["id"]] = w
        e = _norm(w.get("email"))
        if e:
            workers_by_email[e] = w
        n = f"{_norm(w.get('first_name'))} {_norm(w.get('last_name'))}".strip()
        if n:
            workers_by_name[n] = w
    log.info("workers indexed: %d by id / %d by email / %d by name",
             len(workers_by_id), len(workers_by_email), len(workers_by_name))

    report = {
        "hr_scanned": 0,
        "matched_by_link": 0,
        "matched_by_email": 0,
        "matched_by_name": 0,
        "conflicts": 0,
        "no_match": 0,
        "would_update": 0,
        "written": 0,
        "unmatched_samples": [],
    }
    seen_worker_ids: set = set()
    updates: Dict[str, Dict[str, Any]] = {}

    async for h in db.hr_employees.find({"deleted_at": None}, {"_id": 0}):
        report["hr_scanned"] += 1
        w = None
        why = None
        wid = h.get("linked_worker_id")
        if wid and wid in workers_by_id:
            w, why = workers_by_id[wid], "link"
        if not w:
            e = _norm(h.get("email"))
            if e and e in workers_by_email:
                w, why = workers_by_email[e], "email"
        if not w:
            n = f"{_norm(h.get('first_name'))} {_norm(h.get('last_name'))}".strip()
            if n and n in workers_by_name:
                w, why = workers_by_name[n], "name"
        if not w:
            report["no_match"] += 1
            if len(report["unmatched_samples"]) < 10:
                report["unmatched_samples"].append({
                    "employee_id": h.get("employee_id"),
                    "name": f"{h.get('first_name','')} {h.get('last_name','')}".strip(),
                    "email": h.get("email"),
                })
            continue

        if w["id"] in seen_worker_ids:
            report["conflicts"] += 1
            continue
        seen_worker_ids.add(w["id"])

        report[f"matched_by_{why}"] += 1
        payload = _extract_hr_fields(h)
        updates[w["id"]] = payload
        report["would_update"] += 1

    log.info("Match summary: link=%d email=%d name=%d conflicts=%d "
             "no_match=%d would_update=%d",
             report["matched_by_link"], report["matched_by_email"],
             report["matched_by_name"], report["conflicts"],
             report["no_match"], report["would_update"])

    if commit and updates:
        from datetime import datetime, timezone
        now_iso = datetime.now(timezone.utc).isoformat()
        for wid, payload in updates.items():
            payload["updated_at"] = now_iso
            r = await db.workers.update_one(
                {"id": wid, "deleted_at": None},
                {"$set": payload},
            )
            if r.modified_count:
                report["written"] += 1
        report["committed_at"] = now_iso
        log.info("committed %d worker updates", report["written"])
    elif not commit:
        log.info("dry-run: no writes performed")

    # Persist a summary so subsequent operators can see the last run.
    await db.app_state.update_one(
        {"_id": "hr_merge_v58_13_56"},
        {"$set": {"report": report, "commit": commit}},
        upsert=True,
    )
    return report


def _parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--commit", action="store_true",
                   help="Actually write updates. Default is dry-run.")
    return p.parse_args()


if __name__ == "__main__":
    args = _parse_args()
    result = asyncio.run(main(commit=args.commit))
    print()
    print("=== v58.13.56 HR-merge lite report ===")
    for k, v in result.items():
        print(f"  {k:<24} = {v}")
