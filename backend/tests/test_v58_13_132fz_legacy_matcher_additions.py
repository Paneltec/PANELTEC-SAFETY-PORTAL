"""v58.13.132fz — Legacy template matcher additions.

Locks in the four new keyword rules at the top of the
`_CATEGORY_KEYWORDS` tuple in `bulk_import_template_inference.py`:

  · Excavator Pre-Start   → plant_pre_start (was pre_start)
  · Trailer Pre-Start     → plant_pre_start (was pre_start)
  · Drain Cleaning SSRA   → risk_assessment (was hazard via bare "ssra")
  · Excavation Permit     → permit (was permit via generic — now
                            pinned explicitly first)

These are legacy freetext template names that arrive via the Simpro
ZIP importer and `list_forms` roster where no `form_templates`
`category` field exists to steer the write. The `resolve_target_category`
choke-point falls back to `infer_category_from_name` for these,
and the new rules ensure the right destination bucket.
"""
from __future__ import annotations

import sys
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[2]
BACKEND = APP_ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from bulk_import_template_inference import (  # noqa: E402
    _CATEGORY_KEYWORDS,
    infer_category_from_name,
    resolve_target_category,
)

VERSION_JS = APP_ROOT / "frontend" / "src" / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


# ─── Rule-order pins ───────────────────────────────────────────

def test_new_rules_sit_at_top_of_tuple():
    """The four legacy names must appear BEFORE the generic
    'pre-start' / 'ssra' / 'permit' rules they refine, otherwise
    the more generic entries win and the additions are dead code.
    """
    keys = [k for (k, _) in _CATEGORY_KEYWORDS]

    def idx(k: str) -> int:
        return keys.index(k)

    # New entries must exist.
    for needle in (
        "excavator pre-start",
        "excavator pre start",
        "trailer pre-start",
        "trailer pre start",
        "drain cleaning ssra",
        "excavation permit",
    ):
        assert needle in keys, f"missing legacy-matcher rule: {needle!r}"

    # Excavator / Trailer must win before the generic "pre-start".
    assert idx("excavator pre-start") < idx("pre-start")
    assert idx("excavator pre start") < idx("pre start")
    assert idx("trailer pre-start") < idx("pre-start")
    assert idx("trailer pre start") < idx("pre start")

    # Drain Cleaning SSRA must win before the generic "ssra".
    assert idx("drain cleaning ssra") < idx("ssra"), (
        "drain cleaning ssra must precede the bare 'ssra' rule so "
        "it routes to risk_assessment instead of hazard")

    # Excavation Permit (dedicated) must precede the generic "permit".
    # Note: there is a duplicate legacy entry further down that we
    # deliberately leave in place. The dedicated top entry wins.
    permit_hits = [i for i, k in enumerate(keys) if k == "excavation permit"]
    assert permit_hits, "excavation permit rule missing"
    assert permit_hits[0] < idx("permit"), (
        "dedicated 'excavation permit' rule must precede the generic 'permit'")


# ─── Behaviour ─────────────────────────────────────────────────

def test_excavator_pre_start_routes_to_plant_pre_start():
    for name in (
        "Excavator Pre-Start",
        "excavator pre-start",
        "EXCAVATOR PRE START",
        "5T Excavator Pre-Start Checklist",
    ):
        assert infer_category_from_name(name) == "plant_pre_start", (
            f"{name!r} must route to plant_pre_start")


def test_trailer_pre_start_routes_to_plant_pre_start():
    for name in (
        "Trailer Pre-Start",
        "trailer pre-start",
        "TRAILER PRE START",
        "Site Trailer Pre-Start Daily Check",
    ):
        assert infer_category_from_name(name) == "plant_pre_start", (
            f"{name!r} must route to plant_pre_start")


def test_drain_cleaning_ssra_routes_to_risk_assessment():
    for name in (
        "Drain Cleaning SSRA",
        "drain cleaning ssra",
        "Site SSRA — Drain Cleaning",  # generic ssra wins here (bare)
    ):
        cat = infer_category_from_name(name)
        if "drain cleaning ssra" in name.lower():
            assert cat == "risk_assessment", (
                f"{name!r} must route to risk_assessment (got {cat!r})")


def test_excavation_permit_routes_to_permit():
    for name in (
        "Excavation Permit",
        "excavation permit",
        "EXCAVATION PERMIT — Site 42",
    ):
        assert infer_category_from_name(name) == "permit", (
            f"{name!r} must route to permit")


def test_existing_rules_unchanged():
    """Regression pin: the .132fz additions must NOT alter the
    behaviour of the pre-existing generic rules.
    """
    assert infer_category_from_name("SSRA Site Walk") == "hazard"
    assert infer_category_from_name("Toolbox Talk") == "toolbox"
    assert infer_category_from_name("Site Diary Monday") == "site_diary"
    assert infer_category_from_name("Hazard Report") == "hazard"
    assert infer_category_from_name("Daily Check") == "pre_start"
    assert infer_category_from_name("Vehicle Pre-Start") == "pre_start"
    # "Plant Inspection" hits "inspection" first (which precedes
    # the "plant" rule in the tuple) — pre-existing behaviour.
    assert infer_category_from_name("Plant Inspection") == "pre_start"
    assert infer_category_from_name("Plant maintenance") == "plant_pre_start"
    assert infer_category_from_name("Hot Work Permit") == "permit"
    assert infer_category_from_name("") == ""
    assert infer_category_from_name(None) == ""


def test_resolve_target_category_prefers_template_doc():
    """The .132fz additions are name-based fallbacks only; a
    `form_templates` row with an explicit `category` field must
    still win over the keyword matcher.
    """
    tpl = {"id": "t1", "category": "incident"}
    got = resolve_target_category(tpl, "Excavator Pre-Start")
    assert got == "incident", (
        "template_doc.category must beat the keyword matcher")

    # With no doc, the matcher fires.
    got = resolve_target_category(None, "Excavator Pre-Start")
    assert got == "plant_pre_start"


# ─── Version lockstep ──────────────────────────────────────────

def test_version_bumped_to_132fz():
    assert "paneltec-v160.3.9.58.13.132fz" in _read(VERSION_JS)
    assert "paneltec-v160.3.9.58.13.132fz" in _read(SW)
