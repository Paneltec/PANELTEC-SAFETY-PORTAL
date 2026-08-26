"""v58.13.61 — Roles Admin merged as tab under Users & Permissions."""
from pathlib import Path

_APP = Path("/app/frontend/src")


def test_sidebar_has_no_roles_admin_entry():
    src = (_APP / "lib/settingsNavRegistry.js").read_text(encoding="utf-8")
    assert "nav-settings-roles-admin" not in src
    assert "'/app/settings/roles-admin'" not in src


def test_app_js_mounts_users_and_roles_shell():
    src = (_APP / "App.js").read_text(encoding="utf-8")
    assert "UsersAndRolesShell" in src
    assert 'data-testid="users-and-roles-shell"' in src
    assert 'data-testid="users-and-roles-tab-users"' in src
    assert 'data-testid="users-and-roles-tab-roles"' in src
    # Both underlying page components still imported.
    assert "import RolesAdmin" in src
    assert "import UsersManagement" in src


def test_roles_admin_url_redirects_to_users_tab():
    src = (_APP / "App.js").read_text(encoding="utf-8")
    assert (
        '<Route path="settings/roles-admin" '
        'element={<Navigate to="/app/settings/users?tab=roles" replace />} />'
    ) in src
    assert "REMOVE AFTER 2026-11-27" in src


def test_version_sync_moved_past_v58_13_60():
    v_js = (_APP / "lib/version.js").read_text(encoding="utf-8")
    m_ts = Path("/app/mobile/src/lib/version.ts").read_text(encoding="utf-8")
    sw_js = Path("/app/frontend/public/service-worker.js").read_text(encoding="utf-8")
    assert "RUNNING_VERSION = 'paneltec-v160.3.9.58.13.60'" not in v_js
    assert "'paneltec-v160.3.9.58.13.60'" not in m_ts
    assert "'paneltec-v160.3.9.58.13.60'" not in sw_js
    assert "v160.3.9.58.13.61" in v_js
