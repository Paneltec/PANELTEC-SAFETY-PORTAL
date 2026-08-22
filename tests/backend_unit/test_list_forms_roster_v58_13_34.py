"""v58.13.34 — list_forms roster expansion pytests."""
from __future__ import annotations
import os, sys
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
        if not _line or _line.startswith("#") or "=" not in _line: continue
        _k, _, _v = _line.partition("=")
        os.environ.setdefault(_k.strip(), _v.strip().strip('"').strip("'"))

import bulk_import_prestarts as bip  # noqa: E402


class _Cursor:
    def __init__(self, rows): self._rows = list(rows)
    def __aiter__(self): return self._iter()
    async def _iter(self):
        for r in self._rows: yield r


def _reset(): bip._ROSTER_CACHE["at"]=0.0; bip._ROSTER_CACHE["hints"]=None
@pytest.fixture(autouse=True)
def _clean(): _reset(); yield; _reset()


@pytest.mark.asyncio
async def test_roster_includes_list_forms_entries(monkeypatch):
    ft_docs = [{"id":"ft-1","name":"Daily Pre-Start","category":"pre_start","deleted_at":None}]
    lf_docs = [
        {"id":"lf-1","name":"Drain Cleaning - SSRA","deleted_at":None},
        {"id":"lf-2","name":"Excavation Permit - NDD","deleted_at":None},
        {"id":"lf-3","name":"Directional Drill - Pre-Start","deleted_at":None},
        {"id":"lf-4","name":"Telehandler/Loader - Daily Pre-Start","deleted_at":None},
        {"id":"lf-5","name":"Underground Asset - Site Location Form","deleted_at":None},
        {"id":"lf-6","name":"WHSEQ Compliance Audit","deleted_at":None},
    ]
    def _ft_find(filt, _proj=None):
        excluded = filt.get("category",{}).get("$nin",[])
        return _Cursor([d for d in ft_docs
                        if d["category"] not in excluded and d["deleted_at"] is None])
    def _lf_find(filt, _proj=None):
        return _Cursor([d for d in lf_docs if d["deleted_at"] is None])
    fake_db = MagicMock()
    fake_db.form_templates.find = MagicMock(side_effect=_ft_find)
    fake_db.list_forms.find = MagicMock(side_effect=_lf_find)
    monkeypatch.setattr(bip, "db", fake_db)
    monkeypatch.setattr(bip, "_CLASSIFIER_CATEGORIES", tuple())
    monkeypatch.setattr(bip, "_CLASSIFIER_CATEGORY_EXCLUDE",
                        ("site_diary","incident","toolbox","near_miss","admin"))

    r = await bip._load_classifier_roster()
    names = set(r.values())
    # form_templates entry present
    assert "Daily Pre-Start" in names
    # all 6 list_forms entries present
    for n in ("Drain Cleaning - SSRA","Excavation Permit - NDD",
              "Directional Drill - Pre-Start",
              "Telehandler/Loader - Daily Pre-Start",
              "Underground Asset - Site Location Form",
              "WHSEQ Compliance Audit"):
        assert n in names, f"missing list_forms entry: {n}"
    assert len(r) == 7  # 1 form_template + 6 list_forms


@pytest.mark.asyncio
async def test_roster_strictly_wider_than_form_templates_only(monkeypatch):
    """v58.13.34 must always return >= form_templates-alone count."""
    ft_docs = [{"id":"ft-1","name":"Daily Pre-Start","category":"pre_start","deleted_at":None}]
    lf_docs = [{"id":"lf-1","name":"Extra Form","deleted_at":None}]
    fake_db = MagicMock()
    fake_db.form_templates.find = MagicMock(
        side_effect=lambda f,_p=None: _Cursor([d for d in ft_docs if d["deleted_at"] is None]))
    fake_db.list_forms.find = MagicMock(
        side_effect=lambda f,_p=None: _Cursor([d for d in lf_docs if d["deleted_at"] is None]))
    monkeypatch.setattr(bip, "db", fake_db)
    monkeypatch.setattr(bip, "_CLASSIFIER_CATEGORIES", tuple())
    r = await bip._load_classifier_roster()
    assert len(r) == 2


@pytest.mark.asyncio
async def test_list_forms_failure_does_not_break_roster(monkeypatch):
    """If list_forms query blows up, form_templates entries still return."""
    ft_docs = [{"id":"ft-1","name":"Daily Pre-Start","category":"pre_start","deleted_at":None}]
    fake_db = MagicMock()
    fake_db.form_templates.find = MagicMock(
        side_effect=lambda f,_p=None: _Cursor([d for d in ft_docs if d["deleted_at"] is None]))
    def _boom(*_a, **_kw): raise RuntimeError("list_forms mongo boom")
    fake_db.list_forms.find = MagicMock(side_effect=_boom)
    monkeypatch.setattr(bip, "db", fake_db)
    monkeypatch.setattr(bip, "_CLASSIFIER_CATEGORIES", tuple())
    r = await bip._load_classifier_roster()
    assert set(r.values()) == {"Daily Pre-Start"}


@pytest.mark.asyncio
async def test_claude_extract_handles_empty_template_gracefully(monkeypatch):
    """list_forms entries lack `fields[]` — passing an empty dict as
    the template must not crash the extractor."""
    called = {"n": 0}
    async def _fake_json(system, user, image_b64=None, images_b64=None):
        called["n"] += 1
        return {"date": "2026-02-01"}
    import ai
    monkeypatch.setattr(ai, "_claude_json", _fake_json, raising=False)
    # Empty template — simulates the list_forms miss in templates_by_id.
    r = await bip._claude_extract("fakebase64png", {})
    assert r == {"date": "2026-02-01"}
    assert called["n"] == 1


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
