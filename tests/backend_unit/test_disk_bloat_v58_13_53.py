"""v58.13.53 — Disk-bloat hardening.

Two guarantees this test file pins:
  1. `_sweep_orphan_gridfs_blobs` exists in `backup_service.py`,
     is wired into `_apply_retention_policy`, AND is called on
     backend startup. This closes the 405-MB orphan-chunks leak
     that caused the failed production deploy on 2026-08-26.
  2. `scripts/emergency_disk_cleanup_v58_13_53.py` exists, is
     importable, exposes `main`, `_prune_iso_string_ts`,
     `_prune_failed_pdfs`, and refuses to touch the known-running
     bulk-import job id.

Static source-code + import checks. No live-DB dependency — the
migration script already gates every write behind an
`--dry-run` and a `write_check` probe.
"""
from __future__ import annotations

import importlib
import re
import sys
from pathlib import Path


_BACKEND = Path("/app/backend")
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))


def _read(rel: str) -> str:
    return (_BACKEND / rel).read_text(encoding="utf-8")


# ── 1. Root-cause fix inside backup_service.py ──────────────────────


def test_sweep_orphan_gridfs_blobs_helper_exists():
    src = _read("backup_service.py")
    assert "async def _sweep_orphan_gridfs_blobs" in src, (
        "helper `_sweep_orphan_gridfs_blobs` missing — v58.13.53 "
        "regression: orphan-GridFS chunks will accumulate again"
    )
    # Fail-safe: never sweep when metadata is empty (would delete
    # every backup on a freshly-provisioned cluster).
    block = src.split(
        "async def _sweep_orphan_gridfs_blobs", 1,
    )[1].split("\n\n\n", 1)[0]
    assert "if not valid:" in block or "if not valid " in block, (
        "orphan sweep must fail-safe when bk_snapshots is empty"
    )
    assert "return (0, 0)" in block or "return 0, 0" in block, (
        "empty-metadata branch must short-circuit before deletion"
    )


def test_retention_policy_now_sweeps_orphans_inline():
    src = _read("backup_service.py")
    retention = src.split(
        "async def _apply_retention_policy", 1,
    )[1].split("\n\n\n", 1)[0]
    assert "_sweep_orphan_gridfs_blobs" in retention, (
        "_apply_retention_policy must invoke the orphan sweep so "
        "every retention run mops up chunks even if metadata "
        "deletion succeeded but the paired GridFS delete failed"
    )
    assert "last_run_orphans_swept" in retention, (
        "retention run stamp must record orphans_swept count"
    )


def test_startup_boot_hook_runs_orphan_sweep():
    src = _read("backup_service.py")
    assert "_v58_13_53_orphan_gridfs_sweep" in src, (
        "boot-time defensive sweep hook is missing — a deploy "
        "inheriting a bloated DB must self-heal on first boot"
    )
    hook = src.split("_v58_13_53_orphan_gridfs_sweep", 1)[1].split("\n\n", 2)[0]
    assert "_sweep_orphan_gridfs_blobs" in hook, (
        "boot-time hook must call the sweep helper"
    )
    assert "except" in hook, (
        "boot-time hook must be try/except-guarded — a transient "
        "DB glitch must NEVER block backend boot"
    )


# ── 2. Emergency migration script ───────────────────────────────────


def test_emergency_cleanup_script_is_importable():
    mod = importlib.import_module(
        "scripts.emergency_disk_cleanup_v58_13_53",
    )
    for fn in ("main", "_sweep_orphan_bk_fs", "_prune_iso_string_ts",
               "_prune_failed_pdfs", "_compact_after"):
        assert hasattr(mod, fn), f"{fn} missing from cleanup script"
    # Retention windows sane.
    assert mod.PDF_CACHE_TTL_DAYS >= 7
    assert mod.DRYRUN_TTL_DAYS >= 7
    assert mod.REEXTRACT_AUDIT_TTL_DAYS >= 30
    assert mod.FAILED_PDF_TTL_DAYS >= 7


def test_emergency_cleanup_never_prunes_running_bulk_import_job():
    src = _read("scripts/emergency_disk_cleanup_v58_13_53.py")
    assert "KNOWN_RUNNING_JOB_ID" in src
    assert '"14433131-29a9-4fa8-9d7e-af18f86145cf"' in src, (
        "running bulk-import job id must be protected in the "
        "cleanup script — pruning its failed_pdfs blobs would "
        "break the resume path"
    )
    prune = src.split("async def _prune_failed_pdfs", 1)[1].split(
        "\n\n\n", 1,
    )[0]
    # The protected set must include the running job AND anything
    # currently in state=processing/queued.
    assert "protected" in prune
    assert "state" in prune, (
        "protected set must include bulk_import_jobs.state filter"
    )
    assert "processing" in prune


def test_emergency_cleanup_uses_iso_string_lex_compare_correctly():
    """ISO 8601 with a stable timezone offset sorts
    lexicographically for year-first date shapes. This test guards
    the cutoff format so a future refactor doesn't accidentally
    switch to a numeric epoch which would silently prune EVERYTHING.
    """
    src = _read("scripts/emergency_disk_cleanup_v58_13_53.py")
    assert re.search(
        r"def\s+_iso_cutoff\(days:\s*int\)\s*->\s*str",
        src,
    ), "cutoff helper must return a string (ISO)"
    assert "datetime.now(timezone.utc)" in src
    assert "isoformat()" in src


# ── 3. Version-sync pin ──────────────────────────────────────────────
# Forward-safe pattern — see v58.13.51 recurrence note.


def test_version_sync_moved_past_v58_13_52():
    v_js = Path("/app/frontend/src/lib/version.js").read_text(encoding="utf-8")
    m_ts = Path("/app/mobile/src/lib/version.ts").read_text(encoding="utf-8")
    sw_js = Path("/app/frontend/public/service-worker.js").read_text(encoding="utf-8")
    assert "RUNNING_VERSION = 'paneltec-v160.3.9.58.13.52'" not in v_js
    assert "'paneltec-v160.3.9.58.13.52'" not in m_ts
    assert "'paneltec-v160.3.9.58.13.52'" not in sw_js
    assert "v160.3.9.58.13.53" in v_js, (
        "v58.13.53 changelog block missing from version.js"
    )
