"""v58.13.71 — DB prune code fix + retention hardening.

Static source-pins for the two writer repoints (workers.py +
simpro_zip_import.py) and the new `_sweep_ephemeral_collections`
helper in backup_service.py. Also enforces the version-sync
invariant across the 3 canonical files.

No live Mongo required — every check is a source read + regex/
substring match. Runs under pytest as a standalone file.
"""
from __future__ import annotations

from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent.parent / "backend"
FRONTEND = Path(__file__).resolve().parent.parent.parent / "frontend"
MOBILE = Path(__file__).resolve().parent.parent.parent / "mobile"

WORKERS_PY = (BACKEND / "workers.py").read_text(encoding="utf-8")
SIMPRO_PY = (BACKEND / "simpro_zip_import.py").read_text(encoding="utf-8")
BACKUP_PY = (BACKEND / "backup_service.py").read_text(encoding="utf-8")
VERSION_JS = (FRONTEND / "src" / "lib" / "version.js").read_text(encoding="utf-8")
SW_JS = (FRONTEND / "public" / "service-worker.js").read_text(encoding="utf-8")
MOBILE_TS = (MOBILE / "src" / "lib" / "version.ts").read_text(encoding="utf-8")


# ─────────────────────────────────────────────────────────────
# Step 1a — workers.py writer repointed to `fs`
# ─────────────────────────────────────────────────────────────
def test_workers_fs_bucket_repointed_to_fs():
    """`workers.py::_fs_bucket()` must return `bucket_name="fs"`,
    not `bk_fs`. The 8 existing worker photos on preview live in
    `fs` and post-ship uploads must land there too."""
    # Extract the body of _fs_bucket() — everything up to the next
    # def or top-level marker.
    marker = "def _fs_bucket() -> AsyncIOMotorGridFSBucket:"
    assert marker in WORKERS_PY, "workers.py: _fs_bucket() helper missing"
    body_start = WORKERS_PY.index(marker)
    body = WORKERS_PY[body_start:body_start + 800]
    assert 'bucket_name="fs"' in body, (
        "workers.py: _fs_bucket() must return bucket_name=\"fs\" "
        f"(v58.13.71 repoint). Body was:\n{body}"
    )
    assert 'bucket_name="bk_fs"' not in body, (
        "workers.py: _fs_bucket() still points at bk_fs — the "
        "v58.13.71 repoint was reverted."
    )


# ─────────────────────────────────────────────────────────────
# Step 1b — simpro_zip_import.py writer repointed to `fs`
# ─────────────────────────────────────────────────────────────
def test_simpro_zip_fs_bucket_repointed_to_fs():
    """`simpro_zip_import.py::_fs_bucket()` writes real user content
    (worker photos, HR documents, cert PDFs) and MUST target the
    primary `fs` bucket."""
    marker = "def _fs_bucket() -> AsyncIOMotorGridFSBucket:"
    assert marker in SIMPRO_PY, "simpro_zip_import.py: _fs_bucket() helper missing"
    body_start = SIMPRO_PY.index(marker)
    body = SIMPRO_PY[body_start:body_start + 800]
    assert 'bucket_name="fs"' in body, (
        "simpro_zip_import.py: _fs_bucket() must return bucket_name=\"fs\" "
        f"(v58.13.71 repoint). Body was:\n{body}"
    )
    assert 'bucket_name="bk_fs"' not in body, (
        "simpro_zip_import.py: _fs_bucket() still points at bk_fs — the "
        "v58.13.71 repoint was reverted."
    )


# ─────────────────────────────────────────────────────────────
# Step 1c — extended retention sweep helper exists + wired up
# ─────────────────────────────────────────────────────────────
def test_sweep_ephemeral_collections_helper_exists():
    assert "async def _sweep_ephemeral_collections(" in BACKUP_PY, (
        "backup_service.py: expected new v58.13.71 helper "
        "`_sweep_ephemeral_collections` not found."
    )


def test_ttl_constants_carry_intended_values():
    assert "_FAILED_PDF_TTL_DAYS = 30" in BACKUP_PY, (
        "backup_service.py: expected _FAILED_PDF_TTL_DAYS = 30"
    )
    assert "_DRYRUN_TTL_DAYS = 30" in BACKUP_PY, (
        "backup_service.py: expected _DRYRUN_TTL_DAYS = 30"
    )
    assert "_BK_SNAPSHOT_HARD_CAP_DAYS = 90" in BACKUP_PY, (
        "backup_service.py: expected _BK_SNAPSHOT_HARD_CAP_DAYS = 90"
    )


def test_retention_policy_invokes_ephemeral_sweep():
    """`_apply_retention_policy` must invoke the new helper AFTER
    the existing orphan sweep so the two counters are stamped
    together on the same retention run."""
    apply_marker = "async def _apply_retention_policy(db_, fs_)"
    apply_idx = BACKUP_PY.index(apply_marker)
    # Grab a generous chunk — 3 KB — of the function body.
    body = BACKUP_PY[apply_idx:apply_idx + 3000]
    orphan_call = body.find("_sweep_orphan_gridfs_blobs(db_, fs_)")
    ephemeral_call = body.find("_sweep_ephemeral_collections(db_, fs_)")
    assert orphan_call >= 0, (
        "_apply_retention_policy: orphan sweep call missing"
    )
    assert ephemeral_call >= 0, (
        "_apply_retention_policy: v58.13.71 ephemeral sweep call missing"
    )
    assert ephemeral_call > orphan_call, (
        "Ordering invariant violated: ephemeral sweep must run "
        "AFTER the orphan sweep so the two counter maps stamp "
        "the same retention run atomically."
    )
    assert '"last_run_ephemeral"' in body, (
        "app_state.backup_retention.last_run_ephemeral counter "
        "must be stamped so operators can see what the sweep did."
    )


def test_bk_snapshot_hard_cap_retains_newest():
    """Fail-safe invariant — even at the hard cap, the newest
    snapshot must always survive so a boot-fresh cluster can't
    lose its only backup."""
    # Look for the invariant comment + the guard block.
    assert "newest_id = sorted_snaps[0]" in BACKUP_PY, (
        "bk_snapshot hard-cap branch must compute newest_id and "
        "skip it during the delete loop."
    )
    assert 'if s["id"] == newest_id:' in BACKUP_PY, (
        "bk_snapshot hard-cap loop must skip the newest snapshot."
    )
    assert "never drop the most recent" in BACKUP_PY, (
        "Fail-safe comment removed — a maintainer must not be able "
        "to silently delete the invariant without also removing the "
        "explanatory comment."
    )


def test_failed_pdfs_prune_protects_running_job():
    """The known running bulk-import job id must be in the
    protected set so its GridFS blobs never get pruned."""
    assert (
        '_KNOWN_RUNNING_BULK_IMPORT_JOB_ID = '
        '"14433131-29a9-4fa8-9d7e-af18f86145cf"'
    ) in BACKUP_PY, (
        "backup_service.py: expected protected running-job id "
        "constant to be present."
    )
    assert "protected: set = {_KNOWN_RUNNING_BULK_IMPORT_JOB_ID}" in BACKUP_PY, (
        "failed_pdfs prune branch must seed its protected set with "
        "the known running job id before enumerating queued/processing jobs."
    )


# ─────────────────────────────────────────────────────────────
# Version sync — the 3 canonical files must all be v58.13.71.
# Forward-safe: allow future bumps > .71 to pass by permitting
# any .71+ tail so this test doesn't self-invalidate.
# ─────────────────────────────────────────────────────────────
def _extract_version_tail(text: str, needle: str) -> int:
    """Return N from a `paneltec-v160.3.9.58.13.N` string preceded
    by `needle` in the file. Fails the test with a clear message
    if not found."""
    import re
    m = re.search(
        needle + r"\s*=\s*['\"]paneltec-v160\.3\.9\.58\.13\.(\d+)['\"]",
        text,
    )
    assert m, f"{needle}: version literal not found in file"
    return int(m.group(1))


def test_running_version_bumped_to_at_least_71():
    n = _extract_version_tail(VERSION_JS, "RUNNING_VERSION")
    assert n >= 71, f"RUNNING_VERSION tail must be >= 71 (got {n})"


def test_cache_version_bumped_to_at_least_71():
    n = _extract_version_tail(SW_JS, "CACHE_VERSION")
    assert n >= 71, f"CACHE_VERSION tail must be >= 71 (got {n})"


def test_mobile_bundle_version_bumped_to_at_least_71():
    n = _extract_version_tail(MOBILE_TS, "MOBILE_BUNDLE_VERSION")
    assert n >= 71, f"MOBILE_BUNDLE_VERSION tail must be >= 71 (got {n})"
