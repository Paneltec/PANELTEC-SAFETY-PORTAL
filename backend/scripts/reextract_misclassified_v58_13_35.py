"""v160.3.9.58.13.35 — Ship 4b · Backfill re-extraction of the 3 776
misclassified `pre_starts` records (cache-derived mode).

Fixes the historical fallout of the pre-v58.13.30 bulk-import
pipeline that shoehorned SSRAs / permits / non-pre-start forms into
`pre_starts` with `template_name_snapshot=None` and
`template_category_snapshot=None`. All 3 776 offenders currently
render on the Daily Pre-Starts tile as `Unclassified`.

Cache-derived mode ($0, no Claude calls)
----------------------------------------
Uses the CACHED classifier output already sitting in
`bulk_import_pdf_cache` (populated when the PDF was first ingested)
plus the filename-inferred template name parsed out of
`pre_starts.work_summary`. Resolves against the new v58.13.34 roster
(form_templates ∪ list_forms), stamps `template_name_snapshot` +
`template_category_snapshot`, and — when the new category is
`hazard`/`swms`/`permit` — MIGRATES the record: soft-deletes the
`pre_starts` shim, inserts a `form_submissions` row using the cached
`extracted` payload as the fields[] source, and stamps
`metadata.needs_review=true` +
`metadata.reextract_reason='v58_13_35_partial_cache_only'` so HSEQ
knows the SSRA-specific fields (hazards[]/crew[]/TAILGATE) are not
yet populated — the cache extractor ran with the OLD Daily-Pre-Start
prompt shape. A future ZIP-source re-extraction ship (parked) will
restore full SSRA field coverage.

CLI
---
    --dry-run              (default) zero writes
    --commit               real execution
    --limit N              process at most N records
    --scope {all,ssra,ce_ssra,recent_90d}

Guardrails
----------
  · Idempotent: a second `--commit` produces zero further writes.
  · Per-record failure isolation — one record failing does NOT abort
    the batch; audit logs the failure with `status='failed'`.
  · Cost cap: cumulative `estimated_cost_usd` tracked in the summary
    (always $0 in cache-derived mode; the cap machinery is retained
    so a future ZIP-source ship can honour it).
  · Original `pre_starts._id` (and `.id`) preserved for audit
    continuity — the row is soft-deleted, NEVER hard-deleted, and
    the migrated `form_submissions` row reuses the same `id`.
  · Audit collection is append-only.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

# Make `backend/` importable when invoked from anywhere.
_BACKEND = Path(__file__).resolve().parents[1]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

# Load .env before importing db.
_env_file = _BACKEND / ".env"
if _env_file.exists():
    for _line in _env_file.read_text(encoding="utf-8").splitlines():
        _line = _line.strip()
        if not _line or _line.startswith("#") or "=" not in _line:
            continue
        _k, _, _v = _line.partition("=")
        os.environ.setdefault(_k.strip(), _v.strip().strip('"').strip("'"))

log = logging.getLogger("paneltec.reextract_v58_13_35")


# ─── Config ──────────────────────────────────────────────────────────

SCRIPT_VERSION = "v58.13.35"
AUDIT_COLLECTION = "bulk_import_reextract_v58_13_35_audit"

BATCH_SIZE = int(os.environ.get("REEXTRACT_BATCH_SIZE") or 50)
BATCH_SLEEP_SEC = float(os.environ.get("REEXTRACT_BATCH_SLEEP_SEC") or 0.0)
COST_CAP_USD = float(os.environ.get("REEXTRACT_COST_CAP_USD") or 500.0)

# Base filter for the misclassified pool.
BASE_FILTER: dict[str, Any] = {
    "imported": True,
    "deleted_at": None,
    "template_name_snapshot": None,
}


class CostCapExceeded(RuntimeError):
    pass


class UnknownScope(RuntimeError):
    pass


# ─── Utility ─────────────────────────────────────────────────────────

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _scope_filter(scope: str) -> dict[str, Any]:
    scope = (scope or "all").lower()
    if scope == "all":
        return {}
    if scope == "ssra":
        return {"work_summary": {"$regex": "SSRA", "$options": "i"}}
    if scope == "ce_ssra":
        return {"work_summary": {
            "$regex": "Construction & Excavation - SSRA", "$options": "i"}}
    if scope == "recent_90d":
        cutoff = datetime.now(timezone.utc).timestamp() - 90 * 86400
        cutoff_iso = datetime.fromtimestamp(
            cutoff, tz=timezone.utc).isoformat()
        return {"created_at": {"$gte": cutoff_iso}}
    raise UnknownScope(
        f"unknown --scope {scope!r} (expected all|ssra|ce_ssra|recent_90d)")


def _build_query(scope: str) -> dict[str, Any]:
    q = dict(BASE_FILTER)
    q.update(_scope_filter(scope))
    return q


# ─── Roster loader ───────────────────────────────────────────────────

async def _load_roster_and_templates(
    db,
) -> tuple[dict[str, str], dict[str, dict]]:
    """Return (roster, templates_by_id).

    `roster` mirrors `_load_classifier_roster()`'s output shape:
    `{template_id: template_name}` merged across form_templates AND
    list_forms.

    `templates_by_id` is the per-id document dict so callers can
    read the DB-stamped `category` when it exists.
    """
    roster: dict[str, str] = {}
    tpls: dict[str, dict] = {}
    async for t in db.form_templates.find(
        {"deleted_at": None},
        {"_id": 0, "id": 1, "name": 1, "category": 1},
    ):
        tid = t.get("id")
        tname = (t.get("name") or "").strip()
        if tid and tname:
            roster[tid] = tname
            tpls[tid] = t
    try:
        async for t in db.list_forms.find(
            {"deleted_at": None},
            {"_id": 0, "id": 1, "name": 1, "category": 1},
        ):
            tid = t.get("id")
            tname = (t.get("name") or "").strip()
            if tid and tname and tid not in roster:
                roster[tid] = tname
                tpls[tid] = t
    except Exception as e:
        log.warning("list_forms load failed (%s); continuing with "
                    "form_templates only", e)
    return roster, tpls


# ─── Per-record planner (pure) ───────────────────────────────────────

def _plan_record(
    row: dict,
    roster: dict[str, str],
    templates_by_id: dict[str, dict],
) -> dict:
    """Pure planner. No DB, no Claude, no side effects. Returns:

        {
          "action": "migrate" | "update_in_place" | "noop_unresolved",
          "inferred_name": str,
          "matched_template_id": Optional[str],
          "matched_template_name": Optional[str],
          "match_confidence": float,
          "new_category": str,
          "target_collection": "pre_starts" | "form_submissions",
        }
    """
    from bulk_import_template_inference import (
        infer_template_type_from_row,
        resolve_against_roster,
        resolve_target_category,
        should_migrate_out_of_prestarts,
        ROSTER_RESOLVE_MIN_CONFIDENCE,
    )
    inferred = infer_template_type_from_row(row)
    if not inferred:
        return {
            "action": "noop_unresolved",
            "inferred_name": "",
            "matched_template_id": None,
            "matched_template_name": None,
            "match_confidence": 0.0,
            "new_category": "",
            "target_collection": "pre_starts",
            "reason": "no_hint_in_work_summary",
        }
    tid, tname, conf = resolve_against_roster(inferred, roster)
    if not tid or conf < ROSTER_RESOLVE_MIN_CONFIDENCE:
        return {
            "action": "noop_unresolved",
            "inferred_name": inferred,
            "matched_template_id": tid,
            "matched_template_name": tname or None,
            "match_confidence": conf,
            "new_category": "",
            "target_collection": "pre_starts",
            "reason": "low_confidence_roster_match",
        }
    tpl_doc = templates_by_id.get(tid)
    new_cat = resolve_target_category(tpl_doc, tname)
    migrate = should_migrate_out_of_prestarts(new_cat, tname)
    return {
        "action": "migrate" if migrate else "update_in_place",
        "inferred_name": inferred,
        "matched_template_id": tid,
        "matched_template_name": tname,
        "match_confidence": conf,
        "new_category": new_cat,
        "target_collection": "form_submissions" if migrate else "pre_starts",
        "reason": None,
    }


# ─── Audit writer ────────────────────────────────────────────────────

async def _audit_write(db, doc: dict) -> None:
    """Append-only audit insert. Best-effort — a failed audit write
    logs a WARN but does NOT abort the run."""
    doc = {
        "id": str(uuid.uuid4()),
        "script_version": SCRIPT_VERSION,
        "at": _now_iso(),
        **doc,
    }
    try:
        await db[AUDIT_COLLECTION].insert_one(doc)
    except Exception as e:
        log.warning("audit write failed for record_id=%s: %s",
                    doc.get("record_id"), e)


# ─── Commit path (cache-derived) ─────────────────────────────────────

def _extract_filename_from_work_summary(ws: str) -> str:
    if not ws:
        return ""
    idx = ws.find("::")
    if idx == -1:
        return ""
    return ws[idx + 2:].strip()


def _extract_to_positional_fields(extracted: dict) -> list[dict]:
    """Best-effort mapping of the cached Daily-Pre-Start-shape
    extractor payload into positional `form_submissions.fields[]`.

    The migrated (list_forms) SSRA / permit templates lack a
    `fields[]` schema, so we emit a flat {label, type, value} entry
    per extractor key. HSEQ reviewers can rebuild the SSRA-shape
    fields when a future ZIP-source re-extraction runs.
    """
    if not extracted or not isinstance(extracted, dict):
        return []
    fields: list[dict] = []
    for k, v in extracted.items():
        if k == "checklist" and isinstance(v, dict):
            for ck, cv in v.items():
                fields.append({"label": ck, "type": "text", "value": cv})
            continue
        fields.append({"label": k, "type": "text", "value": v})
    return fields


async def _cache_derived_commit(
    db, row: dict, plan: dict, cache_doc: Optional[dict],
) -> dict:
    """Apply the plan for one record.

    · `action=noop_unresolved` → no writes; audit only.
    · `action=update_in_place` → set `template_name_snapshot` +
      `template_category_snapshot` on the pre_starts row.
    · `action=migrate` → soft-delete pre_starts row; insert
      form_submissions row with cached `extracted` as positional
      `fields[]`. Preserves original `id`.
    """
    record_id = row["id"]
    action = plan["action"]

    if action == "noop_unresolved":
        return {
            "record_id": record_id, "action": action, "status": "noop",
            "detail": plan.get("reason") or "",
            "writes": 0, "cost_usd": 0.0,
        }

    if action == "update_in_place":
        result = await db.pre_starts.update_one(
            {"id": record_id, "deleted_at": None,
             "template_name_snapshot": None},
            {"$set": {
                "template_name_snapshot": plan["matched_template_name"],
                "template_category_snapshot": plan["new_category"] or None,
                "updated_at": _now_iso(),
                "reextract_script_version": SCRIPT_VERSION,
            }},
        )
        return {
            "record_id": record_id, "action": action,
            "status": "ok" if result.matched_count else "already_stamped",
            "matched_template_id": plan["matched_template_id"],
            "matched_template_name": plan["matched_template_name"],
            "new_category": plan["new_category"],
            "writes": int(bool(result.matched_count)),
            "cost_usd": 0.0,
        }

    if action == "migrate":
        extracted = (cache_doc or {}).get("extracted") or {}
        fields = _extract_to_positional_fields(extracted)
        pdf_hash = row.get("pdf_hash")
        now = _now_iso()

        # A form_submissions row for this pdf_hash may already exist
        # under a DIFFERENT `id` (pre-v58.13.32 healthy-write path
        # inserted a Daily-Pre-Start-shape FS row when it should have
        # inserted a hazard-shape one). The unique index on
        # (org_id, source='bulk_import', metadata.pdf_hash) means we
        # must UPDATE the existing row rather than INSERT.
        existing = await db.form_submissions.find_one(
            {"org_id": row["org_id"], "source": "bulk_import",
             "metadata.pdf_hash": pdf_hash, "deleted_at": None},
            {"_id": 0, "id": 1},
        )
        if existing is not None:
            # In-place fix of the misclassified FS row.
            fs_id = existing["id"]
            await db.form_submissions.update_one(
                {"id": fs_id, "deleted_at": None},
                {"$set": {
                    "template_id": plan["matched_template_id"],
                    "template_name_snapshot": plan["matched_template_name"],
                    "template_category_snapshot": plan["new_category"],
                    "updated_at": now,
                    "metadata.needs_review": True,
                    "metadata.reextract_reason":
                        "v58_13_35_partial_cache_only",
                    "metadata.reextract_script_version": SCRIPT_VERSION,
                    "metadata.reextract_at": now,
                    "metadata.reextract_source_pre_starts_id": record_id,
                    "metadata.reextract_inferred_from":
                        "work_summary::filename",
                    "metadata.reextract_match_confidence":
                        plan["match_confidence"],
                }},
            )
            wrote_new_fs = 0
            updated_existing_fs = 1
            target_fs_id = fs_id
        else:
            # No FS row exists for this hash — insert one, preserving
            # the pre_starts row id for audit continuity.
            fs_doc = {
                "id": record_id,
                "org_id": row["org_id"],
                "workspace_id": row.get("workspace_id") or "",
                "template_id": plan["matched_template_id"],
                "template_name_snapshot": plan["matched_template_name"],
                "template_category_snapshot": plan["new_category"],
                "source": "bulk_import",
                "fields": fields,
                "submitted_by_id": row.get("created_by"),
                "submitted_by_name": row.get("crew_lead")
                    or "Imported (v58.13.35)",
                "submitted_at": row.get("created_at") or now,
                "created_at": row.get("created_at") or now,
                "updated_at": now,
                "deleted_at": None,
                "metadata": {
                    "pdf_hash": pdf_hash,
                    "src_filename": _extract_filename_from_work_summary(
                        row.get("work_summary") or ""),
                    "needs_review": True,
                    "reextract_reason": "v58_13_35_partial_cache_only",
                    "reextract_script_version": SCRIPT_VERSION,
                    "reextract_at": now,
                    "reextract_source_pre_starts_id": record_id,
                    "reextract_inferred_from": "work_summary::filename",
                    "reextract_match_confidence": plan["match_confidence"],
                },
            }
            await db.form_submissions.insert_one(fs_doc)
            wrote_new_fs = 1
            updated_existing_fs = 0
            target_fs_id = record_id

        soft = await db.pre_starts.update_one(
            {"id": record_id, "deleted_at": None},
            {"$set": {
                "deleted_at": _now_iso(),
                "template_name_snapshot": plan["matched_template_name"],
                "template_category_snapshot": plan["new_category"],
                "updated_at": _now_iso(),
                "reextract_migrated_at": _now_iso(),
                "reextract_target_collection": "form_submissions",
                "reextract_target_form_submission_id": target_fs_id,
                "reextract_script_version": SCRIPT_VERSION,
            }},
        )
        return {
            "record_id": record_id, "action": action,
            "status": "ok" if (wrote_new_fs or updated_existing_fs
                                or soft.matched_count)
                       else "already_migrated",
            "matched_template_id": plan["matched_template_id"],
            "matched_template_name": plan["matched_template_name"],
            "new_category": plan["new_category"],
            "target_form_submission_id": target_fs_id,
            "wrote_new_form_submission": bool(wrote_new_fs),
            "updated_existing_form_submission": bool(updated_existing_fs),
            "writes": wrote_new_fs + updated_existing_fs
                     + int(bool(soft.matched_count)),
            "cost_usd": 0.0,
        }

    return {"record_id": record_id, "action": action,
            "status": "unknown_action", "writes": 0, "cost_usd": 0.0}


# ─── Main runner ─────────────────────────────────────────────────────

async def _iter_scope(db, scope: str, limit: Optional[int]):
    q = _build_query(scope)
    cursor = db.pre_starts.find(q, {"_id": 0}).sort("created_at", 1)
    if limit and limit > 0:
        cursor = cursor.limit(limit)
    async for row in cursor:
        yield row


async def run(args: argparse.Namespace) -> dict:
    """Return a summary dict. Called from `main()` and from tests."""
    from db import db  # noqa: E402 — deferred import lets tests monkeypatch.

    started = _now_iso()
    log.info(
        "%s starting: dry_run=%s scope=%s limit=%s cost_cap=$%.2f",
        SCRIPT_VERSION, args.dry_run, args.scope, args.limit, COST_CAP_USD,
    )

    roster, templates_by_id = await _load_roster_and_templates(db)
    log.info("roster loaded: %d templates", len(roster))

    total_matched = await db.pre_starts.count_documents(_build_query(args.scope))
    log.info("misclassified pool (scope=%s): %d records",
             args.scope, total_matched)

    summary: dict[str, Any] = {
        "script_version": SCRIPT_VERSION,
        "started_at": started,
        "dry_run": args.dry_run,
        "scope": args.scope,
        "limit": args.limit,
        "total_in_scope": total_matched,
        "processed": 0,
        "actions": {"migrate": 0, "update_in_place": 0,
                    "noop_unresolved": 0},
        "by_target_category": {},
        "by_matched_template": {},
        "failures": 0,
        "writes": 0,
        "estimated_cost_usd": 0.0,
        "cost_cap_usd": COST_CAP_USD,
    }
    cost_tracker = {"cost_usd": 0.0}
    batch_counter = 0

    async for row in _iter_scope(db, args.scope, args.limit):
        plan = _plan_record(row, roster, templates_by_id)
        summary["actions"][plan["action"]] = (
            summary["actions"].get(plan["action"], 0) + 1)
        cat = plan.get("new_category") or "(none)"
        summary["by_target_category"][cat] = (
            summary["by_target_category"].get(cat, 0) + 1)
        mname = plan.get("matched_template_name") or "(unresolved)"
        summary["by_matched_template"][mname] = (
            summary["by_matched_template"].get(mname, 0) + 1)

        outcome: dict[str, Any] = {
            "record_id": row["id"], "action": plan["action"],
            "status": "planned", "writes": 0, "cost_usd": 0.0,
        }

        if not args.dry_run:
            try:
                cache_doc = await db.bulk_import_pdf_cache.find_one(
                    {"org_id": row["org_id"],
                     "pdf_hash": row.get("pdf_hash")},
                    {"_id": 0},
                )
                outcome = await _cache_derived_commit(
                    db, row, plan, cache_doc)
                cost_tracker["cost_usd"] += outcome.get("cost_usd") or 0.0
                if cost_tracker["cost_usd"] > COST_CAP_USD:
                    raise CostCapExceeded(
                        f"cumulative cost {cost_tracker['cost_usd']:.2f} > "
                        f"cap {COST_CAP_USD:.2f}")
            except CostCapExceeded as e:
                log.error("cost cap tripped: %s — halting", e)
                summary["failures"] += 1
                summary["cost_cap_tripped"] = True
                await _audit_write(db, {
                    "record_id": row["id"], "action": "abort",
                    "status": "cost_cap_exceeded", "detail": str(e),
                })
                break
            except Exception as e:
                log.warning("record %s failed: %s", row["id"], e)
                outcome = {"record_id": row["id"], "action": plan["action"],
                           "status": "failed", "detail": str(e),
                           "writes": 0, "cost_usd": 0.0}
                summary["failures"] += 1

        summary["writes"] += outcome.get("writes") or 0
        summary["estimated_cost_usd"] += outcome.get("cost_usd") or 0.0
        summary["processed"] += 1

        await _audit_write(db, {
            "record_id": row["id"],
            "pdf_hash": row.get("pdf_hash"),
            "work_summary": row.get("work_summary"),
            "plan": plan,
            "outcome": outcome,
            "dry_run": args.dry_run,
        })

        batch_counter += 1
        if batch_counter >= BATCH_SIZE:
            batch_counter = 0
            if BATCH_SLEEP_SEC > 0 and not args.dry_run:
                await asyncio.sleep(BATCH_SLEEP_SEC)

    summary["finished_at"] = _now_iso()
    log.info("done: %s", json.dumps({
        k: v for k, v in summary.items()
        if k not in ("by_target_category", "by_matched_template")
    }))
    return summary


# ─── CLI ─────────────────────────────────────────────────────────────

def _parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        prog="reextract_misclassified_v58_13_35",
        description="Ship 4b · Backfill re-extraction (cache-derived) of "
                    "misclassified pre_starts rows.",
    )
    mode = p.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", dest="dry_run", action="store_true",
                      default=True,
                      help="Default. Zero writes.")
    mode.add_argument("--commit", dest="dry_run", action="store_false",
                      help="Real execution.")
    p.add_argument("--limit", type=int, default=None,
                   help="Process at most N records.")
    p.add_argument("--scope",
                   choices=("all", "ssra", "ce_ssra", "recent_90d"),
                   default="all")
    return p.parse_args(argv)


def main(argv: Optional[list[str]] = None) -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    args = _parse_args(argv)
    try:
        summary = asyncio.run(run(args))
    except UnknownScope as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 2
    print(json.dumps(summary, indent=2, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
