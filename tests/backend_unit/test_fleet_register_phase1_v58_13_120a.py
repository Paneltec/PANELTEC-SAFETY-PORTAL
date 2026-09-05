"""v58.13.120a — Fleet & Service Register: Phase 1 preconditions.

Locks the Phase 1 contract:
  · `AssetKind` Literal registers `"trailer"` as a fifth first-class
    kind alongside vehicle/plant/tool/container.
  · `AssetPhoto` model + `POST/GET/DELETE /assets/{id}/photos*`
    endpoints exist. Bytes are GridFS-backed (mirrors
    `workers.py::upload_worker_photo`) so this ship adds ZERO to
    the deferred `ephemeral-upload-storage` warning list.
  · `POST /assets/labels/bulk` accepts either `asset_ids` OR
    `source` selector, so printing every asset from a backfill run
    is a single API call.
  · Purge script and backfill script both exist with the
    forward+reverse contract nailed in .118's pattern.
  · Live DB shape post-Phase 1: 130 assets, 100% pm rows linked.
"""
from __future__ import annotations
import re
from pathlib import Path

import pytest


ASSETS_PY = Path("/app/backend/assets.py").read_text()
PURGE = Path("/app/backend/scripts/purge_test_v58_13_14_leftovers_v58_13_120a.py").read_text()
BACKFILL = Path("/app/backend/scripts/backfill_maintenance_regos_v58_13_120.py").read_text()


# ── AssetKind enum ─────────────────────────────────────────────────
def test_asset_kind_gains_trailer():
    assert 'AssetKind = Literal["vehicle", "plant", "tool", "container", "trailer"]' in ASSETS_PY
    assert 'v58.13.120a — Add "trailer" as a fifth first-class kind' in ASSETS_PY


# ── AssetPhoto model + endpoints ───────────────────────────────────
def test_asset_photo_model_present():
    assert 'class AssetPhoto(BaseModel):' in ASSETS_PY
    for f in ('id: str', 'filename: str', 'mime: str', 'size: int',
              'photo_url: str', 'photo_gridfs_id: str',
              'uploaded_at: str', 'uploaded_by: Optional[str]'):
        assert f in ASSETS_PY, f"AssetPhoto missing field: {f}"


def test_asset_photo_endpoints_present():
    assert '@router.post("/{asset_id}/photos")' in ASSETS_PY
    assert '@router.get("/{asset_id}/photo/{gridfs_id}")' in ASSETS_PY
    assert '@router.delete("/{asset_id}/photos/{photo_id}")' in ASSETS_PY
    # 10 MB cap per image.
    assert '_MAX_PHOTO_BYTES = 10 * 1024 * 1024' in ASSETS_PY
    # Cross-tenant guard.
    assert 'Cross-tenant access denied' in ASSETS_PY


def test_asset_photo_uses_gridfs_not_local_disk():
    """Endpoint uses GridFS, not ephemeral local-disk storage."""
    assert 'AsyncIOMotorGridFSBucket' in ASSETS_PY
    assert 'fs.upload_from_stream' in ASSETS_PY
    # No temp-file writers in the endpoint bodies (comments allowed).
    non_comment_lines = [
        line for line in ASSETS_PY.splitlines()
        if not line.lstrip().startswith('#')
    ]
    for line in non_comment_lines:
        assert '/tmp/uploads' not in line
        assert 'tempfile.NamedTemporary' not in line


# ── Print-Labels source selector ───────────────────────────────────
def test_bulk_labels_accepts_source():
    assert 'source: Optional[str] = Field(default=None, max_length=80)' in ASSETS_PY
    assert 'asset_ids: Optional[list[str]] = Field(default=None' in ASSETS_PY
    assert 'if body.source:' in ASSETS_PY
    # The label-set resolves via a source query on the assets collection.
    assert 'db.assets.find(q, {"_id": 0, "id": 1})' in ASSETS_PY
    # Empty result still 422s cleanly.
    assert 'asset_ids or source is required' in ASSETS_PY


# ── Purge script ───────────────────────────────────────────────────
def test_purge_script_shape():
    # Broadened prefix so both TEST-v58.13.14- and TEST-v58.13.16-
    # (and any future .13.NN- burst) are caught.
    assert r'^TEST-v58\.13\.\d+-\d+' in PURGE
    assert 'kind": "plant"' in PURGE
    assert 'status": "retired"' in PURGE
    # Time-window guard.
    assert '"2026-09-04T12:00:00"' in PURGE
    assert '"2026-09-04T13:00:00"' in PURGE
    # Default is dry-run. --commit required.
    assert 'action="store_true"' in PURGE
    assert 'DRY-RUN (read-only)' in PURGE
    # Cascade check for foreign refs — commit refused if unexpected deps.
    assert 'commit refused due to unexpected dependencies' in PURGE
    # Deletion log for hand-restore.
    assert '/app/memory/purge_v58_13_120a_log.txt' in PURGE


# ── Backfill script ────────────────────────────────────────────────
def test_backfill_kind_map_locked():
    """User-approved (Q1/Q2) sub_type → kind mapping."""
    assert '"trailer": "trailer"' in BACKFILL
    assert '"vac truck": "vehicle"' in BACKFILL
    assert '"commercial": "vehicle"' in BACKFILL
    assert '"passenger": "vehicle"' in BACKFILL
    assert '"excavator": "plant"' in BACKFILL
    assert '"telehandler": "plant"' in BACKFILL
    assert '"directional drill": "plant"' in BACKFILL
    assert '"road roller": "plant"' in BACKFILL
    assert '"tma": "plant"' in BACKFILL
    assert 'DEFAULT_KIND = "vehicle"' in BACKFILL


def test_backfill_default_org_paneltec():
    """Q3: null-org pm rows default to the Paneltec org."""
    assert '{"name": {"$regex": "paneltec", "$options": "i"}}' in BACKFILL


def test_backfill_carries_source_and_run_id():
    assert 'BACKFILL_SOURCE = "maintenance_backfill_v58_13_120"' in BACKFILL
    # Every backfilled asset carries an audit-scoped run_id.
    assert '"backfill_run_id": run_id' in BACKFILL
    assert '"backfill_run_id"' in BACKFILL
    # And a fresh scan_token so QR sheets can be printed.
    assert 'secrets.token_urlsafe(12)' in BACKFILL


def test_backfill_forward_and_reverse_flags():
    assert '--commit' in BACKFILL
    assert '--rollback' in BACKFILL
    # Reverse enumerates run_ids first, then unlinks pm, then deletes assets.
    assert 'async def rollback(db)' in BACKFILL
    assert 'backfill_run_id' in BACKFILL
    # PM re-link stamp.
    assert '"backfill_relink_v58_13_120": True' in BACKFILL


def test_backfill_dry_run_is_default():
    assert 'mode = "LIVE COMMIT" if commit else "DRY-RUN (read-only)"' in BACKFILL
    assert 'DRY-RUN complete' in BACKFILL


# ── Post-commit DB shape (live-DB pin — Phase 1 baseline) ───────────
@pytest.mark.asyncio
async def test_live_db_post_phase_1_shape():
    import os
    os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
    os.environ.setdefault("DB_NAME", "test_database")
    from motor.motor_asyncio import AsyncIOMotorClient
    c = AsyncIOMotorClient(os.environ["MONGO_URL"])
    d = c[os.environ["DB_NAME"]]
    try:
        # 130 total = 76 pre-backfill + 54 backfill
        # (10 TEST purged before backfill: 86 → 76 → 130).
        assets_total = await d.assets.count_documents({})
        assert assets_total >= 130, f"assets_total={assets_total} < 130"

        # Every pm row linked post-backfill.
        pm_total = await d.plant_maintenance.count_documents({})
        pm_linked = await d.plant_maintenance.count_documents(
            {"plant_id": {"$ne": None}})
        assert pm_linked == pm_total, (
            f"pm_linked={pm_linked} != pm_total={pm_total} — backfill "
            f"missed rows"
        )

        # No TEST-v58.13.14 / .16 leftovers from the 2026-09-04T12:32
        # burst that Phase 1 purged remain. Other test files re-seed
        # TEST-* rows during their fixture setup with fresh
        # timestamps; those are fine and not our target set.
        n_test = await d.assets.count_documents(
            {"name": {"$regex": r"^TEST-v58\.13\.(14|16)-1788525", "$options": "i"},
             "kind": "plant", "status": "retired"})
        assert n_test == 0, f"purge left {n_test} Phase-1 TEST rows behind"

        # 54 backfilled assets exist, all with the audit tag.
        n_backfill = await d.assets.count_documents(
            {"source": "maintenance_backfill_v58_13_120"})
        assert n_backfill == 54, f"expected 54 backfill rows, got {n_backfill}"

        # And the trailer kind is in use.
        # v58.13.126 — Ratchet ≥20 (getgas reclassify moved 1 asset
        # vehicle→trailer, so live count is now 21). The historic
        # Phase-1 baseline was 20; new admin reclassifications
        # increment above that.
        n_trailers = await d.assets.count_documents({"kind": "trailer"})
        assert n_trailers >= 20, f"expected ≥20 trailers, got {n_trailers}"
    finally:
        c.close()


# ── Version bump forward-safe pin ─────────────────────────────────
_TAIL_RE = re.compile(r"paneltec-v[\d.]+\.58\.13\.(\d+)([a-z]?)")


def test_version_bumps_meet_120a():
    for label, path in (
        ("frontend/version.js", "/app/frontend/src/lib/version.js"),
        ("service-worker.js", "/app/frontend/public/service-worker.js"),
        ("mobile/version.ts", "/app/mobile/src/lib/version.ts"),
    ):
        blob = Path(path).read_text()
        tails = [(int(m.group(1)), m.group(2))
                 for m in _TAIL_RE.finditer(blob)]
        assert tails, f"{label} has no version tail"
        highest = max(tails)
        # >= (120, "a") — either .120a exact or a later ship.
        assert highest >= (120, "a"), f"{label} latest tail={highest} < (120, 'a')"
