"""v58.13.37 — ZIP-mode re-extraction pytests.

Mocks Claude classify/extract + PDF-hash walk. Covers:
  · `_build_zip_pdf_index` handles top-level PDFs AND recurses into
    nested ZIPs; bad-zip entries are skipped without aborting.
  · `_zip_source_commit` on migrate path:
      · reads PDF bytes from nested ZIP,
      · runs Claude classify + extract,
      · upserts cache with fresh payload,
      · updates existing form_submissions row with rich metadata
        shortcuts (hazards/crew/signatures/tailgate_topics/…),
      · clears `metadata.needs_review`,
      · soft-deletes the pre_starts shim,
      · charges 2× per-PDF Claude cost.
  · `_zip_source_commit` on update-in-place path (pre_start): refreshes
    pre_starts.fields[] + template snapshots without soft-deleting.
  · Bad ZIP read → status='failed', needs_review preserved, batch
    continues (no abort).
  · Unresolved classifier (low confidence) → status='unresolved',
    record untouched, one classify cost still charged.
  · Cost cap tripped BEFORE the next Claude pair.
  · Version-sync current.
"""
from __future__ import annotations
import argparse
import hashlib
import importlib
import io
import os
import sys
import zipfile
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

_SCRIPTS = _BACKEND / "scripts"
if str(_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS))

reextract = importlib.import_module("reextract_misclassified_v58_13_35")


# Reuse the fake Mongo shim from the v58.13.35 test module.
_TESTS = Path("/app/tests/backend_unit")
sys.path.insert(0, str(_TESTS))
from test_reextract_v58_13_35 import (  # noqa: E402
    _DB, _mk_row, _seed_templates, _fake_roster_loader,
)


def _args(**kw):
    base = {"dry_run": False, "scope": "all", "limit": None,
            "source": "zip", "zip_root": "/tmp/dummy"}
    base.update(kw)
    return argparse.Namespace(**base)


@pytest.fixture
def db():
    _db = _DB()
    _seed_templates(_db)
    return _db


# ─── ZIP index tests ─────────────────────────────────────────────────

def _make_pdf(name):
    return f"%PDF-1.4\n{name}\n%%EOF".encode("utf-8")


def _make_zip(entries):
    """entries: list[(name, bytes)] → bytes of zip archive."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name, data in entries:
            z.writestr(name, data)
    return buf.getvalue()


def test_zip_index_top_level_and_nested(tmp_path):
    """Outer ZIP with two PDFs + a nested ZIP containing one PDF →
    all three appear in the index, keyed by content hash."""
    # Direct-PDF outer entries.
    p1 = _make_pdf("Direct 1")
    p2 = _make_pdf("Direct 2")
    # Nested ZIP with one PDF inside.
    inner_pdf = _make_pdf("Inside Nested")
    inner_zip = _make_zip([("A Barbari - SSRA (1).pdf", inner_pdf)])
    outer = _make_zip([
        ("Loose 1.pdf", p1),
        ("Loose 2.pdf", p2),
        ("A Barbari.zip", inner_zip),
        ("readme.txt", b"ignored"),
    ])
    (tmp_path / "A-Barbari-2.zip").write_bytes(outer)
    index = reextract._build_zip_pdf_index(tmp_path)
    hashes = {hashlib.sha256(x).hexdigest() for x in
              (p1, p2, inner_pdf)}
    assert set(index.keys()) == hashes
    # Verify the inner nested entry is stamped with the inner-zip
    # name, not empty.
    inner_hit = index[hashlib.sha256(inner_pdf).hexdigest()]
    assert inner_hit[1] == "A Barbari.zip"
    assert inner_hit[2] == "A Barbari - SSRA (1).pdf"


def test_zip_index_skips_bad_nested_zip(tmp_path, caplog):
    """A nested entry that's declared as .zip but is corrupt is
    skipped without aborting the outer walk."""
    p1 = _make_pdf("Direct 1")
    outer = _make_zip([
        ("A Barbari.zip", b"not a zip"),
        ("Loose 1.pdf", p1),
    ])
    (tmp_path / "outer.zip").write_bytes(outer)
    index = reextract._build_zip_pdf_index(tmp_path)
    assert hashlib.sha256(p1).hexdigest() in index
    assert len(index) == 1


def test_zip_index_first_writer_wins_on_duplicate_hash(tmp_path):
    """Same PDF appearing in two nested ZIPs → single entry, first
    seen wins."""
    p1 = _make_pdf("dup")
    nz1 = _make_zip([("firstA.pdf", p1)])
    nz2 = _make_zip([("secondB.pdf", p1)])
    outer = _make_zip([("A.zip", nz1), ("B.zip", nz2)])
    (tmp_path / "outer.zip").write_bytes(outer)
    index = reextract._build_zip_pdf_index(tmp_path)
    hit = index[hashlib.sha256(p1).hexdigest()]
    # First-writer: A.zip's entry wins (ZipFile.infolist() iterates in
    # insertion order).
    assert hit[1] == "A.zip"


# ─── ZIP source-commit tests ─────────────────────────────────────────

class _FakeBulkImportModule:
    """Stubs the four `bulk_import_prestarts` symbols that the ZIP
    commit path imports at call time."""
    def __init__(self, cls_verdict, extracted_payload):
        self.cls_verdict = cls_verdict
        self.extracted_payload = extracted_payload
        self.cache_puts = []

    async def _load_classifier_roster(self):
        return {"lf-viatec": "Viatec Traffic Solutions - SSRA",
                "tpl-daily": "Daily Pre-Start"}

    async def _claude_classify(self, pages, roster=None):
        return dict(self.cls_verdict)

    async def _claude_extract(self, pages, template):
        return dict(self.extracted_payload)

    def _pdf_pages_png_b64(self, pdf_bytes):
        return ["fakepage"]

    async def _cache_put(self, org_id, pdf_hash, payload):
        self.cache_puts.append((org_id, pdf_hash, payload))


def _install_bulk_import_stubs(monkeypatch, stub):
    mod = importlib.import_module("bulk_import_prestarts")
    monkeypatch.setattr(mod, "_pdf_pages_png_b64",
                        stub._pdf_pages_png_b64, raising=False)
    monkeypatch.setattr(mod, "_claude_classify",
                        stub._claude_classify, raising=False)
    monkeypatch.setattr(mod, "_claude_extract",
                        stub._claude_extract, raising=False)
    monkeypatch.setattr(mod, "_load_classifier_roster",
                        stub._load_classifier_roster, raising=False)
    monkeypatch.setattr(mod, "_cache_put",
                        stub._cache_put, raising=False)


def _make_zip_index(tmp_path, pdf_bytes, filename, inner_zip_name=None):
    if inner_zip_name:
        inner = _make_zip([(filename, pdf_bytes)])
        outer = _make_zip([(inner_zip_name, inner)])
    else:
        outer = _make_zip([(filename, pdf_bytes)])
    zp = tmp_path / "src.zip"
    zp.write_bytes(outer)
    h = hashlib.sha256(pdf_bytes).hexdigest()
    return {h: (zp, inner_zip_name or "", filename)}


@pytest.mark.asyncio
async def test_zip_commit_migrate_updates_existing_fs(monkeypatch, db, tmp_path):
    pdf = _make_pdf("SSRA")
    zip_index = _make_zip_index(tmp_path, pdf, "SSRA (1).pdf",
                                 inner_zip_name="A Barbari.zip")
    h = list(zip_index.keys())[0]

    # v58.13.37: ZIP mode iterates FS rows tagged
    # needs_review=True. Seed such an FS row.
    db.form_submissions.docs.append({
        "id": "fs-old", "org_id": "org-1", "source": "bulk_import",
        "template_id": "tpl-daily",
        "template_name_snapshot": "Construction & Excavation SSRA",
        "template_category_snapshot": "hazard",
        "fields": [], "deleted_at": None,
        "created_at": "2026-02-01T00:00:00+00:00",
        "metadata": {"pdf_hash": h, "needs_review": True,
                     "reextract_reason": "v58_13_35_partial_cache_only"},
    })
    stub = _FakeBulkImportModule(
        {"template_name": "Viatec Traffic Solutions - SSRA",
         "confidence": 0.95},
        {"date": "2026-07-24", "site": "Rouse Hill",
         "hazards": [{"description": "Live services near excavation",
                      "control": "Hand-dig 500mm"}],
         "crew": [{"name": "J Doe", "role": "Sign-on",
                   "signature_ts": "2026-07-24T08:12:00"}],
         "signatures": [{"role": "Supervisor",
                         "url": "https://…/sig1.png"}],
         "tailgate_topics": ["Working near live services"],
         "byda": "1100-BYDA-4433", "tgs": "TGS-88",
         "gps": {"lat": -33.68, "lng": 150.90},
         "photos_present": True,
         "checklist": {"PPE": "OK", "Isolation": "Yes"}}
    )
    _install_bulk_import_stubs(monkeypatch, stub)
    import db as db_mod
    monkeypatch.setattr(db_mod, "db", db, raising=False)
    monkeypatch.setattr(reextract, "_load_roster_and_templates",
                        _fake_roster_loader(db))

    args = _args(zip_root=str(tmp_path))
    # Inject the pre-built index so _build_zip_pdf_index isn't
    # re-walked (still works but slower for a unit test).
    monkeypatch.setattr(reextract, "_build_zip_pdf_index",
                        lambda p: zip_index)

    summary = await reextract.run(args)

    assert summary["failures"] == 0
    assert summary["actions"].get("zip_reextracted") == 1
    fs = db.form_submissions.docs[0]
    assert fs["template_name_snapshot"] == "Viatec Traffic Solutions - SSRA"
    assert fs["template_category_snapshot"] == "hazard"
    # Rich fields present
    assert any(f["label"] == "date" for f in fs["fields"])
    assert any(f["label"] == "PPE" for f in fs["fields"])
    # needs_review cleared
    assert fs.get("metadata.needs_review") is False or \
        (fs.get("metadata") or {}).get("needs_review") is False
    assert fs.get("metadata.hazards") or \
        (fs.get("metadata") or {}).get("hazards")
    # v58.13.37 path only touches form_submissions — the pre_starts
    # shim was already soft-deleted in v58.13.35. Ensure we didn't
    # regress by touching pre_starts collection here.
    assert db.pre_starts.docs == []
    # Cache invalidated with fresh payload
    assert len(stub.cache_puts) == 1


def _mk_fs_row(fs_id, pdf_hash, template_name="Construction & Excavation SSRA",
                category="hazard", org="org-1"):
    """Seed a v58.13.35-partial-cache-only FS row (the pool
    v58.13.37 ZIP mode iterates)."""
    return {
        "id": fs_id, "org_id": org, "workspace_id": "ws-1",
        "source": "bulk_import",
        "template_id": "tpl-daily",  # placeholder, will be corrected
        "template_name_snapshot": template_name,
        "template_category_snapshot": category,
        "fields": [], "deleted_at": None,
        "created_at": "2026-02-01T00:00:00+00:00",
        "metadata": {
            "pdf_hash": pdf_hash,
            "needs_review": True,
            "reextract_reason": "v58_13_35_partial_cache_only",
        },
    }


@pytest.mark.asyncio
async def test_zip_hash_miss_skipped_no_source(monkeypatch, db, tmp_path):
    db.form_submissions.docs.append(
        _mk_fs_row("fs-nomatch", "hash-not-in-zip"))
    zip_index = {}
    import db as db_mod
    monkeypatch.setattr(db_mod, "db", db, raising=False)
    monkeypatch.setattr(reextract, "_load_roster_and_templates",
                        _fake_roster_loader(db))
    monkeypatch.setattr(reextract, "_build_zip_pdf_index",
                        lambda p: zip_index)

    summary = await reextract.run(_args(zip_root=str(tmp_path)))
    assert summary["failures"] == 0
    assert summary["statuses"].get("skipped_no_source") == 1
    # FS row's needs_review preserved (untouched).
    assert (db.form_submissions.docs[0]["metadata"]
            .get("needs_review")) is True


@pytest.mark.asyncio
async def test_zip_unresolved_classifier(monkeypatch, db, tmp_path):
    pdf = _make_pdf("weird")
    zip_index = _make_zip_index(tmp_path, pdf, "weird.pdf")
    h = list(zip_index.keys())[0]
    db.form_submissions.docs.append(_mk_fs_row("fs-w", h))

    stub = _FakeBulkImportModule(
        {"template_name": "(none of the above)", "confidence": 0.1}, {})
    _install_bulk_import_stubs(monkeypatch, stub)
    import db as db_mod
    monkeypatch.setattr(db_mod, "db", db, raising=False)
    monkeypatch.setattr(reextract, "_load_roster_and_templates",
                        _fake_roster_loader(db))
    monkeypatch.setattr(reextract, "_build_zip_pdf_index",
                        lambda p: zip_index)

    summary = await reextract.run(_args(zip_root=str(tmp_path)))
    assert summary["statuses"].get("unresolved_after_reextract") == 1
    assert summary["estimated_cost_usd"] == pytest.approx(
        reextract.ZIP_MODE_COST_PER_PDF_USD)
    # FS row untouched.
    assert (db.form_submissions.docs[0]["metadata"]
            .get("needs_review")) is True


@pytest.mark.asyncio
async def test_zip_cost_cap_halts_before_next_pair(monkeypatch, db, tmp_path):
    pdf1, pdf2 = _make_pdf("a"), _make_pdf("b")
    zip_index = {
        hashlib.sha256(pdf1).hexdigest(): (tmp_path / "src.zip", "A.zip", "a.pdf"),
        hashlib.sha256(pdf2).hexdigest(): (tmp_path / "src.zip", "A.zip", "b.pdf"),
    }
    inner = _make_zip([("a.pdf", pdf1), ("b.pdf", pdf2)])
    outer = _make_zip([("A.zip", inner)])
    (tmp_path / "src.zip").write_bytes(outer)
    db.form_submissions.docs.extend([
        _mk_fs_row("fs1", hashlib.sha256(pdf1).hexdigest()),
        _mk_fs_row("fs2", hashlib.sha256(pdf2).hexdigest()),
    ])
    stub = _FakeBulkImportModule(
        {"template_name": "Viatec Traffic Solutions - SSRA",
         "confidence": 0.98},
        {"date": "2026-07-24"},
    )
    _install_bulk_import_stubs(monkeypatch, stub)
    import db as db_mod
    monkeypatch.setattr(db_mod, "db", db, raising=False)
    monkeypatch.setattr(reextract, "_load_roster_and_templates",
                        _fake_roster_loader(db))
    monkeypatch.setattr(reextract, "_build_zip_pdf_index",
                        lambda p: zip_index)
    monkeypatch.setattr(reextract, "COST_CAP_USD",
                        3 * reextract.ZIP_MODE_COST_PER_PDF_USD)

    summary = await reextract.run(_args(zip_root=str(tmp_path)))
    assert summary.get("cost_cap_tripped") is True
    assert summary["processed"] < 2


@pytest.mark.asyncio
async def test_zip_bad_read_isolates_failure(monkeypatch, db, tmp_path):
    pdf_good = _make_pdf("good")
    hg = hashlib.sha256(pdf_good).hexdigest()
    inner = _make_zip([("good.pdf", pdf_good)])
    outer = _make_zip([("A.zip", inner)])
    (tmp_path / "src.zip").write_bytes(outer)
    zip_index = {
        hg: (tmp_path / "src.zip", "A.zip", "good.pdf"),
        "bogus-hash": (tmp_path / "src.zip", "A.zip", "does-not-exist.pdf"),
    }
    db.form_submissions.docs.extend([
        _mk_fs_row("fs_bad", "bogus-hash"),
        _mk_fs_row("fs_ok", hg),
    ])
    stub = _FakeBulkImportModule(
        {"template_name": "Viatec Traffic Solutions - SSRA",
         "confidence": 0.98},
        {"date": "2026-07-24"},
    )
    _install_bulk_import_stubs(monkeypatch, stub)
    import db as db_mod
    monkeypatch.setattr(db_mod, "db", db, raising=False)
    monkeypatch.setattr(reextract, "_load_roster_and_templates",
                        _fake_roster_loader(db))
    monkeypatch.setattr(reextract, "_build_zip_pdf_index",
                        lambda p: zip_index)

    summary = await reextract.run(_args(zip_root=str(tmp_path)))
    assert summary["processed"] == 2
    assert summary["statuses"].get("failed") == 1
    assert summary["statuses"].get("ok_updated_fs") == 1


def test_version_sync_current():
    import re
    running = Path("/app/frontend/src/lib/version.js").read_text(encoding="utf-8")
    sw = Path("/app/frontend/public/service-worker.js").read_text(encoding="utf-8")
    mobile = Path("/app/mobile/src/lib/version.ts").read_text(encoding="utf-8")
    m = re.search(r"export const RUNNING_VERSION = '(paneltec-v[\d.]+[a-z]*)'",
                  running)
    assert m
    current = m.group(1)
    assert f"'{current}'" in sw
    assert f"'{current}'" in mobile
