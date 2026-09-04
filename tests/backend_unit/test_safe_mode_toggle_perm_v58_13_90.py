"""v58.13.90 — Granular `comms_safe_mode.edit` permission.

Source-scan tests only (no live-server dependency). Also runs the
`ensure_stephen_can_toggle()` seed against the live preview Mongo to
prove the override actually lands on Stephen's row.
"""
from __future__ import annotations
import asyncio
import os
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
MOBILE = ROOT / "mobile"

PERMISSIONS_PY = (BACKEND / "permissions.py").read_text(encoding="utf-8")
COMMS_PY = (BACKEND / "comms_safe_mode.py").read_text(encoding="utf-8")
SERVER_PY = (BACKEND / "server.py").read_text(encoding="utf-8")
ROLES_CATALOGUE_PY = (BACKEND / "roles_catalogue.py").read_text(encoding="utf-8")
SAFE_MODE_JSX = (FRONTEND / "src" / "pages" / "CommsSafeMode.jsx").read_text(encoding="utf-8")
VERSION_JS = (FRONTEND / "src" / "lib" / "version.js").read_text(encoding="utf-8")
SW_JS = (FRONTEND / "public" / "service-worker.js").read_text(encoding="utf-8")
MOBILE_TS = (MOBILE / "src" / "lib" / "version.ts").read_text(encoding="utf-8")


# ── Permission registry ──────────────────────────────────────────

def test_comms_safe_mode_resource_registered():
    """New resource is registered with the right label and flags."""
    assert '"comms_safe_mode":' in PERMISSIONS_PY
    m = re.search(
        r'"comms_safe_mode":\s*\{[^\}]*"label":\s*"Comms Safe Mode"[^\}]*'
        r'"email_supported":\s*False[^\}]*"delete_supported":\s*False',
        PERMISSIONS_PY,
        re.DOTALL,
    )
    assert m, "comms_safe_mode resource missing or has wrong flags"


def test_role_defaults_denies_comms_safe_mode_for_every_seeded_role():
    """ROLE_DEFAULTS must clobber `comms_safe_mode` back to all-False
    for every role, including admin. Guards against a future dict
    comprehension edit accidentally granting the token."""
    m = re.search(
        r'for _role in ROLE_DEFAULTS:\s*\n'
        r'\s*ROLE_DEFAULTS\[_role\]\[\"comms_safe_mode\"\]\s*=\s*_grant\(\)',
        PERMISSIONS_PY,
    )
    assert m, "ROLE_DEFAULTS clobber loop for comms_safe_mode is missing"


def test_roles_catalogue_excludes_comms_safe_mode_from_auto_grant():
    """`_all_tokens()` in roles_catalogue.py must skip
    `comms_safe_mode`, or the next `seed_system_roles()` run will
    hand `comms_safe_mode.edit` to the admin DB role and defeat the
    permissions.py clobber. Belt-and-braces test — both layers must
    agree."""
    assert "_AUTO_GRANT_EXCLUDED" in ROLES_CATALOGUE_PY
    m = re.search(
        r'_AUTO_GRANT_EXCLUDED:\s*set\s*=\s*\{[^}]*"comms_safe_mode"[^}]*\}',
        ROLES_CATALOGUE_PY,
    )
    assert m, "_AUTO_GRANT_EXCLUDED does not contain comms_safe_mode"
    # And `_all_tokens()` must actually consult the exclusion set.
    assert re.search(
        r"def _all_tokens\(\)[\s\S]+?if r in _AUTO_GRANT_EXCLUDED",
        ROLES_CATALOGUE_PY,
    ), "_all_tokens() does not skip _AUTO_GRANT_EXCLUDED resources"


def test_endpoint_uses_comms_safe_mode_edit_token():
    """PATCH /api/admin/comms-safe-mode must gate on the new token."""
    m = re.search(
        r'@router\.patch\("/comms-safe-mode"\)[\s\S]+?'
        r'async def patch_safe_mode\([\s\S]+?'
        r'require_permission\("comms_safe_mode",\s*"edit"\)',
        COMMS_PY,
    )
    assert m, "patch_safe_mode endpoint is not gated on comms_safe_mode.edit"
    # The old gate must be gone from this specific endpoint's ACTIVE
    # dep declaration. The history comment inside the endpoint
    # legitimately contains the substring `require_permission("noti…`;
    # target only a `Depends(require_permission(...))` occurrence in
    # the signature, not any comment block.
    signature = re.search(
        r'async def patch_safe_mode\([\s\S]+?\):',
        COMMS_PY,
    ).group(0)
    dep_calls = re.findall(
        r'Depends\(require_permission\("([^"]+)",\s*"([^"]+)"\)\)',
        signature,
    )
    assert dep_calls == [("comms_safe_mode", "edit")], (
        f"patch_safe_mode dep list is {dep_calls} — expected exactly "
        f"[('comms_safe_mode', 'edit')]"
    )


def test_who_can_toggle_endpoint_exists():
    """A helper endpoint exposes the current holder roster."""
    assert '@router.get("/comms-safe-mode/who-can-toggle")' in COMMS_PY
    assert "async def who_can_toggle" in COMMS_PY
    # Only returns identity fields (never role/perm data).
    m = re.search(r'async def who_can_toggle\([\s\S]+?return\s*\{[\s\S]+?\}', COMMS_PY)
    body = m.group(0)
    assert '"id"' in body or "id" in body
    assert '"name"' in body or "name" in body
    assert '"email"' in body or "email" in body
    for forbidden in ("role", "perms", "overrides", "password", "session"):
        assert re.search(rf'"{forbidden}"\s*:\s*1', body) is None, (
            f"who_can_toggle leaks `{forbidden}` — must return identity fields only"
        )


def test_ensure_stephen_helper_present_and_wired_into_startup():
    """`ensure_stephen_can_toggle()` is defined AND called from the
    startup hook so a plain backend restart is enough to seed the
    override."""
    assert "async def ensure_stephen_can_toggle" in COMMS_PY
    assert 'STEPHEN_EMAIL = "stephen@paneltec.com.au"' in COMMS_PY
    assert "await ensure_stephen_can_toggle()" in SERVER_PY


# ── Startup seed — live Mongo write test ────────────────────────

@pytest.mark.asyncio
async def test_ensure_stephen_can_toggle_upserts_override(monkeypatch):
    """Run the seed helper against the preview Mongo. After the call,
    Stephen's `db.user_permissions` row must carry
    `overrides.comms_safe_mode.edit = true`. Calling twice is a no-op."""
    import sys
    sys.path.insert(0, str(BACKEND))
    from db import db  # noqa: E402
    from comms_safe_mode import ensure_stephen_can_toggle, STEPHEN_EMAIL  # noqa: E402

    stephen = await db.users.find_one({"email": STEPHEN_EMAIL, "deleted_at": None},
                                      {"_id": 0, "id": 1})
    if not stephen:
        pytest.skip("no stephen user on this Mongo — seed test skipped")

    # First apply — either grants or is already-granted no-op.
    r1 = await ensure_stephen_can_toggle()
    assert r1["granted"] is True
    row = await db.user_permissions.find_one({"user_id": stephen["id"]},
                                             {"_id": 0, "overrides": 1})
    assert row is not None
    assert row["overrides"]["comms_safe_mode"]["edit"] is True

    # Second call must be a no-op.
    r2 = await ensure_stephen_can_toggle()
    assert r2 == {"granted": True, "no_op": True, "user_id": stephen["id"]}


# ── Frontend ────────────────────────────────────────────────────

def test_frontend_gates_both_toggle_buttons_on_can_toggle():
    """Both `Turn Safe Mode ON` and `Turn Safe Mode OFF` buttons must
    include `!canToggle` in their `disabled` expression."""
    for tid in ("safe-mode-toggle-on", "safe-mode-toggle-off"):
        m = re.search(
            rf'data-testid="{tid}"[\s\S]{{0,400}}?disabled=\{{([^}}]+)\}}',
            SAFE_MODE_JSX,
        )
        # The disabled expression is written BEFORE the data-testid on
        # the button tag; search the other direction too.
        if not m:
            m = re.search(
                rf'disabled=\{{([^}}]+)\}}[\s\S]{{0,400}}?data-testid="{tid}"',
                SAFE_MODE_JSX,
            )
        assert m, f"button {tid} not found in CommsSafeMode.jsx"
        assert "!canToggle" in m.group(1), (
            f"button {tid} disabled expression does not include !canToggle"
        )


def test_frontend_permission_banner_and_holders_line_render():
    """The new permission-lock banner and the always-visible holders
    helper line are both wired in."""
    assert 'data-testid="perm-lock-banner"' in SAFE_MODE_JSX
    assert 'data-perm-token="comms_safe_mode.edit"' in SAFE_MODE_JSX
    assert 'data-testid="perm-lock-holders"' in SAFE_MODE_JSX
    assert 'data-testid="perm-holders-line"' in SAFE_MODE_JSX
    assert "You don&apos;t have permission" in SAFE_MODE_JSX
    # Banner is guarded on !canToggle and !locked so it doesn't
    # collide with the env-lock banner.
    assert "!canToggle && !locked" in SAFE_MODE_JSX


def test_frontend_fetches_effective_permissions_and_holders():
    """`load()` fans out /auth/me + who-can-toggle in parallel and
    plumbs the results into `setCanToggle` + `setHolders`."""
    # `const load = async () => { … };` — nested-brace tolerant match
    # (Promise.all([...]) contains nested `{}` blocks).
    start = SAFE_MODE_JSX.find("const load = async () => {")
    assert start >= 0
    # Walk brace count until the enclosing block closes, then find
    # the terminating `;`.
    depth = 0
    i = start
    while i < len(SAFE_MODE_JSX):
        ch = SAFE_MODE_JSX[i]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                break
        i += 1
    body = SAFE_MODE_JSX[start:i + 2]
    assert "api.get('/auth/me')" in body
    assert "api.get('/admin/comms-safe-mode/who-can-toggle')" in body
    assert "setCanToggle" in body
    assert "setHolders" in body
    assert "effective_permissions" in body


# ── Version-sync forward-safe pin >= 90 ─────────────────────────

def _tail(text: str, name: str) -> int:
    m = re.search(rf"{name}\s*=\s*['\"]paneltec-v[\d.]+\.(\d+)[a-z]*['\"]", text)
    assert m, f"{name} not found"
    return int(m.group(1))


def test_running_version_gte_90():
    assert _tail(VERSION_JS, "RUNNING_VERSION") >= 90


def test_cache_version_gte_90():
    assert _tail(SW_JS, "CACHE_VERSION") >= 90


def test_mobile_bundle_version_gte_90():
    assert _tail(MOBILE_TS, "MOBILE_BUNDLE_VERSION") >= 90
