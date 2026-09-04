"""v58.13.105 — Reduced batch: PDF blob-helper sweep + Users &
Permissions matrix wire-in for comms_safe_mode.edit.

Items 3 (route-link compile guard) and 4 (rate-limit test-mode bypass)
were deferred to conserve credits per user directive; those get their
own ships.
"""
from __future__ import annotations
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FRONTEND = ROOT / "frontend"
MOBILE = ROOT / "mobile"

DOWNLOADS_JS = (FRONTEND / "src" / "lib" / "downloads.js").read_text(encoding="utf-8")
PERMISSIONS_JS = (FRONTEND / "src" / "lib" / "permissions.js").read_text(encoding="utf-8")
AUDIT_JSX = (FRONTEND / "src" / "pages" / "AuditExports.jsx").read_text(encoding="utf-8")
DASH_JSX = (FRONTEND / "src" / "pages" / "Dashboard.jsx").read_text(encoding="utf-8")
FORMS_JSX = (FRONTEND / "src" / "pages" / "Forms.jsx").read_text(encoding="utf-8")
OUTBOX_JSX = (FRONTEND / "src" / "pages" / "Outbox.jsx").read_text(encoding="utf-8")
USERS_JSX = (FRONTEND / "src" / "pages" / "UsersManagement.jsx").read_text(encoding="utf-8")
VERSION_JS = (FRONTEND / "src" / "lib" / "version.js").read_text(encoding="utf-8")
SW_JS = (FRONTEND / "public" / "service-worker.js").read_text(encoding="utf-8")
MOBILE_TS = (MOBILE / "src" / "lib" / "version.ts").read_text(encoding="utf-8")


# ── Item 1 · Shared bearer-authed file opener ────────────────────

def test_downloads_module_exists_and_exports_helper():
    assert (
        "export async function openAuthedFile" in DOWNLOADS_JS
        or "export function openAuthedFile" in DOWNLOADS_JS
    ), "openAuthedFile is not exported from lib/downloads.js"


def test_downloads_helper_uses_axios_blob_and_strips_api_prefix():
    assert re.search(
        r"replace\(\s*/\^\\?/api/\s*,\s*['\"]{2}\s*\)",
        DOWNLOADS_JS,
    ), "downloads.js does not strip the leading /api prefix"
    assert re.search(
        r"api\.get\(\s*path\s*,\s*\{\s*responseType:\s*['\"]blob['\"]",
        DOWNLOADS_JS,
    ), "downloads.js does not use api.get with responseType:'blob'"


def test_audit_exports_imports_shared_helper():
    """AuditExports.jsx used to define its own openAuthedFile (.103);
    v58.13.105 moves it to the shared module. Regression-guard the
    switch so the local helper can't sneak back in."""
    assert re.search(
        r"import\s*\{\s*openAuthedFile\s*\}\s*from\s*['\"]\.\./lib/downloads['\"]",
        AUDIT_JSX,
    ), "AuditExports.jsx does not import openAuthedFile from lib/downloads"
    assert "async function openAuthedFile" not in AUDIT_JSX, (
        "AuditExports.jsx still defines a local openAuthedFile — "
        "the .105 refactor should have replaced it with the shared import"
    )


def test_dashboard_uses_shared_helper():
    assert re.search(
        r"import\s*\{\s*openAuthedFile\s*\}\s*from\s*['\"]\.\./lib/downloads['\"]",
        DASH_JSX,
    ), "Dashboard.jsx missing openAuthedFile import"
    assert re.search(
        r"await\s+openAuthedFile\(\s*data\.file_url\s*,",
        DASH_JSX,
    ), "Dashboard.jsx PDF audit pack does not call openAuthedFile"


def test_dashboard_no_bare_backend_window_open():
    """Pre-.105 Dashboard.jsx had `window.open(${BACKEND}${data.file_url})`
    which strips the bearer → 401 blank tab. Regression guard."""
    assert not re.search(
        r"window\.open\(\s*`\$\{[^}]*REACT_APP_BACKEND_URL[^}]*\}\$\{[^}]*file_url",
        DASH_JSX,
    ), "Dashboard.jsx still bare-window.opens a BACKEND + file_url URL"


def test_forms_photo_grid_uses_shared_helper():
    assert re.search(
        r"import\s*\{\s*openAuthedFile\s*\}\s*from\s*['\"]\.\./lib/downloads['\"]",
        FORMS_JSX,
    ), "Forms.jsx missing openAuthedFile import"
    assert re.search(
        r"onClick=\{\s*\(\)\s*=>\s*openAuthedFile\(\s*p\.file_url",
        FORMS_JSX,
    ), "Forms.jsx photo grid does not call openAuthedFile"


def test_forms_no_bare_anchor_around_photos():
    assert not re.search(
        r"<a\s+key=\{i\}\s+href=\{`\$\{[^}]*REACT_APP_BACKEND_URL[^}]*\}\$\{p\.file_url\}`\}\s+target=\"_blank\"",
        FORMS_JSX,
    ), "Forms.jsx still wraps photo thumbs in a bare-anchor download link"


def test_outbox_attachment_uses_shared_helper():
    assert re.search(
        r"import\s*\{\s*openAuthedFile\s*\}\s*from\s*['\"]\.\./lib/downloads['\"]",
        OUTBOX_JSX,
    ), "Outbox.jsx missing openAuthedFile import"
    assert re.search(
        r"onClick=\{\s*\(\)\s*=>\s*openAuthedFile\(\s*a\.file_url",
        OUTBOX_JSX,
    ), "Outbox.jsx attachment does not call openAuthedFile"


def test_outbox_no_bare_anchor_on_attachments():
    """Pre-.105 Outbox rendered `<a href={a.file_url}>` (relative URL,
    hit /api/... on current domain without bearer). Regression guard."""
    assert not re.search(
        r"<a\s+href=\{a\.file_url\}",
        OUTBOX_JSX,
    ), "Outbox.jsx still uses <a href={a.file_url}> — bearer will be stripped"


# ── Item 2 · comms_safe_mode in the Users & Permissions matrix ────

def test_comms_safe_mode_in_resource_labels():
    m = re.search(
        r"RESOURCE_LABELS\s*=\s*\{[\s\S]{0,2000}?"
        r"comms_safe_mode:\s*['\"]Comms Safe Mode['\"]",
        PERMISSIONS_JS,
    )
    assert m, "comms_safe_mode label missing or wrong in RESOURCE_LABELS"


def test_support_maps_carry_comms_safe_mode_false():
    """`comms_safe_mode` only has a meaningful `edit` action; all other
    columns must be marked unsupported so the matrix renders "—"."""
    for map_name in (
        "EMAIL_SUPPORTED", "DELETE_SUPPORTED",
        "TEAM_VIEW_SUPPORTED", "OPEN_VIEW_SUPPORTED",
    ):
        m = re.search(
            rf"{map_name}\s*=\s*\{{[\s\S]{{0,2000}}?comms_safe_mode:\s*false",
            PERMISSIONS_JS,
        )
        assert m, f"{map_name} is missing `comms_safe_mode: false`"


def test_open_view_supported_map_defined():
    """NEW map introduced in .105 — pin its export shape so future
    imports don't silently fall through to undefined."""
    assert re.search(
        r"export\s+const\s+OPEN_VIEW_SUPPORTED\s*=\s*\{",
        PERMISSIONS_JS,
    ), "OPEN_VIEW_SUPPORTED export missing"


def test_users_management_supported_gate_honours_all_four_maps():
    """The matrix `supported` computation must consult all four
    support maps for their respective actions. Anchored to the exact
    shape shipped in .105."""
    m = re.search(
        r"const\s+supported\s*=\s*"
        r"\(!isEmail\s*\|\|\s*EMAIL_SUPPORTED\[res\]\)\s*"
        r"&&\s*\(!isTeamView\s*\|\|\s*TEAM_VIEW_SUPPORTED\[res\]\)\s*"
        r"&&\s*\(!isDelete\s*\|\|\s*DELETE_SUPPORTED\[res\]\s*!==\s*false\)\s*"
        r"&&\s*\(!isOpenOrView\s*\|\|\s*OPEN_VIEW_SUPPORTED\[res\]\s*!==\s*false\)",
        USERS_JSX,
    )
    assert m, (
        "UsersManagement.jsx `supported` gate does not honour the four "
        "support maps — comms_safe_mode row would render click-through "
        "cells for open/view/delete/team_view/email"
    )


def test_users_management_imports_new_support_maps():
    assert re.search(
        r"import\s*\{[^}]*DELETE_SUPPORTED[^}]*OPEN_VIEW_SUPPORTED[^}]*\}"
        r"\s*from\s*['\"]\.\./lib/permissions['\"]",
        USERS_JSX,
    ), "UsersManagement.jsx does not import DELETE_SUPPORTED + OPEN_VIEW_SUPPORTED"


# ── Version-sync forward-safe pin >= 105 ────────────────────────

def _tail(text, name):
    m = re.search(rf"{name}\s*=\s*['\"]paneltec-v[\d.]+\.(\d+)['\"]", text)
    assert m, f"could not read tail of {name}"
    return int(m.group(1))


def test_running_version_gte_105():
    assert _tail(VERSION_JS, "RUNNING_VERSION") >= 105


def test_cache_version_gte_105():
    assert _tail(SW_JS, "CACHE_VERSION") >= 105


def test_mobile_bundle_version_gte_105():
    assert _tail(MOBILE_TS, "MOBILE_BUNDLE_VERSION") >= 105
