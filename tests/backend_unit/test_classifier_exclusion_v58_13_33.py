"""v58.13.33 — Classifier exclusion-list pytests."""
from __future__ import annotations
import os
import sys
from pathlib import Path
from unittest.mock import MagicMock

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


def _t(id_, name, category):
    return {"id": id_, "name": name, "category": category, "deleted_at": None}


def _reset(): bip._ROSTER_CACHE["at"] = 0.0; bip._ROSTER_CACHE["hints"] = None


@pytest.fixture(autouse=True)
def _clean():
    _reset(); yield; _reset()


# ---------------------------------------------------------------------------
# 1. Default exclusion list — returns all except site_diary/incident/etc.
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_default_exclusion_returns_all_non_excluded(monkeypatch):
    docs = [
        _t("t-1", "Daily Pre-Start", "pre_start"),
        _t("t-2", "Vehicle Pre-Use Inspection", "inspection"),
        _t("t-3", "Hot Work Permit", "general"),
        _t("t-4", "SSRA - Concrete", "hazard"),
        _t("t-5", "Site Diary Note", "site_diary"),       # excluded
        _t("t-6", "Incident Report", "incident"),         # excluded
        _t("t-7", "Toolbox Talk", "toolbox"),             # excluded
    ]
    def _find(filt, _proj=None):
        excluded = filt.get("category", {}).get("$nin", [])
        return _Cursor([d for d in docs if d["category"] not in excluded])
    fake_db = MagicMock()
    fake_db.form_templates.find = MagicMock(side_effect=_find)
    monkeypatch.setattr(bip, "db", fake_db)
    # Force default env — legacy inclusion list must be empty.
    monkeypatch.setattr(bip, "_CLASSIFIER_CATEGORIES", tuple())
    monkeypatch.setattr(bip, "_CLASSIFIER_CATEGORY_EXCLUDE",
                        ("site_diary", "incident", "toolbox",
                         "near_miss", "admin"))

    r = await bip._load_classifier_roster()
    assert set(r.values()) == {"Daily Pre-Start",
                               "Vehicle Pre-Use Inspection",
                               "Hot Work Permit",
                               "SSRA - Concrete"}


# ---------------------------------------------------------------------------
# 2. Empty exclusion list returns EVERY active template
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_empty_exclusion_returns_all(monkeypatch):
    docs = [
        _t("t-1", "Daily Pre-Start", "pre_start"),
        _t("t-2", "Toolbox Talk", "toolbox"),
        _t("t-3", "Admin Form", "admin"),
    ]
    def _find(filt, _proj=None):
        excluded = filt.get("category", {}).get("$nin", [])
        return _Cursor([d for d in docs if d["category"] not in excluded])
    fake_db = MagicMock()
    fake_db.form_templates.find = MagicMock(side_effect=_find)
    monkeypatch.setattr(bip, "db", fake_db)
    monkeypatch.setattr(bip, "_CLASSIFIER_CATEGORIES", tuple())
    monkeypatch.setattr(bip, "_CLASSIFIER_CATEGORY_EXCLUDE", tuple())

    r = await bip._load_classifier_roster()
    assert len(r) == 3


# ---------------------------------------------------------------------------
# 3. Explicit legacy inclusion list still honoured (backward-compat)
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_legacy_inclusion_env_still_works(monkeypatch):
    docs = [
        _t("t-1", "Daily Pre-Start", "pre_start"),
        _t("t-2", "Hot Work Permit", "general"),
        _t("t-3", "SSRA - Concrete", "hazard"),
    ]
    def _find(filt, _proj=None):
        included = filt.get("category", {}).get("$in", [])
        return _Cursor([d for d in docs if d["category"] in included])
    fake_db = MagicMock()
    fake_db.form_templates.find = MagicMock(side_effect=_find)
    monkeypatch.setattr(bip, "db", fake_db)
    monkeypatch.setattr(bip, "_CLASSIFIER_CATEGORIES", ("pre_start", "hazard"))

    r = await bip._load_classifier_roster()
    # Only pre_start + hazard, "general" excluded.
    assert set(r.values()) == {"Daily Pre-Start", "SSRA - Concrete"}


# ---------------------------------------------------------------------------
# 4. Post-Ship 3 (v58.13.33) roster >= pre-Ship 3 count of 6 legacy names.
#    We assert the SHAPE of the widening, not an exact number.
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_roster_widens_from_six_baseline(monkeypatch):
    docs = [_t(f"t-{i}", f"Template {i}", cat)
            for i, cat in enumerate([
                "pre_start", "hazard", "inspection", "general",
                "risk_assessment", "permit", "plant_pre_start"])]
    def _find(filt, _proj=None):
        excluded = filt.get("category", {}).get("$nin", [])
        return _Cursor([d for d in docs if d["category"] not in excluded])
    fake_db = MagicMock()
    fake_db.form_templates.find = MagicMock(side_effect=_find)
    monkeypatch.setattr(bip, "db", fake_db)
    monkeypatch.setattr(bip, "_CLASSIFIER_CATEGORIES", tuple())
    monkeypatch.setattr(bip, "_CLASSIFIER_CATEGORY_EXCLUDE",
                        ("site_diary", "incident", "toolbox",
                         "near_miss", "admin"))

    r = await bip._load_classifier_roster()
    assert len(r) >= 6, f"expected >=6 templates, got {len(r)}"
    assert len(r) > len(bip._TEMPLATE_HINTS), \
        "post-v58.13.33 roster must be strictly larger than the 6-template baseline"


# ---------------------------------------------------------------------------
# 5. Version-sync
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
