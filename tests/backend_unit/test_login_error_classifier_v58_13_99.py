"""v58.13.99 — Sign-in error classifier: 5xx / 520 / network-down
stops masquerading as "Invalid password".

Source-scan tests. Follow the pattern established by v58.13.98 (see
`test_deferred_startup_v58_13_98.py`) — verify the refactor structure
via regex against the JS source so a future edit that reintroduces
the false "invalid password" copy on a 5xx / network failure fails
CI immediately.

Runtime end-to-end proofs are captured in the ship report; those
require a live browser environment which this pytest suite does not
provide. The source-pin coverage here is sufficient to guard the
regression class.
"""
from __future__ import annotations
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FRONTEND = ROOT / "frontend"
MOBILE = ROOT / "mobile"

API_JS = (FRONTEND / "src" / "lib" / "api.js").read_text(encoding="utf-8")
COVER_JSX = (FRONTEND / "src" / "pages" / "Cover.jsx").read_text(encoding="utf-8")
LOGIN_JSX = (FRONTEND / "src" / "pages" / "Login.jsx").read_text(encoding="utf-8")
VERSION_JS = (FRONTEND / "src" / "lib" / "version.js").read_text(encoding="utf-8")
SW_JS = (FRONTEND / "public" / "service-worker.js").read_text(encoding="utf-8")
MOBILE_TS = (MOBILE / "src" / "lib" / "version.ts").read_text(encoding="utf-8")


# ── lib/api.js: classifyAuthError exists and behaves ──────────────

def test_classify_auth_error_is_exported():
    """Named export `classifyAuthError` must be present in lib/api.js."""
    assert re.search(
        r"export\s+function\s+classifyAuthError\s*\(", API_JS
    ), "classifyAuthError is not exported from lib/api.js"


def _classifier_body() -> str:
    """Extract the body of classifyAuthError for the branch-order pins."""
    m = re.search(
        r"export\s+function\s+classifyAuthError\s*\([\s\S]+?\n\}",
        API_JS,
    )
    assert m, "classifyAuthError body not found"
    return m.group(0)


def test_no_response_returns_server_down():
    """When err.response is falsy (offline / DNS / CORS-preflight / drop),
    the classifier MUST return the server_down kind — not credentials."""
    body = _classifier_body()
    # Anchor: the first branch after `const resp = err?.response` inspects
    # `!resp` and returns kind:'server_down'.
    m = re.search(
        r"const\s+resp\s*=\s*err\?\.response;[\s\S]{0,200}?if\s*\(\s*!resp\s*\)\s*\{[\s\S]{0,300}?kind:\s*['\"]server_down['\"]",
        body,
    )
    assert m, (
        "classifyAuthError does not handle the no-response case as "
        "server_down — a network-down would fall through to credentials"
    )


def test_5xx_returns_server_down_before_credentials():
    """5xx (incl. 502/503/504/520) MUST be classified BEFORE the 401/403
    branch — otherwise a 520 could still render as 'Invalid password'
    if the ordering is ever accidentally swapped."""
    body = _classifier_body()
    idx_5xx = body.find("status >= 500")
    idx_credentials = body.find("'credentials'")
    assert idx_5xx > -1, "5xx branch missing"
    assert idx_credentials > -1, "credentials branch missing"
    assert idx_5xx < idx_credentials, (
        "5xx branch must appear BEFORE the credentials branch — "
        "otherwise a 520 falls through to 'Invalid password'"
    )
    # And the 5xx branch returns server_down.
    m = re.search(
        r"status\s*>=\s*500\s*&&\s*status\s*<=\s*599[\s\S]{0,300}?kind:\s*['\"]server_down['\"]",
        body,
    )
    assert m, "5xx branch does not return kind:'server_down'"


def test_429_delegates_to_apierror():
    """429 branch must exist and use the existing 429 handling in
    apiError so the retry_after_seconds copy from v58.13.88 survives."""
    body = _classifier_body()
    m = re.search(
        r"status\s*===\s*429[\s\S]{0,200}?kind:\s*['\"]rate_limit['\"][\s\S]{0,200}?apiError\(err\)",
        body,
    )
    assert m, "429 branch does not delegate to apiError for the message"


def test_disabled_branch_before_credentials():
    """account-disabled MUST be caught BEFORE the 401/403 credentials
    branch. Otherwise a disabled account gets the misleading 'Invalid
    password' copy."""
    body = _classifier_body()
    idx_disabled = body.find("'disabled'")
    idx_credentials = body.find("'credentials'")
    assert idx_disabled > -1
    assert idx_credentials > -1
    assert idx_disabled < idx_credentials, (
        "'disabled' branch must appear BEFORE 'credentials' branch — "
        "a disabled account otherwise gets misleading bad-password copy"
    )
    # Detection via x-auth-reason header OR /disabled/i on backend detail.
    assert re.search(
        r"reason\s*===\s*['\"]account-disabled['\"]", body
    ), "x-auth-reason: account-disabled path missing"
    assert re.search(
        r"/disabled/i\.test", body
    ), "detail-string /disabled/i regex missing"


def test_401_and_403_map_to_credentials():
    body = _classifier_body()
    m = re.search(
        r"status\s*===\s*401\s*\|\|\s*status\s*===\s*403[\s\S]{0,300}?kind:\s*['\"]credentials['\"][\s\S]{0,300}?Invalid email or password",
        body,
    )
    assert m, "401/403 do not map to the credentials message"


def test_422_maps_to_validation():
    body = _classifier_body()
    m = re.search(
        r"status\s*===\s*422[\s\S]{0,200}?kind:\s*['\"]validation['\"]",
        body,
    )
    assert m, "422 does not map to the validation kind"


def test_unknown_fallback_does_not_accuse_bad_password():
    """The final fallback for unmatched statuses must NEVER surface
    an 'Invalid password'-like default copy. This is the whole point
    of the ship."""
    body = _classifier_body()
    # Find the "unknown" branch specifically.
    m = re.search(
        r"kind:\s*['\"]unknown['\"][\s\S]{0,300}?message:\s*([^\n]+)",
        body,
    )
    assert m, "unknown branch missing"
    unknown_msg_expr = m.group(1)
    # The message should either delegate to apiError OR fall back to a
    # generic "Could not sign in" copy. It must NOT be a literal
    # "Invalid password" string.
    assert "Invalid" not in unknown_msg_expr or "apiError" in unknown_msg_expr, (
        "unknown fallback still contains a hardcoded 'Invalid password' — "
        "this defeats the point of v58.13.99"
    )


# ── apiError unchanged regression guard ───────────────────────────

def test_apierror_still_handles_429_verbatim():
    """40+ callers rely on apiError's existing behaviour. The .99 ship
    must NOT alter its 429 or fallback logic."""
    m = re.search(
        r"export\s+function\s+apiError\s*\(e\)\s*\{[\s\S]+?\n\}",
        API_JS,
    )
    assert m, "apiError body not found"
    body = m.group(0)
    # Same 429 short-circuit as .88 — preserved.
    assert "status === 429" in body
    assert "retry_after_seconds" in body


# ── Cover.jsx and Login.jsx wire-in ───────────────────────────────

def test_cover_imports_classify_auth_error():
    assert re.search(
        r"import\s*\{\s*classifyAuthError\s*\}\s*from\s*['\"]\.\./lib/api['\"]",
        COVER_JSX,
    ), "Cover.jsx does not import classifyAuthError"


def test_cover_uses_classifier_in_catch():
    """Cover.jsx doLogin catch must call classifyAuthError."""
    assert re.search(
        r"classifyAuthError\(err\)",
        COVER_JSX,
    ), "Cover.jsx does not call classifyAuthError(err)"


def test_cover_no_longer_has_raw_disabled_string_check():
    """The old `msg.toLowerCase().includes('disabled')` string sniffing
    (that used to be Cover.jsx's only 5xx-vs-401 differentiator) must
    be removed — the classifier handles that path now."""
    assert not re.search(
        r"\.toLowerCase\(\)\.includes\(\s*['\"]disabled['\"]\s*\)",
        COVER_JSX,
    ), (
        "Cover.jsx still contains the raw '.toLowerCase().includes(disabled)' "
        "branch — the classifier should own that logic"
    )


def test_login_jsx_imports_classify_auth_error():
    assert re.search(
        r"classifyAuthError",
        LOGIN_JSX,
    ), "legacy Login.jsx does not use classifyAuthError"


def test_login_jsx_submit_uses_classifier():
    """The legacy Login.jsx surface (deprecated but kept on disk per the
    file's own header) must stay in lock-step with Cover.jsx so a
    future re-route can't silently reintroduce the misclassification."""
    m = re.search(
        r"try\s*\{[\s\S]{0,400}?login\(email,\s*password[\s\S]{0,400}?catch\s*\(err\)[\s\S]{0,300}?classifyAuthError\(err\)",
        LOGIN_JSX,
    )
    assert m, "Login.jsx submit() catch does not call classifyAuthError"


def test_login_jsx_simpro_uses_classifier():
    m = re.search(
        r"loginWithSimpro\(email\)[\s\S]{0,400}?catch\s*\(err\)[\s\S]{0,400}?classifyAuthError\(err\)",
        LOGIN_JSX,
    )
    assert m, "Login.jsx submitSimpro() catch does not call classifyAuthError"


# ── Version-sync forward-safe pin >= 99 ───────────────────────────

def _tail(text, name):
    m = re.search(rf"{name}\s*=\s*['\"]paneltec-v[\d.]+\.(\d+)['\"]", text)
    assert m, f"could not read tail of {name}"
    return int(m.group(1))


def test_running_version_gte_99():
    assert _tail(VERSION_JS, "RUNNING_VERSION") >= 99


def test_cache_version_gte_99():
    assert _tail(SW_JS, "CACHE_VERSION") >= 99


def test_mobile_bundle_version_gte_99():
    assert _tail(MOBILE_TS, "MOBILE_BUNDLE_VERSION") >= 99
