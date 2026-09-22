"""Generic CRUD routers — permission-gated.

Each entity exposes:
  GET    /api/{entity}                 — list (requires <resource>.view)
  GET    /api/{entity}/{id}            — detail (requires <resource>.view)
  POST   /api/{entity}                 — create (requires <resource>.edit)
  PATCH  /api/{entity}/{id}            — partial update (requires <resource>.edit)
  DELETE /api/{entity}/{id}            — soft delete (requires <resource>.edit)
"""
import logging
from typing import Any, Dict, List, Optional, Type

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel

from db import db
from models import (
    HazardIn, IncidentIn, InspectionIn, PreStartIn, RiskAssessmentIn, SiteDiaryIn, SwmsIn,
    SwmsReview, new_id, now_iso,
)
from permissions import require_permission, require_module, resolve_team_scope
from permissions_scope import _is_privileged, swms_visibility_filter

logger = logging.getLogger("paneltec.crud")

# v58.13.78 — Fields on mirrored `form_submissions` rows that can grow
# arbitrarily large on prod (Claude Vision raw responses, per-photo
# base64, HTML archives). Stripped from LIST responses only. The
# detail route still returns them because it fetches a single row.
_HEAVY_METADATA_FIELDS = (
    "raw_extraction_json",
    "raw_html",
    "claude_response",
    "vision_response",
    "ocr_response",
    "extraction_debug",
    "pdf_page_images",
)


def _slim_mirror_metadata(row: dict) -> dict:
    """Remove heavy blob fields from a mirrored form_submission row before
    it hits the list serializer. Idempotent; safe on rows without a
    `metadata` dict."""
    md = row.get("metadata")
    if not isinstance(md, dict):
        return row
    for k in _HEAVY_METADATA_FIELDS:
        md.pop(k, None)
    # Nested `attachments[*].base64` is another prod-only accident-in-
    # waiting — strip inline base64 blobs but keep the descriptor.
    atts = row.get("attachments")
    if isinstance(atts, list):
        for a in atts:
            if isinstance(a, dict):
                a.pop("base64", None)
                a.pop("data_url", None)
    return row


def _safe_encode_list(docs: List[dict], route_hint: str) -> List[dict]:
    """v58.13.78 — Encode a list of DB documents defensively.

    A single unserialisable value (naive `datetime`, `Decimal`, `bytes`,
    stray `ObjectId`) will crash FastAPI's default `JSONResponse`
    partway through streaming, dropping the connection AFTER the
    headers are sent — Cloudflare then reports 520 / "malformed
    response" to the user. Guard against that by running each doc
    through `jsonable_encoder` individually; log-and-skip any that
    fail so ONE bad row can never take down the whole page.
    """
    out: List[dict] = []
    for d in docs:
        try:
            out.append(jsonable_encoder(d))
        except Exception as e:  # noqa: BLE001
            logger.exception(
                "safe-encode: dropped one row on %s (id=%r): %s: %s",
                route_hint, d.get("id"), type(e).__name__, e,
            )
    return out


def _scoped(user: dict, workspace_id: Optional[str] = None) -> dict:
    q: Dict[str, Any] = {"org_id": user["org_id"], "deleted_at": None}
    if workspace_id:
        q["workspace_id"] = workspace_id
    return q


def _strip(doc: dict) -> dict:
    doc.pop("_id", None)
    return doc


def build_router(prefix: str, collection: str, model: Type[BaseModel], resource: str,
                 module_id: Optional[str] = None,
                 mirror_categories: Optional[list[str]] = None,
                 exclude_name_regex: Optional[str] = None) -> APIRouter:
    # v160.0.9 — router-level `require_module()` gate. When `module_id`
    # is set, every route on this router is subject to the mobile
    # module toggle for the caller's role. Web callers bypass (no
    # `x-client-platform: mobile` header).
    #
    # v160.2.5a — `mirror_categories` unions `form_submissions` rows
    # tagged with any of the given template categories into the list
    # response. Fixes the routing gap where phone-submitted forms
    # (which land in `form_submissions`) never surfaced on the
    # web-admin Capture sub-tabs (which read from their own legacy
    # collections). Merged rows carry `source: "form_submission"` so
    # the UI can render them alongside legacy entries.
    from fastapi import Depends as _Dep
    router_deps = [_Dep(require_module(module_id))] if module_id else []
    r = APIRouter(prefix=f"/{prefix}", tags=[prefix], dependencies=router_deps)

    @r.get("")
    async def list_items(
        response: Response,   # v58.13.132ea — for X-Total-Count header
        workspace_id: Optional[str] = Query(None),
        status: Optional[str] = Query(None),
        include_superseded: bool = Query(False),
        # v58.13.132ec — Archive visibility toggle. Default hides
        # archived rows so a fresh page load never surfaces stale
        # end-of-year cleanup records. Admins flip the FE toggle to
        # inspect / restore them.
        include_archived: bool = Query(False),
        date_from: Optional[str] = Query(None),
        date_to: Optional[str] = Query(None),
        scope: Optional[str] = Query(None, description="`me` = own records only, `team` = org-wide (needs team_view)"),
        # v58.13.132ea — Default lifted from 100 → 5000 (the previous
        # `le=` cap) after the `.132dz` migration made the pagination
        # cap actively harmful: Stephen's Risk Assessments bucket went
        # from 1 row (pre-migration) to 3 561 rows, and the old
        # default silently truncated to the first 100. FE list pages
        # today consume the response as a bare array and have no
        # "load more" affordance, so a hidden truncation reads as
        # "the migration is broken". Adding a proper FE pager is
        # flagged as follow-up UX work — bumping the default fixes
        # the visibility bug immediately without a BC-breaking
        # response-shape change.
        limit: int = Query(5000, ge=1, le=5000),
        # v58.13.132eh — Pagination offset. When >0, skip the first N
        # rows in the sort order. Combined with `limit` this gives
        # the FE a Load-More affordance without breaking the legacy
        # bare-array response shape. `X-Total-Count` continues to
        # report the TRUE DB total so the FE knows when it has
        # exhausted the pool.
        offset: int = Query(0, ge=0),
        # v160.3.9.58.1 — filters used by the Bulk-Import wizard's
        # deep-links. `bulk_import_id` narrows the list to records
        # committed by one import job; `needs_review` shows only rows
        # whose worker fuzzy-match returned nothing (soft-fail path).
        # Both only apply to the mirrored `form_submissions` slice —
        # legacy `pre_starts` rows never carry this metadata so they
        # simply drop out when either filter is set.
        bulk_import_id: Optional[str] = Query(None),
        needs_review: Optional[int] = Query(None),
        user: dict = Depends(require_permission(resource, "view")),
    ):
        # v58.13.78 — Top-level try/except so a crash in the list-build
        # code path never drops the connection mid-stream. Cloudflare
        # 520 on prod /app/pre-starts was traced to this endpoint; the
        # symptom is a malformed origin response, which only happens
        # when the server closes the TCP connection AFTER headers are
        # sent. By catching + logging + returning a clean JSON error we
        # ensure the origin ALWAYS emits a well-formed HTTP response.
        try:
            docs = await _list_impl(user, workspace_id, status, include_superseded,
                                     date_from, date_to, scope, limit,
                                     bulk_import_id, needs_review, include_archived,
                                     offset)
            # v58.13.132ea — X-Total-Count header exposes the total
            # rows the caller has access to WITHIN THE CURRENT
            # FILTERS, before the pagination slice. Legacy consumers
            # (which read `r.data` as a bare array) are unaffected;
            # future FE pager work can consume `X-Total-Count` for
            # "N of M shown" UX without a response-shape change.
            # v58.13.132ee — Also emit X-Archived-Count so the FE
            # ShowArchivedToggle can badge itself with the archived
            # count without a second round-trip.
            docs, arch_count, total_count = docs
            try:
                # v58.13.132ef — X-Total-Count is the TRUE DB total,
                # not `len(docs)` (which was capped by the pagination
                # limit and made the FE chip freeze at 5,000 total).
                response.headers["X-Total-Count"] = str(total_count)
                response.headers["X-Archived-Count"] = str(arch_count)
                response.headers["Access-Control-Expose-Headers"] = (
                    "X-Total-Count, X-Archived-Count")
            except Exception:  # pragma: no cover — defensive
                pass
            return docs
        except HTTPException:
            raise
        except Exception as e:  # noqa: BLE001
            logger.exception(
                "list_items crashed on /%s (user=%s org=%s): %s: %s",
                prefix, user.get("id"), user.get("org_id"),
                type(e).__name__, e,
            )
            raise HTTPException(
                status_code=500,
                detail={
                    "ok": False,
                    "error": "list_items_failed",
                    "resource": resource,
                    "message": "Server error while building the list. "
                                "Support has been notified.",
                },
            )

    async def _list_impl(
        user, workspace_id, status, include_superseded,
        date_from, date_to, scope, limit,
        bulk_import_id, needs_review, include_archived,
        offset: int = 0,
    ):
        q = _scoped(user, workspace_id)
        # v58.13.132kn — SWMS visibility. Non-privileged callers get
        # `applies_to`-driven scoping (roles / worker_ids / asset_types /
        # company_ids / legacy-null). Replaces the pre-.132kn
        # `TEAM_SCOPED_RESOURCES` creator-only narrowing which hid every
        # admin-created SWMS from workers — a WHS Reg 39 gap. See
        # `permissions_scope.swms_visibility_filter` and
        # `memory/v58_13_132kn_swms_applies_to_scope.md`.
        if collection == "swms" and not _is_privileged(user):
            _swms_scope = await swms_visibility_filter(user)
            if _swms_scope.get("__scope_no_match__"):
                return [], 0, 0
            # Merge without stomping any existing `$or` on `q` (there
            # isn't one today, but keep defensive: if a future ship
            # adds one, use `$and` to compose).
            if "$or" in q:
                q = {"$and": [q, _swms_scope]}
            else:
                q.update(_swms_scope)
        # v159.2 — team-scoping. If the caller lacks `team_view` on this
        # resource (or explicitly asked `?scope=me`), narrow the query to
        # records they created themselves.
        own_only = await resolve_team_scope(user, resource, scope)
        if own_only is not None:
            q["created_by"] = own_only
        # v58.13.132ec — Hide archived rows unless caller asked. Mongo's
        # `{field: null}` semantics matches both `null` and missing, so
        # legacy docs without the field surface correctly on the default
        # path.
        if not include_archived:
            q["archived_at"] = None
        if status:
            q["status"] = status
        elif collection == "swms" and not include_superseded:
            # Phase 4.1 — hide chained ancestors from default SWMS lists.
            q["status"] = {"$ne": "superseded"}
        if date_from or date_to:
            rng: Dict[str, Any] = {}
            if date_from:
                rng["$gte"] = date_from
            if date_to:
                rng["$lte"] = date_to
            q["date"] = rng
        # v160.3.9.58.1 — When wizard filters are active, the legacy
        # `pre_starts` (etc.) collection can NEVER match — those rows
        # don't carry bulk-import metadata. Skip the base query to avoid
        # noise and keep the response deterministic.
        if bulk_import_id or needs_review:
            docs = []
        else:
            # v58.13.132gx Phase 4 — Bug 2 SSRA-exclusion on the
            # native list. Applies the same regex as mirror rows so
            # legacy `risk_assessments` docs whose `title` matches
            # ("Drain Cleaning SSRA", "Site Specific Risk Assessment
            # …") don't leak into the generic RA list either.
            native_q = q
            if exclude_name_regex:
                native_q = {
                    **q,
                    "$nor": [
                        {"title": {"$regex": exclude_name_regex, "$options": "i"}},
                        {"name": {"$regex": exclude_name_regex, "$options": "i"}},
                        {"template_name_snapshot": {"$regex": exclude_name_regex,
                                                     "$options": "i"}},
                    ],
                }
            docs = await db[collection].find(native_q, {"_id": 0}).sort(
                "created_at", -1).skip(offset).limit(limit).to_list(limit)

        # v160.2.5a — union in matching `form_submissions` (phone-filled
        # forms). Non-destructive — legacy rows keep priority; merged
        # rows carry `source: "form_submission"` and are ordered by
        # created_at (newest first). Skipped when `mirror_categories`
        # isn't set on this router, or when the caller narrowed with
        # `status=` (we can't safely map arbitrary status strings across
        # heterogeneous schemas).
        # v58.13.132eh — When paginating past the first page, skip the
        # mirror union entirely. The union order isn't deterministic
        # across the two collections and pulling both fully into memory
        # to interleave would defeat the point of pagination. Mirror
        # content is a small fraction of the base collection anyway;
        # if a user paginates deeply, they're browsing legacy shim
        # rows, not phone submissions.
        if mirror_categories and not status and offset == 0:
            mq: Dict[str, Any] = {
                "org_id": user["org_id"], "deleted_at": None,
                "template_category_snapshot": {"$in": mirror_categories},
            }
            # v58.13.132gx Phase 4 — Bug 2 (SSRAs incorrectly in
            # Risk Assessments). Reject mirror rows whose stored
            # template name matches the exclusion regex. Used by
            # risk_assessments_router to keep SSRA submissions off
            # the generic Risk Assessments list.
            if exclude_name_regex:
                mq["template_name_snapshot"] = {
                    "$not": {"$regex": exclude_name_regex, "$options": "i"},
                }
            # v58.13.132ec — Mirror the archive filter onto mirrored rows.
            if not include_archived:
                mq["archived_at"] = None
            if workspace_id:
                mq["workspace_id"] = workspace_id
            if own_only is not None:
                # v160.2.5a — form_submissions uses `submitted_by`, not
                # `created_by`. Match either key so worker-scope filters
                # still apply to mirrored rows.
                mq["$or"] = [{"created_by": own_only}, {"submitted_by": own_only}]
            if date_from or date_to:
                mq["submitted_at"] = {
                    **({"$gte": date_from} if date_from else {}),
                    **({"$lte": date_to} if date_to else {}),
                }
            # v160.3.9.58.1 — bulk-import wizard filters.
            if bulk_import_id:
                mq["metadata.job_id"] = bulk_import_id
            if needs_review:
                # Rows without a resolved worker land in the review queue.
                # `needs_review=True` is stamped by the extractor when
                # the fuzzy-match returns nothing. Match either form of
                # the flag so legacy rows that only carry a null id
                # still surface.
                mq["$and"] = mq.get("$and", []) + [{
                    "$or": [
                        {"metadata.worker_match.needs_review": True},
                        {"metadata.worker_match.id": None},
                    ],
                }]
            mirrored = await db.form_submissions.find(mq, {"_id": 0}).sort(
                "submitted_at", -1).to_list(limit)
            # v58.13.78 — Strip heavy metadata blobs from list rows
            # BEFORE any further processing. On prod some mirrored rows
            # carry multi-MB Claude Vision responses / per-page base64
            # image dumps that were fine to store but choked the list
            # response and triggered Cloudflare 520s on
            # /app/pre-starts. Detail route (`/{item_id}`) is
            # unaffected — it fetches a single doc and returns full
            # payload.
            for _m in mirrored:
                _slim_mirror_metadata(_m)
            # v58.10.3 — Dedup against the legacy shim. Rows in `docs`
            # (from the legacy collection, e.g. `pre_starts`) may carry
            # `source_form_submission_id` pointing at the paired
            # `form_submissions` row. If we blindly union `mirrored` in
            # we'd surface both — one tile per PDF twice. Drop any
            # mirrored row whose `id` is already referenced by a shim
            # in this response. The shim (enriched by v58.10.3) is the
            # canonical row to render; the paired form_submission is
            # still reachable via `/api/form-submissions/{id}` for the
            # detail view.
            _shim_source_ids = {
                d.get("source_form_submission_id") for d in docs
                if d.get("source_form_submission_id")
            }
            if _shim_source_ids:
                mirrored = [m for m in mirrored
                            if m.get("id") not in _shim_source_ids]
            # v160.2.9-delete — Fill in `template_name_snapshot` from the
            # live `form_templates` row for any legacy submission that
            # missed the snapshot capture. Falls back to "Deleted
            # template" when the template row itself has vanished. One
            # `find({$in: [...]})` batch — O(1) queries.
            missing_ids = {
                m.get("template_id") for m in mirrored
                if not m.get("template_name_snapshot") and m.get("template_id")
            }
            if missing_ids:
                lookup = {}
                async for t in db.form_templates.find(
                    {"id": {"$in": list(missing_ids)}}, {"_id": 0, "id": 1, "name": 1},
                ):
                    lookup[t["id"]] = t.get("name")
                for m in mirrored:
                    if not m.get("template_name_snapshot"):
                        m["template_name_snapshot"] = (
                            lookup.get(m.get("template_id")) or "Deleted template"
                        )
            for m in mirrored:
                # Normalise the shape so the existing web-admin table
                # renderers can pick it up without blowing up on missing
                # keys. Original fields are left intact.
                sub_at = m.get("submitted_at") or ""
                m.setdefault("created_at", sub_at)
                m.setdefault("created_by", m.get("submitted_by"))
                m.setdefault("status", "submitted")
                m.setdefault("date", sub_at[:10] if sub_at else "")
                tpl_name = m.get("template_name_snapshot") or "Form submission"
                m.setdefault("title", tpl_name)
                # v160.2.9-delete — Inspections.jsx reads `template_name`
                # as the primary column. Mirror the snapshot under that
                # alias so it never renders blank. Same alias is safe
                # for the other Capture tabs (they read their own field
                # names — `crew_lead`, `raw_notes`, `title` — none of
                # which conflict with `template_name`).
                m.setdefault("template_name", tpl_name)
                m["source"] = "form_submission"
            docs = docs + mirrored
            docs.sort(key=lambda d: d.get("created_at") or "", reverse=True)
            docs = docs[:limit]
        # v58.13.78 — Defensive encode. Prevents a single unserialisable
        # doc (naive datetime, Decimal, bytes) from crashing the whole
        # response mid-stream and giving the user a Cloudflare 520.
        encoded = _safe_encode_list(docs, route_hint=f"/{prefix}")

        # v58.13.132ee — Cheap archived-row count for the same query
        # scope, so the FE ShowArchivedToggle can badge itself with
        # the archived count. `own_only` and workspace/team scoping
        # already resolved above → reuse the same `q` shape and just
        # flip archived_at.
        arch_q = {**q}
        arch_q.pop("archived_at", None)
        arch_q.pop("status", None)  # count irrespective of status filter
        arch_q["archived_at"] = {"$ne": None}
        arch_count = 0
        try:
            arch_count = await db[collection].count_documents(arch_q)
            if mirror_categories:
                mq_a: Dict[str, Any] = {
                    "org_id": user["org_id"], "deleted_at": None,
                    "template_category_snapshot": {"$in": mirror_categories},
                    "archived_at": {"$ne": None},
                }
                # v58.13.132gx — mirror the SSRA-exclusion regex.
                if exclude_name_regex:
                    mq_a["template_name_snapshot"] = {
                        "$not": {"$regex": exclude_name_regex, "$options": "i"},
                    }
                if workspace_id:
                    mq_a["workspace_id"] = workspace_id
                if own_only is not None:
                    mq_a["$or"] = [{"created_by": own_only},
                                   {"submitted_by": own_only}]
                arch_count += await db.form_submissions.count_documents(mq_a)
        except Exception:  # pragma: no cover — defensive
            arch_count = 0

        # v58.13.132ef — True total (before the pagination `limit`
        # slice) so the FE `TotalCountChip` displays the actual DB
        # count instead of `len(docs)` (which was capped at 5000
        # since .132ea and made the chip freeze at "5,000 total"
        # for orgs with >5k rows). Same query scope as the `.find()`
        # above, minus the wizard filters that already returned an
        # empty `docs`.
        total_count = 0
        try:
            if not (bulk_import_id or needs_review):
                # v58.13.132gx — mirror the SSRA exclusion into the
                # native count too so the FE TotalCountChip agrees
                # with the visible list.
                total_native_q = q
                if exclude_name_regex:
                    total_native_q = {
                        **q,
                        "$nor": [
                            {"title": {"$regex": exclude_name_regex, "$options": "i"}},
                            {"name": {"$regex": exclude_name_regex, "$options": "i"}},
                            {"template_name_snapshot": {"$regex": exclude_name_regex,
                                                         "$options": "i"}},
                        ],
                    }
                total_count = await db[collection].count_documents(total_native_q)
            if mirror_categories and not status:
                mq_t: Dict[str, Any] = {
                    "org_id": user["org_id"], "deleted_at": None,
                    "template_category_snapshot": {"$in": mirror_categories},
                }
                if not include_archived:
                    mq_t["archived_at"] = None
                # v58.13.132gx — mirror the SSRA-exclusion regex.
                if exclude_name_regex:
                    mq_t["template_name_snapshot"] = {
                        "$not": {"$regex": exclude_name_regex, "$options": "i"},
                    }
                if workspace_id:
                    mq_t["workspace_id"] = workspace_id
                if own_only is not None:
                    mq_t["$or"] = [{"created_by": own_only},
                                   {"submitted_by": own_only}]
                if date_from or date_to:
                    mq_t["submitted_at"] = {
                        **({"$gte": date_from} if date_from else {}),
                        **({"$lte": date_to} if date_to else {}),
                    }
                if bulk_import_id:
                    mq_t["metadata.job_id"] = bulk_import_id
                if needs_review:
                    mq_t["$and"] = mq_t.get("$and", []) + [{
                        "$or": [
                            {"metadata.worker_match.needs_review": True},
                            {"metadata.worker_match.id": None},
                        ],
                    }]
                total_count += await db.form_submissions.count_documents(mq_t)
        except Exception:  # pragma: no cover — defensive
            total_count = len(encoded)
        return encoded, arch_count, total_count

    @r.get("/{item_id}")
    async def get_item(item_id: str, user: dict = Depends(require_permission(resource, "view"))):
        doc = await db[collection].find_one(
            {"id": item_id, "org_id": user["org_id"], "deleted_at": None}, {"_id": 0})
        if not doc:
            raise HTTPException(status_code=404, detail="Not found")
        # v159.2 — team-scoping on detail: workers without `team_view` can
        # only open their own records. Others (supervisor+/auditor) unchanged.
        own_only = await resolve_team_scope(user, resource, None)
        if own_only is not None and doc.get("created_by") != own_only:
            raise HTTPException(
                status_code=403,
                detail=f"Permission denied: {resource}.team_view",
            )
        return doc

    @r.post("", status_code=201)
    async def create_item(body: model, user: dict = Depends(require_permission(resource, "edit"))):
        payload = body.model_dump()
        doc = {
            "id": new_id(),
            "org_id": user["org_id"],
            "created_by": user["id"],
            "created_at": now_iso(),
            "updated_at": now_iso(),
            "deleted_at": None,
            **payload,
        }
        if collection == "swms":
            # Phase 4.1 — version-chain auto-commit. If a non-superseded record
            # exists with the same title in this org, we either:
            #   (a) update IN-PLACE if the incoming version matches (idempotent), or
            #   (b) insert FRESH and link via supersedes/superseded_by pointers,
            #       archiving the old row with status=superseded.
            doc["version"] = doc.get("version") or 1
            title = (payload.get("title") or "").strip()
            new_ver = payload.get("version")
            if title:
                existing = await db.swms.find_one(
                    {"org_id": user["org_id"], "title": title,
                     "deleted_at": None,
                     "status": {"$ne": "superseded"}},
                    {"_id": 0},
                )
                if existing:
                    if (existing.get("version") or 1) == new_ver:
                        # Idempotent re-import — patch in place.
                        await db.swms.update_one(
                            {"id": existing["id"]},
                            {"$set": {**{k: v for k, v in payload.items() if k != "id"},
                                      "updated_at": now_iso(),
                                      "updated_by": user["id"]}},
                        )
                        return {**existing, **payload, "id": existing["id"],
                                "_chain_action": "in_place_update"}
                    # Different version → chain. Insert fresh, archive old.
                    doc["supersedes"] = existing["id"]
                    await db.swms.update_one(
                        {"id": existing["id"]},
                        {"$set": {"superseded_by": doc["id"],
                                  "status": "superseded",
                                  "updated_at": now_iso()}},
                    )
                    doc["_chain_action"] = "superseded_v" + str(existing.get("version"))
        await db[collection].insert_one(dict(doc))
        return _strip(doc)

    @r.patch("/{item_id}")
    async def update_item(item_id: str, patch: dict,
                          user: dict = Depends(require_permission(resource, "edit"))):
        patch = {k: v for k, v in (patch or {}).items()
                 if k not in {"id", "org_id", "created_at", "created_by"}}
        patch["updated_at"] = now_iso()
        result = await db[collection].find_one_and_update(
            {"id": item_id, "org_id": user["org_id"], "deleted_at": None},
            {"$set": patch},
            return_document=True,
            projection={"_id": 0},
        )
        if not result:
            raise HTTPException(status_code=404, detail="Not found")
        return result

    @r.delete("/{item_id}")
    async def delete_item(item_id: str,
                          user: dict = Depends(require_permission(resource, "edit"))):
        result = await db[collection].update_one(
            {"id": item_id, "org_id": user["org_id"], "deleted_at": None},
            {"$set": {"deleted_at": now_iso()}},
        )
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Not found")
        return {"ok": True}

    # ─── v58.13.132ec — Archive lifecycle ─────────────────────────
    # Archive is a non-destructive state that hides the row from
    # default list views. Records are recoverable via `unarchive`.
    # Admin-only (bulk operation with data-integrity implications).
    #
    # Handles BOTH the native collection and the mirrored
    # `form_submissions` slice — a caller can point either endpoint
    # at any id and the correct collection gets the write. Same
    # audit row goes to `archive_audit` regardless.

    async def _find_row(item_id: str, org_id: str):
        """Return (collection_name, doc) for either the native or
        mirrored row, or (None, None) if neither carries the id."""
        native = await db[collection].find_one(
            {"id": item_id, "org_id": org_id},
            {"_id": 0, "id": 1, "archived_at": 1, "archive_batch_id": 1},
        )
        if native is not None:
            return collection, native
        if mirror_categories:
            mirror = await db.form_submissions.find_one(
                {"id": item_id, "org_id": org_id,
                 "template_category_snapshot": {"$in": mirror_categories}},
                {"_id": 0, "id": 1, "archived_at": 1, "archive_batch_id": 1},
            )
            if mirror is not None:
                return "form_submissions", mirror
        return None, None

    async def _write_audit(actor_id: str, action: str, batch_id: str,
                            affected: int, criteria: Dict[str, Any] | None,
                            reason: str | None) -> None:
        await db.archive_audit.insert_one({
            "id": new_id(),
            "module": prefix,
            "actor_user_id": actor_id,
            "action": action,
            "batch_id": batch_id,
            "criteria": criteria or {},
            "affected_count": affected,
            "reason": reason,
            "timestamp": now_iso(),
        })

    @r.post("/archive")
    async def bulk_archive(
        body: Optional[dict] = None,
        user: dict = Depends(require_permission(resource, "edit")),
    ):
        """v58.13.132ed — Bulk archive with criteria + dry-run preview.
        Admin-only. `dry_run=true` returns match count + first 100 ids
        without persisting."""
        if user.get("role") != "admin":
            raise HTTPException(status_code=403, detail="Admin only")
        body = body or {}
        criteria = body.get("criteria") or {}
        reason = body.get("reason")
        dry_run = bool(body.get("dry_run"))

        # Build the base match: org + not-already-archived. `deleted_at`
        # is deliberately not filtered here — a soft-deleted row can
        # still be archived (they are orthogonal states).
        q: dict[str, Any] = {"org_id": user["org_id"], "archived_at": None}
        # Date filters — cascade through the shape variants we see across
        # the 7 modules (`date`, `created_at`, `submitted_at`,
        # `occurred_at`).
        date_before = criteria.get("date_before")
        date_between = criteria.get("date_between")
        if date_before or date_between:
            date_field = "created_at"
            rng: dict[str, str] = {}
            if date_before:
                rng["$lt"] = date_before
            elif date_between and len(date_between) == 2:
                rng["$gte"] = date_between[0]
                rng["$lte"] = date_between[1]
            q[date_field] = rng
        # Status / site / category — pass-throughs.
        if criteria.get("status_in"):
            q["status"] = {"$in": criteria["status_in"]}
        if criteria.get("site_id"):
            q["site_id"] = criteria["site_id"]
        if criteria.get("category_in"):
            q["category"] = {"$in": criteria["category_in"]}
        if criteria.get("template_id_in"):
            q["template_id"] = {"$in": criteria["template_id_in"]}

        # `oldest_n` — post-filter slice by created_at asc. Runs BEFORE
        # any commit so dry-run + commit see the same set.
        oldest_n = criteria.get("oldest_n")
        limit_native = 0
        candidates: list[dict] = []
        if oldest_n:
            candidates = await db[collection].find(
                q, {"_id": 0, "id": 1}
            ).sort("created_at", 1).limit(int(oldest_n)).to_list(int(oldest_n))
            matched_ids = [c["id"] for c in candidates]
        else:
            matched_ids_cursor = db[collection].find(q, {"_id": 0, "id": 1})
            matched_ids = [c["id"] async for c in matched_ids_cursor]

        # Mirror slice.
        mirror_matched_ids: list[str] = []
        if mirror_categories:
            mq = dict(q)
            mq["template_category_snapshot"] = {"$in": mirror_categories}
            # Rewrite `created_at` filter → `submitted_at` on mirrored rows.
            if date_before or date_between:
                mq.pop("created_at", None)
                rng2: dict[str, str] = {}
                if date_before:
                    rng2["$lt"] = date_before
                elif date_between and len(date_between) == 2:
                    rng2["$gte"] = date_between[0]
                    rng2["$lte"] = date_between[1]
                mq["submitted_at"] = rng2
            if oldest_n:
                mcands = await db.form_submissions.find(
                    mq, {"_id": 0, "id": 1}
                ).sort("submitted_at", 1).limit(int(oldest_n)).to_list(int(oldest_n))
                mirror_matched_ids = [c["id"] for c in mcands]
            else:
                mirror_matched_ids = [c["id"] async for c in
                                       db.form_submissions.find(mq, {"_id": 0, "id": 1})]

        total_matched = len(matched_ids) + len(mirror_matched_ids)
        sample = (matched_ids + mirror_matched_ids)[:100]

        if dry_run:
            return {"ok": True, "dry_run": True, "matched_count": total_matched,
                    "matched_ids_sample": sample, "batch_id": None}

        batch_id = new_id()
        stamp = {"archived_at": now_iso(), "archived_by": user["id"],
                 "archived_reason": reason, "archive_batch_id": batch_id}
        n1 = 0
        if matched_ids:
            r1 = await db[collection].update_many(
                {"id": {"$in": matched_ids}, "org_id": user["org_id"],
                 "archived_at": None},
                {"$set": stamp})
            n1 = r1.modified_count
        n2 = 0
        if mirror_matched_ids:
            r2 = await db.form_submissions.update_many(
                {"id": {"$in": mirror_matched_ids}, "org_id": user["org_id"],
                 "archived_at": None},
                {"$set": stamp})
            n2 = r2.modified_count
        affected = n1 + n2
        await _write_audit(user["id"], "bulk_archive", batch_id, affected,
                            criteria, reason)
        return {"ok": True, "dry_run": False, "batch_id": batch_id,
                "archived_count": affected, "matched_ids_sample": sample}

    @r.post("/{item_id}/archive")
    async def archive_item(
        item_id: str,
        body: Optional[dict] = None,
        user: dict = Depends(require_permission(resource, "edit")),
    ):
        if user.get("role") != "admin":
            raise HTTPException(status_code=403, detail="Admin only")
        coll, doc = await _find_row(item_id, user["org_id"])
        if not doc:
            raise HTTPException(status_code=404, detail="Not found")
        if doc.get("archived_at"):
            return {"ok": True, "id": item_id,
                    "batch_id": doc.get("archive_batch_id"),
                    "already_archived": True}
        batch_id = new_id()
        reason = (body or {}).get("reason")
        await db[coll].update_one(
            {"id": item_id, "org_id": user["org_id"]},
            {"$set": {"archived_at": now_iso(),
                      "archived_by": user["id"],
                      "archived_reason": reason,
                      "archive_batch_id": batch_id}},
        )
        await _write_audit(user["id"], "archive", batch_id, 1,
                            {"item_id": item_id, "collection": coll}, reason)
        return {"ok": True, "id": item_id, "batch_id": batch_id,
                "already_archived": False}

    @r.post("/{item_id}/unarchive")
    async def unarchive_item(
        item_id: str,
        user: dict = Depends(require_permission(resource, "edit")),
    ):
        if user.get("role") != "admin":
            raise HTTPException(status_code=403, detail="Admin only")
        coll, doc = await _find_row(item_id, user["org_id"])
        if not doc:
            raise HTTPException(status_code=404, detail="Not found")
        prior_batch = doc.get("archive_batch_id")
        if not doc.get("archived_at"):
            return {"ok": True, "id": item_id, "already_active": True}
        await db[coll].update_one(
            {"id": item_id, "org_id": user["org_id"]},
            {"$set": {"archived_at": None,
                      "archived_by": None,
                      "archived_reason": None,
                      "archive_batch_id": None}},
        )
        await _write_audit(user["id"], "unarchive", prior_batch or "",
                            1, {"item_id": item_id, "collection": coll},
                            None)
        return {"ok": True, "id": item_id, "restored_from_batch": prior_batch}

    @r.post("/unarchive-batch/{batch_id}")
    async def unarchive_batch(
        batch_id: str,
        user: dict = Depends(require_permission(resource, "edit")),
    ):
        if user.get("role") != "admin":
            raise HTTPException(status_code=403, detail="Admin only")
        q = {"org_id": user["org_id"], "archive_batch_id": batch_id}
        total = 0
        for c in [collection] + (["form_submissions"] if mirror_categories else []):
            res = await db[c].update_many(
                q, {"$set": {"archived_at": None, "archived_by": None,
                             "archived_reason": None,
                             "archive_batch_id": None}},
            )
            total += res.modified_count
        await _write_audit(user["id"], "bulk_unarchive", batch_id, total,
                            {"batch_id": batch_id}, None)
        return {"ok": True, "batch_id": batch_id, "restored_count": total}

    return r


# ---------- Build the six entity routers ----------
# v160.0.9 — each router now carries the corresponding mobile module id
# so the phone gets 403 when an admin turns the module OFF.
# v160.2.5a — Capture sub-tabs mirror phone-filled submissions by
# template category. Buckets:
#   pre_starts  ← pre_start | plant_pre_start
#   site_diary  ← (no live category yet; keeps empty until seeded)
#   hazards     ← near_miss
#   incidents   ← incident
#   inspections ← inspection
# `general` and `toolbox` are catch-all for the /forms tab (per-template
# view via FormSubmissions.jsx) — deliberately NOT mirrored here so a
# submission never double-lands in two Capture tabs.
swms_router       = build_router("swms",         "swms",                SwmsIn,        "swms",         "swms")
prestarts_router  = build_router("pre-starts",   "pre_starts",          PreStartIn,    "pre_starts",   "pre_start",
                                 mirror_categories=["pre_start", "plant_pre_start"])
diary_router      = build_router("site-diary",   "site_diary_entries",  SiteDiaryIn,   "site_diary",   "site_diary",
                                 mirror_categories=["site_diary"])
hazards_router    = build_router("hazards",      "hazards",             HazardIn,      "hazards",      "hazard",
                                 # v160.3.0-adjust-14 — union both `hazard` and
                                 # `near_miss` mirror categories. Pre-adjust-13
                                 # this only pulled `near_miss` because `hazard`
                                 # was normalised down to `general` on write.
                                 # Since adjust-13, `hazard` is a first-class
                                 # ALLOWED_CATEGORY (used by the Construction &
                                 # Excavation SSRA and Viatec Traffic Solutions
                                 # SSRA templates), so imported / mobile
                                 # submissions with `category: hazard` need to
                                 # surface on the Hazard Reports capture tab.
                                 mirror_categories=["hazard", "near_miss"])
incidents_router  = build_router("incidents",    "incidents",           IncidentIn,    "incidents",    "incident",
                                 # v58.13.132ia — Hazard Reports merged into Incidents.
                                 # `hazard` + `near_miss` mirror categories join the mirror
                                 # projection so field-captured hazard-family form_submissions
                                 # surface on the Incidents Capture tab. Native `hazards`
                                 # collection rows are physically migrated by
                                 # `migrations/merge_hazards_into_incidents_v58_13_132ia.py`.
                                 mirror_categories=["incident", "hazard", "near_miss"])
inspections_router = build_router("inspections", "inspections",         InspectionIn,  "inspections",  "inspection",
                                  mirror_categories=["inspection"])
# v160.3.0-adjust-13 — Risk Assessments Capture bucket. Reads submissions
# via mirror-projection on templates with category === "risk_assessment".
# Uses its own collection so any future native writes stay isolated.
#
# v58.13.132gx Phase 4 — Bug 2. Explicitly exclude submissions whose
# template name reads as SSRA / Site Specific Risk Assessment so
# they don't leak into the generic Risk Assessments tab. SSRAs live
# on their own tab (see `bulk_import_template_inference.py`).
_SSRA_EXCLUDE_REGEX = r"\bssra\b|site\s*specific\s*risk"
risk_assessments_router = build_router(
    "risk-assessments", "risk_assessments", RiskAssessmentIn,
    "risk_assessments", "risk_assessment",
    mirror_categories=["risk_assessment"],
    exclude_name_regex=_SSRA_EXCLUDE_REGEX,
)


# ---------- SWMS review (extra endpoint) ----------

@swms_router.post("/{item_id}/review")
async def review_swms(item_id: str, body: SwmsReview,
                      user: dict = Depends(require_permission("swms", "edit"))):
    if user["role"] not in {"hseq_lead", "admin"}:
        raise HTTPException(status_code=403, detail="Only HSE leads can review SWMS")
    status_map = {"approve": "approved", "reject": "rejected", "request_changes": "changes_requested"}
    update = {
        "status": status_map[body.action],
        "review_note": body.note,
        "reviewed_by": user["id"],
        "reviewed_at": now_iso(),
        "updated_at": now_iso(),
    }
    result = await db.swms.find_one_and_update(
        {"id": item_id, "org_id": user["org_id"], "deleted_at": None},
        {"$set": update},
        return_document=True,
        projection={"_id": 0},
    )
    if not result:
        raise HTTPException(status_code=404, detail="SWMS not found")
    return result
