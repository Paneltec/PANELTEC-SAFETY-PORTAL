"""v58.13.132ci — Mobile PIN login · pytests."""
from __future__ import annotations
import re
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent.parent
BACKEND = REPO / "backend"
FRONTEND = REPO / "frontend"
MIN = "132ci"


def _read(p): return p.read_text(encoding="utf-8")


def test_module_exists_and_mounts_router():
    p = BACKEND / "auth_mobile_pin.py"
    assert p.exists()
    src = _read(p)
    assert 'prefix="/auth/mobile"' in src
    assert '@router.post("/pin-login")' in src
    # Server mounts it.
    server = _read(BACKEND / "server.py")
    assert "from auth_mobile_pin import router as auth_mobile_pin_router" in server
    assert "api.include_router(auth_mobile_pin_router)" in server


def test_reuses_admin_console_pin_attempts_ledger():
    src = _read(BACKEND / "auth_mobile_pin.py")
    # MUST reuse the existing collection, not create a new one.
    assert "db.admin_console_pin_attempts" in src
    # Keys are namespaced with `mobile:` so admin-console + mobile
    # counters can't cross-contaminate.
    assert '"mobile:' in src


def test_lockout_tiers_match_brief():
    """Brief: 5 failed → 60s, 10 failed → 15 min. Third tier (20/24h)
    added defensively to catch overnight brute-force sweeps."""
    src = _read(BACKEND / "auth_mobile_pin.py")
    assert "(5,  timedelta(seconds=60))" in src or "(5, timedelta(seconds=60))" in src
    assert "timedelta(minutes=15)" in src
    assert "(10," in src


def test_response_shape_documented():
    src = _read(BACKEND / "auth_mobile_pin.py")
    # All acceptance-criteria fields are returned.
    for f in ("user_id", "role_id", "role_label", "org_id", "org_name",
              "session_token", "session_token_expires_at",
              "permissions_snapshot"):
        assert f'"{f}"' in src, f"missing response field {f!r}"


def test_role_label_fallback_covers_four_core_roles():
    src = _read(BACKEND / "auth_mobile_pin.py")
    for r in ("admin", "paneltec_civil", "viatec_traffic", "external_contractor"):
        assert f'"{r}"' in src, f"missing fallback label for {r}"


def test_device_id_captured_on_login():
    src = _read(BACKEND / "auth_mobile_pin.py")
    # Optional field on the request model.
    assert "device_id: Optional[str]" in src
    # Stored non-destructively on the user.
    assert 'mobile_device_ids' in src
    assert 'last_mobile_device_id' in src


def test_reuses_create_access_token_jwt():
    src = _read(BACKEND / "auth_mobile_pin.py")
    assert "from auth import create_access_token" in src, \
        "must reuse the existing JWT helper, not invent a new token format"


def test_three_way_version_sync_at_132ci():
    vjs = _read(FRONTEND / "src" / "lib" / "version.js")
    sw = _read(FRONTEND / "public" / "service-worker.js")
    def _tok(s, pat):
        m = re.search(pat, s, re.M); assert m; return m.group(1)
    run = _tok(vjs, r"^export const RUNNING_VERSION\s*=\s*'paneltec-v160\.3\.9\.58\.13\.(\d+[a-z]*)'")
    exp = _tok(vjs, r"^export const EXPECTED_CACHE_VERSION\s*=\s*'paneltec-v160\.3\.9\.58\.13\.(\d+[a-z]*)'")
    swv = _tok(sw,  r"^const CACHE_VERSION\s*=\s*'paneltec-v160\.3\.9\.58\.13\.(\d+[a-z]*)'")
    assert run == exp == swv, f"drift: run={run} exp={exp} sw={swv}"
    assert run >= MIN
