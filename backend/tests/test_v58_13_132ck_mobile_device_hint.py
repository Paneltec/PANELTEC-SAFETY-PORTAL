"""v58.13.132ck — Mobile device-hint · pytests."""
from __future__ import annotations
import re
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent.parent
BACKEND = REPO / "backend"
FRONTEND = REPO / "frontend"
MIN = "132ck"


def _read(p): return p.read_text(encoding="utf-8")


MODULE = BACKEND / "auth_mobile_pin.py"


def test_endpoint_registered_no_auth():
    src = _read(MODULE)
    # Endpoint present under the same /auth/mobile prefix.
    assert '@router.get("/device-hint")' in src
    # No `Depends(get_current_user)` on the handler signature.
    m = re.search(r'@_limiter\.limit\([^\)]+\)\s*async def device_hint\([^)]+\)', src)
    assert m, "device_hint handler with rate-limit decorator not found"
    handler_sig = m.group(0)
    assert "Depends(get_current_user)" not in handler_sig, \
        "device-hint must be no-auth (pre-login hint)"


def test_rate_limit_decorator_60_per_min():
    src = _read(MODULE)
    assert '@_limiter.limit("60/minute")' in src, \
        "device-hint must be rate-limited to 60/min per peer IP"


def test_source_lookup_uses_last_mobile_device_id():
    src = _read(MODULE)
    assert '"last_mobile_device_id": device_id' in src, \
        "device-hint lookup must be keyed on `last_mobile_device_id` (newest-owner strategy c)"


def test_response_projection_is_safe_subset_only():
    """Response fields on the bound path MUST be limited to:
    bound, user_first_name, role_label, org_name.
    NO email, id, role_id, org_id, phone, mobile, last_name, token."""
    src = _read(MODULE)
    # Locate the bound-return dict.
    idx = src.index('"bound":            True,')
    block = src[idx: idx + 500]
    # Whitelisted fields.
    for allowed in ('"bound"', '"user_first_name"', '"role_label"', '"org_name"'):
        assert allowed in block, f"missing safe field {allowed}"
    # PII leaks that MUST NOT be in the response.
    for banned in ('"email"', '"phone"', '"mobile"', '"last_name"',
                   '"user_id"', '"role_id"', '"org_id"',
                   '"session_token"', '"token"'):
        assert banned not in block, f"PII leak in device-hint response: {banned}"


def test_disabled_users_fall_through_to_unbound():
    src = _read(MODULE)
    assert 'user.get("status") or "").lower() == "disabled"' in src, \
        "disabled accounts must not surface a friendly greeting"


def test_first_name_fallback_chain():
    src = _read(MODULE)
    assert "def _first_name" in src
    # Prefer first_name → name split → email local-part → 'there' fallback.
    assert '"there"' in src


def test_three_way_version_sync_at_132ck():
    vjs = _read(FRONTEND / "src" / "lib" / "version.js")
    sw = _read(FRONTEND / "public" / "service-worker.js")
    def _tok(s, pat):
        m = re.search(pat, s, re.M); assert m; return m.group(1)
    run = _tok(vjs, r"^export const RUNNING_VERSION\s*=\s*'paneltec-v160\.3\.9\.58\.13\.(\d+[a-z]*)'")
    exp = _tok(vjs, r"^export const EXPECTED_CACHE_VERSION\s*=\s*'paneltec-v160\.3\.9\.58\.13\.(\d+[a-z]*)'")
    swv = _tok(sw,  r"^const CACHE_VERSION\s*=\s*'paneltec-v160\.3\.9\.58\.13\.(\d+[a-z]*)'")
    assert run == exp == swv, f"drift: run={run} exp={exp} sw={swv}"
    assert run >= MIN
