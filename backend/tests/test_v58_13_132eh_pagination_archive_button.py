"""v58.13.132eh — Pagination controls + ArchiveDialog button-enable fix.

Locks:
1. Backend list endpoints accept `?offset=` and return non-overlapping
   pages (verified on `/api/pre-starts`).
2. `PaginationBar` component: Load-more button, page-size selector,
   localStorage persistence.
3. All 7 CAPTURE list pages render the pager and pass a stable
   `onLoadMore` callback that increments offset.
4. `ArchiveDialog`: Preview + Archive buttons enable once ANY single
   valid criteria is set (was previously gated on completed Preview).
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path

import pytest
import requests

APP_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(APP_ROOT / "backend"))

FE = APP_ROOT / "frontend" / "src"
PAGES = FE / "pages"
PAGINATION_JSX = FE / "components" / "PaginationBar.jsx"
DIALOG_JSX = FE / "components" / "ArchiveDialog.jsx"
VERSION_JS = FE / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"

API = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


# ─── Backend ── list endpoints accept `?offset=` ───────────────
_TOKEN: dict = {"h": None}


def _admin_headers():
    if _TOKEN["h"] is not None:
        return _TOKEN["h"]
    r = requests.post(f"{API}/api/auth/login",
                      json={"email": "stephen@paneltec.com.au",
                            "password": "Mcgstephen50#"}, timeout=30)
    if r.status_code != 200:
        pytest.skip(f"admin login unavailable: {r.status_code}")
    t = r.json().get("access_token") or r.json().get("token")
    _TOKEN["h"] = {"Authorization": f"Bearer {t}"}
    return _TOKEN["h"]


def test_prestarts_offset_returns_non_overlapping_page():
    h = _admin_headers()
    p1 = requests.get(f"{API}/api/pre-starts",
                      params={"limit": 3, "offset": 0}, headers=h, timeout=30)
    p2 = requests.get(f"{API}/api/pre-starts",
                      params={"limit": 3, "offset": 3}, headers=h, timeout=30)
    assert p1.status_code == 200 and p2.status_code == 200
    ids1 = {d["id"] for d in p1.json()}
    ids2 = {d["id"] for d in p2.json()}
    assert len(ids1) == 3 and len(ids2) == 3
    assert ids1.isdisjoint(ids2), "offset=3 must skip the first 3 rows"


def test_prestarts_offset_past_page_cap():
    """The old code silently truncated at limit=5000. With offset,
    users can now reach rows past index 5000."""
    h = _admin_headers()
    r = requests.get(f"{API}/api/pre-starts",
                     params={"limit": 10, "offset": 5000}, headers=h, timeout=30)
    assert r.status_code == 200
    total = int(r.headers.get("X-Total-Count", "0"))
    # Only meaningful if the DB truly holds >5000 rows on this env.
    if total <= 5000:
        pytest.skip(f"env has {total} pre-starts — offset test needs >5000")
    rows = r.json()
    assert 0 < len(rows) <= 10


def test_visitors_endpoint_accepts_offset():
    src = _read(APP_ROOT / "backend" / "visitor_signins.py")
    assert "offset: int = Query(0" in src, (
        "visitor_signins.py admin_list_visitors must accept offset")
    assert ".skip(offset)" in src, (
        "visitor list cursor must apply .skip(offset)")


# ─── Backend source pins for offset in crud.py ───────────────
def test_crud_list_items_accepts_offset():
    src = _read(APP_ROOT / "backend" / "crud.py")
    assert "offset: int = Query(0, ge=0)" in src
    # `_list_impl` propagates offset through the cursor.
    assert ".skip(offset).limit(limit)" in src


# ─── PaginationBar component contract ─────────────────────────
def test_pagination_component_shape():
    src = _read(PAGINATION_JSX)
    assert "export default function PaginationBar" in src
    assert "load-more-btn" in src
    assert "page-size-select" in src
    assert "pagination-count" in src
    assert "canLoadMore" in src
    assert "usePersistedPageSize" in src
    # Persistence: writes to localStorage on change.
    assert "localStorage.setItem" in src
    # Options list matches the brief (100 · 500 · 1000 · 5000).
    for n in ("100", "500", "1000", "5000"):
        assert n in src


# ─── Every CAPTURE page mounts the pager ──────────────────────
PAGES_WITH_PAGER = {
    "PreStarts.jsx":       "pre-starts",
    "Incidents.jsx":       "incidents",
    "Hazards.jsx":         "hazards",
    "Inspections.jsx":     "inspections",
    "RiskAssessments.jsx": "risk-assessments",
    "SiteDiary.jsx":       "site-diary",
    "AdminVisitors.jsx":   "admin-visitors",
}


@pytest.mark.parametrize("page,prefix", list(PAGES_WITH_PAGER.items()))
def test_page_imports_pagination_bar(page, prefix):
    src = _read(PAGES / page)
    assert "import PaginationBar" in src, f"{page}: missing PaginationBar import"
    assert "usePersistedPageSize" in src, f"{page}: missing usePersistedPageSize"


@pytest.mark.parametrize("page,prefix", list(PAGES_WITH_PAGER.items()))
def test_page_renders_pagination_bar(page, prefix):
    src = _read(PAGES / page)
    assert "<PaginationBar" in src, f"{page}: <PaginationBar/> not rendered"
    assert f'testidPrefix="{prefix}"' in src
    # storageKey per-module.
    assert f'storageKey="{prefix}:pageSize"' in src


@pytest.mark.parametrize("page,prefix", list(PAGES_WITH_PAGER.items()))
def test_page_wires_onloadmore(page, prefix):
    src = _read(PAGES / page)
    # Must define an onLoadMore that increments offset and appends.
    assert "onLoadMore" in src, f"{page}: no onLoadMore callback"
    # The fetch call must accept both offset and append flags —
    # look for the signature shape.
    assert re.search(r"(items|rows)\.length[,)]", src), (
        f"{page}: onLoadMore must pass the current row count as the "
        f"next offset")


# ─── ArchiveDialog button-enable bug fix ─────────────────────
def test_archive_dialog_arms_on_any_criteria():
    src = _read(DIALOG_JSX)
    # hasAnyCriteria derived from the criteria object.
    assert "hasAnyCriteria" in src, (
        "ArchiveDialog must derive a `hasAnyCriteria` flag")
    assert "Object.keys(criteria).length > 0" in src
    # Preview button gate must include hasAnyCriteria.
    m_prev = re.search(
        r'onClick=\{runPreview\}\s+disabled=\{([^}]+)\}', src, re.DOTALL)
    assert m_prev, "Preview button `disabled` expression not found"
    assert "hasAnyCriteria" in m_prev.group(1), (
        "Preview button must be disabled unless hasAnyCriteria is true")
    # Commit button gate must NOT require `!preview` any more.
    m_commit = re.search(
        r'disabled=\{([^}]+)\}[^<]*(?:className=\{[^}]+\}\s*)?data-testid="archive-commit-btn"',
        src, re.DOTALL)
    assert m_commit, "Commit button `disabled` expression not found"
    commit_gate = m_commit.group(1)
    assert "hasAnyCriteria" in commit_gate, (
        f"Commit button must arm on any single valid criteria; got: {commit_gate}")
    # Must NOT hard-require a completed preview.
    assert "!preview ||" not in commit_gate and "!preview)" not in commit_gate, (
        "Commit button must NOT hard-require a completed Preview run")


def test_confirm_step_handles_missing_preview():
    src = _read(DIALOG_JSX)
    # If the user skipped Preview, the confirm dialog must still show
    # a coherent message.
    assert "no preview run" in src, (
        "Confirm dialog must show a fallback message when preview is null")


# ─── Version pin ─────────────────────────────────────────────
def test_version_pinned_to_132eh_or_higher():
    v = _read(VERSION_JS)
    sw = _read(SW)
    m_v = re.search(r"RUNNING_VERSION\s*=\s*'paneltec-v[\d.]+\.132([a-z]{2})'", v)
    m_sw = re.search(r"CACHE_VERSION\s*=\s*'paneltec-v[\d.]+\.132([a-z]{2})'", sw)
    assert m_v and m_v.group(1) >= "eh"
    assert m_sw and m_sw.group(1) >= "eh"
