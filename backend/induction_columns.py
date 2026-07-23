"""v160.3.9.6 — Admin cleanup endpoints for the Inductions Matrix.

The matrix is not backed by an `induction_columns` collection — columns
are derived at query time from distinct `(column_key, name, category)`
tuples across `worker_certifications`. So "manage columns" operations
are all row-level rewrites on `worker_certifications`.

Endpoints (all admin / manager / hseq_lead only, all audit-logged):
  GET  /api/induction-columns/cleanup-suggestions
       Server-side A/B/C categorisation of the current column set,
       matching the frontend Manage Columns modal's expected shape.

  POST /api/induction-columns/merge
       Body: {source_keys, target_key, target_name, target_category}
       Reassigns `column_key`, `name`, `category` on every child row
       whose `column_key` is in `source_keys`. Creates the target
       column implicitly (its existence is a derived property of rows).

  POST /api/induction-columns/move-to-certifications
       Body: {keys}
       Sets `hidden_from_matrix = "inductions"` on every child row
       whose `column_key` is in `keys`. Rows still appear in the flat
       `/workers/certifications/all` list (the Certifications page).

  POST /api/induction-columns/clear-column-key
       Body: {keys}
       Sets `column_key = null` on every child row whose `column_key`
       is in `keys`. Non-destructive — the underlying document remains
       and can be re-attached manually via the existing card flow.
"""
from __future__ import annotations

import logging
import re
from collections import defaultdict
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from db import db
from auth import get_current_user

log = logging.getLogger("paneltec.induction_columns")
router = APIRouter(prefix="/induction-columns", tags=["induction-columns"])

_WRITE_ROLES = {"admin", "manager", "hseq_lead"}

# Cat-A: individual cert INSTANCES misclassified as columns.
# Header shape "<Type> - <Initials or Name> - EXP <date>" or "- Iss <date>",
# or trailing year suffixes like "CPR - 2019", "CPR - 11-2018", "CPR- 22-11-2020"
# (imported one document per year and then never consolidated).
_RE_CAT_A = re.compile(
    r"(?:"
    r"\s-\s*.+\s+(?:EXP|Exp|exp|Iss|iss|ISS)\s?\d"     # <Type> - <name> - EXP <date>
    r"|"
    r"-\s*\d{2,4}[-/\s]\d{2,4}"                        # trailing date-fragment: - 11-2018, - 22-11-2020
    r"|"
    r"-\s*\d{4}(?:\s*\(\d+\))?\s*$"                    # trailing year: - 2019, - 2021, - 2019(1)
    r")"
)

# Cat-C: patterns for headers that belong in Certifications, not Inductions.
_RE_CAT_C_PARTS = (
    re.compile(r"first\s*aid", re.IGNORECASE),
    re.compile(r"licence|license", re.IGNORECASE),
    re.compile(r"driver", re.IGNORECASE),
    re.compile(r"confined\s*space", re.IGNORECASE),
    re.compile(r"old\s+traffic\s+ticket", re.IGNORECASE),
    re.compile(r"lend\s*lease", re.IGNORECASE),
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _norm_name(s: str) -> str:
    """Lowercase + strip every non-alphanumeric char + drop trailing noise
    words ('induction', 'cert', 'certificate', 'card'). Folds together
    header variants like 'White Card', 'White card', 'White_Card',
    'White_Card_Induction' → all become 'whitecard'."""
    n = re.sub(r"[^a-z0-9]+", "", (s or "").lower())
    for suf in ("induction", "certificate", "cert", "card", "trained", "training"):
        # Peel repeated suffixes so 'white_card_induction' → 'whitecardinduction'
        # → 'whitecard' → 'white'. Stops when no suffix matches.
        while n.endswith(suf) and len(n) > len(suf):
            n = n[: -len(suf)]
    return n


def _require_admin(user: dict) -> None:
    if (user.get("role") or "").lower() not in _WRITE_ROLES:
        raise HTTPException(status_code=403,
                            detail="Admin, HSEQ Lead or Manager only.")


async def _audit(user: dict, action: str, payload: dict) -> None:
    """Fire-and-forget audit log write. Matches the shape used by
    settings_nav / auth_invite / mobile_modules etc."""
    try:
        await db.audit_logs.insert_one({
            "org_id":     user.get("org_id"),
            "actor_id":   user.get("id"),
            "actor_name": user.get("name") or user.get("email"),
            "action":     action,
            "at":         _now_iso(),
            **payload,
        })
    except Exception as e:  # noqa: BLE001
        log.warning("audit_logs.insert failed for %s: %s", action, e)


# ────────────────── suggestions ──────────────────

@router.get("/cleanup-suggestions")
async def cleanup_suggestions(user: dict = Depends(get_current_user)):
    """A/B/C categorisation of the current Inductions Matrix columns.

    Returned shape:
      {
        "totals": {"columns": int, "canonical": int, "rogue": int},
        "category_a": [{column_key, header, category, cnt, action:"clear"}],
        "category_b": [{
            "cluster_norm": "...",
            "target_key": "...", "target_name": "...", "target_category": "...",
            "target_exists": bool,
            "sources": [{column_key, header, category, cnt}],
        }],
        "category_c": [{column_key, header, category, cnt, action:"move"}],
      }
    """
    _require_admin(user)
    org = user["org_id"]

    pipeline = [
        {"$match": {"org_id": org, "deleted_at": None,
                    "column_key": {"$exists": True, "$ne": None},
                    "hidden_from_matrix": {"$ne": "inductions"}}},
        {"$group": {"_id": {"k": "$column_key", "h": "$name", "c": "$category"},
                    "cnt": {"$sum": 1}}},
        {"$sort": {"_id.c": 1, "_id.h": 1}},
    ]
    cols = []
    async for row in db.worker_certifications.aggregate(pipeline):
        cols.append({
            "column_key": row["_id"]["k"],
            "header":     row["_id"]["h"] or "",
            "category":   row["_id"].get("c"),
            "cnt":        row["cnt"],
        })

    total = len(cols)
    canonical = [c for c in cols if c["category"]]
    rogue     = [c for c in cols if not c["category"]]

    # Category A — pattern-matches "<Type> - <Name> - EXP <date>".
    cat_a = [{**c, "action": "clear"} for c in cols
             if _RE_CAT_A.search(c["header"] or "")]
    cat_a_keys = {(c["column_key"], c["header"]) for c in cat_a}

    # Category B — near-duplicate names, folding rogue → canonical if any.
    # Sort clusters so the canonical (category set) row wins as the target.
    remaining_after_a = [c for c in cols if (c["column_key"], c["header"]) not in cat_a_keys]
    by_norm: dict[str, list[dict]] = defaultdict(list)
    for c in remaining_after_a:
        by_norm[_norm_name(c["header"])].append(c)

    cat_b = []
    for norm, items in by_norm.items():
        if len(items) < 2:
            continue
        # v160.3.9.6 — Cat-B sources are ROGUE (category=None) only. We never
        # fold one canonical column into another canonical — that's beyond
        # what the user approved. Rogues fold into a canonical when the
        # cluster contains one; otherwise a new canonical is created.
        canonical_items = [it for it in items if it["category"]]
        rogue_items     = [it for it in items if not it["category"]]
        if not rogue_items:
            continue  # cluster is all-canonical — leave it alone.

        if canonical_items:
            # Prefer highest cell count, then longest header, among canonicals.
            canonical_items.sort(key=lambda it: (-it["cnt"], -len(it["header"])))
            target = canonical_items[0]
            target_key      = target["column_key"]
            target_name     = target["header"]
            target_category = target["category"]
            target_exists   = True
            sources         = rogue_items
        else:
            # All-rogue cluster → create a fresh canonical from the rogue
            # with the highest cell count / longest header.
            rogue_items.sort(key=lambda it: (-it["cnt"], -len(it["header"])))
            template = rogue_items[0]
            hl = (template["header"] or "").lower()
            if any(k in hl for k in ("induction", "taswater", "tasrail", "tasgas",
                                     "cdo", "mv", "nmc", "airport", "petuna",
                                     "tasnetworks", "downer", "dcc", "ajr")):
                inferred_cat = "site_induction"
            elif "licen" in hl or "hr " in hl or "mr " in hl:
                inferred_cat = "license"
            else:
                inferred_cat = "competency"
            target_key      = re.sub(r"[^a-z0-9]+", "_", hl).strip("_") or "col"
            target_name     = template["header"] or template["column_key"]
            target_category = inferred_cat
            target_exists   = False
            # Merge every rogue in the cluster (target itself is folded via
            # the same update since its column_key is in source_keys).
            sources = rogue_items

        cat_b.append({
            "cluster_norm":    norm,
            "target_key":      target_key,
            "target_name":     target_name,
            "target_category": target_category,
            "target_exists":   target_exists,
            "sources":         sources,
        })

    # Category C — Policy 1: only rogue rows (category=None) that also match
    # a licence/first-aid/confined-space/traffic-ticket pattern AND are not
    # already scheduled as Cat-A or a Cat-B source.
    cat_b_source_keys = {(s["column_key"], s["header"])
                         for cluster in cat_b for s in cluster["sources"]}
    cat_c_candidates = [
        c for c in cols
        if (c["column_key"], c["header"]) not in cat_a_keys
        and (c["column_key"], c["header"]) not in cat_b_source_keys
        and not c["category"]                         # Policy 1 — rogue only
        and any(p.search(c["header"] or "") for p in _RE_CAT_C_PARTS)
    ]
    cat_c = [{**c, "action": "move"} for c in cat_c_candidates]

    return {
        "totals": {"columns": total, "canonical": len(canonical), "rogue": len(rogue)},
        "category_a": cat_a,
        "category_b": cat_b,
        "category_c": cat_c,
    }


# ────────────────── merge ──────────────────

class MergeBody(BaseModel):
    source_keys: list[str]
    target_key: str
    target_name: str
    target_category: str  # 'competency' | 'license' | 'site_induction'


@router.post("/merge")
async def merge_columns(body: MergeBody, user: dict = Depends(get_current_user)):
    _require_admin(user)
    if not body.source_keys:
        raise HTTPException(400, detail="source_keys is empty.")
    if body.target_category not in {"competency", "license", "site_induction"}:
        raise HTTPException(400, detail="target_category must be one of "
                                        "competency / license / site_induction.")
    # v160.3.9.6 — Allow target_key to appear in source_keys. When a rogue
    # row shares its `column_key` with a canonical (`cpr` rogue vs `cpr`
    # canonical, distinguished only by `category` being null), the merge
    # simply promotes those rogue rows by setting `category` + `name`.
    # No self-loop occurs because rows already matching the canonical
    # 3-tuple are idempotent under the `$set`.

    org = user["org_id"]
    now = _now_iso()
    # v160.3.9.6 — Restrict to ROGUE rows (category ∈ {null, ""}). Rows
    # already sitting on the canonical (column_key, name, category) triple
    # are left alone — no data-value churn, and `modified_count` reflects
    # actual work done. Prevents the pathological case where a rogue key
    # equals the canonical key: `column_key=cpr rogues` get folded, `column_key=cpr canonicals` untouched.
    result = await db.worker_certifications.update_many(
        {"org_id": org, "deleted_at": None,
         "column_key": {"$in": body.source_keys},
         "category":   {"$in": [None, ""]}},
        {"$set": {
            "column_key":  body.target_key,
            "name":        body.target_name,
            "category":    body.target_category,
            "updated_at":  now,
            "updated_by":  user.get("id"),
        }},
    )
    await _audit(user, "induction_columns.merge", {
        "source_keys":     body.source_keys,
        "target_key":      body.target_key,
        "target_name":     body.target_name,
        "target_category": body.target_category,
        "matched":         result.matched_count,
        "modified":        result.modified_count,
    })
    return {"merged": result.modified_count, "target_key": body.target_key}


# ────────────────── move-to-certifications ──────────────────

class MoveItem(BaseModel):
    column_key: str
    name: str


class MoveBody(BaseModel):
    # v160.3.9.6 — Identify columns by (column_key, name) tuples so a rogue
    # column sharing a `column_key` with a canonical doesn't drag the
    # canonical along when moved / hidden. Backwards-compat: if the caller
    # only supplies `keys`, fall back to key-only matching.
    items: list[MoveItem] | None = None
    keys: list[str] | None = None


@router.post("/move-to-certifications")
async def move_to_certifications(body: MoveBody, user: dict = Depends(get_current_user)):
    _require_admin(user)
    if not (body.items or body.keys):
        raise HTTPException(400, detail="Provide `items` (preferred) or `keys`.")

    org = user["org_id"]
    now = _now_iso()
    if body.items:
        # Match each (column_key, name) tuple, restricted to rogue rows to
        # avoid Policy-1 violations (only category=None rows are moved).
        or_clauses = [
            {"column_key": it.column_key, "name": it.name,
             "category": {"$in": [None, ""]}}
            for it in body.items
        ]
        q = {"org_id": org, "deleted_at": None, "$or": or_clauses}
    else:
        q = {"org_id": org, "deleted_at": None,
             "column_key": {"$in": body.keys or []},
             "category": {"$in": [None, ""]}}
    result = await db.worker_certifications.update_many(
        q,
        {"$set": {
            "hidden_from_matrix": "inductions",
            "updated_at":         now,
            "updated_by":         user.get("id"),
        }},
    )
    await _audit(user, "induction_columns.move_to_certifications", {
        "items":    [it.model_dump() for it in (body.items or [])],
        "keys":     body.keys or [],
        "matched":  result.matched_count,
        "modified": result.modified_count,
    })
    return {"moved": result.modified_count}


# ────────────────── clear column key ──────────────────

class ClearItem(BaseModel):
    column_key: str
    name: str


class ClearBody(BaseModel):
    # Same (column_key, name) contract as MoveBody. Rogue rows only —
    # canonical rows never have their column_key stripped.
    items: list[ClearItem] | None = None
    keys: list[str] | None = None


@router.post("/clear-column-key")
async def clear_column_key(body: ClearBody, user: dict = Depends(get_current_user)):
    _require_admin(user)
    if not (body.items or body.keys):
        raise HTTPException(400, detail="Provide `items` (preferred) or `keys`.")

    org = user["org_id"]
    now = _now_iso()
    if body.items:
        or_clauses = [
            {"column_key": it.column_key, "name": it.name,
             "category": {"$in": [None, ""]}}
            for it in body.items
        ]
        q = {"org_id": org, "deleted_at": None, "$or": or_clauses}
    else:
        q = {"org_id": org, "deleted_at": None,
             "column_key": {"$in": body.keys or []},
             "category": {"$in": [None, ""]}}
    result = await db.worker_certifications.update_many(
        q,
        {"$set":   {"updated_at": now, "updated_by": user.get("id")},
         "$unset": {"column_key": ""}},
    )
    await _audit(user, "induction_columns.clear_column_key", {
        "items":    [it.model_dump() for it in (body.items or [])],
        "keys":     body.keys or [],
        "matched":  result.matched_count,
        "modified": result.modified_count,
    })
    return {"cleared": result.modified_count}
