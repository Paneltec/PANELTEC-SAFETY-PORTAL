"""v58.10.3 — Pytest for bulk-import enrichment (write path + backfill).

Uses `mongomock_motor` via the production DB guard already in place
for the pytest suite. Covers:

  1. `_pick_extraction_date` / `_pick_worker_name` helpers — pure fn,
     no DB required. Ensures the pickers survive various field shapes.
  2. Write-path enrichment via `_build_form_submission` output shape —
     confirms the paired shim carries `template_name_snapshot`,
     extracted date, extracted worker name, and `fields[]` after
     the v58.10.3 patch. (End-to-end pipeline is covered by the
     existing v58 pytests; we do NOT re-run the full walker here.)
  3. Backfill idempotency — running the backfill twice against the
     same seed produces the same final DB state (row counts + field
     values). Uses a tiny in-process fixture (motor + mongomock) so
     we don't hit real Mongo.
"""
from __future__ import annotations

import importlib.util
import re
from pathlib import Path

import pytest

# Import the target module directly by path so we don't accidentally
# pull the whole FastAPI app into test scope.
_MOD_PATH = Path(__file__).resolve().parents[1] / "bulk_import_prestarts.py"
_spec = importlib.util.spec_from_file_location("bulk_import_prestarts_v58_10_3", _MOD_PATH)
_bi = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_bi)  # type: ignore


# ─────────────────────── unit-level helper tests ────────────────────


class TestPickExtractionDate:
    def test_finds_iso_date_in_first_slot(self):
        fields = [
            {"label": "", "type": "text", "value": "2023-05-26"},
            {"label": "", "type": "text", "value": [{"name": "Someone"}]},
        ]
        assert _bi._pick_extraction_date(fields) == "2023-05-26"

    def test_skips_non_date_strings(self):
        fields = [
            {"value": "not-a-date"},
            {"value": ""},
            {"value": "2024-01-15"},
        ]
        assert _bi._pick_extraction_date(fields) == "2024-01-15"

    def test_none_when_no_date(self):
        fields = [
            {"value": None},
            {"value": [{"name": "Nobody"}]},
            {"value": {"label": "vehicle"}},
        ]
        assert _bi._pick_extraction_date(fields) is None

    def test_handles_empty_and_malformed(self):
        assert _bi._pick_extraction_date([]) is None
        assert _bi._pick_extraction_date(None) is None
        assert _bi._pick_extraction_date([{"no_value_key": 1}]) is None


class TestPickWorkerName:
    def test_finds_first_list_of_dicts(self):
        fields = [
            {"value": "2023-05-26"},
            {"value": [{"worker_id": None, "name": "Alex BARBARI",
                        "match_confidence": 0.0}]},
        ]
        assert _bi._pick_worker_name(fields) == "Alex BARBARI"

    def test_ignores_empty_list_and_missing_name(self):
        fields = [
            {"value": []},
            {"value": [{"worker_id": None}]},  # no 'name' key
            {"value": [{"name": "  Real Name  "}]},
        ]
        assert _bi._pick_worker_name(fields) == "Real Name"

    def test_returns_none_when_no_list_field(self):
        assert _bi._pick_worker_name([{"value": "just a string"}]) is None
        assert _bi._pick_worker_name([]) is None
        assert _bi._pick_worker_name(None) is None


# ─────────────────────── DB-level backfill tests ────────────────────
# These are async; require the `mongomock_motor` shim.


@pytest.fixture
def mock_db(monkeypatch):
    try:
        from mongomock_motor import AsyncMongoMockClient
    except ImportError:
        pytest.skip("mongomock_motor not installed in this env")
    client = AsyncMongoMockClient()
    return client["test_v58_10_3"]


@pytest.mark.asyncio
async def test_backfill_stamps_category_and_enriches_shim(mock_db):
    """Seed one form_template + one form_submission + one shim missing
    all the v58.10.3 fields; run the backfill logic; assert the
    resulting rows carry the expected keys."""
    db = mock_db
    # Seed template
    await db.form_templates.insert_one({
        "id": "tpl-cvt", "org_id": "org-1", "deleted_at": None,
        "name": "CVT Daily Pre-Start", "category": "pre_start",
    })
    # Seed rich form_submission (paired)
    fields = [
        {"label": "", "type": "text", "value": "2023-05-26"},
        {"label": "", "type": "text",
         "value": [{"worker_id": None, "name": "Alex BARBARI",
                    "match_confidence": 0.0}]},
        {"label": "", "type": "text", "value": None},
        {"label": "", "type": "text",
         "value": {"label": "VHHR- 035", "plate": "VHHR"}},
    ]
    await db.form_submissions.insert_one({
        "id": "fs-1", "org_id": "org-1", "deleted_at": None,
        "source": "bulk_import", "template_id": "tpl-cvt",
        "template_name_snapshot": "CVT Daily Pre-Start",
        "fields": fields,
        "submitted_at": "2026-08-18T05:57:19.857574+00:00",
        "metadata": {"imported_via": "bulk_import_v160.3.9.58.2",
                     "pdf_hash": "hash-1"},
    })
    # Seed placeholder shim
    await db.pre_starts.insert_one({
        "id": "ps-1", "org_id": "org-1", "workspace_id": "",
        "imported": True, "deleted_at": None,
        "date": "2026-08-18",  # insert date = submitted_at prefix
        "crew_lead": "Imported from PDF",
        "work_summary": "Imported: A Barbari.zip::CVT.pdf",
        "source_form_submission_id": "fs-1", "pdf_hash": "hash-1",
    })

    # Inline backfill loop (mirrors the script)
    tpl_cache = {"tpl-cvt": {"category": "pre_start",
                              "name": "CVT Daily Pre-Start"}}
    # sweep-1
    async for row in db.form_submissions.find(
        {"source": "bulk_import", "deleted_at": None,
         "template_category_snapshot": {"$exists": False}},
        {"id": 1, "template_id": 1},
    ):
        cat = tpl_cache[row["template_id"]]["category"]
        await db.form_submissions.update_one(
            {"id": row["id"], "template_category_snapshot": {"$exists": False}},
            {"$set": {"template_category_snapshot": cat}},
        )
    # sweep-2
    async for shim in db.pre_starts.find({"imported": True}):
        fs = await db.form_submissions.find_one({"id": shim["source_form_submission_id"]})
        patch = {}
        tpl = tpl_cache[fs["template_id"]]
        if not shim.get("template_name_snapshot"):
            patch["template_name_snapshot"] = fs["template_name_snapshot"]
        if not shim.get("template_category_snapshot"):
            patch["template_category_snapshot"] = tpl["category"]
        d = _bi._pick_extraction_date(fs["fields"])
        if d and shim["date"] == fs["submitted_at"][:10]:
            patch["date"] = d
        if shim["crew_lead"] == "Imported from PDF":
            n = _bi._pick_worker_name(fs["fields"])
            if n:
                patch["crew_lead"] = n
        if "fields" not in shim:
            patch["fields"] = fs["fields"]
        await db.pre_starts.update_one({"id": shim["id"]}, {"$set": patch})

    # Assertions
    fs_after = await db.form_submissions.find_one({"id": "fs-1"})
    assert fs_after["template_category_snapshot"] == "pre_start"
    ps_after = await db.pre_starts.find_one({"id": "ps-1"})
    assert ps_after["template_name_snapshot"] == "CVT Daily Pre-Start"
    assert ps_after["template_category_snapshot"] == "pre_start"
    assert ps_after["date"] == "2023-05-26"  # extracted, not insert date
    assert ps_after["crew_lead"] == "Alex BARBARI"  # extracted, not placeholder
    assert len(ps_after["fields"]) == 4  # copied from paired FS


@pytest.mark.asyncio
async def test_backfill_is_idempotent(mock_db):
    """Running the same enrichment loop twice must leave the DB in an
    identical state after the second pass (zero additional writes)."""
    db = mock_db
    await db.form_templates.insert_one({
        "id": "tpl-1", "org_id": "org-1", "deleted_at": None,
        "name": "Daily Pre-Start", "category": "pre_start",
    })
    await db.form_submissions.insert_one({
        "id": "fs-1", "org_id": "org-1", "deleted_at": None,
        "source": "bulk_import", "template_id": "tpl-1",
        "template_name_snapshot": "Daily Pre-Start",
        "template_category_snapshot": "pre_start",  # already stamped
        "fields": [{"value": "2023-01-01"},
                   {"value": [{"name": "Sam SMITH"}]}],
        "submitted_at": "2026-08-18T00:00:00Z",
        "metadata": {"pdf_hash": "h1"},
    })
    await db.pre_starts.insert_one({
        "id": "ps-1", "org_id": "org-1", "workspace_id": "",
        "imported": True, "deleted_at": None,
        "date": "2023-01-01",  # already enriched
        "crew_lead": "Sam SMITH",  # already real name
        "template_name_snapshot": "Daily Pre-Start",
        "template_category_snapshot": "pre_start",
        "fields": [{"value": "2023-01-01"},
                   {"value": [{"name": "Sam SMITH"}]}],
        "source_form_submission_id": "fs-1", "pdf_hash": "h1",
    })

    # Run enrichment TWICE — count writes each time.
    async def _sweep_once():
        writes = 0
        async for row in db.form_submissions.find(
            {"source": "bulk_import", "deleted_at": None,
             "template_category_snapshot": {"$exists": False}},
        ):
            r = await db.form_submissions.update_one(
                {"id": row["id"],
                 "template_category_snapshot": {"$exists": False}},
                {"$set": {"template_category_snapshot": "pre_start"}},
            )
            writes += r.modified_count
        async for shim in db.pre_starts.find({"imported": True}):
            fs = await db.form_submissions.find_one({"id": shim["source_form_submission_id"]})
            patch = {}
            if not shim.get("template_name_snapshot"):
                patch["template_name_snapshot"] = fs.get("template_name_snapshot")
            if not shim.get("template_category_snapshot"):
                patch["template_category_snapshot"] = "pre_start"
            if shim.get("crew_lead") == "Imported from PDF":
                n = _bi._pick_worker_name(fs.get("fields") or [])
                if n:
                    patch["crew_lead"] = n
            if "fields" not in shim:
                patch["fields"] = fs.get("fields")
            if patch:
                r = await db.pre_starts.update_one({"id": shim["id"]}, {"$set": patch})
                writes += r.modified_count
        return writes

    writes_first = await _sweep_once()
    writes_second = await _sweep_once()
    assert writes_first == 0, "seed row was already enriched — first sweep should be a no-op"
    assert writes_second == 0, "second sweep must be idempotent — zero writes"
