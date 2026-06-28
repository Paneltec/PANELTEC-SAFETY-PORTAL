"""Phase 3.9c — Notification dispatcher for form template assignments.

When an admin saves changes to a template's `applies_to` rule (via the matrix
or two-pane UI), workers who are newly exposed to the template (either by
direct worker_id assignment, role membership or simpro_company_id match) get
an email + SMS within 60 s:

    "You have a new safety form assigned: {form name}.
    Open Paneltec to complete."

Re-assignment is deduped per (worker_id, template_id) for 24 h via the
`form_assignment_notifications` collection so a bulk-save spree can't spam.
The dispatcher runs as a fire-and-forget asyncio task so the PUT/POST
response is not blocked by Microsoft 365 / TextMagic latency.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone, timedelta
from typing import Iterable

import httpx

from db import db


log = logging.getLogger("paneltec.forms.assignment_notify")

_DEDUPE_HOURS = 24


# ────────────────── Audience resolution ──────────────────

async def _resolve_audience(org_id: str, applies_to: dict) -> set[str]:
    """Expand an `applies_to` rule into the **direct** + role + company-matched
    worker IDs that should see this template (regardless of asset). Universal
    rules (kinds=['any']) are intentionally excluded — they don't notify
    everyone in the org every time you tick an asset_type checkbox."""
    if not applies_to:
        return set()
    now = datetime.now(timezone.utc).isoformat()

    direct: set[str] = set()
    for w in (applies_to.get("worker_ids") or []):
        wid = (w or {}).get("worker_id") if isinstance(w, dict) else w
        exp = (w or {}).get("expires_at") if isinstance(w, dict) else None
        if wid and (not exp or exp > now):
            direct.add(wid)

    roles: set[str] = set()
    for r in (applies_to.get("roles") or []):
        role = (r or {}).get("role") if isinstance(r, dict) else r
        exp = (r or {}).get("expires_at") if isinstance(r, dict) else None
        if role and (not exp or exp > now):
            roles.add(role.lower())

    companies: set[str] = set()
    for c in (applies_to.get("companies") or []):
        cid = (c or {}).get("simpro_company_id") if isinstance(c, dict) else c
        exp = (c or {}).get("expires_at") if isinstance(c, dict) else None
        if cid and (not exp or exp > now):
            companies.add(str(cid))

    audience = set(direct)
    if roles or companies:
        cur = db.workers.find(
            {"org_id": org_id, "deleted_at": None},
            {"_id": 0, "id": 1, "role": 1, "simpro_company_id": 1},
        )
        async for w in cur:
            r = (w.get("role") or "").lower()
            sc = str(w.get("simpro_company_id") or "")
            if (r and r in roles) or (sc and sc in companies):
                audience.add(w["id"])
    return audience


# ────────────────── Dispatcher ──────────────────

async def _send_one(worker: dict, template: dict, org_id: str, deep_link: str) -> None:
    """Queue one email (via outbox) + one SMS (best-effort) for this worker."""
    name = (
        worker.get("name")
        or " ".join(filter(None, [worker.get("first_name"), worker.get("last_name")])).strip()
        or "Worker"
    )
    subject = f"New safety form: {template.get('name')}"
    body_html = (
        f"<p>Hi {name},</p>"
        f"<p>You have been assigned a new safety form on Paneltec Civil:</p>"
        f"<p><b>{template.get('name')}</b><br/>"
        f"<i>{(template.get('description') or '').strip() or 'Open the app to complete this form.'}</i></p>"
        f"<p><a href=\"{deep_link}\">Open in Paneltec →</a></p>"
        f"<p style='color:#64748b;font-size:11px'>Paneltec Civil · WHS Compliance</p>"
    )

    # Email
    try:
        from email_outbox import queue_email_doc
        to_addr = worker.get("email")
        if to_addr:
            await queue_email_doc(
                org_id=org_id,
                to=[to_addr],
                subject=subject,
                body_html=body_html,
                resource_kind="forms",
                related_record_type="form_template_assignment",
                related_record_id=template["id"],
                created_by="system:form_assignment_notifier",
            )
    except Exception as e:  # noqa: BLE001
        log.warning("form-assignment email failed worker=%s tpl=%s: %s",
                    worker.get("id"), template.get("id"), e)

    # SMS (TextMagic, best-effort).
    try:
        tm = await db.integration_configs.find_one(
            {"org_id": org_id, "kind": "textmagic"},
            {"config": 1, "status": 1},
        )
        tm_cfg = (tm or {}).get("config") or {}
        mobile = worker.get("phone") or worker.get("mobile")
        if tm_cfg.get("username") and tm_cfg.get("api_key") and mobile:
            text = (
                f"Paneltec: New safety form assigned — {template.get('name')}. "
                f"Open the app to complete."
            )
            async with httpx.AsyncClient(timeout=10) as c:
                await c.post(
                    "https://rest.textmagic.com/api/v2/messages",
                    headers={
                        "X-TM-Username": tm_cfg["username"],
                        "X-TM-Key": tm_cfg["api_key"],
                    },
                    data={"text": text, "phones": mobile},
                )
    except Exception as e:  # noqa: BLE001
        log.warning("form-assignment SMS failed worker=%s tpl=%s: %s",
                    worker.get("id"), template.get("id"), e)


async def _process(template_id: str, org_id: str, new_worker_ids: Iterable[str]) -> dict:
    template = await db.form_templates.find_one(
        {"id": template_id, "org_id": org_id, "deleted_at": None},
        {"_id": 0, "id": 1, "name": 1, "description": 1},
    )
    if not template:
        return {"sent": 0, "deduped": 0}

    deep_link = f"https://app.paneltec.com.au/app/forms?template={template_id}"
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=_DEDUPE_HOURS)).isoformat()
    sent = 0
    deduped = 0

    for wid in new_worker_ids:
        # Dedupe across the configured window.
        prior = await db.form_assignment_notifications.find_one({
            "org_id": org_id, "template_id": template_id, "worker_id": wid,
            "sent_at": {"$gte": cutoff},
        })
        if prior:
            deduped += 1
            continue
        worker = await db.workers.find_one(
            {"id": wid, "org_id": org_id, "deleted_at": None},
            {"_id": 0, "id": 1, "first_name": 1, "last_name": 1, "name": 1,
             "email": 1, "phone": 1, "mobile": 1, "role": 1},
        )
        if not worker:
            continue
        await _send_one(worker, template, org_id, deep_link)
        await db.form_assignment_notifications.insert_one({
            "org_id": org_id,
            "template_id": template_id,
            "worker_id": wid,
            "sent_at": datetime.now(timezone.utc).isoformat(),
        })
        sent += 1
    return {"sent": sent, "deduped": deduped}


async def dispatch_diff(
    *, org_id: str, template_id: str,
    prior_applies_to: dict, next_applies_to: dict,
    skip: bool = False,
) -> dict:
    """Synchronous helper that **schedules** notification work for the newly
    exposed audience. Returns the {newly_added, prior_count, next_count}
    counts immediately so the API caller can display them. If `skip=True`
    the diff is computed but no notifications are queued (used when the
    admin opted out)."""
    prior_audience = await _resolve_audience(org_id, prior_applies_to or {})
    next_audience = await _resolve_audience(org_id, next_applies_to or {})
    newly = next_audience - prior_audience

    if not skip and newly:
        # Fire-and-forget — don't block the PUT response.
        asyncio.create_task(_process(template_id, org_id, list(newly)))

    return {
        "prior_count": len(prior_audience),
        "next_count": len(next_audience),
        "newly_added": sorted(newly),
        "newly_added_count": len(newly),
        "queued": not skip and len(newly) > 0,
    }


# ────────────────── Targeted form resolution (used by scan + list) ──────────────────

async def resolve_forms_for_worker(
    *, org_id: str, worker: dict | None,
    asset: dict | None = None,
    include_universal_only: bool = False,
) -> list[dict]:
    """Return form templates visible to *this* worker, applying ALL Phase 3.9c
    rules at once:

      1. `kinds:["any"]`                 → universal (always included).
      2. asset.kind ∈ kinds              → asset-type rule.
      3. asset.asset_type ∈ asset_types  → asset-type rule.
      4. worker.id ∈ worker_ids          → direct assignment.
      5. worker.role ∈ roles             → role membership.
      6. worker.simpro_company_id ∈ companies → company membership.

    Expired entries (`expires_at` < now) are filtered out before matching.
    The resulting list is deduped and decorated with a `match_reasons` array
    so the caller (or the "Assigned to you" amber chip) can show WHY a form
    appeared.

    If `include_universal_only=True` only rule #1 is honoured — used by the
    list endpoint when the caller is NOT a worker (admin browsing).
    """
    now = datetime.now(timezone.utc).isoformat()
    kind = (asset or {}).get("kind", "")
    kind = (kind or "").lower() if kind else ""
    asset_type = (asset or {}).get("asset_type", "")
    asset_type = (asset_type or "").lower() if asset_type else ""

    wid = (worker or {}).get("id")
    wrole = ((worker or {}).get("role") or "").lower()
    wcompany = str((worker or {}).get("simpro_company_id") or "")

    out: list[dict] = []
    cur = db.form_templates.find(
        {"org_id": org_id, "deleted_at": None},
        {"_id": 0, "id": 1, "name": 1, "description": 1, "category": 1,
         "fields": 1, "applies_to": 1},
    )
    async for tpl in cur:
        a = tpl.get("applies_to") or {}
        kinds = {k.lower() for k in (a.get("kinds") or [])}
        types_set = {t.lower() for t in (a.get("asset_types") or [])}
        reasons: list[str] = []

        if "any" in kinds:
            reasons.append("universal")
        if not include_universal_only:
            if asset and kind and kind in kinds:
                reasons.append(f"kind:{kind}")
            if asset and asset_type and asset_type in types_set:
                reasons.append(f"asset_type:{asset_type}")
            if wid:
                for entry in (a.get("worker_ids") or []):
                    if isinstance(entry, dict):
                        ewid, eexp = entry.get("worker_id"), entry.get("expires_at")
                    else:
                        ewid, eexp = entry, None
                    if ewid == wid and (not eexp or eexp > now):
                        reasons.append("direct")
                        break
            if wrole:
                for entry in (a.get("roles") or []):
                    if isinstance(entry, dict):
                        erole, eexp = (entry.get("role") or "").lower(), entry.get("expires_at")
                    else:
                        erole, eexp = (entry or "").lower(), None
                    if erole == wrole and (not eexp or eexp > now):
                        reasons.append(f"role:{wrole}")
                        break
            if wcompany:
                for entry in (a.get("companies") or []):
                    if isinstance(entry, dict):
                        ecid, eexp = str(entry.get("simpro_company_id") or ""), entry.get("expires_at")
                    else:
                        ecid, eexp = str(entry), None
                    if ecid == wcompany and (not eexp or eexp > now):
                        reasons.append(f"company:{wcompany}")
                        break

        if not reasons:
            continue
        out.append({
            "template_id": tpl["id"],
            "name": tpl["name"],
            "description": tpl.get("description") or "",
            "category": (tpl.get("category") or "").lower(),
            "field_count": len(tpl.get("fields") or []),
            "match_reasons": reasons,
        })

    # Recommended ordering: direct/role/company assignments first, then
    # asset-type rules, then universal-only.
    def _rank(item):
        rs = item["match_reasons"]
        if any(r == "direct" for r in rs): return 0
        if any(r.startswith("role:") for r in rs): return 1
        if any(r.startswith("company:") for r in rs): return 2
        if any(r.startswith("kind:") or r.startswith("asset_type:") for r in rs): return 3
        return 4
    out.sort(key=lambda x: (_rank(x), x["name"].lower()))
    return out
