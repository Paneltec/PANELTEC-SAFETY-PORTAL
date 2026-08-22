"""v58.13.35 — Ship 4b re-extraction script pytests.

Covers:
  · dry-run report shape (per action, per category, per template)
  · commit path: migrate → soft-deletes pre_starts, inserts
    form_submissions with correct snapshots + needs_review metadata
  · commit path: update_in_place → stamps snapshots on pre_starts
  · noop_unresolved path when the work_summary carries no `::` hint
  · low-confidence roster match falls to noop_unresolved
  · original record id preserved across migrate
  · per-record failure isolation — one record failing does not abort
  · cost cap enforcement (synthetic — cache-derived is always $0 so
    the cap can only be tripped by forcing a positive outcome cost)
  · idempotency — a second --commit is a no-op
  · version-sync current
"""
from __future__ import annotations
import argparse
import importlib
import os
import sys
from pathlib import Path
from typing import Any

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

_SCRIPTS = _BACKEND / "scripts"
if str(_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS))

import bulk_import_template_inference as bti  # noqa: E402
reextract = importlib.import_module("reextract_misclassified_v58_13_35")


# ─── Fake async Mongo shim ───────────────────────────────────────────

class _Cursor:
    def __init__(self, rows, sort_key=None, limit=None):
        self._rows = list(rows)
        self._sort_key = sort_key
        self._limit = limit

    def sort(self, key, direction=1):
        self._sort_key = (key, direction)
        return self

    def limit(self, n):
        self._limit = n
        return self

    def __aiter__(self):
        rows = list(self._rows)
        if self._sort_key:
            k, d = self._sort_key
            rows.sort(key=lambda r: (r.get(k) or ""),
                      reverse=(d == -1))
        if self._limit:
            rows = rows[:self._limit]

        async def _it():
            for r in rows:
                yield r
        return _it()


class _UpdateResult:
    def __init__(self, matched):
        self.matched_count = matched


class _Coll:
    def __init__(self, initial=None):
        self.docs: list[dict] = list(initial or [])
        self.inserts: list[dict] = []
        self.updates: list[tuple[dict, dict]] = []

    def find(self, filt=None, proj=None):
        rows = [d for d in self.docs if _matches(d, filt or {})]
        return _Cursor(rows)

    async def find_one(self, filt, proj=None):
        for d in self.docs:
            if _matches(d, filt or {}):
                return dict(d)
        return None

    async def count_documents(self, filt):
        return sum(1 for d in self.docs if _matches(d, filt or {}))

    async def insert_one(self, doc):
        self.inserts.append(dict(doc))
        self.docs.append(dict(doc))
        return type("R", (), {"inserted_id": doc.get("id")})()

    async def update_one(self, filt, update):
        for d in self.docs:
            if _matches(d, filt):
                sets = update.get("$set") or {}
                d.update(sets)
                self.updates.append((filt, update))
                return _UpdateResult(1)
        return _UpdateResult(0)


def _dget(doc, key):
    """Dotted-key nested get, e.g. `metadata.pdf_hash`."""
    cur = doc
    for part in key.split("."):
        if not isinstance(cur, dict):
            return None
        cur = cur.get(part)
    return cur


def _matches(doc: dict, filt: dict) -> bool:
    for k, v in filt.items():
        dv = _dget(doc, k)
        if isinstance(v, dict):
            if "$in" in v:
                if dv not in v["$in"]:
                    return False
            elif "$nin" in v:
                if dv in v["$nin"]:
                    return False
            elif "$ne" in v:
                if dv == v["$ne"]:
                    return False
            elif "$exists" in v:
                exists = k in doc and doc.get(k) is not None
                if bool(v["$exists"]) != bool(exists):
                    return False
            elif "$gte" in v:
                if dv is None or dv < v["$gte"]:
                    return False
            elif "$regex" in v:
                import re as _re
                if not dv or not _re.search(v["$regex"], dv,
                                            _re.IGNORECASE if "i" in
                                            (v.get("$options") or "") else 0):
                    return False
        else:
            if dv != v:
                return False
    return True


class _DB:
    def __init__(self):
        self.pre_starts = _Coll()
        self.form_submissions = _Coll()
        self.bulk_import_pdf_cache = _Coll()
        self.form_templates = _Coll()
        self.list_forms = _Coll()
        self.bulk_import_reextract_v58_13_35_audit = _Coll()

    def __getitem__(self, name):
        return getattr(self, name)


# ─── Fixtures ────────────────────────────────────────────────────────

def _mk_row(id, ws, org="org-1", hash_="h-1"):
    return {
        "id": id, "org_id": org, "workspace_id": "ws-1",
        "imported": True, "deleted_at": None,
        "template_name_snapshot": None,
        "template_category_snapshot": None,
        "work_summary": ws, "pdf_hash": hash_,
        "created_at": "2026-02-01T00:00:00+00:00",
        "created_by": "user-1", "crew_lead": "J Doe",
    }


def _seed_templates(db):
    db.form_templates.docs.extend([
        {"id": "tpl-daily", "name": "Daily Pre-Start",
         "category": "pre_start", "deleted_at": None},
        {"id": "tpl-cvt", "name": "CVT Daily Pre-Start",
         "category": "pre_start", "deleted_at": None},
        {"id": "tpl-ce-ssra", "name": "Construction & Excavation SSRA",
         "category": "hazard", "deleted_at": None},
    ])
    db.list_forms.docs.extend([
        {"id": "lf-viatec", "name": "Viatec Traffic Solutions - SSRA",
         "category": None, "deleted_at": None},
        {"id": "lf-excav-permit",
         "name": "Excavation Permit - Mechanical, Drilling & Vacuum (NDD)",
         "category": None, "deleted_at": None},
    ])


@pytest.fixture
def db():
    _db = _DB()
    _seed_templates(_db)
    return _db


def _args(**kw) -> argparse.Namespace:
    base = {"dry_run": True, "scope": "all", "limit": None}
    base.update(kw)
    return argparse.Namespace(**base)


# ─── inference helper tests ──────────────────────────────────────────

def test_infer_from_row_prefers_snapshot():
    assert bti.infer_template_type_from_row(
        {"template_name_snapshot": "Daily Pre-Start"}) == "Daily Pre-Start"


def test_infer_from_row_falls_to_work_summary():
    ws = ("Imported: A Barbari.zip::Construction & Excavation - SSRA  "
          "(3502) - 20260724133725.pdf")
    assert bti.infer_template_type_from_row({"work_summary": ws}) == \
        "Construction & Excavation - SSRA"


def test_infer_from_row_empty_when_no_hint():
    assert bti.infer_template_type_from_row(
        {"work_summary": "no marker here"}) == ""
    assert bti.infer_template_type_from_row({}) == ""
    assert bti.infer_template_type_from_row(None) == ""


def test_resolve_against_roster_exact_and_substring():
    roster = {"tpl-a": "Daily Pre-Start", "tpl-b": "CVT Daily Pre-Start"}
    tid, name, conf = bti.resolve_against_roster("Daily Pre-Start", roster)
    assert (tid, name, conf) == ("tpl-a", "Daily Pre-Start", 1.0)
    # substring match (target is a prefix of canonical)
    tid, _, conf = bti.resolve_against_roster("Daily Pre", roster)
    assert conf >= 0.75
    assert tid in ("tpl-a", "tpl-b")


def test_infer_category_from_name_ssra_permits_prestarts():
    assert bti.infer_category_from_name("Viatec Traffic Solutions - SSRA") == "hazard"
    assert bti.infer_category_from_name("Excavation Permit NDD") == "permit"
    assert bti.infer_category_from_name("Daily Pre-Start") == "pre_start"
    assert bti.infer_category_from_name("Something unrelated") == ""


def test_should_migrate_hazard_yes_prestart_no():
    assert bti.should_migrate_out_of_prestarts("hazard", "SSRA") is True
    assert bti.should_migrate_out_of_prestarts("permit", "Permit") is True
    assert bti.should_migrate_out_of_prestarts("swms", "SWMS") is True
    assert bti.should_migrate_out_of_prestarts("pre_start", "Daily") is False


# ─── planner tests ───────────────────────────────────────────────────

def test_plan_migrates_ssra_to_hazard(db):
    row = _mk_row("r1", "Imported: A.zip::Viatec Traffic Solutions - SSRA "
                        "(1) - 20260101010101.pdf")
    roster = {"lf-viatec": "Viatec Traffic Solutions - SSRA",
              "tpl-daily": "Daily Pre-Start"}
    tpls = {"lf-viatec": {"id": "lf-viatec",
                          "name": "Viatec Traffic Solutions - SSRA",
                          "category": None}}
    plan = reextract._plan_record(row, roster, tpls)
    assert plan["action"] == "migrate"
    assert plan["matched_template_id"] == "lf-viatec"
    assert plan["new_category"] == "hazard"
    assert plan["target_collection"] == "form_submissions"


def test_plan_update_in_place_for_daily_prestart(db):
    row = _mk_row("r2", "Imported: A.zip::Daily Pre-Start "
                        "(1) - 20260101010101.pdf")
    roster = {"tpl-daily": "Daily Pre-Start"}
    tpls = {"tpl-daily": {"id": "tpl-daily", "name": "Daily Pre-Start",
                          "category": "pre_start"}}
    plan = reextract._plan_record(row, roster, tpls)
    assert plan["action"] == "update_in_place"
    assert plan["new_category"] == "pre_start"


def test_plan_noop_when_no_hint():
    row = _mk_row("r3", "no marker in this string")
    plan = reextract._plan_record(row, {"tpl-a": "Daily Pre-Start"}, {})
    assert plan["action"] == "noop_unresolved"
    assert plan["reason"] == "no_hint_in_work_summary"


def test_plan_noop_on_low_confidence_match():
    row = _mk_row("r4", "Imported: A.zip::TotallyUnknownDocument "
                        "(1) - 20260101010101.pdf")
    plan = reextract._plan_record(
        row, {"tpl-a": "Daily Pre-Start"},
        {"tpl-a": {"id": "tpl-a", "name": "Daily Pre-Start",
                   "category": "pre_start"}})
    assert plan["action"] == "noop_unresolved"
    assert plan["reason"] == "low_confidence_roster_match"


# ─── runner (dry-run) tests ──────────────────────────────────────────

@pytest.mark.asyncio
async def test_dryrun_report_shape(monkeypatch, db):
    db.pre_starts.docs.extend([
        _mk_row("r1", "Imported: A.zip::Viatec Traffic Solutions - SSRA "
                     "(1) - 20260101010101.pdf"),
        _mk_row("r2", "Imported: A.zip::Daily Pre-Start "
                     "(2) - 20260101010101.pdf"),
        _mk_row("r3", "no hint"),
    ])
    import db as db_mod
    monkeypatch.setattr(db_mod, "db", db, raising=False)
    monkeypatch.setattr(reextract, "_load_roster_and_templates",
                        _fake_roster_loader(db))
    summary = await reextract.run(_args(dry_run=True))
    assert summary["dry_run"] is True
    assert summary["total_in_scope"] == 3
    assert summary["processed"] == 3
    assert summary["actions"]["migrate"] == 1
    assert summary["actions"]["update_in_place"] == 1
    assert summary["actions"]["noop_unresolved"] == 1
    assert summary["writes"] == 0
    assert summary["estimated_cost_usd"] == 0.0
    # audit written for every record
    assert len(db.bulk_import_reextract_v58_13_35_audit.docs) == 3


def _fake_roster_loader(db):
    async def _loader(_db):
        roster: dict[str, str] = {}
        tpls: dict[str, dict] = {}
        for t in db.form_templates.docs:
            if t.get("deleted_at") is None:
                roster[t["id"]] = t["name"]
                tpls[t["id"]] = t
        for t in db.list_forms.docs:
            if t.get("deleted_at") is None and t["id"] not in roster:
                roster[t["id"]] = t["name"]
                tpls[t["id"]] = t
        return roster, tpls
    return _loader


@pytest.mark.asyncio
async def test_commit_migrate_updates_existing_form_submission(monkeypatch, db):
    """Prod scenario: a form_submissions row for the same pdf_hash
    already exists under a DIFFERENT id (misclassified with Daily
    Pre-Start snapshots). Script must UPDATE it in place, not
    INSERT (which would trip the unique index)."""
    row = _mk_row(
        "ps-abc",
        "Imported: A.zip::Construction & Excavation - SSRA "
        "(1) - 20260101010101.pdf",
        hash_="dup-hash",
    )
    db.pre_starts.docs.append(row)
    # Pre-existing (misclassified) FS row under a different id.
    db.form_submissions.docs.append({
        "id": "fs-different-id",
        "org_id": "org-1",
        "source": "bulk_import",
        "template_id": "tpl-daily",
        "template_name_snapshot": "Daily Pre-Start",   # wrong
        "template_category_snapshot": "pre_start",     # wrong
        "fields": [{"label": "old", "type": "text", "value": "v"}],
        "metadata": {"pdf_hash": "dup-hash",
                     "src_filename": "old.pdf"},
        "deleted_at": None,
    })
    db.bulk_import_pdf_cache.docs.append({
        "org_id": "org-1", "pdf_hash": "dup-hash",
        "extracted": {"date": "2026-01-01"},
        "classifier": {"template_name": "SSRA", "confidence": 0.4},
    })
    import db as db_mod
    monkeypatch.setattr(db_mod, "db", db, raising=False)
    monkeypatch.setattr(reextract, "_load_roster_and_templates",
                        _fake_roster_loader(db))

    summary = await reextract.run(_args(dry_run=False))
    assert summary["failures"] == 0
    assert summary["actions"]["migrate"] == 1

    # existing FS updated in place (still under the DIFFERENT id)
    fs = db.form_submissions.docs[0]
    assert fs["id"] == "fs-different-id"
    assert fs["template_name_snapshot"] == \
        "Construction & Excavation SSRA"
    assert fs["template_category_snapshot"] == "hazard"
    # metadata.needs_review + reextract_reason applied via $set on
    # dotted paths — our fake shim writes them as top-level dotted
    # keys, so just assert the "needs_review" marker landed
    assert fs.get("metadata.needs_review") is True or \
        (fs.get("metadata") or {}).get("needs_review") is True

    # pre_starts row soft-deleted
    ps = db.pre_starts.docs[0]
    assert ps["deleted_at"] is not None
    assert ps["reextract_target_form_submission_id"] == "fs-different-id"


# ─── runner (commit) tests ───────────────────────────────────────────

@pytest.mark.asyncio
async def test_commit_migrates_ssra_and_soft_deletes(monkeypatch, db):
    row = _mk_row(
        "rec-abc",
        "Imported: A.zip::Viatec Traffic Solutions - SSRA "
        "(1) - 20260101010101.pdf",
    )
    db.pre_starts.docs.append(row)
    db.bulk_import_pdf_cache.docs.append({
        "org_id": "org-1", "pdf_hash": "h-1",
        "extracted": {"date": "2026-01-01", "worker_name": "J Doe",
                      "checklist": {"Item A": "Yes"}},
        "classifier": {"template_name": "Daily Pre-Start", "confidence": 0.4},
    })
    import db as db_mod
    monkeypatch.setattr(db_mod, "db", db, raising=False)
    monkeypatch.setattr(reextract, "_load_roster_and_templates",
                        _fake_roster_loader(db))

    summary = await reextract.run(_args(dry_run=False))
    assert summary["actions"]["migrate"] == 1
    assert summary["failures"] == 0

    # form_submissions row inserted with same id
    fs = db.form_submissions.docs[0]
    assert fs["id"] == "rec-abc"
    assert fs["template_name_snapshot"] == "Viatec Traffic Solutions - SSRA"
    assert fs["template_category_snapshot"] == "hazard"
    assert fs["metadata"]["needs_review"] is True
    assert fs["metadata"]["reextract_reason"] == \
        "v58_13_35_partial_cache_only"
    assert fs["metadata"]["reextract_source_pre_starts_id"] == "rec-abc"
    # positional fields[] carries the extractor payload
    labels = {f["label"] for f in fs["fields"]}
    assert "date" in labels
    assert "Item A" in labels  # checklist unpacked

    # pre_starts row soft-deleted (deleted_at set), NOT hard-deleted
    ps = db.pre_starts.docs[0]
    assert ps["id"] == "rec-abc"
    assert ps["deleted_at"] is not None
    assert ps["template_name_snapshot"] == "Viatec Traffic Solutions - SSRA"
    assert ps["reextract_target_collection"] == "form_submissions"


@pytest.mark.asyncio
async def test_commit_update_in_place_for_prestart(monkeypatch, db):
    row = _mk_row(
        "rec-daily",
        "Imported: A.zip::Daily Pre-Start (2) - 20260101010101.pdf",
    )
    db.pre_starts.docs.append(row)
    import db as db_mod
    monkeypatch.setattr(db_mod, "db", db, raising=False)
    monkeypatch.setattr(reextract, "_load_roster_and_templates",
                        _fake_roster_loader(db))
    summary = await reextract.run(_args(dry_run=False))
    assert summary["actions"]["update_in_place"] == 1
    ps = db.pre_starts.docs[0]
    assert ps["template_name_snapshot"] == "Daily Pre-Start"
    assert ps["template_category_snapshot"] == "pre_start"
    assert ps["deleted_at"] is None  # NOT soft-deleted
    assert len(db.form_submissions.docs) == 0  # no migration


@pytest.mark.asyncio
async def test_failure_isolation(monkeypatch, db):
    good = _mk_row("good", "Imported: A.zip::Daily Pre-Start "
                           "(1) - 20260101010101.pdf")
    bad = _mk_row("bad", "Imported: A.zip::Daily Pre-Start "
                          "(2) - 20260101010101.pdf")
    db.pre_starts.docs.extend([good, bad])
    import db as db_mod
    monkeypatch.setattr(db_mod, "db", db, raising=False)
    monkeypatch.setattr(reextract, "_load_roster_and_templates",
                        _fake_roster_loader(db))

    # Sabotage update_one for the 'bad' record only.
    orig_update = db.pre_starts.update_one

    async def _sabotage(filt, update):
        if filt.get("id") == "bad":
            raise RuntimeError("boom")
        return await orig_update(filt, update)

    db.pre_starts.update_one = _sabotage  # type: ignore[assignment]

    summary = await reextract.run(_args(dry_run=False))
    assert summary["failures"] == 1
    assert summary["processed"] == 2  # both attempted


@pytest.mark.asyncio
async def test_cost_cap_enforced(monkeypatch, db):
    """Force outcome cost > cap and confirm the run halts."""
    db.pre_starts.docs.extend([
        _mk_row("r1", "Imported: A.zip::Daily Pre-Start "
                     "(1) - 20260101010101.pdf"),
        _mk_row("r2", "Imported: A.zip::Daily Pre-Start "
                     "(2) - 20260101010101.pdf"),
    ])
    import db as db_mod
    monkeypatch.setattr(db_mod, "db", db, raising=False)
    monkeypatch.setattr(reextract, "_load_roster_and_templates",
                        _fake_roster_loader(db))
    monkeypatch.setattr(reextract, "COST_CAP_USD", 0.01)

    async def _fake_commit(_db, row, plan, cache_doc):
        return {"record_id": row["id"], "action": plan["action"],
                "status": "ok", "writes": 1, "cost_usd": 1.0}

    monkeypatch.setattr(reextract, "_cache_derived_commit", _fake_commit)
    summary = await reextract.run(_args(dry_run=False))
    assert summary.get("cost_cap_tripped") is True
    assert summary["processed"] < 2  # halted early


@pytest.mark.asyncio
async def test_idempotency_second_commit_is_noop(monkeypatch, db):
    """After one --commit pass, a second pass sees zero
    misclassified records (base filter no longer matches them)."""
    row = _mk_row(
        "rec-abc",
        "Imported: A.zip::Viatec Traffic Solutions - SSRA "
        "(1) - 20260101010101.pdf",
    )
    db.pre_starts.docs.append(row)
    db.bulk_import_pdf_cache.docs.append({
        "org_id": "org-1", "pdf_hash": "h-1",
        "extracted": {"date": "2026-01-01"},
        "classifier": {"template_name": "SSRA", "confidence": 0.4},
    })
    import db as db_mod
    monkeypatch.setattr(db_mod, "db", db, raising=False)
    monkeypatch.setattr(reextract, "_load_roster_and_templates",
                        _fake_roster_loader(db))

    s1 = await reextract.run(_args(dry_run=False))
    s2 = await reextract.run(_args(dry_run=False))
    assert s1["actions"]["migrate"] == 1
    # Second pass: no matches remain (soft-deleted + snapshot stamped
    # means BASE_FILTER's template_name_snapshot=None no longer hits).
    assert s2["total_in_scope"] == 0
    assert s2["processed"] == 0
    assert s2["actions"]["migrate"] == 0


# ─── scope / limit tests ─────────────────────────────────────────────

@pytest.mark.asyncio
async def test_scope_ssra_filters_pool(monkeypatch, db):
    db.pre_starts.docs.extend([
        _mk_row("s1", "Imported: A.zip::Construction & Excavation - SSRA "
                     "(1) - 20260101010101.pdf"),
        _mk_row("s2", "Imported: A.zip::Daily Pre-Start "
                     "(2) - 20260101010101.pdf"),
    ])
    import db as db_mod
    monkeypatch.setattr(db_mod, "db", db, raising=False)
    monkeypatch.setattr(reextract, "_load_roster_and_templates",
                        _fake_roster_loader(db))
    summary = await reextract.run(_args(dry_run=True, scope="ssra"))
    assert summary["total_in_scope"] == 1
    assert summary["processed"] == 1


@pytest.mark.asyncio
async def test_limit_caps_processed(monkeypatch, db):
    for i in range(10):
        db.pre_starts.docs.append(_mk_row(
            f"r{i}",
            f"Imported: A.zip::Daily Pre-Start ({i}) - 20260101010101.pdf",
        ))
    import db as db_mod
    monkeypatch.setattr(db_mod, "db", db, raising=False)
    monkeypatch.setattr(reextract, "_load_roster_and_templates",
                        _fake_roster_loader(db))
    summary = await reextract.run(_args(dry_run=True, limit=3))
    assert summary["total_in_scope"] == 10
    assert summary["processed"] == 3


# ─── version-sync ────────────────────────────────────────────────────

def test_version_sync_current():
    import re
    running = Path("/app/frontend/src/lib/version.js").read_text(encoding="utf-8")
    sw = Path("/app/frontend/public/service-worker.js").read_text(encoding="utf-8")
    mobile = Path("/app/mobile/src/lib/version.ts").read_text(encoding="utf-8")
    m = re.search(r"export const RUNNING_VERSION = '(paneltec-v[\d.]+)'",
                  running)
    assert m
    current = m.group(1)
    assert current.endswith("58.13.35"), f"expected 58.13.35, got {current}"
    assert f"'{current}'" in sw
    assert f"'{current}'" in mobile
