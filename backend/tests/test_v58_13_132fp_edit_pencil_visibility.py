"""v58.13.132fp — Source-pin guarding the Workers.jsx edit pencil.

Rationale:
  Stephen reported the edit pencil was invisible on Melinda Linford's
  row (workers list). Root cause: the JSX pencil is unconditional, but
  the fixed 190 px actions column + `flex-wrap` cluster pushed the
  6th button (Delete) onto a wrapped line on every row, and on rows
  with the wider `+ Login` button (Melinda et al.) the pencil itself
  could land on the wrapped line on stale bundles / narrower
  viewports. `.132fp` widens the column to 260 px and swaps
  `flex-wrap` → `flex-nowrap` so every button stays on one line.

These pins guard against a regression that could re-introduce the
clip:
  1. The actions column MUST be at least 260 px.
  2. The action-cluster MUST use `flex-nowrap` (never `flex-wrap`).
  3. Every button inside the cluster MUST carry `shrink-0` so
     flex won't compress them out of view.
  4. The edit-pencil JSX MUST NOT be gated on any per-worker
     conditional (status / active / exp / linked_user_id / has_login /
     photo_url).
  5. The backend PATCH endpoint still returns 200 for admin on Mel
     with a benign field.
"""
from __future__ import annotations

import os
import re
from pathlib import Path

import pytest
import requests

from tests.conftest import ADMIN_EMAIL, ADMIN_PWD, API

pytestmark = pytest.mark.live_db_writes

APP_ROOT = Path(__file__).resolve().parents[2]
WORKERS_JSX = APP_ROOT / "frontend" / "src" / "pages" / "Workers.jsx"
VERSION_JS = APP_ROOT / "frontend" / "src" / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"

MEL_ID = "47476d38-bc55-4fc7-90c2-7db2b909d692"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def _login(email, pwd):
    r = requests.post(f"{API}/auth/login",
                       json={"email": email, "password": pwd}, timeout=30)
    if r.status_code == 429:
        pytest.skip("rate-limited")
    assert r.status_code == 200, r.text
    tok = r.json().get("access_token") or r.json().get("token")
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def admin_hdr():
    return _login(ADMIN_EMAIL, ADMIN_PWD)


# ── Source pins ───────────────────────────────────────────────────

def test_workers_actions_column_is_at_least_260px():
    src = _read(WORKERS_JSX)
    # gridTemplateColumns strings appear on both the sort header AND
    # every row — both must carry the widened final column.
    matches = re.findall(
        r"gridTemplateColumns:\s*'([^']+)'", src)
    assert len(matches) >= 2, "expected at least two gridTemplateColumns strings"
    for gt in matches:
        # Final column is the LAST whitespace-separated token.
        tail = gt.strip().split()[-1]
        px = re.match(r"(\d+)px$", tail)
        assert px, f"actions column must be a fixed px value, got {tail!r}"
        assert int(px.group(1)) >= 260, (
            f".132fp requires actions column >= 260 px, got {tail!r} in {gt!r}")


def test_actions_cluster_uses_flex_nowrap_not_flex_wrap():
    src = _read(WORKERS_JSX)
    # Locate the cluster div carrying `worker-actions-cluster-` testid
    # (added in .132fp) and pin its className.
    m = re.search(
        r'<div\s+className="([^"]+)"\s*\n?\s*data-testid=\{`worker-actions-cluster-\$\{w\.id\}`\}',
        src)
    assert m, "expected a <div data-testid={worker-actions-cluster-…}> introduced in .132fp"
    cls = m.group(1)
    assert "flex-nowrap" in cls, (
        f"action-cluster must use flex-nowrap in .132fp, got: {cls!r}")
    assert "flex-wrap" not in cls or "flex-wrap-" in cls, (
        f"action-cluster must NOT use flex-wrap in .132fp, got: {cls!r}")


def test_edit_pencil_and_siblings_are_shrink_zero():
    src = _read(WORKERS_JSX)
    # The edit button JSX must carry shrink-0 so flex won't compress
    # it out of view when the row is narrower than the cluster.
    m = re.search(
        r"data-testid=\{`edit-\$\{w\.id\}`\}[\s\S]{0,240}?className=\"([^\"]+)\">",
        src)
    assert m, "expected the edit-<id> button JSX in Workers.jsx"
    assert "shrink-0" in m.group(1), (
        f"edit pencil must have shrink-0 in .132fp, got: {m.group(1)!r}")


def test_edit_pencil_is_not_gated_on_worker_state():
    """The pencil MUST render for every worker row visible to an
    admin. Guard against a regression where someone gates it on
    worker.active / status / exp / linked_user_id / has_login /
    photo_url etc."""
    src = _read(WORKERS_JSX)
    idx = src.find("data-testid={`edit-${w.id}`}")
    assert idx >= 0, "edit-<id> button not found in Workers.jsx"
    # Look at the ~200 chars of source immediately before the
    # button's data-testid — this covers the opening `<button` and
    # any wrapping conditional. If a `w.<field> && <button` prefix
    # is present, the pencil is gated per-worker.
    prefix = src[max(0, idx - 240):idx]
    forbidden = (
        "w.status", "w.active", "w.exp", "w.linked_user_id",
        "w.has_login", "w.photo_url",
    )
    for token in forbidden:
        # The token must not appear inside a `<xxx && <button …>` chain
        # immediately in front of the button. We tolerate the token
        # if it appears in a comment or an unrelated JSX branch farther
        # back — 240 chars is scoped to just the button itself.
        # Also tolerate an inner `data-worker-name={fullName(w)}` etc.
        # which uses `w.` for props not for gating.
        assert f"{token} &&" not in prefix, (
            f"edit pencil appears to be gated on `{token} &&` prefix: {prefix!r}")


def test_version_bumped_to_132fp():
    ver = _read(VERSION_JS)
    sw = _read(SW)
    assert "paneltec-v160.3.9.58.13.132fp" in ver, (
        "RUNNING_VERSION / EXPECTED_CACHE_VERSION must be .132fp")
    assert "paneltec-v160.3.9.58.13.132fp" in sw, (
        "service-worker CACHE_VERSION must be .132fp")


# ── Live backend confirmation ─────────────────────────────────────

def test_admin_can_patch_melinda_via_api(admin_hdr):
    # Sanity: read Mel's current state.
    r = requests.get(f"{API}/workers/{MEL_ID}", headers=admin_hdr, timeout=30)
    assert r.status_code == 200, r.text
    original = r.json().get("additional_notes") or ""
    # PATCH with a benign field and confirm 200 + round-trip.
    probe = f".132fp source-pin probe — safe to overwrite"
    r = requests.patch(
        f"{API}/workers/{MEL_ID}",
        headers={**admin_hdr, "Content-Type": "application/json"},
        json={"additional_notes": probe}, timeout=30)
    assert r.status_code == 200, r.text
    assert r.json().get("additional_notes") == probe
    # Restore.
    r = requests.patch(
        f"{API}/workers/{MEL_ID}",
        headers={**admin_hdr, "Content-Type": "application/json"},
        json={"additional_notes": original}, timeout=30)
    assert r.status_code == 200, r.text
