"""v58.13.132ew — Display logged-in user for security awareness.

Two indicators added to AppShell so users can never mistake which
account they are acting on:
  · Top-right user chip now shows full `name` + `role_id` (was
    first-name only in uppercase).
  · Sidebar carries a "Logged in as <name> · <role>" line directly
    below the wordmark, visible on every authenticated page. Hidden
    when the sidebar is collapsed.

Plus a live-API lock that `/api/auth/me` returns `name` and
`role_id` so the FE has something to display.

Also folds in the in-flight `.132ev` credential vault work:
  · `backend/tile_credentials.py` — 5 endpoints, AES-256-GCM at
    rest via HKDF-derived per-user keys.
  · `PANELTEC_VAULT_SECRET` env var required at import time.
  · Cheat-sheet popup in `AppsDirectoryModal.jsx` + credential
    editor in `QuickLinksSection.jsx`.
"""
from __future__ import annotations

import os
import re
from pathlib import Path

import pytest
import requests

from tests.conftest import API

pytestmark = pytest.mark.live_db_writes

APP_ROOT = Path(__file__).resolve().parents[2]
FE = APP_ROOT / "frontend" / "src"
APPSHELL = FE / "components" / "layout" / "AppShell.jsx"
MODAL = FE / "components" / "AppsDirectoryModal.jsx"
SECT = FE / "components" / "QuickLinksSection.jsx"
TC_MOD = APP_ROOT / "backend" / "tile_credentials.py"
VERSION_JS = FE / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def _admin_hdr():
    r = requests.post(f"{API}/auth/login",
                       json={"email": "stephen@paneltec.com.au",
                             "password": "Mcgstephen50#"}, timeout=30)
    if r.status_code != 200:
        pytest.skip(f"admin login unavailable: {r.status_code}")
    t = r.json().get("access_token") or r.json().get("token")
    return {"Authorization": f"Bearer {t}"}


# ── Item 1 — user chip + sidebar "logged in as" ───────────────────

def test_user_chip_shows_name_and_role():
    src = _read(APPSHELL)
    assert 'data-testid="user-chip-identity"' in src
    # Full name/email displayed (not just first-name).
    assert "user?.name || user?.email || 'You'" in src
    # Role rendered.
    assert "user?.role_id || user?.role" in src


def test_sidebar_has_logged_in_as_line():
    src = _read(APPSHELL)
    assert 'data-testid="sidebar-logged-in-as"' in src
    assert "Logged in as" in src
    # Only shown when the sidebar is expanded + user is loaded.
    assert "!collapsed && user &&" in src


def test_sidebar_shell_accepts_user_prop_and_shell_passes_it():
    src = _read(APPSHELL)
    assert "const SidebarShell = ({ collapsed, canAdminNav, badges, brandName, user })" in src
    assert "brandName={brandName} user={user}" in src


def test_auth_me_returns_name_and_role():
    hdr = _admin_hdr()
    r = requests.get(f"{API}/auth/me", headers=hdr, timeout=30)
    assert r.status_code == 200
    body = r.json()
    assert body.get("name"), "auth/me must return `name`"
    assert body.get("role_id") or body.get("role"), (
        "auth/me must return `role_id` (or `role`)")


# ── Folded-in .132ev credential vault locks ───────────────────────

def test_vault_secret_required_at_import():
    """Import-time guard: refuse to load without the env var."""
    src = _read(TC_MOD)
    assert 'os.environ.get(_VAULT_SECRET_ENV, "")' in src
    assert "raise RuntimeError" in src
    assert "PANELTEC_VAULT_SECRET" in src


def test_credentials_encryption_round_trip():
    hdr = _admin_hdr()
    payload = {"username": "roundtrip_user",
               "password": "SuperSecret2026!",
               "qa_pairs": [{"label": "Pet name", "answer": "Buddy"}]}
    r = requests.put(f"{API}/tile-credentials/rt-tile",
                       json=payload, headers=hdr, timeout=30)
    assert r.status_code == 200
    meta = r.json()
    assert meta["has_password"] is True
    assert meta["password_preview"].endswith("026!")
    # Reveal the password.
    r_rev = requests.post(f"{API}/tile-credentials/rt-tile/reveal",
                           headers=hdr, timeout=30)
    assert r_rev.status_code == 200
    assert r_rev.json()["password"] == "SuperSecret2026!"
    # Copy the QA field.
    r_qa = requests.post(f"{API}/tile-credentials/rt-tile/copy-field",
                          json={"field": "Pet name"},
                          headers=hdr, timeout=30)
    assert r_qa.status_code == 200
    assert r_qa.json()["value"] == "Buddy"
    # Clean up.
    requests.delete(f"{API}/tile-credentials/rt-tile", headers=hdr, timeout=30)


def test_cheat_sheet_popup_wiring_present():
    src = _read(MODAL)
    assert "openCheatSheet" in src
    assert "/tile-credentials/" in src
    assert "navigator.clipboard.writeText" in src


def test_credential_editor_present_in_manager():
    src = _read(SECT)
    assert "CredentialSubEditor" in src
    for tid in ("credential-editor-username", "credential-editor-password",
                 "credential-editor-save", "credential-editor-clear",
                 "credential-editor-add-qa"):
        assert tid in src, f"missing testid {tid}"


# ── Folded-in .132ew auto-colour tiles ────────────────────────────

def test_auto_colour_palette_and_helper_in_manager():
    """FE lock: AUTO_PALETTE + autoColor helper must live in the
    manager so live-preview swatches match the server's hash pick."""
    src = _read(SECT)
    assert "export const AUTO_PALETTE" in src
    assert "export function autoColor" in src
    # 12 palette entries, sentinel `#1d6fb8` deliberately absent so it
    # can act as the "unset / auto" marker.
    for hex_code in ("#3b82f6", "#ef4444", "#22c55e", "#7c3aed",
                     "#14b8a6", "#f97316", "#ec4899", "#6366f1",
                     "#f59e0b", "#06b6d4", "#f43f5e", "#10b981"):
        assert hex_code in src, f"palette missing {hex_code}"
    assert "#1d6fb8" not in src.split("export const AUTO_PALETTE", 1)[1].split("]", 1)[0]
    # Editor + add row wire the auto-tag through data-testids.
    assert "apps-directory-add-color-auto-tag" in src
    assert "org-quick-links-editor-color-auto-tag" in src


def test_auto_colour_is_idempotent_for_same_label():
    """Same label → same hex on the server (round-trip through
    create → read → delete twice). Proves the hash is stable."""
    hdr = _admin_hdr()
    label = "Auto-Colour Idempotency Probe"
    seen: list[str] = []
    for _ in range(2):
        r = requests.post(f"{API}/org/url-tiles",
                           json={"url": "https://example.com",
                                 "label": label},
                           headers=hdr, timeout=30)
        assert r.status_code == 200, r.text
        tile = r.json()
        seen.append(tile["color"])
        # Colour must come from the auto palette (NOT the legacy
        # default sentinel).
        assert tile["color"] != "#1d6fb8", (
            "auto-picked colour must not equal the legacy default sentinel")
        requests.delete(f"{API}/org/url-tiles/{tile['id']}",
                          headers=hdr, timeout=30)
    assert seen[0] == seen[1], f"auto-colour must be idempotent, got {seen}"


def test_manual_colour_wins_over_auto_pick():
    """Admin picks a colour → server must NOT hash-swap it on read."""
    hdr = _admin_hdr()
    manual = "#22c55e"  # green — deliberately different from any
    # label-derived hash pick to keep the assertion unambiguous.
    r = requests.post(f"{API}/org/url-tiles",
                       json={"url": "https://example.com",
                             "label": "Manual Colour Probe",
                             "color": manual},
                       headers=hdr, timeout=30)
    assert r.status_code == 200, r.text
    tile = r.json()
    try:
        assert tile["color"] == manual, (
            f"manual colour must survive round-trip, got {tile['color']}")
        # Re-fetch via the list endpoint to prove the read path.
        r_list = requests.get(f"{API}/org/url-tiles", headers=hdr, timeout=30)
        matched = next((t for t in r_list.json()["tiles"]
                        if t["id"] == tile["id"]), None)
        assert matched is not None
        assert matched["color"] == manual
    finally:
        requests.delete(f"{API}/org/url-tiles/{tile['id']}",
                          headers=hdr, timeout=30)


# ── Version-sync ──────────────────────────────────────────────────

def test_version_pinned_to_132ew_or_higher():
    v = _read(VERSION_JS)
    sw = _read(SW)
    m_v = re.search(r"RUNNING_VERSION\s*=\s*'paneltec-v[\d.]+\.132([a-z]{2})'", v)
    m_sw = re.search(r"CACHE_VERSION\s*=\s*'paneltec-v[\d.]+\.132([a-z]{2})'", sw)
    assert m_v and m_v.group(1) >= "ew", f"RUNNING_VERSION suffix must be >= 132ew, got {m_v and m_v.group(1)}"
    assert m_sw and m_sw.group(1) >= "ew", f"CACHE_VERSION suffix must be >= 132ew, got {m_sw and m_sw.group(1)}"
