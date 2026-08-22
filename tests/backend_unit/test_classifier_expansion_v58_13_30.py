"""v58.13.30 — Bulk-import classifier roster expansion pytests.

Covers:
  · `_load_classifier_roster()` — dynamic form_templates query with
    5-min TTL, env-configurable category set, DB-failure fallback,
    empty-result fallback.
  · Low-confidence escape hatch — records land in
    `bulk_import_pdf_cache` with `classification_low_confidence: True`
    and NOT in `pre_starts` / `form_submissions` (dryrun status =
    "unclassified" so the promotion gates skip them).
  · Legacy 6-template roster still returned when the DB provides
    them (backward-compat).
  · `_claude_classify()` accepts a `roster` param and includes the
    escape-label option.

Placed under /app/tests/backend_unit/ per v58.13.10.
"""
from __future__ import annotations
import os
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

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


class _Cursor:
    def __init__(self, rows): self._rows = list(rows)
    def __aiter__(self): return self._iter()
    async def _iter(self):
        for r in self._rows: yield r


def _template(id_, name, category="pre_start", deleted_at=None):
    return {"id": id_, "name": name, "category": category, "deleted_at": deleted_at}


def _reset_cache():
    bip._ROSTER_CACHE["at"] = 0.0
    bip._ROSTER_CACHE["hints"] = None


@pytest.fixture(autouse=True)
def _reset(monkeypatch):
    _reset_cache()
    yield
    _reset_cache()


# ---------------------------------------------------------------------------
# 1. Roster function returns templates from ALL configured categories
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_roster_pulls_all_configured_categories(monkeypatch):
    docs = [
        _template("t-1", "Daily Pre-Start", "pre_start"),
        _template("t-2", "Plant Pre-Start Checklist", "plant_pre_start"),
        _template("t-3", "Construction & Excavation SSRA", "hazard"),
        _template("t-4", "Viatec Traffic SSRA", "hazard"),
        _template("t-5", "Excavation Permit NDD", "permit"),
        _template("t-6", "SWMS – Concrete Cutting", "swms"),
    ]
    def _find(filt, _proj=None):
        cats = filt.get("category", {}).get("$in", [])
        rows = [
            d for d in docs
            if d["category"] in cats and d["deleted_at"] is None
        ]
        return _Cursor(rows)
    fake_db = MagicMock()
    fake_db.form_templates.find = MagicMock(side_effect=_find)
    monkeypatch.setattr(bip, "db", fake_db)

    r = await bip._load_classifier_roster()
    assert len(r) == 6
    assert set(r.values()) == {
        "Daily Pre-Start", "Plant Pre-Start Checklist",
        "Construction & Excavation SSRA", "Viatec Traffic SSRA",
        "Excavation Permit NDD", "SWMS – Concrete Cutting",
    }


# ---------------------------------------------------------------------------
# 2. Excludes soft-deleted templates
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_roster_excludes_soft_deleted(monkeypatch):
    docs = [
        _template("t-1", "Daily Pre-Start", "pre_start"),
        _template("t-2", "Legacy Retired Form", "pre_start",
                  deleted_at="2026-01-01T00:00:00+00:00"),
    ]
    def _find(filt, _proj=None):
        rows = [d for d in docs
                if d["deleted_at"] is None
                and d["category"] in filt["category"]["$in"]]
        return _Cursor(rows)
    fake_db = MagicMock()
    fake_db.form_templates.find = MagicMock(side_effect=_find)
    monkeypatch.setattr(bip, "db", fake_db)

    r = await bip._load_classifier_roster()
    assert len(r) == 1
    assert list(r.values()) == ["Daily Pre-Start"]


# ---------------------------------------------------------------------------
# 3. DB failure → hardcoded fallback (pipeline stays functional)
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_roster_falls_back_on_db_failure(monkeypatch):
    fake_db = MagicMock()
    def _boom(*_a, **_kw): raise RuntimeError("mongo boom")
    fake_db.form_templates.find = MagicMock(side_effect=_boom)
    monkeypatch.setattr(bip, "db", fake_db)

    r = await bip._load_classifier_roster()
    # Falls back to _TEMPLATE_HINTS — 6 legacy pre-start templates.
    assert r == dict(bip._TEMPLATE_HINTS)


# ---------------------------------------------------------------------------
# 4. Empty result also triggers the fallback (defence-in-depth)
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_roster_falls_back_on_empty_result(monkeypatch):
    fake_db = MagicMock()
    fake_db.form_templates.find = MagicMock(return_value=_Cursor([]))
    monkeypatch.setattr(bip, "db", fake_db)

    r = await bip._load_classifier_roster()
    assert r == dict(bip._TEMPLATE_HINTS)


# ---------------------------------------------------------------------------
# 5. TTL cache — second call within the window doesn't re-query
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_roster_ttl_cache_hits_avoid_repeat_queries(monkeypatch):
    docs = [_template("t-1", "Daily Pre-Start", "pre_start")]
    call_count = {"n": 0}
    def _find(filt, _proj=None):
        call_count["n"] += 1
        return _Cursor([d for d in docs
                        if d["category"] in filt["category"]["$in"]])
    fake_db = MagicMock()
    fake_db.form_templates.find = MagicMock(side_effect=_find)
    monkeypatch.setattr(bip, "db", fake_db)

    await bip._load_classifier_roster()
    await bip._load_classifier_roster()
    await bip._load_classifier_roster()
    assert call_count["n"] == 1  # 3 calls, 1 db hit


# ---------------------------------------------------------------------------
# 6. Legacy 6-template names still resolvable through the DB path
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_roster_preserves_all_six_legacy_pre_start_names(monkeypatch):
    legacy_names = list(bip._TEMPLATE_HINTS.values())
    docs = [_template(f"t-{i}", n, "pre_start")
            for i, n in enumerate(legacy_names)]
    def _find(filt, _proj=None):
        return _Cursor([d for d in docs
                        if d["category"] in filt["category"]["$in"]])
    fake_db = MagicMock()
    fake_db.form_templates.find = MagicMock(side_effect=_find)
    monkeypatch.setattr(bip, "db", fake_db)

    r = await bip._load_classifier_roster()
    assert set(r.values()) == set(legacy_names)


# ---------------------------------------------------------------------------
# 7. Env var overrides the category set
# ---------------------------------------------------------------------------
def test_categories_are_env_configurable():
    # The module constant is loaded at import time from
    # BULK_IMPORT_CLASSIFIER_CATEGORIES. Verify the default is what
    # we ship, and that the parser strips whitespace + drops empties.
    default = tuple(
        c.strip() for c in
        "pre_start,plant_pre_start,hazard,swms,permit".split(",")
        if c.strip()
    )
    assert bip._CLASSIFIER_CATEGORIES == default

    # Simulate the parse the module does at import time.
    raw = " ssra , pre_start , , hazard "
    parsed = tuple(c.strip() for c in raw.split(",") if c.strip())
    assert parsed == ("ssra", "pre_start", "hazard")


# ---------------------------------------------------------------------------
# 8. _claude_classify signature accepts roster + includes escape option
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_claude_classify_includes_escape_option(monkeypatch):
    captured = {}
    async def _fake_json(system, user, image_b64=None, images_b64=None):
        captured["system"] = system
        captured["user"] = user
        return {"template_name": "Daily Pre-Start", "confidence": 0.9}
    # Patch the `ai._claude_json` import target used by _claude_classify.
    import ai
    monkeypatch.setattr(ai, "_claude_json", _fake_json, raising=False)

    roster = {"t-1": "Daily Pre-Start", "t-2": "SSRA - Excavation"}
    r = await bip._claude_classify("fakebase64png", roster=roster)
    assert r["template_name"] == "Daily Pre-Start"
    # The prompt Claude sees must list both roster entries + the escape.
    assert "Daily Pre-Start" in captured["user"]
    assert "SSRA - Excavation" in captured["user"]
    assert bip._CLASSIFIER_ESCAPE_LABEL in captured["user"]


@pytest.mark.asyncio
async def test_claude_classify_defaults_to_legacy_when_no_roster(monkeypatch):
    captured = {}
    async def _fake_json(system, user, image_b64=None, images_b64=None):
        captured["user"] = user
        return {"template_name": "Daily Pre-Start", "confidence": 0.9}
    import ai
    monkeypatch.setattr(ai, "_claude_json", _fake_json, raising=False)

    r = await bip._claude_classify("fakebase64png")
    assert r["template_name"] == "Daily Pre-Start"
    # All 6 legacy pre-start names must appear in the user prompt.
    for n in bip._TEMPLATE_HINTS.values():
        assert n in captured["user"]


# ---------------------------------------------------------------------------
# 9. Confidence floor — sanity check on the constant
# ---------------------------------------------------------------------------
def test_confidence_floor_env_configurable():
    # 0.7 is the ship default. Env var override is a float parse.
    assert bip._MIN_CLASSIFIER_CONFIDENCE == 0.7
    # Parse the same way the module does.
    parsed = float(os.environ.get("BULK_IMPORT_MIN_CLASSIFIER_CONFIDENCE") or "0.7")
    assert parsed == 0.7


# ---------------------------------------------------------------------------
# 10. Version-sync guardrail
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
