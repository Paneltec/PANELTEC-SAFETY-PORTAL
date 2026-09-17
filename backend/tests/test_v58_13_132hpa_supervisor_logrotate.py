"""v58.13.132hpa — Supervisor log rotation + test_reports archive.

Post-`.132hp` housekeeping shipment:

  1. Supervisor stdout/stderr rotation. During `.132hp` compile
     churn `backend.err.log` was measured growing at ~2 MB/h with
     no rotation policy in place. `.132hma` shipped an
     `/etc/logrotate.d/paneltec-disk-hygiene` config for the
     purge script's own log but never installed the `logrotate`
     package OR extended coverage to supervisor. `.132hpa` fixes
     both — installs `logrotate` (3.21.0-1) and drops
     `/etc/logrotate.d/paneltec-supervisor-logs` covering the
     seven supervisor streams (backend, frontend, mobile err/out
     + supervisord itself) with `size 10M`, daily, rotate 7,
     compress + delaycompress, copytruncate.

  2. Archived 33 historical `test_reports/iteration_*.json`
     files (June-August) to `memory/archive/test_reports/`.
     Frees the working directory without deleting the artefacts.
"""
from __future__ import annotations

import re
import shutil
from pathlib import Path

import pytest

APP_ROOT = Path(__file__).resolve().parents[2]

SUP_LOGROTATE = Path("/etc/logrotate.d/paneltec-supervisor-logs")
SUP_LOGROTATE_REF = APP_ROOT / "scripts" / "paneltec-supervisor-logs.logrotate.reference"
DH_LOGROTATE = Path("/etc/logrotate.d/paneltec-disk-hygiene")
ARCHIVE_DIR = APP_ROOT / "memory" / "archive" / "test_reports"
VJS = APP_ROOT / "frontend" / "src" / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


# ─────────────── logrotate binary + configs ───────────────


def test_logrotate_binary_installed():
    assert shutil.which("logrotate"), (
        "logrotate binary must be installed for /etc/logrotate.d/* to "
        "actually rotate. `.132hma` shipped the config file but not "
        "the binary — `.132hpa` corrects both."
    )


def test_supervisor_logrotate_config_present():
    assert SUP_LOGROTATE.is_file(), "supervisor logrotate config missing"
    body = _read(SUP_LOGROTATE)
    # Covers all 7 supervisor log streams.
    for stream in (
        "/var/log/supervisor/backend.err.log",
        "/var/log/supervisor/backend.out.log",
        "/var/log/supervisor/frontend.err.log",
        "/var/log/supervisor/frontend.out.log",
        "/var/log/supervisor/mobile.err.log",
        "/var/log/supervisor/mobile.out.log",
        "/var/log/supervisor/supervisord.log",
    ):
        assert stream in body, f"logrotate config missing stream: {stream}"
    # Policy pins — matches .132hma disk-hygiene shape.
    assert "daily" in body
    assert re.search(r"^\s*rotate 7\b", body, re.M)
    assert "compress" in body
    assert "copytruncate" in body
    assert re.search(r"^\s*size 10M\b", body, re.M)


def test_supervisor_logrotate_reference_mirror():
    """The /etc/** file isn't tracked by git — the .reference copy
    under scripts/ is. Guard that they match content-for-content."""
    assert SUP_LOGROTATE_REF.is_file(), "reference mirror missing"
    assert _read(SUP_LOGROTATE_REF) == _read(SUP_LOGROTATE), (
        "reference mirror drifted from live config"
    )


def test_disk_hygiene_logrotate_still_valid():
    """Regression pin — .132hma's config must still parse now that
    the binary is actually installed."""
    assert DH_LOGROTATE.is_file()
    body = _read(DH_LOGROTATE)
    assert "/var/log/paneltec-disk-hygiene.log" in body


# ─────────────── test_reports archive ───────────────


def test_iteration_reports_archived():
    """Old iteration_*.json reports moved out of /app/test_reports/
    into the archive folder. The pytest/ subdir stays for XML runs
    that are still useful."""
    live = APP_ROOT / "test_reports"
    live_iter = list(live.glob("iteration_*.json"))
    assert not live_iter, (
        f"Expected 0 iteration_*.json in live test_reports, "
        f"found {len(live_iter)}"
    )
    assert ARCHIVE_DIR.is_dir(), "archive dir missing"
    archived = list(ARCHIVE_DIR.glob("iteration_*.json"))
    assert len(archived) >= 30, (
        f"Expected 30+ archived reports, found {len(archived)}"
    )


# ─────────────── Version lockstep ───────────────


def test_version_bumped_to_132hpa():
    js, sw = _read(VJS), _read(SW)
    assert re.search(
        r"RUNNING_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132hpa'", js
    )
    assert re.search(
        r"EXPECTED_CACHE_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132hpa'", js
    )
    assert re.search(r"CACHE_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132hpa'", sw)
