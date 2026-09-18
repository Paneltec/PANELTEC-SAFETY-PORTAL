"""Ask Intelligence — Claude Sonnet 4.5 with grounded evidence over org records.

v58.13.114 — Retrieval scope expanded from 5 to 12 collections and made
QUERY-AWARE. `_evidence()` now:
  · Extracts query tokens with `_query_tokens()`.
  · Regex-filters every collection against those tokens when present;
    falls back to the pre-.114 recency behaviour when the query has no
    usable token (empty / stopword-only / too-short).
  · Joins `users` matches into `pre_starts`, `site_diary_entries`,
    `audit_log`, `outbound_emails`, `outbound_sms` by `created_by` /
    `submitted_by` / `actor_user_id` so authored-record hits count.
  · Gates `audit_log` + comms collections on `_can_see_audit()` /
    `_can_see_comms()` so a non-privileged caller never gets citations
    to records they can't see in the UI.
Confidence is now COMPUTED by the backend via `_compute_confidence()` —
Claude's own confidence is respected only when it's a downgrade. A
name-shaped zero-domain-hit query returns a fallback body via
`_build_name_fallback_body()` so the user gets a summary + top-3
recent activity without a second round-trip.
"""
from __future__ import annotations
import asyncio
import json
import logging
import os
import re
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from pymongo import ReturnDocument

from ai import CLAUDE_MODEL, _claude_json, _emergent_key
from auth import get_current_user
from permissions import require_module
from db import db
from models import new_id, now_iso

log = logging.getLogger("paneltec.ask")
router = APIRouter(prefix="/ask", tags=["ask"], dependencies=[Depends(require_module("ask_intel"))])  # v160.0.9

# v159.1 — Ask Intelligence gate. Non-admin/hseq callers must have the
# `ask_intel` mobile module toggled on for their role. Admins bypass.
PRIVILEGED_ASK_ROLES = {"admin", "hseq_lead"}


async def require_ask_access(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") in PRIVILEGED_ASK_ROLES:
        return user
    doc = await db.org_settings.find_one(
        {"org_id": user["org_id"]}, {"_id": 0, "mobile_modules": 1},
    )
    row = (((doc or {}).get("mobile_modules") or {}).get(user.get("role") or "") or {})
    if not row.get("ask_intel"):
        raise HTTPException(403, "Permission denied: ask_intel module disabled for your role")
    return user


_briefing_cache: dict[str, tuple[float, dict]] = {}
CACHE_TTL = 3600  # 1 hour

ASK_SYSTEM = """You are Paneltec Civil's compliance analyst. Answer the user's question
ONLY using the JSON evidence bundle provided in the user message. Cite specific
record IDs and titles inline. If the evidence does not support an answer, say so.

You MUST respond with ONLY this JSON shape (no prose, no fences):
{
  "title": "...",
  "body": "...",
  "confidence": "high|medium|low",
  "cited_evidence": [
    { "record_type": "incident|hazard|swms|inspection|contractor|user|worker|site_visitor|form_submission|pre_start|site_diary|audit_log|outbound_email|outbound_sms",
      "record_id": "...", "label": "..." }
  ]
}
Keep body to 2-4 sentences. Pick 2-5 cited records. When the evidence contains
`users`, `workers`, or `site_visitors` entries matching a name-shaped query,
prefer citing those directly.
"""


class AskIn(BaseModel):
    question: str = Field(min_length=3)
    workspace_id: Optional[str] = None


# ── v58.13.114 helpers ──────────────────────────────────────────────

# Names (or any single lower-case token 3-40 chars) that a user might
# type. Anything longer or containing a stopword we still tokenise but
# treat as a topical search.
_STOPWORDS = {
    "the", "and", "for", "with", "this", "that", "was", "are", "have",
    "has", "who", "what", "when", "where", "why", "how", "any", "all",
    "does", "did", "not", "yes", "no", "please", "show", "give", "tell",
    "find", "search", "list", "recent", "latest", "last", "week", "month",
    "day", "days", "weeks", "months", "year", "years", "record", "records",
    "site", "sites", "me", "my", "our", "your", "them", "they", "it",
}


def _query_tokens(question: str) -> list[str]:
    """Extract 2-40 char alphanumeric tokens from the user's question.

    Removes stopwords + the module verbs we intentionally never want to
    match against arbitrary text (e.g. "incidents" as a token would
    otherwise match every incident title). Order preserved so the
    first informative token is the "primary" filter — the primary
    token drives `_looks_name_shaped()`.
    """
    if not question:
        return []
    raw = re.findall(r"[A-Za-z0-9][A-Za-z0-9._-]{1,39}", question.lower())
    return [t for t in raw if t not in _STOPWORDS and len(t) >= 2]


def _looks_name_shaped(question: str, tokens: list[str]) -> bool:
    """True iff the query is a single informative token — treat as a name."""
    return len(tokens) == 1 and " " not in question.strip()


def _regex_or(fields: list[str], token: str) -> dict:
    """Build a case-insensitive `$or` over the given fields for one token."""
    escaped = re.escape(token)
    return {"$or": [{f: {"$regex": escaped, "$options": "i"}} for f in fields]}


def _can_see_audit(user: dict) -> bool:
    if (user or {}).get("role") in {"admin", "hseq_lead"}:
        return True
    eff = ((user or {}).get("effective_permissions") or {}).get("audit_log") or {}
    return bool(eff.get("view"))


def _can_see_comms(user: dict) -> bool:
    if (user or {}).get("role") in {"admin", "hseq_lead"}:
        return True
    eff = ((user or {}).get("effective_permissions") or {}).get("email_outbox") or {}
    return bool(eff.get("view"))


async def ensure_indexes() -> None:
    """v58.13.114 — Add indexes for the collections the retriever now
    regex-scans. Skipped if already present. Called from server.py
    on_startup alongside every other module's ensure_indexes."""
    try:
        await db.form_submissions.create_index("submitted_by")
        await db.form_submissions.create_index("submitted_by_name")
        await db.form_submissions.create_index("template_name_snapshot")
        await db.pre_starts.create_index("created_by")
        await db.site_diary_entries.create_index("created_by")
        await db.site_visitors.create_index("name")
        await db.site_visitors.create_index("visiting_person")
        await db.workers.create_index("first_name")
        await db.workers.create_index("last_name")
        await db.audit_log.create_index("actor_user_id")
    except Exception as e:  # pragma: no cover
        log.warning("ask ensure_indexes: %s", e)


async def _evidence(org_id: str, workspace_id: Optional[str],
                    question: str = "",
                    user: Optional[dict] = None) -> dict:
    """Assemble the evidence bundle.

    v58.13.114 — Now takes `question` and `user`. Query tokens drive
    a regex pre-filter across every collection; joined queries on
    child collections use the user-ids we matched. If `question` has
    no usable token, we fall back to the pre-.114 recency behaviour
    so briefing/dashboard callers keep working exactly as before.
    """
    ninety_days_ago = (datetime.now(timezone.utc) - timedelta(days=90)).isoformat()
    ws_filter: dict = {}
    if workspace_id:
        ws_filter["workspace_id"] = workspace_id
    tokens = _query_tokens(question)
    primary = tokens[0] if tokens else None
    user = user or {}

    def base(extra=None):
        q = {"org_id": org_id, "deleted_at": None, **ws_filter}
        if extra:
            q.update(extra)
        return q

    # ── existing 5 collections (kept as domain context) ────────────
    incidents = await db.incidents.find(base({"occurred_at": {"$gte": ninety_days_ago}}),
                                        {"_id": 0, "id": 1, "title": 1, "category": 1,
                                         "occurred_at": 1, "description": 1, "follow_up_status": 1}).limit(30).to_list(30)
    hazards = await db.hazards.find(base({"status": {"$in": ["open", "in_progress"]}}),
                                    {"_id": 0, "id": 1, "title": 1, "severity": 1,
                                     "controls": 1, "status": 1}).limit(30).to_list(30)
    swms = await db.swms.find(base(),
                              {"_id": 0, "id": 1, "title": 1, "status": 1, "updated_at": 1}).sort("updated_at", -1).limit(30).to_list(30)
    inspections = await db.inspections.find(base(),
                                            {"_id": 0, "id": 1, "template_name": 1, "date": 1,
                                             "corrective_actions": 1}).sort("date", -1).limit(20).to_list(20)
    contractors = await db.contractors.find({"org_id": org_id, "deleted_at": None},
                                            {"_id": 0, "id": 1, "name": 1, "status": 1, "documents": 1}).limit(30).to_list(30)
    for c in contractors:
        docs = c.get("documents") or []
        c["doc_counts"] = {
            "valid": sum(1 for d in docs if d.get("status") == "valid"),
            "expiring_soon": sum(1 for d in docs if d.get("status") == "expiring_soon"),
            "expired": sum(1 for d in docs if d.get("status") == "expired"),
            "pending": sum(1 for d in docs if d.get("status") == "pending"),
        }
        c.pop("documents", None)

    # ── v58.13.114 new collections — query-aware ───────────────────
    users_hits: list[dict] = []
    workers_hits: list[dict] = []
    visitors_hits: list[dict] = []
    forms_hits: list[dict] = []
    prestarts_hits: list[dict] = []
    diary_hits: list[dict] = []
    audit_hits: list[dict] = []
    email_hits: list[dict] = []
    sms_hits: list[dict] = []

    if primary:
        users_hits = await db.users.find(
            {"org_id": org_id, **_regex_or(["name", "first_name", "last_name", "email"], primary)},
            {"_id": 0, "id": 1, "name": 1, "email": 1, "role": 1, "status": 1},
        ).limit(10).to_list(10)
        workers_hits = await db.workers.find(
            {"org_id": org_id, **_regex_or(["first_name", "last_name", "name", "email"], primary)},
            {"_id": 0, "id": 1, "first_name": 1, "last_name": 1, "email": 1, "position": 1},
        ).limit(10).to_list(10)
        visitors_hits = await db.site_visitors.find(
            {"org_id": org_id, "deleted_at": None,
             **_regex_or(["name", "visiting_person", "company", "purpose"], primary)},
            {"_id": 0, "id": 1, "name": 1, "company": 1, "visiting_person": 1,
             "purpose": 1, "signed_in_at": 1, "site_id": 1},
        ).sort("signed_in_at", -1).limit(15).to_list(15)

        matched_user_ids = [u["id"] for u in users_hits if u.get("id")]

        forms_q: dict = {"org_id": org_id, "deleted_at": None}
        forms_or = [_regex_or(["submitted_by_name", "template_name_snapshot"], primary)["$or"][0]] \
            + [{"submitted_by_name": {"$regex": re.escape(primary), "$options": "i"}}] \
            + [{"template_name_snapshot": {"$regex": re.escape(primary), "$options": "i"}}]
        if matched_user_ids:
            forms_or.append({"submitted_by": {"$in": matched_user_ids}})
        forms_q["$or"] = forms_or
        forms_hits = await db.form_submissions.find(
            forms_q,
            {"_id": 0, "id": 1, "template_name_snapshot": 1, "submitted_by_name": 1,
             "submitted_by": 1, "submitted_at": 1, "template_id": 1},
        ).sort("submitted_at", -1).limit(20).to_list(20)

        if matched_user_ids:
            prestarts_hits = await db.pre_starts.find(
                {"org_id": org_id, "deleted_at": None,
                 "created_by": {"$in": matched_user_ids}},
                {"_id": 0, "id": 1, "created_by": 1, "created_at": 1,
                 "site_id": 1, "vehicle_rego": 1},
            ).sort("created_at", -1).limit(15).to_list(15)
            diary_hits = await db.site_diary_entries.find(
                {"org_id": org_id, "deleted_at": None,
                 "created_by": {"$in": matched_user_ids}},
                {"_id": 0, "id": 1, "created_by": 1, "created_at": 1,
                 "entry_text": 1, "site_id": 1},
            ).sort("created_at", -1).limit(15).to_list(15)

        if _can_see_audit(user):
            audit_q: dict = {"org_id": org_id}
            audit_or = [_regex_or(["actor_name", "actor_email", "description"], primary)["$or"][0]]
            if matched_user_ids:
                audit_or.append({"actor_user_id": {"$in": matched_user_ids}})
            audit_q["$or"] = audit_or
            audit_hits = await db.audit_log.find(
                audit_q,
                {"_id": 0, "id": 1, "actor_user_id": 1, "actor_name": 1,
                 "action": 1, "at": 1, "resource_kind": 1, "resource_id": 1},
            ).sort("at", -1).limit(20).to_list(20)

        if _can_see_comms(user) and matched_user_ids:
            email_hits = await db.outbound_emails.find(
                {"org_id": org_id, "$or": [
                    {"actor_user_id": {"$in": matched_user_ids}},
                    {"created_by": {"$in": matched_user_ids}},
                ]},
                {"_id": 0, "id": 1, "subject": 1, "to": 1, "status": 1, "created_at": 1},
            ).sort("created_at", -1).limit(10).to_list(10)
            sms_hits = await db.outbound_sms.find(
                {"org_id": org_id, "$or": [
                    {"actor_user_id": {"$in": matched_user_ids}},
                    {"created_by": {"$in": matched_user_ids}},
                ]},
                {"_id": 0, "id": 1, "to": 1, "body": 1, "status": 1, "created_at": 1},
            ).sort("created_at", -1).limit(10).to_list(10)

    return {
        # Domain (unchanged, unfiltered — kept as recency context)
        "incidents": incidents, "hazards": hazards, "swms": swms,
        "inspections": inspections, "contractors": contractors,
        # v58.13.114 additions
        "users": users_hits, "workers": workers_hits,
        "site_visitors": visitors_hits, "form_submissions": forms_hits,
        "pre_starts": prestarts_hits, "site_diary_entries": diary_hits,
        "audit_log": audit_hits, "outbound_emails": email_hits,
        "outbound_sms": sms_hits,
        "_meta": {"query_tokens": tokens, "primary_token": primary},
    }


# v58.13.114 — Confidence override matrix. Keys: (hits_bucket,
# entity_types_bucket, claude_says). Values: final confidence.
_CONFIDENCE_MATRIX = {
    # 0 hits → always LOW no matter what Claude claimed.
    (0, 0, "high"): "low",   (0, 0, "medium"): "low",   (0, 0, "low"): "low",
    # 1-2 hits + 1 entity type → LOW (single-source and thin).
    (1, 1, "high"): "low",   (1, 1, "medium"): "low",   (1, 1, "low"): "low",
    # 1-2 hits + ≥2 entity types → MEDIUM cap.
    (1, 2, "high"): "medium", (1, 2, "medium"): "medium", (1, 2, "low"): "low",
    # ≥3 hits + 1 entity type → MEDIUM cap (single-source can't be HIGH).
    (2, 1, "high"): "medium", (2, 1, "medium"): "medium", (2, 1, "low"): "low",
    # ≥3 hits + ≥2 entity types → HIGH only if Claude agrees; else respect its downgrade.
    (2, 2, "high"): "high",  (2, 2, "medium"): "medium", (2, 2, "low"): "low",
}


def _compute_confidence(cited: list[dict], claude_confidence: str) -> str:
    """Enforce the .114 confidence matrix backend-side."""
    if not isinstance(cited, list):
        return "low"
    valid_hits = [c for c in cited if isinstance(c, dict) and c.get("record_id")]
    hits = len(valid_hits)
    types = len({c.get("record_type") for c in valid_hits if c.get("record_type")})
    claude = (claude_confidence or "medium").lower()
    if claude not in {"high", "medium", "low"}:
        claude = "low"
    hits_bucket = 0 if hits == 0 else 1 if hits <= 2 else 2
    types_bucket = 0 if types == 0 else 1 if types == 1 else 2
    return _CONFIDENCE_MATRIX.get((hits_bucket, types_bucket, claude), "low")


def _build_name_fallback_body(question: str, evidence: dict) -> Optional[str]:
    """Return a friendly name-summary body when the query is name-shaped
    AND none of the 5 domain collections matched but at least one
    person/authored collection did. Returns None when the fallback
    doesn't apply — caller should use the LLM answer verbatim."""
    tokens = evidence.get("_meta", {}).get("query_tokens") or []
    if len(tokens) != 1:
        return None
    domain_hits = sum(1 for k in ("incidents", "hazards", "swms",
                                   "inspections", "contractors")
                       if evidence.get(k))  # non-empty means bundle has rows, but
    # a bundle can be non-empty and STILL fail to mention the token — the LLM's
    # own answer handles that. Only fire the fallback when zero domain rows
    # actually reference the token via title/description; we approximate that
    # by only firing when every domain list is empty of the token substring:
    tok = tokens[0]
    def _touches(rows, fields):
        for r in rows or []:
            for f in fields:
                v = r.get(f)
                if isinstance(v, str) and tok.lower() in v.lower():
                    return True
        return False
    if _touches(evidence.get("incidents"), ["title", "description"]): return None
    if _touches(evidence.get("hazards"), ["title"]): return None
    if _touches(evidence.get("swms"), ["title"]): return None
    if _touches(evidence.get("inspections"), ["template_name"]): return None
    if _touches(evidence.get("contractors"), ["name"]): return None
    # Must have at least one person/authored row.
    person_counts = {
        "users": len(evidence.get("users") or []),
        "workers": len(evidence.get("workers") or []),
        "site_visitors": len(evidence.get("site_visitors") or []),
        "form_submissions": len(evidence.get("form_submissions") or []),
        "pre_starts": len(evidence.get("pre_starts") or []),
        "site_diary_entries": len(evidence.get("site_diary_entries") or []),
    }
    if sum(person_counts.values()) == 0:
        return None
    # Build count summary
    parts = []
    if person_counts["users"]:
        parts.append(f"{person_counts['users']} user{'s' if person_counts['users'] != 1 else ''}")
    if person_counts["workers"]:
        parts.append(f"{person_counts['workers']} worker{'s' if person_counts['workers'] != 1 else ''}")
    if person_counts["site_visitors"]:
        parts.append(f"{person_counts['site_visitors']} site visitor record"
                      f"{'s' if person_counts['site_visitors'] != 1 else ''}")
    authored = person_counts["form_submissions"] + person_counts["pre_starts"] + person_counts["site_diary_entries"]
    if authored:
        parts.append(f"{authored} authored record{'s' if authored != 1 else ''}")
    if not parts:
        return None
    # Build top-3 recent activity from person/authored collections.
    recent = []
    for v in (evidence.get("site_visitors") or [])[:3]:
        when = (v.get("signed_in_at") or "")[:16].replace("T", " ")
        vp = v.get("visiting_person") or "—"
        recent.append(f"- Site visitor sign-in: {v.get('name') or 'Unknown'} visiting {vp}"
                      + (f", {when}" if when else ""))
    for f in (evidence.get("form_submissions") or [])[:3]:
        when = (f.get("submitted_at") or "")[:10]
        by = f.get("submitted_by_name") or "—"
        recent.append(f"- Form submission: {f.get('template_name_snapshot') or 'Form'} "
                      f"by {by}" + (f", {when}" if when else ""))
    for u in (evidence.get("users") or [])[:2]:
        role = (u.get("role") or "").replace("_", " ").title() or "User"
        recent.append(f"- User profile: {u.get('name') or u.get('email') or 'Unknown'}, {role}")
    recent = recent[:3]
    body = (
        f"'{tok}' matches {', '.join(parts)}."
        + (" Most recent:\n" + "\n".join(recent) if recent else "")
        + f"\n\nNarrow further? Try 'incidents authored by {tok}' or "
        f"'{tok}'s site visits last 30 days'."
    )
    return body


# v58.13.115 — Route mapping for citation deep-links. Server-side so
# the LLM never has to know about frontend routing. Values with a
# `{id}` placeholder are formatted with the record id; the special
# `form_submission` key needs the parent template id, looked up from
# the evidence bundle by `_enrich_citations()`.
_DEEP_LINK_TEMPLATES: dict[str, str] = {
    # Direct detail routes (App.js confirms these render <Detail /> pages).
    "swms":            "/app/swms/{id}",
    "contractor":      "/app/contractors/{id}",
    # List routes with an `?open=<id>` drawer contract. `site_visitor`
    # is fully wired in this ship; the rest are flagged in the
    # ship-report for later (list page loads, drawer wiring deferred
    # — never a dead link, just a page-level landing).
    "site_visitor":    "/app/admin/visitors?open={id}",
    "incident":        "/app/incidents?open={id}",
    "hazard":          "/app/hazards?open={id}",
    "inspection":      "/app/inspections?open={id}",
    "pre_start":       "/app/pre-starts?open={id}",
    "site_diary":      "/app/site-diary?open={id}",
    "user":            "/app/settings/users?open={id}",
    "worker":          "/app/settings/workers?open={id}",
    "outbound_email":  "/app/outbox?open={id}&kind=email",
    "outbound_sms":    "/app/outbox?open={id}&kind=sms",
    # v58.13.120d — Fleet & Service Register assets. Ask
    # Intelligence citations of type `asset` land on the new
    # `/app/fleet` register with the drawer pre-opened.
    "asset":           "/app/fleet?open={id}",
    # `form_submission` handled specially by `_enrich_citations` —
    # requires the parent `template_id` looked up in the evidence bundle.
    # `audit_log` — deliberately null (no detail page exists).
}


def _build_deep_link(record_type: str, record_id: str,
                     evidence: dict) -> tuple[Optional[str], Optional[str]]:
    """Return `(deep_link, reason_or_None)` for one citation.

    · `deep_link` is a relative frontend path (never absolute) so the
      React app can just pass it to `<Link to>`.
    · `reason` is populated ONLY when `deep_link` is None so the
      frontend can render a tooltip explaining why the link is dead.
    """
    if not record_id or not record_type:
        return (None, "missing_id")
    record_type = record_type.lower()
    if record_type == "audit_log":
        return (None, "no_detail_page")
    if record_type == "form_submission":
        # Need the parent template_id from the evidence bundle.
        for row in evidence.get("form_submissions") or []:
            if row.get("id") == record_id and row.get("template_id"):
                return (f"/app/forms/templates/{row['template_id']}/submissions?open={record_id}",
                        None)
        return (None, "no_template_id")
    tmpl = _DEEP_LINK_TEMPLATES.get(record_type)
    if not tmpl:
        return (None, "unknown_type")
    return (tmpl.format(id=record_id), None)


def _enrich_citations(cited: list[dict], evidence: dict) -> list[dict]:
    """Attach `deep_link` + optional `deep_link_reason` to every
    citation. Never mutates the LLM's original record_type / record_id
    / label — the frontend still renders those verbatim; the new
    fields sit alongside as strictly additive metadata."""
    out: list[dict] = []
    for c in cited or []:
        if not isinstance(c, dict):
            continue
        rt = c.get("record_type")
        rid = c.get("record_id")
        link, reason = _build_deep_link(rt or "", rid or "", evidence)
        # Preserve original citation shape (record_type/id/label) and
        # append deep_link + reason. `deep_link_reason` is omitted
        # when the link IS present so the payload stays tidy.
        enriched = {**c, "deep_link": link}
        if link is None:
            enriched["deep_link_reason"] = reason or "unknown"
        out.append(enriched)
    return out


# ────────────────────────────────────────────────────────────────────


@router.post("")
async def ask(body: AskIn, user: dict = Depends(require_ask_access)):
    evidence = await _evidence(user["org_id"], body.workspace_id,
                                question=body.question, user=user)
    # Strip _meta before sending to Claude — internal-only.
    llm_evidence = {k: v for k, v in evidence.items() if k != "_meta"}
    user_text = (f"Question: {body.question}\n\nEvidence (JSON):\n"
                 f"{json.dumps(llm_evidence, ensure_ascii=False)[:24000]}")
    answer = await _claude_json(ASK_SYSTEM, user_text)
    answer.setdefault("title", "Answer")
    answer.setdefault("body", "")
    answer.setdefault("confidence", "medium")
    answer.setdefault("cited_evidence", [])
    # v58.13.114 — Backend-computed confidence override. Claude's own
    # "high" is discarded when the citation shape doesn't support it.
    answer["confidence"] = _compute_confidence(answer.get("cited_evidence"),
                                                answer.get("confidence"))
    # v58.13.114 — Name-shaped fallback body when the domain lists have
    # zero rows referencing the query token but a person/authored
    # collection did match. Overrides Claude's "no records found" prose
    # with a real summary + top-3 recent activity so the user doesn't
    # need a second round-trip.
    fallback = _build_name_fallback_body(body.question, evidence)
    if fallback:
        answer["body"] = fallback
        answer["fallback"] = "name_summary"
        # Cite up to 5 person/authored rows so the confidence override
        # sees real citations too.
        cites: list[dict] = []
        for u in (evidence.get("users") or [])[:2]:
            cites.append({"record_type": "user", "record_id": u.get("id"),
                          "label": u.get("name") or u.get("email") or "User"})
        for v in (evidence.get("site_visitors") or [])[:2]:
            cites.append({"record_type": "site_visitor", "record_id": v.get("id"),
                          "label": f"{v.get('name') or '?'} visiting {v.get('visiting_person') or '—'}"})
        for f in (evidence.get("form_submissions") or [])[:1]:
            cites.append({"record_type": "form_submission", "record_id": f.get("id"),
                          "label": f.get("template_name_snapshot") or "Form submission"})
        if cites:
            answer["cited_evidence"] = cites
            answer["confidence"] = _compute_confidence(cites, "medium")

    # v58.13.115 — attach `deep_link` (+ optional `deep_link_reason`) to
    # every citation before we hand the payload back to the frontend.
    # Runs AFTER the fallback path so both LLM-native citations and the
    # synthesised name-summary citations get the same treatment.
    answer["cited_evidence"] = _enrich_citations(answer.get("cited_evidence"),
                                                  evidence)

    # v58.13.115a — Auto-clear the caller's history BEFORE inserting
    # the new row. User asked for "delete the results every time we do
    # a search" so only the current answer stays around. Scoped to the
    # current org + user id — never touches other users' history.
    await db.ask_history.delete_many({"org_id": user["org_id"], "user_id": user["id"]})
    # Store in history (best-effort)
    await db.ask_history.insert_one({
        "id": new_id(), "org_id": user["org_id"], "user_id": user["id"],
        "question": body.question, "workspace_id": body.workspace_id,
        "answer": answer, "created_at": now_iso(),
    })
    return answer


@router.get("/briefing")
async def briefing(workspace_id: Optional[str] = Query(None), user: dict = Depends(require_ask_access)):
    cache_key = f"{user['org_id']}::{workspace_id or '*'}"
    now = time.time()
    if cache_key in _briefing_cache:
        ts, val = _briefing_cache[cache_key]
        if now - ts < CACHE_TTL:
            return val

    question = "What most needs management attention this week, what should we do, and what evidence proves it?"
    # v58.13.114 — Briefing intentionally uses recency fallback (no
    # query text). The `_evidence()` signature is backwards-compat
    # thanks to defaulted `question` + `user`.
    evidence = await _evidence(user["org_id"], workspace_id,
                                question="", user=user)
    llm_evidence = {k: v for k, v in evidence.items() if k != "_meta"}
    user_text = (f"Question: {question}\n\nEvidence (JSON):\n"
                 f"{json.dumps(llm_evidence, ensure_ascii=False)[:24000]}")
    try:
        # v58.13.132il — Hard 10s timeout so a slow / hung Claude call
        # can't turn into an infinite web-dashboard spinner. Falls
        # through to the same "temporarily unavailable" copy below.
        answer = await asyncio.wait_for(
            _claude_json(ASK_SYSTEM, user_text), timeout=10.0,
        )
    except (HTTPException, asyncio.TimeoutError):
        # Fall back gracefully — caller will still get a useful payload
        answer = {
            "title": "Briefing temporarily unavailable",
            "body": "The AI briefing service is busy. Try again in a minute.",
            "confidence": "low", "cited_evidence": [], "fallback": True,
        }
    answer.setdefault("cited_evidence", [])
    # v58.13.115 — enrich briefing citations too. Briefing evidence
    # never has a query token so form_submission lookups will return
    # `no_template_id`, but incident/hazard/swms/etc still get real
    # deep-links, which is exactly what the dashboard wants.
    answer["cited_evidence"] = _enrich_citations(answer.get("cited_evidence"),
                                                  evidence)
    answer["cached_at"] = now_iso()
    _briefing_cache[cache_key] = (now, answer)
    return answer


@router.get("/history")
async def history(limit: int = Query(10, ge=1, le=50), user: dict = Depends(get_current_user)):
    docs = await db.ask_history.find(
        {"org_id": user["org_id"], "user_id": user["id"]},
        {"_id": 0},
    ).sort("created_at", -1).limit(limit).to_list(limit)
    return docs


@router.delete("/history")
async def clear_history(user: dict = Depends(get_current_user)):
    """v58.13.115a — Explicit "Clear history" button. Scoped strictly to
    the calling user + org so an admin clearing their own history never
    wipes another admin's rows. Returns `{deleted: n}` so the UI can
    toast "History cleared (n rows)"."""
    r = await db.ask_history.delete_many({"org_id": user["org_id"],
                                           "user_id": user["id"]})
    return {"deleted": int(getattr(r, "deleted_count", 0) or 0)}


# ────────────────────── Ask suggested questions (CRUD) ──────────────────────

DEFAULT_SUGGESTIONS = [
    ("Which contractors have docs expiring this month?", "contractors"),
    ("What are the recurring incident categories last quarter?", "incidents"),
    ("Show me open hazards by severity.", "hazards"),
    ("Which inspections are overdue?", "inspections"),
]

WRITE_ROLES = {"admin", "hseq_lead"}


def _require_write(user: dict):
    if user.get("role") not in WRITE_ROLES:
        raise HTTPException(status_code=403, detail="Permission denied: ask_suggestions.edit")


async def _seed_default_suggestions(org_id: str, created_by: str) -> None:
    """Lazy-seed the default suggestions for an org the first time the list is
    fetched and the collection has no active rows for that org."""
    has_any = await db.ask_suggestions.find_one(
        {"org_id": org_id, "deleted_at": None}, {"_id": 1}
    )
    if has_any:
        return
    docs = []
    for i, (question, category) in enumerate(DEFAULT_SUGGESTIONS):
        docs.append({
            "id": new_id(), "org_id": org_id,
            "question": question, "category": category,
            "sort_order": (i + 1) * 10,
            "created_at": now_iso(), "updated_at": now_iso(),
            "created_by": created_by, "deleted_at": None,
        })
    if docs:
        await db.ask_suggestions.insert_many(docs)


class SuggestionIn(BaseModel):
    question: str = Field(min_length=3, max_length=240)
    category: Optional[str] = Field(default=None, max_length=40)


class SuggestionPatch(BaseModel):
    question: Optional[str] = Field(default=None, min_length=3, max_length=240)
    category: Optional[str] = Field(default=None, max_length=40)
    sort_order: Optional[int] = Field(default=None, ge=0, le=100000)


def _serialise(doc: dict) -> dict:
    return {
        "id": doc["id"],
        "question": doc["question"],
        "category": doc.get("category"),
        "sort_order": doc.get("sort_order", 0),
        "created_at": doc.get("created_at"),
        "updated_at": doc.get("updated_at"),
    }


@router.get("/suggestions")
async def list_suggestions(user: dict = Depends(require_ask_access)):
    await _seed_default_suggestions(user["org_id"], user["id"])
    cursor = db.ask_suggestions.find(
        {"org_id": user["org_id"], "deleted_at": None},
        {"_id": 0},
    ).sort([("sort_order", 1), ("created_at", 1)])
    docs = await cursor.to_list(200)
    return [_serialise(d) for d in docs]


@router.post("/suggestions", status_code=201)
async def create_suggestion(body: SuggestionIn, user: dict = Depends(get_current_user)):
    _require_write(user)
    # Auto-increment sort_order: max existing + 10
    last = await db.ask_suggestions.find_one(
        {"org_id": user["org_id"], "deleted_at": None},
        {"_id": 0, "sort_order": 1},
        sort=[("sort_order", -1)],
    )
    next_order = ((last or {}).get("sort_order") or 0) + 10
    doc = {
        "id": new_id(), "org_id": user["org_id"],
        "question": body.question.strip(),
        "category": (body.category or "").strip() or None,
        "sort_order": next_order,
        "created_at": now_iso(), "updated_at": now_iso(),
        "created_by": user["id"], "deleted_at": None,
    }
    await db.ask_suggestions.insert_one(doc)
    return _serialise(doc)


@router.patch("/suggestions/{suggestion_id}")
async def update_suggestion(
    suggestion_id: str,
    body: SuggestionPatch,
    user: dict = Depends(get_current_user),
):
    _require_write(user)
    update: dict = {"updated_at": now_iso()}
    if body.question is not None:
        update["question"] = body.question.strip()
    if body.category is not None:
        update["category"] = body.category.strip() or None
    if body.sort_order is not None:
        update["sort_order"] = int(body.sort_order)
    if len(update) == 1:
        raise HTTPException(status_code=400, detail="No editable fields supplied")
    result = await db.ask_suggestions.find_one_and_update(
        {"id": suggestion_id, "org_id": user["org_id"], "deleted_at": None},
        {"$set": update},
        projection={"_id": 0},
        return_document=ReturnDocument.AFTER,
    )
    if not result:
        raise HTTPException(status_code=404, detail="Suggestion not found")
    return _serialise(result)


@router.delete("/suggestions/{suggestion_id}", status_code=204)
async def delete_suggestion(
    suggestion_id: str,
    user: dict = Depends(get_current_user),
):
    _require_write(user)
    result = await db.ask_suggestions.update_one(
        {"id": suggestion_id, "org_id": user["org_id"], "deleted_at": None},
        {"$set": {"deleted_at": now_iso(), "updated_at": now_iso()}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Suggestion not found")
    return None
