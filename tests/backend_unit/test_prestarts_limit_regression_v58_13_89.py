"""v58.13.89 — P0 hotfix: Pre-starts frontend limit regression.

Guards against re-introducing the `limit: 50000` bug that fell off the
v58.13.84 A3 cap-drop grep sweep. Every rule here is a source-scan
(no live-server dependency).
"""
from __future__ import annotations
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FRONTEND = ROOT / "frontend"
MOBILE = ROOT / "mobile"

PRESTARTS_JSX = (FRONTEND / "src" / "pages" / "PreStarts.jsx").read_text(encoding="utf-8")
VERSION_JS = (FRONTEND / "src" / "lib" / "version.js").read_text(encoding="utf-8")
SW_JS = (FRONTEND / "public" / "service-worker.js").read_text(encoding="utf-8")
MOBILE_TS = (MOBILE / "src" / "lib" / "version.ts").read_text(encoding="utf-8")


# ── Frontend limit + fetch layer ──────────────────────────────────

def test_prestarts_fetch_uses_5000_limit():
    """The on-mount fetch must ask for at most 5000 rows — the current
    backend cap set by v58.13.84 A3."""
    m = re.search(
        r"api\.get\(\s*['\"]/pre-starts['\"]\s*,\s*\{\s*params:\s*\{\s*limit:\s*(\d+)\s*\}\s*\}",
        PRESTARTS_JSX,
    )
    assert m, "PreStarts.jsx no longer calls api.get('/pre-starts', {params:{limit:N}})"
    assert int(m.group(1)) <= 5000, (
        f"PreStarts.jsx is passing limit={m.group(1)} — v58.13.84 A3 caps at 5000 "
        f"and the request will 422."
    )
    # The old smoking-gun value must not appear as an ACTIVE axios param
    # any more. It's legitimately allowed to appear in the changelog
    # comment that documents the fix — so we only reject the code form,
    # not the substring anywhere in the file.
    assert re.search(r"limit:\s*50000\b", m.group(0)) is None
    # And more broadly: no active axios call in the file still passes
    # limit>5000.
    for call in re.finditer(r"api\.get\([^)]*limit:\s*(\d+)", PRESTARTS_JSX):
        assert int(call.group(1)) <= 5000, (
            f"PreStarts.jsx still contains an active axios call with limit={call.group(1)}"
        )


def test_prestarts_fetch_classifies_error_kind():
    """The catch branch must classify 4xx as `client` and 5xx / network
    as `network` so the retry loop and the banner can react sensibly."""
    m = re.search(
        r"const fetchItems = useCallback\(async \(attempt = 0\) => \{[\s\S]+?\}, \[\]\);",
        PRESTARTS_JSX,
    )
    assert m, "PreStarts.jsx::fetchItems not found"
    body = m.group(0)
    # status extraction
    assert "err?.response?.status" in body
    # explicit 4xx classifier
    assert "isClientError" in body
    assert re.search(r"status\s*>=\s*400\s*&&\s*status\s*<\s*500", body)
    # loadError carries the kind
    assert re.search(r"kind:\s*isClientError\s*\?\s*['\"]client['\"]\s*:\s*['\"]network['\"]", body)


def test_prestarts_fetch_skips_retry_on_client_error():
    """A 4xx must NOT enqueue a retry. Retrying with the same params
    will always fail identically."""
    m = re.search(
        r"const fetchItems = useCallback\(async \(attempt = 0\) => \{[\s\S]+?\}, \[\]\);",
        PRESTARTS_JSX,
    )
    body = m.group(0)
    # The retry setTimeouts must be inside a `if (!isClientError)` guard.
    assert "if (!isClientError)" in body
    # And the two retry timers (3000ms + 10000ms) both live INSIDE that
    # guard. Match the guard as `if (!isClientError) { … <second if …> }`
    # using nested-brace tolerance.
    guard = re.search(
        r"if \(!isClientError\)\s*\{[\s\S]+?setTimeout[\s\S]+?3000[\s\S]+?setTimeout[\s\S]+?10000[\s\S]+?\}",
        body,
    )
    assert guard, "retry block does not contain both 3000ms + 10000ms timers under the !isClientError guard"


def test_prestarts_banner_branches_on_error_kind():
    """The banner JSX must render distinct copy for `kind === 'client'`
    vs `kind === 'network'` and carry a `data-error-kind` attribute for
    downstream tests."""
    assert "data-error-kind" in PRESTARTS_JSX
    # Both banner variants must be present. The network-branch string
    # is a JS string literal (uses `'` not `&apos;`).
    assert "Request too large." in PRESTARTS_JSX
    assert "Couldn't reach the server." in PRESTARTS_JSX
    # The kind-driven className switch is present.
    assert "loadError.kind === 'client'" in PRESTARTS_JSX
    # Retry button preserved on both branches.
    assert 'data-testid="prestarts-load-error-retry"' in PRESTARTS_JSX


# ── Version-sync forward-safe pin >= 89 ──────────────────────────

def _tail(text: str, name: str) -> int:
    m = re.search(rf"{name}\s*=\s*['\"]paneltec-v[\d.]+\.(\d+)[a-z]*['\"]", text)
    assert m, f"{name} not found"
    return int(m.group(1))


def test_running_version_gte_89():
    assert _tail(VERSION_JS, "RUNNING_VERSION") >= 89


def test_cache_version_gte_89():
    assert _tail(SW_JS, "CACHE_VERSION") >= 89


def test_mobile_bundle_version_gte_89():
    assert _tail(MOBILE_TS, "MOBILE_BUNDLE_VERSION") >= 89
