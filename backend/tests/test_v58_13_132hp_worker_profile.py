"""v58.13.132hp — Worker profile enhancements (grouped).

Five interlocking UX improvements to the Worker profile, batched
into one ship because they all touch adjacent surfaces:

  1. Photo zoom slider — new `photo_scale` float [0.5, 2.5] server-side
     clamp, 0.5..2.0 UI range. Companion to the existing
     `photo_offset_y` from `.132fd`. Applied via CSS transform:
     scale() BEFORE translateY() so zoom pivots around the crop centre.
     Live-previewed in the edit modal AND persisted to all 3 photo
     render sites (edit-modal avatar, list-row circle, drawer header).

  2. Collapsible Licences tab — chevron toggle in the section header,
     `localStorage`-per-user persistence keyed on
     `paneltec:licences:open:{workerId}`. First mount defaults to
     open so nobody misses a licence.

  3. Collapsible Private & Confidential tab — same pattern,
     `paneltec:private-confidential:open:{workerId}`.

  4. Inline Edit button on each Licences row — wires the existing
     `CertEditModal` from `certifications/`. Previously the panel
     told the user to scroll up to the Certifications section to
     edit; now edit lives where the row is. View button already
     used `OpenAsPdfButton` (from `.132hk`); left untouched.

  5. Personal tab — four Paneltec-only fields added to `WorkerIn`
     + `WorkerPatch`:
       · `usi_number`              (10-char USI, uppercased FE-side)
       · `tax_file_number`         (9 digits, masked reveal-to-edit FE)
       · `emergency_contact_name`  (free text)
       · `emergency_contact_phone` (free text)
     ALL four are Paneltec-only — the `.132hp` FE surface renders an
     amber "never synced from Simpro" separator above them so admins
     don't wonder why a manual entry survives a Simpro refresh. The
     Simpro sync path in `integrations_simpro_workers.py::_extract_pii`
     is UNCHANGED (still writes to a separate `emergency_contact`
     dict on the doc — different field, different lifecycle).
"""
from __future__ import annotations

import re
import uuid
from pathlib import Path

import pytest
import requests

from tests.conftest import ADMIN_EMAIL, ADMIN_PWD, API

pytestmark = pytest.mark.live_db_writes

APP_ROOT = Path(__file__).resolve().parents[2]
WORKERS_PY = APP_ROOT / "backend" / "workers.py"
WORKERS_JSX = APP_ROOT / "frontend" / "src" / "pages" / "Workers.jsx"
LICENCES_JSX = APP_ROOT / "frontend" / "src" / "components" / "workers" / "LicencesPanel.jsx"
PC_JSX = APP_ROOT / "frontend" / "src" / "components" / "workers" / "PrivateConfidentialPanel.jsx"
VJS = APP_ROOT / "frontend" / "src" / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def _login() -> dict:
    r = requests.post(
        f"{API}/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PWD},
        timeout=30,
    )
    if r.status_code == 429:
        pytest.skip("rate-limited")
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


# ─────────────── Backend model additions ───────────────


def test_worker_patch_carries_new_fields():
    src = _read(WORKERS_PY)
    for f in (
        "usi_number",
        "tax_file_number",
        "emergency_contact_name",
        "emergency_contact_phone",
        "photo_scale",
    ):
        assert re.search(rf"{f}:\s*Optional", src), f"WorkerPatch missing field: {f}"


def test_worker_in_carries_new_fields():
    src = _read(WORKERS_PY)
    # WorkerIn (create) — must accept the same fields so a Simpro
    # import or manual create doesn't 422 when values are supplied.
    match = re.search(
        r"class WorkerIn\(BaseModel\):(.+?)class SmartFillCardEntry",
        src,
        re.S,
    )
    assert match, "could not locate WorkerIn class body"
    body = match.group(1)
    for f in (
        "usi_number",
        "tax_file_number",
        "emergency_contact_name",
        "emergency_contact_phone",
    ):
        assert f in body, f"WorkerIn missing field: {f}"


def test_photo_scale_clamped_and_defaulted_live():
    h = _login()
    r = requests.get(f"{API}/workers?limit=1", headers=h, timeout=15)
    workers = r.json()
    workers = workers if isinstance(workers, list) else workers.get("items", [])
    if not workers:
        pytest.skip("no workers in tenant")
    wid = workers[0]["id"]
    try:
        # Above-range should clamp to 2.5 (backend range, not FE range).
        r2 = requests.patch(
            f"{API}/workers/{wid}",
            json={"photo_scale": 9.9},
            headers=h,
            timeout=15,
        )
        assert r2.status_code == 200, r2.text
        assert r2.json().get("photo_scale") == 2.5
        # Below-range should clamp to 0.5.
        r3 = requests.patch(
            f"{API}/workers/{wid}",
            json={"photo_scale": 0.01},
            headers=h,
            timeout=15,
        )
        assert r3.status_code == 200, r3.text
        assert r3.json().get("photo_scale") == 0.5
    finally:
        # Restore to 1.0 (natural).
        requests.patch(
            f"{API}/workers/{wid}",
            json={"photo_scale": 1.0},
            headers=h,
            timeout=15,
        )


def test_new_fields_round_trip_live():
    h = _login()
    r = requests.get(f"{API}/workers?limit=1", headers=h, timeout=15)
    workers = r.json()
    workers = workers if isinstance(workers, list) else workers.get("items", [])
    if not workers:
        pytest.skip("no workers in tenant")
    wid = workers[0]["id"]
    tag = uuid.uuid4().hex[:6].upper()
    try:
        r2 = requests.patch(
            f"{API}/workers/{wid}",
            json={
                "usi_number": f"USI{tag}",
                "tax_file_number": "123456789",
                "emergency_contact_name": f"Test {tag}",
                "emergency_contact_phone": f"+61400{tag}",
            },
            headers=h,
            timeout=15,
        )
        assert r2.status_code == 200, r2.text
        body = r2.json()
        assert body["usi_number"] == f"USI{tag}"
        assert body["tax_file_number"] == "123456789"
        assert body["emergency_contact_name"] == f"Test {tag}"
        assert body["emergency_contact_phone"] == f"+61400{tag}"
    finally:
        requests.patch(
            f"{API}/workers/{wid}",
            json={
                "usi_number": None,
                "tax_file_number": None,
                "emergency_contact_name": None,
                "emergency_contact_phone": None,
            },
            headers=h,
            timeout=15,
        )


# ─────────────── Frontend surface ───────────────


def test_photo_tile_wheel_zoom_supersedes_slider_v58_13_132hx():
    """v58.13.132hx superseded the slider — the tile now uses
    wheel-zoom + pointer drag persisted in `photo_transform`."""
    src = _read(WORKERS_JSX)
    # Old slider testids gone.
    assert 'worker-edit-photo-scale-slider' not in src
    assert 'worker-edit-photo-scale-reset' not in src
    # New transform-based controls present.
    assert "onWheel" in src
    assert "onPointerDown" in src
    assert "getPhotoTransform" in src
    # Scale still applied at multiple render sites.
    assert src.count("scale(${") >= 3, (
        "Expected at least 3 photo render sites to apply scale()"
    )
    # Transform origin explicitly set so zoom pivots around centre.
    assert "transformOrigin: 'center center'" in src


def test_personal_tab_new_inputs_rendered():
    src = _read(WORKERS_JSX)
    for testid in (
        "worker-usi-number",
        "worker-tax-file-number",
        "worker-tax-file-number-masked",
        "worker-emergency-contact-name",
        "worker-emergency-contact-phone",
    ):
        assert f'data-testid="{testid}"' in src, f"missing test-id: {testid}"
    # Amber "never synced" banner marker.
    assert "Paneltec-only — never synced from Simpro" in src


def test_licences_panel_collapsible_with_edit_button():
    src = _read(LICENCES_JSX)
    # Header is a button with aria-expanded.
    assert 'data-testid="section-licences-toggle"' in src
    assert "aria-expanded={open}" in src
    # localStorage-per-worker persistence key.
    assert "paneltec:licences:open:${workerId}" in src
    # Row-level edit wires CertEditModal.
    assert "CertEditModal" in src
    assert 'data-testid={`licence-edit-${r.id}`}' in src


def test_private_confidential_panel_collapsible():
    src = _read(PC_JSX)
    assert 'data-testid="section-private-confidential-toggle"' in src
    assert "aria-expanded={open}" in src
    assert "paneltec:private-confidential:open:${workerId}" in src


# ─────────────── Simpro sync UNCHANGED ───────────────


def test_simpro_extract_pii_does_not_touch_new_paneltec_fields():
    """Regression guard — the four new Paneltec-only fields must NOT
    appear in `_extract_pii` (the Simpro-inbound PII mapper). If they
    do, a Simpro refresh would silently overwrite Stephen's manual
    entries, which is the exact behaviour Q1 said MUST NOT happen."""
    simpro_src = _read(APP_ROOT / "backend" / "integrations_simpro_workers.py")
    # Find the _extract_pii function body.
    match = re.search(
        r"def _extract_pii\(detail: dict\) -> dict:(.+?)(?=^def |^async def )",
        simpro_src,
        re.S | re.M,
    )
    assert match, "could not locate _extract_pii"
    body = match.group(1)
    for f in (
        "usi_number",
        "tax_file_number",
        "emergency_contact_name",
        "emergency_contact_phone",
    ):
        assert f not in body, (
            f"Paneltec-only field {f!r} leaked into Simpro sync path — "
            f"remove it or the manual entries will be overwritten "
            f"on the next refresh."
        )


# ─────────────── Version lockstep ───────────────


def test_version_bumped_to_132hp_or_later():
    """v58.13.132hx superseded the .132hp version pin — accept any
    .132h* or greater tail."""
    js, sw = _read(VJS), _read(SW)
    assert re.search(r"RUNNING_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132h[p-z]", js)
    assert re.search(r"EXPECTED_CACHE_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132h[p-z]", js)
    assert re.search(r"CACHE_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132h[p-z]", sw)
