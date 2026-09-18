"""v58.13.132ib — WorkerPicker inline_company_toggle + multi + regression harness.

Source pins + behavioural tests for:
  · GET /api/forms/pickers/workers?company_id=<simpro_id> — new filter.
  · WorkerPicker honors `config.inline_company_toggle` + `company_options`.
  · WorkerPicker honors `config.multi: true` (array shape + chip cluster).
  · isAnswerValid accepts Array<worker> for `multi: true` worker_pickers.
  · Version lockstep .132ib across version.js + service-worker.js.

Playwright regression harness lives at `scripts/verify_pickers_132ib.py`
(runs all-templates × all-pickers toggle→row→chip cycle). Not called from
pytest to keep the pytest suite hermetic; it's invoked manually / by the
verify step before commit.
"""
from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from fastapi import FastAPI

ROOT = Path(__file__).resolve().parents[2]
FRONTEND = ROOT / "frontend"
BACKEND = ROOT / "backend"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


# ── Frontend source pins ────────────────────────────────────────────

def test_worker_picker_reads_inline_company_toggle_config():
    src = _read(FRONTEND / "src" / "components" / "forms" / "PickerFields.jsx")
    assert "cfg.inline_company_toggle" in src
    assert "cfg.company_options" in src
    # Company toggle testids exposed for automation.
    assert "-company-toggle" in src
    assert "-company-all" in src
    assert "-company-${opt.simpro_id}" in src


def test_worker_picker_handles_multi_config():
    src = _read(FRONTEND / "src" / "components" / "forms" / "PickerFields.jsx")
    assert "cfg.multi" in src
    assert "onPickMulti" in src
    # Chip cluster + testids.
    assert "-multi-chips" in src
    assert "-multi-chip-" in src
    assert "-multi-remove-" in src
    # Idempotent add — clicking an already-selected worker no-ops.
    assert "if (selectedIds.has(w.id)) return" in src
    # Array value contract.
    assert "Array.isArray(props.value) ? props.value : []" in src


def test_picker_input_has_multi_support_hooks():
    """PickerInput exposes `topSlot`, `hideSelectedChip`, `onPickOverride`
    so any picker (worker_picker today, plant_picker tomorrow) can bolt
    on multi-select without a per-type fork."""
    src = _read(FRONTEND / "src" / "components" / "forms" / "PickerFields.jsx")
    assert "topSlot" in src
    assert "hideSelectedChip = false" in src
    assert "onPickOverride = null" in src
    # onPickMulti path must NOT close the dropdown so the user can chain picks.
    assert "onPickOverride(it);" in src


def test_backend_workers_endpoint_accepts_company_id():
    src = _read(BACKEND / "forms_pickers.py")
    # Signature widened with optional `company_id` (`None` = "all").
    assert 'company_id: Optional[str] = None' in src
    # Filter applied to Mongo query.
    assert 'flt["simpro_company_id"] = str(company_id)' in src
    # Projection now surfaces simpro_company_id so the FE can badge.
    assert '"simpro_company_id": 1' in src


def test_is_answer_valid_accepts_multi_worker_picker_array():
    """Port of the frontend `isAnswerValid` contract for `multi:true`
    worker_pickers — mirrored in Python so the pytest suite doesn't
    have to spin a Node runtime."""
    def is_answer_valid(field, value, photo_files=None):
        t = (field or {}).get("type")
        cfg = (field or {}).get("config") or {}
        if t == "worker_picker" and cfg.get("multi"):
            return (isinstance(value, list) and len(value) > 0
                    and isinstance(value[0], dict) and value[0].get("id") is not None)
        if t in ("worker_picker", "customer_picker", "job_picker"):
            return bool(value and isinstance(value, dict) and value.get("id"))
        return False

    # Also lock the same contract lives verbatim in frontend/src/lib/isAnswerValid.js.
    js_src = _read(FRONTEND / "src" / "lib" / "isAnswerValid.js")
    assert "if (t === 'worker_picker' && (field.config || {}).multi)" in js_src
    assert "Array.isArray(value) && value.length > 0" in js_src

    field = {"type": "worker_picker", "config": {"multi": True}}
    assert is_answer_valid(field, [{"id": "w1", "name": "A"}]) is True
    assert is_answer_valid(field, []) is False
    assert is_answer_valid(field, None) is False
    field_single = {"type": "worker_picker", "config": {}}
    assert is_answer_valid(field_single, {"id": "w1", "name": "A"}) is True
    assert is_answer_valid(field_single, None) is False


# ── Behavioural: /workers endpoint with company_id ─────────────────

@pytest.mark.asyncio
async def test_workers_endpoint_filters_by_company_id(monkeypatch):
    import forms_pickers

    rows = [
        {"id": "a", "org_id": "org-1", "name": "Alice",  "simpro_company_id": "2", "position": "Trades"},
        {"id": "b", "org_id": "org-1", "name": "Bob",    "simpro_company_id": "2", "position": "Trades"},
        {"id": "c", "org_id": "org-1", "name": "Carla",  "simpro_company_id": "3", "position": "TTM"},
        {"id": "d", "org_id": "org-1", "name": "Dan",    "simpro_company_id": None, "position": None},
        {"id": "e", "org_id": "org-2", "name": "Cross",  "simpro_company_id": "2", "position": "Trades"},
    ]

    class FakeCursor:
        def __init__(self, matched):
            self._m = matched

        def __aiter__(self):
            async def gen():
                for r in self._m:
                    yield r
            return gen()

    class FakeColl:
        def find(self, flt, projection=None):
            def match(r):
                if r["org_id"] != flt["org_id"]:
                    return False
                if "simpro_company_id" in flt and r.get("simpro_company_id") != flt["simpro_company_id"]:
                    return False
                # `active: {$ne: False}` — treat missing as True.
                if r.get("active") is False:
                    return False
                # `deleted_at: None`
                if r.get("deleted_at") is not None:
                    return False
                return True
            return FakeCursor([r for r in rows if match(r)])

    class FakeDb(dict):
        def __getattr__(self, k):
            return FakeColl()

    monkeypatch.setattr(forms_pickers, "db", FakeDb())
    monkeypatch.setattr(forms_pickers, "_cache_get", lambda *a, **kw: None)
    monkeypatch.setattr(forms_pickers, "_cache_set", lambda *a, **kw: None)

    from auth import get_current_user

    async def fake_user():
        return {"id": "u1", "org_id": "org-1", "role": "admin"}

    app = FastAPI()
    app.include_router(forms_pickers.router, prefix="/api")
    app.dependency_overrides[get_current_user] = fake_user
    client = TestClient(app)

    # No filter → 4 in-org non-deleted rows.
    r = client.get("/api/forms/pickers/workers")
    assert r.status_code == 200
    all_ids = [w["id"] for w in r.json()["workers"]]
    assert set(all_ids) == {"a", "b", "c", "d"}, all_ids

    # company_id=2 → Alice + Bob.
    r = client.get("/api/forms/pickers/workers?company_id=2")
    assert r.status_code == 200
    ids = {w["id"] for w in r.json()["workers"]}
    assert ids == {"a", "b"}, ids

    # company_id=3 → Carla only.
    r = client.get("/api/forms/pickers/workers?company_id=3")
    assert r.status_code == 200
    ids = {w["id"] for w in r.json()["workers"]}
    assert ids == {"c"}, ids

    # simpro_company_id present in the response row.
    r = client.get("/api/forms/pickers/workers?company_id=2")
    assert all("simpro_company_id" in w for w in r.json()["workers"])

# ── Version pin ─────────────────────────────────────────────────────

def test_version_pin_v132ib():
    v = _read(FRONTEND / "src" / "lib" / "version.js")
    assert "RUNNING_VERSION = 'paneltec-v160.3.9.58.13.132ib'" in v
    assert "EXPECTED_CACHE_VERSION = 'paneltec-v160.3.9.58.13.132ib'" in v
    sw = _read(FRONTEND / "public" / "service-worker.js")
    assert "CACHE_VERSION = 'paneltec-v160.3.9.58.13.132ib'" in sw
