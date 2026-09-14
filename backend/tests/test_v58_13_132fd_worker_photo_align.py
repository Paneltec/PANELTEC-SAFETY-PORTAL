"""v58.13.132fd — Worker photo vertical alignment slider.

Adds `photo_offset_y: int` to the worker record — a percentage
(0..100) interpreted client-side as the CSS `object-position` Y
coordinate. Missing/null → 50 (centre). Out-of-range values are
clamped server-side (never 400).

FE: a range slider under the edit-form thumbnail live-previews the
crop; the value ships as part of the existing PATCH body. Row list
photo + ID card photo apply the same offset.
"""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest
import requests

from tests.conftest import ADMIN_EMAIL, ADMIN_PWD, API, EPHEMERAL_PWD

pytestmark = pytest.mark.live_db_writes

APP_ROOT = Path(__file__).resolve().parents[2]
FE = APP_ROOT / "frontend" / "src"
WORKERS_PAGE = FE / "pages" / "Workers.jsx"
VERSION_JS = FE / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def _login(email: str, pwd: str):
    r = requests.post(f"{API}/auth/login",
                       json={"email": email, "password": pwd},
                       timeout=30)
    if r.status_code == 429:
        pytest.skip("rate-limited by auth throttle — retry later")
    assert r.status_code == 200, r.text
    tok = r.json().get("access_token") or r.json().get("token")
    return {"Authorization": f"Bearer {tok}"}


def _me(hdr):
    r = requests.get(f"{API}/auth/me", headers=hdr, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def admin_hdr():
    return _login(ADMIN_EMAIL, ADMIN_PWD)


@pytest.fixture(scope="module")
def worker_hdr(ephemeral_users):
    return _login(ephemeral_users["worker"], EPHEMERAL_PWD)


@pytest.fixture
def seeded_worker(admin_hdr, _mongo):
    """Seed a worker directly via Mongo (POST is disabled at the
    API — worker create is Simpro-only). Returns the worker id;
    fixture cleans up on teardown."""
    me = _me(admin_hdr)
    wid = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    _mongo.workers.insert_one({
        "id": wid, "org_id": me["org_id"],
        "first_name": "PhotoAlign", "last_name": "Probe",
        "active": True, "source": "manual",
        "created_at": now, "updated_at": now, "deleted_at": None,
    })
    yield wid
    _mongo.workers.delete_one({"id": wid})


# ── BE — model + endpoints ────────────────────────────────────────

def test_patch_accepts_photo_offset_y(admin_hdr, seeded_worker):
    r = requests.patch(f"{API}/workers/{seeded_worker}",
                        json={"photo_offset_y": 70},
                        headers=admin_hdr, timeout=30)
    assert r.status_code == 200, r.text
    assert r.json()["photo_offset_y"] == 70
    r_get = requests.get(f"{API}/workers/{seeded_worker}",
                          headers=admin_hdr, timeout=30)
    assert r_get.status_code == 200, r_get.text
    assert r_get.json()["photo_offset_y"] == 70


def test_missing_photo_offset_y_defaults_to_fifty(admin_hdr, seeded_worker):
    """Freshly seeded worker without `photo_offset_y` returns 50
    on GET — the default coercion in `_serialise`."""
    r = requests.get(f"{API}/workers/{seeded_worker}",
                      headers=admin_hdr, timeout=30)
    assert r.status_code == 200, r.text
    assert r.json()["photo_offset_y"] == 50


def test_clamp_above_range(admin_hdr, seeded_worker):
    r = requests.patch(f"{API}/workers/{seeded_worker}",
                        json={"photo_offset_y": 150},
                        headers=admin_hdr, timeout=30)
    assert r.status_code == 200, r.text
    assert r.json()["photo_offset_y"] == 100


def test_clamp_below_range(admin_hdr, seeded_worker):
    r = requests.patch(f"{API}/workers/{seeded_worker}",
                        json={"photo_offset_y": -20},
                        headers=admin_hdr, timeout=30)
    assert r.status_code == 200, r.text
    assert r.json()["photo_offset_y"] == 0


def test_non_integer_photo_offset_y_rejected(admin_hdr, seeded_worker):
    """Non-integer body → Pydantic 422 (or handler-level 400).
    Either is acceptable; the point is the server refuses the
    payload rather than persisting garbage."""
    r = requests.patch(f"{API}/workers/{seeded_worker}",
                        json={"photo_offset_y": "high"},
                        headers=admin_hdr, timeout=30)
    assert r.status_code in (400, 422), r.text


def test_non_admin_patch_forbidden(admin_hdr, worker_hdr, seeded_worker):
    """Same `_require_write` gate as any other worker edit. Non-
    admin gets 403. Existence of the worker is deliberately not
    leaked — the API answers 403 (or 404 under contractor-rep
    scoping); both are acceptable defence outcomes."""
    r = requests.patch(f"{API}/workers/{seeded_worker}",
                        json={"photo_offset_y": 60},
                        headers=worker_hdr, timeout=30)
    assert r.status_code in (403, 404), r.text


# ── FE source-pins ────────────────────────────────────────────────

def test_frontend_slider_wired_in_edit_form():
    src = _read(WORKERS_PAGE)
    # Label + testid + range input bound to controlled state.
    assert "Vertical alignment" in src
    assert 'data-testid="worker-edit-photo-align-slider"' in src
    assert re.search(r'type="range"[\s\S]{0,200}max="100"', src), (
        "range input with max='100' missing")
    # Reset to centre + Higher/Lower ticks.
    assert "Reset to centre" in src
    # Photo offset bound into the form state.
    assert "photo_offset_y" in src
    # Live preview via object-position inline style.
    assert "objectPosition: `50% ${" in src


def test_frontend_slider_only_shows_when_photo_present_and_editable():
    """The slider only renders when `canEdit && hasPhoto` AND the
    parent has passed the controlled offset handler — matches the
    spec's "hide the slider when no photo" rule and prevents the
    bystander render sites (row list, ID card) from showing it."""
    src = _read(WORKERS_PAGE)
    assert "canEdit && hasPhoto && typeof onChangeOffsetY === 'function'" in src


# ── Version pin ───────────────────────────────────────────────────

def test_version_pinned_to_132fd_or_higher():
    v = _read(VERSION_JS)
    sw = _read(SW)
    m_v = re.search(r"RUNNING_VERSION\s*=\s*'paneltec-v[\d.]+\.132([a-z]{2})'", v)
    m_ex = re.search(r"EXPECTED_CACHE_VERSION\s*=\s*'paneltec-v[\d.]+\.132([a-z]{2})'", v)
    m_sw = re.search(r"CACHE_VERSION\s*=\s*'paneltec-v[\d.]+\.132([a-z]{2})'", sw)
    for name, m in (("RUNNING_VERSION", m_v),
                     ("EXPECTED_CACHE_VERSION", m_ex),
                     ("CACHE_VERSION", m_sw)):
        assert m and m.group(1) >= "fd", (
            f"{name} suffix must be >= 132fd, got {m and m.group(1)}")
