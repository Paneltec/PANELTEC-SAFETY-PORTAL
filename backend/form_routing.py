"""v58.13.132dz — Form-submission category routing rules.

Provides a single choke-point (`resolve_template_category`) that
callers writing to `form_submissions` consult to determine the
`template_category_snapshot` for a new row.

Design
======
Historically the value was set inline everywhere a submission
landed:

    "template_category_snapshot": template.get("category") or "general"

This ship introduces a small `form_routing_rules` Mongo collection
so that admins can override a template's declared category without
editing the template row itself (which is fragile — templates get
re-imported from source PDFs and lose ad-hoc edits). Adding a new
override becomes a one-row DB insert, not a code change.

Schema
------
`form_routing_rules`:
    id                     - str (uuid4)
    template_id            - str (indexed, unique per active rule)
    destination_category   - str (one of ALLOWED_CATEGORY, see forms.py)
    template_name_hint     - str (informational, for audit readability)
    active                 - bool (soft-disable without deletion)
    created_at             - ISO 8601 str
    created_by             - "system" | user id
    reason                 - str (why the rule exists)

Semantics
---------
`resolve_template_category(template)`:
    1. If template has an active rule → return the rule's category.
    2. Else return `template.get("category") or "general"`.

Rules are cached process-locally for 60s to keep the write path
fast (a Mongo round-trip on every form submission would add ~5ms
of latency; the rule set is tiny and near-static, so caching is
worth the small staleness window).

Seeded rules
------------
One rule is seeded at startup (idempotent):
    template_id = "dc28f66a-a385-4a64-b5f0-d92bfd7b1798"
                  (Construction & Excavation SSRA)
    destination_category = "risk_assessment"
    reason = "v58.13.132dz — SSRA submissions belong on the Risk "
             "Assessments capture bucket, not Hazard Reports."

Admin UI for viewing/editing these rules is out of scope for this
ship; the collection is DB-only. Follow-up ticket flagged in the
ship memo.
"""
from __future__ import annotations

import logging
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from db import db

log = logging.getLogger("paneltec.form_routing")

# ── Seed rules (idempotent) ────────────────────────────────────
# Each entry becomes a row in `form_routing_rules` at
# `ensure_form_routing_rules()` time. Keys are stable — a re-seed
# updates the existing row's `destination_category` if the template
# id matches. Rows created outside this seed list are left alone.
SEED_RULES: list[dict[str, Any]] = [
    {
        "template_id": "dc28f66a-a385-4a64-b5f0-d92bfd7b1798",
        "destination_category": "risk_assessment",
        "template_name_hint": "Construction & Excavation SSRA",
        "reason": (
            "v58.13.132dz — SSRA submissions belong on the Risk "
            "Assessments capture bucket, not Hazard Reports. Standing "
            "rule going forward per Stephen (2026-02)."
        ),
    },
]


# v58.13.132ki — Name-pattern seed rules.
#
# Historically we hand-maintained one `SEED_RULES` entry per
# template_id. That doesn't scale: the same logical form (e.g.
# "Viatec Traffic Solutions SSRA") ships once per org, so a single
# rule needs to be materialised as N template-id-scoped rows.
#
# Additionally, Stephen's org had SSRA templates whose
# `form_templates.category` field was still `pre_start` even after
# routing rules pointed them at `risk_assessment` — the routing rule
# handled submission-time correctly, but list queries that filtered
# by the template's own `category` (e.g. Capture/Daily Pre-Starts)
# leaked SSRAs in. This ship fixes both.
#
# `NAME_PATTERN_SEED_RULES` describes a logical rule keyed by an
# exact `name` match on `form_templates`. On `ensure_form_routing_rules()`
# we resolve each pattern to every matching template_id across every
# org and upsert an equivalent `form_routing_rules` row per match.
# We also flip `form_templates.category` in the same pass so the
# list queries agree.
NAME_PATTERN_SEED_RULES: list[dict[str, Any]] = [
    {
        "name_exact": "Construction & Excavation SSRA",
        "destination_category": "risk_assessment",
        "reason": (
            "v58.13.132ki — SSRA templates route to Risk Assessments "
            "regardless of the per-org `form_templates.category` value. "
            "Extends `.132dz` (single-template-id rule) to all orgs."
        ),
    },
    {
        "name_exact": "Viatec Traffic Solutions SSRA",
        "destination_category": "risk_assessment",
        "reason": (
            "v58.13.132ki — Viatec SSRA routes to Risk Assessments. "
            "Was mis-categorised as `pre_start` on Stephen's org."
        ),
    },
    {
        "name_exact": "Drain Cleaning SSRA",
        "destination_category": "risk_assessment",
        "reason": (
            "v58.13.132ki — Drain Cleaning SSRA routes to Risk Assessments. "
            "Was mis-categorised as `pre_start` on Stephen's org."
        ),
    },
]


# ── Cache ──────────────────────────────────────────────────────
_CACHE: dict[str, str] = {}          # template_id -> destination_category
_CACHE_LOADED_AT: float = 0.0        # monotonic() timestamp
_CACHE_TTL_SEC: float = 60.0


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _reload_cache() -> None:
    """Reload the process-local cache from Mongo."""
    global _CACHE, _CACHE_LOADED_AT
    fresh: dict[str, str] = {}
    async for r in db.form_routing_rules.find(
        {"active": True},
        {"_id": 0, "template_id": 1, "destination_category": 1},
    ):
        tid = r.get("template_id")
        cat = r.get("destination_category")
        if tid and cat:
            fresh[tid] = cat
    _CACHE = fresh
    _CACHE_LOADED_AT = time.monotonic()


async def _cache_get(template_id: Optional[str]) -> Optional[str]:
    if not template_id:
        return None
    if (time.monotonic() - _CACHE_LOADED_AT) > _CACHE_TTL_SEC:
        try:
            await _reload_cache()
        except Exception as e:  # pragma: no cover — defensive
            log.warning("form_routing cache reload failed: %s", e)
    return _CACHE.get(template_id)


async def resolve_template_category(template: dict[str, Any]) -> str:
    """Return the `template_category_snapshot` to persist for a new
    submission of `template`. Rule lookup wins over the template's
    declared category. Defaults to "general" when neither is set.
    """
    override = await _cache_get(template.get("id"))
    if override:
        return override
    return template.get("category") or "general"


async def ensure_form_routing_rules() -> None:
    """Idempotent — creates indexes + upserts the seed rules.

    Called from `server.py::startup`. Safe to re-run on every boot.
    """
    try:
        await db.form_routing_rules.create_index(
            "template_id", unique=True, name="uniq_template_id"
        )
        await db.form_routing_rules.create_index("active")
    except Exception as e:
        log.warning("form_routing_rules index setup: %s", e)

    for rule in SEED_RULES:
        existing = await db.form_routing_rules.find_one(
            {"template_id": rule["template_id"]}
        )
        if existing:
            # Re-seed only updates the destination + hint + reason so
            # a shipped rule can be edited via SEED_RULES on the next
            # release. `created_at` / `created_by` are preserved.
            await db.form_routing_rules.update_one(
                {"template_id": rule["template_id"]},
                {"$set": {
                    "destination_category": rule["destination_category"],
                    "template_name_hint": rule["template_name_hint"],
                    "reason": rule["reason"],
                    "active": True,
                    "updated_at": _now_iso(),
                }},
            )
        else:
            await db.form_routing_rules.insert_one({
                "id": str(uuid.uuid4()),
                "template_id": rule["template_id"],
                "destination_category": rule["destination_category"],
                "template_name_hint": rule["template_name_hint"],
                "reason": rule["reason"],
                "active": True,
                "created_at": _now_iso(),
                "created_by": "system",
            })

    # v58.13.132ki — Name-pattern pass. For each logical pattern,
    # resolve every matching `form_templates` row across all orgs
    # and (a) upsert a routing rule per match, (b) flip that row's
    # own `category` field to the destination category so downstream
    # list queries that read `form_templates.category` directly
    # agree with the routing rule. Emits a summary log line per
    # org so operators can see exactly what got flipped.
    per_org_flipped: dict[str, list[str]] = {}
    for pattern in NAME_PATTERN_SEED_RULES:
        matches = await db.form_templates.find(
            {"name": pattern["name_exact"], "deleted_at": None},
            {"_id": 0, "id": 1, "name": 1, "category": 1, "org_id": 1},
        ).to_list(500)
        for t in matches:
            tid = t.get("id")
            org_id = t.get("org_id") or "unknown"
            dst = pattern["destination_category"]
            hint = pattern["name_exact"]
            reason = pattern["reason"]

            # (a) upsert routing rule
            existing = await db.form_routing_rules.find_one(
                {"template_id": tid}
            )
            if existing:
                if existing.get("destination_category") != dst:
                    await db.form_routing_rules.update_one(
                        {"template_id": tid},
                        {"$set": {
                            "destination_category": dst,
                            "template_name_hint": hint,
                            "reason": reason,
                            "active": True,
                            "updated_at": _now_iso(),
                        }},
                    )
            else:
                await db.form_routing_rules.insert_one({
                    "id": str(uuid.uuid4()),
                    "template_id": tid,
                    "destination_category": dst,
                    "template_name_hint": hint,
                    "reason": reason,
                    "active": True,
                    "created_at": _now_iso(),
                    "created_by": "system",
                })

            # (b) flip form_templates.category if it disagrees.
            # `general` is a placeholder — we don't rewrite it. Any
            # other value (`pre_start`, `hazard`, `daily_start`, …)
            # gets moved to `risk_assessment` so list views agree.
            current_cat = t.get("category")
            if current_cat != dst:
                await db.form_templates.update_one(
                    {"id": tid},
                    {"$set": {"category": dst,
                              "category_flipped_at": _now_iso(),
                              "category_flipped_from": current_cat,
                              "category_flip_reason": (
                                  "v58.13.132ki name-pattern migration"),
                              }},
                )
                per_org_flipped.setdefault(org_id, []).append(
                    f"{hint} ({current_cat}→{dst})"
                )

    if per_org_flipped:
        for org_id, names in per_org_flipped.items():
            log.warning(
                "[migrate-ssra-routing] org=%s flipped=%s",
                org_id, names,
            )
    else:
        log.info(
            "[migrate-ssra-routing] no template categories needed "
            "flipping — all SSRA templates already route to "
            "risk_assessment on the template row itself."
        )

    # Warm the cache immediately so the first submission after boot
    # picks up the rule without waiting for the 60s TTL.
    await _reload_cache()
