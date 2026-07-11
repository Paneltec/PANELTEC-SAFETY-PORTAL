"""v160.3.0-apply — Verify the cert-mapping application ran correctly
and remains idempotent on re-run.

Contracts under test
--------------------
1. Every row from `/app/memory/v160_3_0_cert_mapping_proposal.md`
   that resolves to a live template with a NON-EMPTY slug list has
   those exact slugs on the template document. Order preserved.
2. Rows with `_(none)_` in the proposal have `required_certifications = []`.
3. Rows marked as test artefacts (`v160.3.0 gated *`) are NOT
   gated (skipped by the migration).
4. Snapshot collection `form_templates_backup_v160_3_0_apply`
   exists and holds >= 1 row.
5. Re-running the migration reports `applied_count == 0` — no drift.
"""
from __future__ import annotations

import asyncio
import os
import re
import sys

import pytest
from dotenv import load_dotenv


load_dotenv("/app/backend/.env")
sys.path.insert(0, "/app/backend")


def _db():
    from pymongo import MongoClient
    return MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


PROPOSAL = "/app/memory/v160_3_0_cert_mapping_proposal.md"
_ROW = re.compile(r"^\|\s*(?P<name>[^|]+?)\s*\|\s*`(?P<cat>[^`]*)`\s*\|\s*(?P<slugs>[^|]+?)\s*\|")
_SLUG = re.compile(r"`([a-z_]+)`")


def _rows():
    with open(PROPOSAL) as f:
        md = f.read()
    started = False
    for ln in md.splitlines():
        if ln.startswith("|----"):
            started = True; continue
        if not started:
            continue
        m = _ROW.match(ln)
        if not m:
            break
        name = m.group("name").strip()
        cell = m.group("slugs").strip()
        slugs = _SLUG.findall(cell) if "_(none)_" not in cell else []
        is_test_artefact = name.startswith("v160.3.0 gated ")
        yield {"name": name, "slugs": slugs, "is_test_artefact": is_test_artefact}


def test_snapshot_written():
    db = _db()
    n = db["form_templates_backup_v160_3_0_apply"].estimated_document_count()
    assert n > 0, "snapshot must be populated by the apply migration"


def test_every_proposed_slug_is_persisted():
    """Every proposal row (bar test artefacts) whose slug list is
    non-empty must land on the live template. Order preserved."""
    db = _db()
    failures = []
    for r in _rows():
        if r["is_test_artefact"]:
            continue
        if not r["slugs"]:
            continue
        tpl = db.form_templates.find_one(
            {"name": r["name"], "deleted_at": None},
            {"_id": 0, "id": 1, "required_certifications": 1},
        )
        if not tpl:
            failures.append(f"{r['name']}: template not found")
            continue
        if list(tpl.get("required_certifications") or []) != r["slugs"]:
            failures.append(
                f"{r['name']}: expected {r['slugs']} got {tpl.get('required_certifications')}"
            )
    assert not failures, "\n".join(failures)


def test_none_rows_remain_ungated():
    db = _db()
    failures = []
    for r in _rows():
        if r["is_test_artefact"]:
            continue
        if r["slugs"]:
            continue
        tpl = db.form_templates.find_one(
            {"name": r["name"], "deleted_at": None},
            {"_id": 0, "id": 1, "required_certifications": 1},
        )
        if not tpl:
            continue  # not_found tracked in migration summary — not a bug here
        cur = tpl.get("required_certifications") or []
        if cur:
            failures.append(f"{r['name']}: expected [] got {cur}")
    assert not failures, "\n".join(failures)


def test_test_artefact_templates_are_not_gated():
    """Skip rule from the migration: rows named `v160.3.0 gated *` are
    fixture leftovers and must NOT get production gates applied."""
    db = _db()
    for t in db.form_templates.find(
        {"name": {"$regex": "^v160\\.3\\.0 gated "}, "deleted_at": None},
        {"_id": 0, "name": 1, "required_certifications": 1},
    ):
        assert (t.get("required_certifications") or []) == [], (
            f"test artefact {t['name']} got gated: {t.get('required_certifications')}"
        )


def test_apply_is_idempotent():
    """Second run of the migration must apply 0 rows — everything is
    already in sync with the proposal."""
    from scripts.migrate_v160_3_0_apply_cert_map import main
    summary = asyncio.run(main())
    assert summary["applied_count"] == 0, summary
    assert summary["not_found_count"] == 0, summary
