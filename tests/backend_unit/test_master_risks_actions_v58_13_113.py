"""v58.13.113 — Master Risks Copy / Print / Edit regression tests.

Locks:
  · `PATCH /master-risks/{risk_uid}` gated by
    `require_permission("reference_library", "edit")`.
  · `MasterRiskPatch` accepts every field on the row and writes ONLY
    the fields the caller supplied (`exclude_unset=True`).
  · Audit-log entry written to `master_risks_audit` on every
    successful patch with action `manual-update`, actor id, and the
    list of updated field keys.
  · Empty patch → 400 `no-fields`.
  · Non-existent risk → 404 `not-found`.
  · Frontend Copy/Print/Edit buttons live inside the expanded card
    with the expected testids; Edit is gated on `canWrite`
    (reference_library.edit). Clipboard write uses ClipboardItem
    with a plain-text + HTML pair.
  · `@media print` CSS block exists and hides `body > *` while
    revealing `.risk-print-root`.
  · Version-sync forward-safe pin >= .113.
"""
from __future__ import annotations
import asyncio
import inspect
import os
import re
import uuid
from pathlib import Path
import sys

import pytest

sys.path.insert(0, "/app/backend")


# ── Backend endpoint contract ────────────────────────────────────────
def test_patch_endpoint_registered():
    import master_risks
    paths = {r.path for r in master_risks.router.routes}
    assert "/master-risks/{risk_uid}" in paths, (
        f"PATCH /master-risks/{{risk_uid}} missing; saw {paths}"
    )
    # Confirm the PATCH verb specifically is attached to that path.
    methods = {
        m for r in master_risks.router.routes if r.path == "/master-risks/{risk_uid}"
        for m in getattr(r, "methods", set())
    }
    assert "PATCH" in methods


def test_patch_endpoint_permission_gated():
    import master_risks
    src = inspect.getsource(master_risks.patch_master_risk)
    # Must be gated by `require_permission("reference_library", "edit")`.
    assert 'require_permission("reference_library"' in src
    assert '"edit"' in src


def test_patch_endpoint_writes_audit_log_source_pin():
    import master_risks
    src = inspect.getsource(master_risks.patch_master_risk)
    assert "master_risks_audit" in src
    assert '"manual-update"' in src
    assert "actor_id" in src
    assert '"fields"' in src


def test_patch_schema_accepts_every_field():
    from master_risks import MasterRiskPatch
    fields = set(MasterRiskPatch.model_fields.keys())
    expected = {
        "classification", "activity", "hazard_aspect", "unwanted_event",
        "risk_score_uncontrolled", "risk_score_controlled",
        "mandatory_controls", "other_controls", "legal_references",
        "swms_reference", "severity", "fill_hex", "fill_hex_controlled",
    }
    missing = expected - fields
    assert not missing, f"MasterRiskPatch missing fields: {missing}"


# ── Behavioural: real Mongo round-trip (fresh motor client per loop) ─
@pytest.mark.asyncio
async def test_patch_writes_updates_and_audit(monkeypatch):
    os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
    os.environ.setdefault("DB_NAME", "paneltec_civil")
    from motor.motor_asyncio import AsyncIOMotorClient
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    d = client[os.environ["DB_NAME"]]
    rid = f"test-113-{uuid.uuid4().hex[:8]}"
    uid = str(uuid.uuid4())
    now = "2026-02-15T00:00:00+00:00"
    seed = {
        "id": uid, "risk_id": rid,
        "classification": "General", "activity": "Test activity",
        "hazard_aspect": "orig hazard", "unwanted_event": "orig unwanted",
        "mandatory_controls": "line 1\nline 2",
        "other_controls": "orig other",
        "legal_references": "orig legal",
        "risk_score_uncontrolled": "E-18", "risk_score_controlled": "M-9",
        "severity": "extreme",
        "created_at": now, "updated_at": now,
        "deleted_at": None,
    }
    try:
        await d.master_risks.insert_one(seed)

        # Simulate a permission-passed request by calling the coroutine
        # directly with a mock `user` dict. Monkey-patch the module's
        # `db` binding to our fresh client so the patch reads/writes
        # against the same connection we seeded on.
        import master_risks
        original_db = master_risks.db
        master_risks.db = d
        actor = {"id": "actor-113", "role": "admin", "org_id": "org-x"}
        patch = master_risks.MasterRiskPatch(
            hazard_aspect="updated hazard",
            mandatory_controls="new bullet 1\nnew bullet 2\nnew bullet 3",
        )
        try:
            out = await master_risks.patch_master_risk(uid, patch, user=actor)
        finally:
            master_risks.db = original_db
        assert out["hazard_aspect"] == "updated hazard"
        assert out["mandatory_controls"].startswith("new bullet 1")
        # untouched fields preserved
        assert out["unwanted_event"] == "orig unwanted"
        assert out["updated_at"] != now  # bumped

        # Audit entry written with the exact field list + actor id.
        audit = await d.master_risks_audit.find_one({"risk_id": rid,
                                                     "action": "manual-update"})
        assert audit is not None
        assert audit["actor_id"] == "actor-113"
        assert set(audit["fields"]) == {"hazard_aspect", "mandatory_controls", "updated_at"}
    finally:
        await d.master_risks.delete_many({"risk_id": rid})
        await d.master_risks_audit.delete_many({"risk_id": rid})
        client.close()


@pytest.mark.asyncio
async def test_patch_rejects_empty_body(monkeypatch):
    import master_risks
    from fastapi import HTTPException
    actor = {"id": "actor-113", "role": "admin", "org_id": "org-x"}
    with pytest.raises(HTTPException) as ei:
        await master_risks.patch_master_risk(
            "bogus-id",
            master_risks.MasterRiskPatch(),  # zero fields
            user=actor,
        )
    assert ei.value.status_code == 400
    assert ei.value.detail == "no-fields"


@pytest.mark.asyncio
async def test_patch_404_on_missing():
    # Use a fresh motor client so we don't touch the module-level `db`
    # (whose event loop closes between the round-trip test above and
    # this one — RuntimeError: Event loop is closed).
    os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
    os.environ.setdefault("DB_NAME", "paneltec_civil")
    from motor.motor_asyncio import AsyncIOMotorClient
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    d = client[os.environ["DB_NAME"]]
    import master_risks
    from fastapi import HTTPException
    # Monkey-patch the module `db` to point at our fresh client for this
    # test scope only.
    original_db = master_risks.db
    master_risks.db = d
    try:
        actor = {"id": "actor-113", "role": "admin", "org_id": "org-x"}
        with pytest.raises(HTTPException) as ei:
            await master_risks.patch_master_risk(
                f"nonexistent-{uuid.uuid4().hex}",
                master_risks.MasterRiskPatch(hazard_aspect="x"),
                user=actor,
            )
        assert ei.value.status_code == 404
    finally:
        master_risks.db = original_db
        client.close()


# ── Frontend source-pins ────────────────────────────────────────────
JSX = Path("/app/frontend/src/pages/MasterRisksTab.jsx").read_text()
CSS = Path("/app/frontend/src/index.css").read_text()
HOOK = Path("/app/frontend/src/components/riskAssessments/useCrudModal.jsx").read_text()


def test_frontend_copy_button_wired():
    assert re.search(r'data-testid=\{`master-risks-detail-copy-\$\{row\.risk_id\}`\}', JSX)
    # Prefers ClipboardItem for dual-format write.
    assert "ClipboardItem" in JSX
    assert "text/html" in JSX
    assert "text/plain" in JSX


def test_frontend_print_button_wired():
    assert re.search(r'data-testid=\{`master-risks-detail-print-\$\{row\.risk_id\}`\}', JSX)
    assert "window.print()" in JSX
    assert "afterprint" in JSX


def test_frontend_edit_button_gated_on_canedit():
    assert re.search(r'data-testid=\{`master-risks-detail-edit-\$\{row\.risk_id\}`\}', JSX)
    # Edit renders only when canEdit is truthy inside DetailPanel.
    assert re.search(r"\{canEdit\s*&&\s*\(\s*<button", JSX, re.DOTALL)
    # canEdit is fed from `canWrite` (reference_library.edit).
    assert re.search(r"canEdit=\{canWrite\}", JSX)


def test_frontend_toast_on_copy_success():
    assert re.search(r"toast\.success\(`Risk #\$\{row\.risk_id\} copied to clipboard`", JSX)


def test_usecrudmodal_exposes_openedit():
    assert "openEdit" in HOOK
    assert "setEditRow(row)" in HOOK


def test_print_css_hides_shell_and_shows_card():
    assert "@media print" in CSS
    assert ".risk-print-root" in CSS
    assert "body > *" in CSS
    assert "visibility: hidden" in CSS
    # @page A4 portrait declared.
    assert "size: A4" in CSS and "portrait" in CSS


# ── Version sync forward-safe pin ────────────────────────────────────
_VERSION_TAIL_RE = re.compile(r"paneltec-v[\d.]+\.58\.13\.(\d+)([a-z]?)")


def test_version_bumps_meet_113():
    for label, path in (
        ("frontend/version.js", "/app/frontend/src/lib/version.js"),
        ("service-worker.js", "/app/frontend/public/service-worker.js"),
        ("mobile/version.ts", "/app/mobile/src/lib/version.ts"),
    ):
        blob = Path(path).read_text()
        tails = [(int(m.group(1)), m.group(2))
                 for m in _VERSION_TAIL_RE.finditer(blob)]
        assert tails, f"{label} has no version tail"
        highest = max(tails)
        assert highest >= (113, ""), f"{label} latest tail={highest} < (113, '')"
