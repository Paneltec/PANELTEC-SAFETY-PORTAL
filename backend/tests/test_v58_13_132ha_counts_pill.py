"""v58.13.132ha — Doc Library self-serve counts pill.

Locks in:
  · Backend `/api/document-library/counts` endpoint returns
    folders_active + folders_deleted + files_active + files_deleted
    + files_missing_binary.
  · Missing-binary probe uses `upload_storage.files` metadata.key
    join (matches the .132gh GridFS reader path).
  · Frontend CountsPill component mounted under the PageHeader,
    with testids for each metric.
  · Version-file lockstep to .132ha.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[2]
BACKEND = APP_ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

DOCLIB_PY = BACKEND / "document_library.py"
DOCLIB_JSX = APP_ROOT / "frontend" / "src" / "pages" / "DocumentLibrary.jsx"
VERSION_JS = APP_ROOT / "frontend" / "src" / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


# ─── Backend source pins ────────────────────────────────────────

def test_counts_endpoint_defined():
    src = _read(DOCLIB_PY)
    m = re.search(
        r'@router\.get\("/counts"\).*?return \{',
        src, re.DOTALL,
    )
    assert m, "/counts handler missing"


def test_counts_endpoint_returns_all_five_keys():
    src = _read(DOCLIB_PY)
    m = re.search(
        r'@router\.get\("/counts"\).*?\n\n\n',
        src, re.DOTALL,
    )
    assert m, "/counts handler block not delimited"
    body = m.group(0)
    for key in (
        '"folders_active"', '"folders_deleted"',
        '"files_active"', '"files_deleted"',
        '"files_missing_binary"',
    ):
        assert key in body, f"/counts response missing key {key}"


def test_counts_missing_binary_probes_upload_storage():
    src = _read(DOCLIB_PY)
    m = re.search(
        r'@router\.get\("/counts"\).*?\n\n\n',
        src, re.DOTALL,
    )
    assert m
    body = m.group(0)
    assert 'db["upload_storage.files"]' in body, \
        "/counts must query upload_storage.files for missing-binary probe"
    assert '"metadata.key"' in body, \
        "/counts must join on metadata.key"


def test_counts_uses_get_current_user_not_admin_only():
    src = _read(DOCLIB_PY)
    m = re.search(
        r'@router\.get\("/counts"\)\s*\nasync def library_counts\(([^)]+)\)',
        src,
    )
    assert m, "/counts signature not found"
    assert "get_current_user" in m.group(1), \
        "/counts must be accessible to any authenticated user (no admin gate)"


# ─── Frontend source pins ───────────────────────────────────────

def test_countspill_component_defined():
    src = _read(DOCLIB_JSX)
    assert re.search(r'^function CountsPill\(', src, re.M), \
        "CountsPill component missing"


def test_countspill_mounted_under_pageheader():
    src = _read(DOCLIB_JSX)
    # PageHeader block must be followed by <CountsPill />
    m = re.search(
        r'<PageHeader\b[^>]*?/>\s*\n\s*\n?\s*<CountsPill\s*/>',
        src, re.DOTALL,
    )
    assert m, "CountsPill must be mounted directly under PageHeader"


def test_countspill_fetches_counts_endpoint():
    src = _read(DOCLIB_JSX)
    assert "api.get('/document-library/counts')" in src, \
        "CountsPill must fetch /document-library/counts"


def test_countspill_testids_present():
    src = _read(DOCLIB_JSX)
    required = [
        'data-testid="doclib-counts-pill"',
        'data-testid="doclib-counts-folders"',
        'data-testid="doclib-counts-files"',
        'data-testid="doclib-counts-deleted"',
        'data-testid="doclib-counts-missing"',
    ]
    for tid in required:
        assert tid in src, f"Missing testid: {tid}"


def test_countspill_missing_binary_only_when_nonzero():
    src = _read(DOCLIB_JSX)
    # Missing-binary chip must be conditional on mB > 0 so a clean
    # library doesn't render an amber "0 missing binary" chip.
    assert re.search(r'mB\s*>\s*0\s*\?', src), \
        "Missing-binary chip must be gated on mB > 0"


# ─── Version lockstep ───────────────────────────────────────────

def test_version_lockstep_pinned_at_132ha():
    running = re.search(
        r"RUNNING_VERSION\s*=\s*'paneltec-v160\.3\.9\.58\.13\.132h([a-z])'",
        _read(VERSION_JS),
    )
    expected = re.search(
        r"EXPECTED_CACHE_VERSION\s*=\s*'paneltec-v160\.3\.9\.58\.13\.132h([a-z])'",
        _read(VERSION_JS),
    )
    cache = re.search(
        r"CACHE_VERSION\s*=\s*'paneltec-v160\.3\.9\.58\.13\.132h([a-z])'",
        _read(SW),
    )
    for m, label in ((running, "RUNNING_VERSION"),
                     (expected, "EXPECTED_CACHE_VERSION"),
                     (cache, "CACHE_VERSION")):
        assert m, f"{label} not pinned to .132h?"
        assert m.group(1) >= "a", f"{label} must be >= .132ha (got .132h{m.group(1)})"
