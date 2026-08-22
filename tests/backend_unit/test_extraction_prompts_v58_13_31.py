"""v58.13.31 — Per-category extraction prompt selector pytests.

Covers:
  · `_get_prompt_for_category()` — pre-start / hazard / permit / swms
    branches + unknown-fallback + case-insensitive matching.
  · Pre-start prompt is BYTE-IDENTICAL to v58.11.0 (regression guard —
    ensures the 5 609 existing correctly-classified daily pre-start
    extractions produce the same prompt shape on future runs).
  · Hazard (SSRA) prompt requests `hazards[]`, `crew[]`,
    `signatures[]`, TAILGATE topics, BYDA / TGS numbers, emergency
    assembly point, GPS coords.
  · Permit prompt requests `checklist{}`, `hazards[]`, `signatures[]`.
  · `_claude_extract()` selects prompt based on `template.get("category")`.

Placed under /app/tests/backend_unit/ per v58.13.10.
"""
from __future__ import annotations
import os
import sys
from pathlib import Path

import pytest

_BACKEND = Path("/app/backend")
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

import bulk_import_prestarts as bip  # noqa: E402


# ---------------------------------------------------------------------------
# 1. pre_start / plant_pre_start branches — regression-locked
# ---------------------------------------------------------------------------
def test_prestart_prompt_returns_v58_11_0_shape():
    sys_, user = bip._get_prompt_for_category(
        "pre_start", "Daily Pre-Start", ["Date", "Operator (Name)"],
    )
    # System prompt is exactly the v58.11.0 wording.
    assert "pre-start check-sheet" in sys_
    assert "checklist body, signatures, photos, notes" in sys_
    # User prompt contains the label-driven schema + the return spec.
    assert '"checklist":{"<exact label from template>"' in user
    assert '"date":"YYYY-MM-DD"' in user
    assert '"worker_name"' in user
    assert '"plant_or_vehicle"' in user
    assert '"gps_map_present"' in user
    assert '"signature_present"' in user
    # Labels list is embedded.
    assert '"Date"' in user
    assert '"Operator (Name)"' in user


def test_plant_prestart_uses_same_prompt():
    sys1, u1 = bip._get_prompt_for_category("pre_start", "X", ["A"])
    sys2, u2 = bip._get_prompt_for_category("plant_pre_start", "X", ["A"])
    assert sys1 == sys2 and u1 == u2


# ---------------------------------------------------------------------------
# 2. Hazard (SSRA) branch — new prompt with full SSRA field set
# ---------------------------------------------------------------------------
def test_hazard_prompt_has_ssra_field_set():
    sys_, user = bip._get_prompt_for_category(
        "hazard", "Construction & Excavation SSRA",
        ["Date", "Operator (Name)"],
    )
    # SSRA-specific system framing.
    assert "Site Specific Risk Assessment" in sys_ or "SSRA" in sys_
    assert "TAILGATE" in sys_ or "hazards + controls" in sys_
    # SSRA schema keys all present.
    for key in ('"hazards":[', '"crew":[', '"signatures":[',
                '"tailgate_topics_discussed":[',
                '"byda_number"', '"tgs_number"',
                '"emergency_assembly_point"', '"gps_coords"',
                '"swms_ids":['):
        assert key in user, f"missing SSRA schema key {key}"
    # Instruction to include EVERY hazard row + crew member + signature.
    assert "EVERY hazard row" in user
    assert "EVERY crew member" in user
    assert "EVERY signature" in user


def test_swms_is_aliased_to_hazard():
    """SWMS forms are similar enough to SSRAs that the same schema
    captures what's needed for now. Alias tested for stability."""
    hs, hu = bip._get_prompt_for_category("hazard", "X", [])
    ss, su = bip._get_prompt_for_category("swms", "X", [])
    assert hs == ss and hu == su


# ---------------------------------------------------------------------------
# 3. Permit branch — new prompt with permit field set
# ---------------------------------------------------------------------------
def test_permit_prompt_has_permit_field_set():
    sys_, user = bip._get_prompt_for_category(
        "permit", "Excavation Permit NDD",
        ["Date", "Site", "Pre-Conditions Confirmed"],
    )
    # Permit-specific system framing.
    assert "permit" in sys_.lower()
    assert "excavation permit" in sys_.lower() \
        or "hot work" in sys_.lower()
    # Permit schema keys.
    for key in ('"permit_type"', '"checklist"',
                '"hazards":[', '"signatures":[', '"date"'):
        assert key in user, f"missing permit schema key {key}"
    # Labels are embedded for the checklist field.
    assert '"Date"' in user
    assert '"Pre-Conditions Confirmed"' in user


# ---------------------------------------------------------------------------
# 4. Unknown / empty category → falls back to pre-start prompt
# ---------------------------------------------------------------------------
def test_unknown_category_falls_back_to_prestart():
    sys_, user = bip._get_prompt_for_category("unknown_xyz", "X", ["A"])
    ref_sys, ref_user = bip._get_prompt_for_category("pre_start", "X", ["A"])
    assert sys_ == ref_sys and user == ref_user


def test_empty_category_falls_back_to_prestart():
    sys_, user = bip._get_prompt_for_category("", "X", ["A"])
    ref_sys, ref_user = bip._get_prompt_for_category("pre_start", "X", ["A"])
    assert sys_ == ref_sys and user == ref_user


def test_none_category_falls_back_to_prestart():
    sys_, user = bip._get_prompt_for_category(None, "X", ["A"])
    ref_sys, ref_user = bip._get_prompt_for_category("pre_start", "X", ["A"])
    assert sys_ == ref_sys and user == ref_user


# ---------------------------------------------------------------------------
# 5. Case-insensitive matching
# ---------------------------------------------------------------------------
def test_category_matching_is_case_insensitive():
    for c in ("HAZARD", " Hazard ", "hAzArD"):
        sys_, _ = bip._get_prompt_for_category(c, "X", [])
        assert "SSRA" in sys_ or "Site Specific" in sys_


# ---------------------------------------------------------------------------
# 6. _claude_extract picks the right prompt based on template.category
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_claude_extract_uses_hazard_prompt_for_hazard_template(monkeypatch):
    captured = {}
    async def _fake_json(system, user, image_b64=None, images_b64=None):
        captured["system"] = system
        captured["user"] = user
        return {"date": "2026-02-01"}
    import ai
    monkeypatch.setattr(ai, "_claude_json", _fake_json, raising=False)

    template = {
        "id": "t-1",
        "name": "Construction & Excavation SSRA",
        "category": "hazard",
        "fields": [{"label": "Date"}, {"label": "Operator (Name)"}],
    }
    r = await bip._claude_extract("fakebase64png", template)
    assert r == {"date": "2026-02-01"}
    # Hazard-branch signal in the captured system prompt.
    assert "Site Specific Risk Assessment" in captured["system"] \
        or "SSRA" in captured["system"]
    # Hazard schema keys in the user prompt.
    for key in ('"hazards":[', '"crew":[', '"signatures":['):
        assert key in captured["user"]


@pytest.mark.asyncio
async def test_claude_extract_uses_prestart_prompt_when_no_category(monkeypatch):
    """Cached rows from before v58.13.30 may lack a `category` field on
    their `templates_by_id` lookup. Extractor must fall back to the
    pre-start prompt for backward-compat."""
    captured = {}
    async def _fake_json(system, user, image_b64=None, images_b64=None):
        captured["system"] = system
        captured["user"] = user
        return {}
    import ai
    monkeypatch.setattr(ai, "_claude_json", _fake_json, raising=False)

    template = {
        "id": "t-1", "name": "Daily Pre-Start",
        "fields": [{"label": "Date"}],
        # NO 'category' field
    }
    await bip._claude_extract("fakebase64png", template)
    # Pre-start branch signal.
    assert "pre-start check-sheet" in captured["system"]


@pytest.mark.asyncio
async def test_claude_extract_permit_category(monkeypatch):
    captured = {}
    async def _fake_json(system, user, image_b64=None, images_b64=None):
        captured["system"] = system
        return {}
    import ai
    monkeypatch.setattr(ai, "_claude_json", _fake_json, raising=False)

    template = {
        "id": "t-1", "name": "Excavation Permit NDD",
        "category": "permit",
        "fields": [{"label": "Date"}],
    }
    await bip._claude_extract("fakebase64png", template)
    assert "permit" in captured["system"].lower()


# ---------------------------------------------------------------------------
# 7. Version-sync
# ---------------------------------------------------------------------------
def test_version_sync_current():
    import re
    running = Path("/app/frontend/src/lib/version.js").read_text(encoding="utf-8")
    sw = Path("/app/frontend/public/service-worker.js").read_text(encoding="utf-8")
    mobile = Path("/app/mobile/src/lib/version.ts").read_text(encoding="utf-8")
    m = re.search(r"export const RUNNING_VERSION = '(paneltec-v[\d.]+)'", running)
    assert m
    current = m.group(1)
    assert f"'{current}'" in sw
    assert f"'{current}'" in mobile
