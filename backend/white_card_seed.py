"""v58.13.132kp — Auto-seed White Card (Construction Induction) records.

Fix scope
---------
User directive: "Remove access for all forms for all users" — the cert
gate is disabled by default in `.132kp`. To preserve a compliance
audit trail for the AU legal requirement that construction workers
hold a White Card (Construction Induction) — see WHS Reg 316A — this
migration seeds a placeholder `worker_certifications` row for every
worker who doesn't already have one.

Seeded rows carry `status="seeded"` and blank `issue_date` +
`expiry_date` so admins know at a glance that they still need to
verify and fill in the real credential. Workers with any existing
White Card record (regardless of status) are skipped — the migration
NEVER clobbers a manually-entered date.

Idempotent on every boot.

Log line shape:
    [migrate-white-card] org=<uuid> seeded=<n> skipped_existing=<n>
"""
from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime, timezone

from db import db

log = logging.getLogger("paneltec.white_card_seed")

# Match any existing record that ALREADY represents a White Card for
# this worker — regardless of the exact label (`White Card NSW`,
# `White Card (Construction Induction)`, `Construction Induction Card`,
# etc.). We skip when any such record exists, active or archived,
# because we don't want to duplicate.
_WHITE_CARD_RE = re.compile(r"white[\s_-]*card|construction[\s_-]*induction", re.I)

_SEEDED_LABEL = "White Card (Construction Induction)"
_SEEDED_NOTE = (
    "Auto-seeded on 2026-09-22 (v.132kp). Admin should verify and "
    "update issued/expiry dates. See ship memo "
    "v58_13_132kp_cert_gate_default_off.md."
)


async def seed_white_card_on_startup() -> dict:
    """One-time (per-worker) seed. Idempotent on every subsequent boot."""
    report = {"orgs_scanned": 0, "seeded": 0,
              "skipped_existing": 0, "by_org": {}}

    now = datetime.now(timezone.utc).isoformat()

    # Group workers by org so each org gets its own log line.
    orgs = await db.workers.distinct("org_id", {"deleted_at": None})
    for org_id in orgs:
        if not org_id:
            continue
        report["orgs_scanned"] += 1
        seeded_here = 0
        skipped_here = 0

        # Pre-fetch every worker_id in this org that ALREADY has a
        # White-Card-flavoured cert (active or archived). Bulk skip lookup.
        existing_worker_ids: set[str] = set()
        async for c in db.worker_certifications.find(
            {"org_id": org_id, "name": {"$regex": _WHITE_CARD_RE.pattern,
                                          "$options": "i"}},
            {"_id": 0, "worker_id": 1},
        ):
            wid = c.get("worker_id")
            if wid:
                existing_worker_ids.add(wid)

        # Iterate workers, insert placeholders for those without one.
        async for w in db.workers.find(
            {"org_id": org_id, "deleted_at": None},
            {"_id": 0, "id": 1},
        ):
            wid = w.get("id")
            if not wid:
                continue
            if wid in existing_worker_ids:
                skipped_here += 1
                continue
            doc = {
                "id": str(uuid.uuid4()),
                "org_id": org_id,
                "worker_id": wid,
                "name": _SEEDED_LABEL,
                "issuer": None,
                "issue_date": None,
                "expiry_date": None,
                "doc_file_id": None,
                "doc_folder_id": None,
                "notes": _SEEDED_NOTE,
                # v58.13.132kp — Distinct status for the seed. Not one of
                # the runtime statuses (`valid`, `expiring_soon`,
                # `no_expiry`, `expired`, `missing`); admin UI treats it
                # as a placeholder and highlights for review.
                "status": "seeded",
                "seeded_via_migration": True,
                "created_by": "system:migrate:.132kp",
                "created_at": now,
                "updated_at": now,
                "deleted_at": None,
            }
            try:
                await db.worker_certifications.insert_one(doc)
                seeded_here += 1
            except Exception as e:  # noqa: BLE001
                log.warning("white-card seed insert failed for worker %s: %s", wid, e)

        report["seeded"] += seeded_here
        report["skipped_existing"] += skipped_here
        report["by_org"][org_id] = {
            "seeded_new": seeded_here,
            "skipped_existing": skipped_here,
        }
        log.info(
            "[migrate-white-card] org=%s seeded=%d skipped_existing=%d",
            org_id, seeded_here, skipped_here,
        )

    log.info(
        "[migrate-white-card] summary: orgs=%d seeded=%d skipped_existing=%d",
        report["orgs_scanned"], report["seeded"], report["skipped_existing"],
    )
    return report
