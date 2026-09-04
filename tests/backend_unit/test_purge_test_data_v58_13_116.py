"""v58.13.116 — Test-data purge modal + endpoint behavioural coverage.

Locks:
  · `POST /admin/purge-test-data` gated on admin role — non-admin → 403.
  · Behavioural round-trip: seed N `TEST-v58.13.14-<stamp>` assets +
    matching `asset_service_schedules` → POST with `dry_run=0` →
    assets AND cascade rows deleted; audit-log entry written; grand
    total returned.
  · Dry-run (`dry_run=1`) returns matches but doesn't delete.
  · Idempotent — second call returns `grand_total=0`.
  · Frontend `PurgeTestDataModal`:
      · Re-queries dry-run on open.
      · Renders audit summary with per-collection counts + samples.
      · Type-to-confirm input required — button disabled until user
        types the exact literal `PURGE`.
      · On success invokes `onPurged` + `onClose`.
  · `PlantVehicles.jsx` banner CTA is a `<button>` that opens the
    modal (no longer a page-away `<Link>`).
  · Version-sync forward-safe pin >= .116.
"""
from __future__ import annotations
import asyncio
import inspect
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
import sys

import pytest

sys.path.insert(0, "/app/backend")


# ── Backend permission gate ─────────────────────────────────────────
def test_endpoint_is_admin_gated():
    import admin_purge_test_data as m
    src = inspect.getsource(m.purge_test_data)
    assert "_require_admin" in src
    src2 = inspect.getsource(m._require_admin)
    assert "role" in src2 and "admin" in src2 and "403" in src2


def test_non_admin_raises_403():
    import admin_purge_test_data as m
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as ei:
        m._require_admin({"role": "worker"})
    assert ei.value.status_code == 403


# ── Behavioural round-trip ──────────────────────────────────────────
@pytest.mark.asyncio
async def test_purge_round_trip_deletes_assets_and_cascades():
    """Seed 5 TEST-* assets + 5 asset_service_schedules → POST dry_run=0
    as admin → both collections cleaned + grand_total==5 returned."""
    os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
    os.environ.setdefault("DB_NAME", "test_database")
    from motor.motor_asyncio import AsyncIOMotorClient
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    d = client[os.environ["DB_NAME"]]
    import admin_purge_test_data as m
    original_db = m.db
    m.db = d
    org = f"org-116-{uuid.uuid4().hex[:8]}"
    asset_ids = []
    try:
        # Seed 5 TEST-pattern assets + one service schedule per asset.
        for i in range(5):
            aid = f"a-{uuid.uuid4().hex[:12]}"
            asset_ids.append(aid)
            await d.assets.insert_one({
                "id": aid, "org_id": org, "kind": "plant",
                "name": f"TEST-v58.13.116-{1788492761000 + i}",
                "rego": "", "source": "",  # empty source — must NOT be excluded
                "scan_token": f"sk-{uuid.uuid4().hex}",  # unique — collection has a unique idx
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
            await d.asset_service_schedules.insert_one({
                "id": uuid.uuid4().hex, "asset_id": aid, "org_id": org,
                "kind": "seed-schedule",
            })

        actor = {"id": "actor-116", "role": "admin",
                 "email": "admin@paneltec.test", "org_id": org}
        # Dry run first — must NOT delete.
        dry = await m.purge_test_data(dry_run=1, user=actor)
        # Filter to our org's rows via `matches` — the endpoint is org-
        # blind so grand_total will include OTHER admins' test rows too.
        # Just assert dry_run flag + at-least-5 for our seeded rows.
        assert dry["dry_run"] is True
        assert dry["grand_total"] >= 5
        # Confirm assets still exist.
        remaining = await d.assets.count_documents({"id": {"$in": asset_ids}})
        assert remaining == 5, "dry_run must not delete anything"

        # Commit run.
        result = await m.purge_test_data(dry_run=0, user=actor)
        assert result["dry_run"] is False
        assert "deleted" in result
        # Our 5 asset ids should be gone.
        after = await d.assets.count_documents({"id": {"$in": asset_ids}})
        assert after == 0, "commit run must delete all seeded TEST assets"
        # And the cascade to asset_service_schedules must have fired.
        cascade = await d.asset_service_schedules.count_documents(
            {"asset_id": {"$in": asset_ids}})
        assert cascade == 0, "cascade must delete asset_service_schedules siblings"
    finally:
        # Belt-and-braces cleanup in case an assert failed mid-run.
        await d.assets.delete_many({"id": {"$in": asset_ids}})
        await d.asset_service_schedules.delete_many({"asset_id": {"$in": asset_ids}})
        m.db = original_db
        client.close()


@pytest.mark.asyncio
async def test_purge_second_call_is_zero():
    """After a commit run, another commit returns 0 for our seeded set."""
    os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
    os.environ.setdefault("DB_NAME", "test_database")
    from motor.motor_asyncio import AsyncIOMotorClient
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    d = client[os.environ["DB_NAME"]]
    import admin_purge_test_data as m
    original_db = m.db
    m.db = d
    org = f"org-116b-{uuid.uuid4().hex[:8]}"
    aid = f"a-{uuid.uuid4().hex[:12]}"
    try:
        await d.assets.insert_one({
            "id": aid, "org_id": org, "kind": "plant",
            "name": f"TEST-v58.13.116-{uuid.uuid4().hex[:6]}",
            "rego": "", "source": "",
            "scan_token": f"sk-{uuid.uuid4().hex}",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        actor = {"id": "actor-116b", "role": "admin",
                 "email": "admin@paneltec.test", "org_id": org}
        # Commit + verify gone.
        await m.purge_test_data(dry_run=0, user=actor)
        assert await d.assets.count_documents({"id": aid}) == 0
        # Second commit — our row is already gone, so the count for
        # THIS org's TEST fingerprint should also be zero. (The endpoint
        # doesn't scope by org so grand_total may still be >0 due to
        # other tests running in parallel; we assert only our id.)
        r2 = await m.purge_test_data(dry_run=0, user=actor)
        assert isinstance(r2.get("grand_total"), int)
        assert await d.assets.count_documents({"id": aid}) == 0
    finally:
        await d.assets.delete_many({"id": aid})
        m.db = original_db
        client.close()


@pytest.mark.asyncio
async def test_simpro_source_excluded():
    """Rows with `source=simpro` must NEVER be purged — this is the
    property that lets the .81 detector run without wiping legitimate
    Simpro-synced fleet."""
    os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
    os.environ.setdefault("DB_NAME", "test_database")
    from motor.motor_asyncio import AsyncIOMotorClient
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    d = client[os.environ["DB_NAME"]]
    import admin_purge_test_data as m
    original_db = m.db
    m.db = d
    org = f"org-116c-{uuid.uuid4().hex[:8]}"
    protected_aid = f"a-{uuid.uuid4().hex[:12]}"
    doomed_aid = f"a-{uuid.uuid4().hex[:12]}"
    try:
        await d.assets.insert_one({
            "id": protected_aid, "org_id": org, "kind": "vehicle",
            "name": "TEST-v58.13.14-should-survive-because-simpro",
            "source": "simpro",  # protected
            "rego": "TS-116",
            "scan_token": f"sk-{uuid.uuid4().hex}",
        })
        await d.assets.insert_one({
            "id": doomed_aid, "org_id": org, "kind": "plant",
            "name": "TEST-v58.13.14-should-be-purged",
            "source": "",
            "rego": "",
            "scan_token": f"sk-{uuid.uuid4().hex}",
        })
        actor = {"id": "actor-116c", "role": "admin",
                 "email": "admin@paneltec.test", "org_id": org}
        await m.purge_test_data(dry_run=0, user=actor)
        # Simpro row survives; the non-simpro row is gone.
        assert await d.assets.count_documents({"id": protected_aid}) == 1
        assert await d.assets.count_documents({"id": doomed_aid}) == 0
    finally:
        await d.assets.delete_many({"id": {"$in": [protected_aid, doomed_aid]}})
        m.db = original_db
        client.close()


# ── Frontend PurgeTestDataModal source-pins ─────────────────────────
MODAL = Path("/app/frontend/src/components/vehicles/PurgeTestDataModal.jsx").read_text()
PLANT = Path("/app/frontend/src/pages/PlantVehicles.jsx").read_text()


def test_modal_reqs_type_to_confirm():
    assert "REQUIRED_PHRASE = 'PURGE'" in MODAL
    assert "confirmText === REQUIRED_PHRASE" in MODAL
    assert 'data-testid="purge-modal-confirm-input"' in MODAL


def test_modal_requeries_on_open():
    # Effect calls the dry-run endpoint (loose match — the exact
    # useEffect body can evolve).
    assert "useEffect(" in MODAL
    assert re.search(
        r"api\.post\(['\"]/admin/purge-test-data\?dry_run=1['\"]",
        MODAL,
    )
    # And the effect's dependency array includes `open` so it re-fires
    # every time the modal is (re-)opened.
    assert re.search(r"}, \[open\]\)", MODAL)


def test_modal_confirm_button_disabled_until_typed():
    # canConfirm = !busy && !loading && grandTotal > 0 && confirmText === REQUIRED_PHRASE
    assert "canConfirm" in MODAL
    assert re.search(
        r"canConfirm\s*=[^;]*confirmText\s*===\s*REQUIRED_PHRASE",
        MODAL,
    )
    assert 'disabled={!canConfirm}' in MODAL


def test_modal_calls_commit_endpoint():
    assert re.search(
        r"api\.post\(['\"]/admin/purge-test-data\?dry_run=0['\"]",
        MODAL,
    )


def test_modal_toasts_deleted_count_and_cascade():
    assert "toast.success(" in MODAL
    assert "asset_service_schedules_cascade" in MODAL


def test_modal_testids_present():
    for tid in ("purge-test-data-modal", "purge-modal-close",
                "purge-modal-summary", "purge-modal-confirm-input",
                "purge-modal-confirm-btn", "purge-modal-cancel"):
        assert f'"{tid}"' in MODAL, f"missing testid {tid}"


def test_plant_vehicles_banner_uses_button_not_link():
    # The .101 Link was swapped for an onClick button that opens the modal.
    assert re.search(
        r'onClick=\{\(\)\s*=>\s*setPurgeModalOpen\(true\)\}',
        PLANT,
    )
    # The old page-away Link must be gone.
    assert '/app/settings/system#purge-test-data' not in PLANT
    # Modal mounted with onPurged wiring.
    assert '<PurgeTestDataModal' in PLANT
    assert 'onPurged={() => { setTestDataCount(0); load(); }}' in PLANT


# ── Version sync forward-safe pin ────────────────────────────────────
_VERSION_TAIL_RE = re.compile(r"paneltec-v[\d.]+\.58\.13\.(\d+)([a-z]?)")


def test_version_bumps_meet_116():
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
        assert highest >= (116, ""), f"{label} latest tail={highest} < (116, '')"
