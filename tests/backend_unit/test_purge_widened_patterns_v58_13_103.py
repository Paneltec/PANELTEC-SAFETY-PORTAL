"""v58.13.103 — Widened purge patterns + AuditExports PDF blob helper.

Source-scan tests. Runtime purge + PDF-open proofs are captured in the
ship report (curl through the live backend before/after). This pytest
guards the code STRUCTURE so a future refactor can't silently
reintroduce either the missed-prefix regression class OR the bare-anchor
auth mismatch on file downloads.
"""
from __future__ import annotations
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
MOBILE = ROOT / "mobile"

PURGE_PY = (BACKEND / "admin_purge_test_data.py").read_text(encoding="utf-8")
AUDIT_JSX = (FRONTEND / "src" / "pages" / "AuditExports.jsx").read_text(encoding="utf-8")
DOWNLOADS_JS = (FRONTEND / "src" / "lib" / "downloads.js").read_text(encoding="utf-8")
VERSION_JS = (FRONTEND / "src" / "lib" / "version.js").read_text(encoding="utf-8")
SW_JS = (FRONTEND / "public" / "service-worker.js").read_text(encoding="utf-8")
MOBILE_TS = (MOBILE / "src" / "lib" / "version.ts").read_text(encoding="utf-8")


# ── Widened TEST_PATTERNS ────────────────────────────────────────

NEW_PATTERNS_REQUIRED = [
    r"^TEST[_ .]",
    r"^Test ",
    r"^test[_ .]",
    r"^zSCRATCH",
    r"^SCRATCH[-_]",
    r"^scratch[-_]",
    r"^dummy[-_]",
    r"^fake[-_.]",
    r"^example[-_]",
    r"^foobar",
    r"^dev[-_]",
    r"^qa[-_]",
    r"^staging[-_]",
    r"^[a-zA-Z]+v\d+-\d{10,}",
]


def test_each_new_pattern_present():
    """Every one of the 14 .103 additions must appear in the source."""
    for pat in NEW_PATTERNS_REQUIRED:
        # `pat` is already a Python source-form regex; look for it as
        # a literal substring (patterns are stored via `r"…"` strings).
        assert pat in PURGE_PY, f"missing widened pattern: {pat!r}"


def test_scratch_prefix_anchored_only():
    """Bare `scratch` MUST NOT be in the whitelist — it would delete
    narrative text like 'scratched front lower nose cone'. Only
    prefix-anchored variants are allowed."""
    m = re.search(
        r'^\s*r"[^"]*\bscratch\b[^"]*"\s*,',
        PURGE_PY,
        re.MULTILINE,
    )
    while m:
        line = m.group(0)
        # If this line contains bare `scratch` without a `^` anchor OR
        # without a separator right after, fail.
        # Accept: `^SCRATCH[-_]`, `^scratch[-_]`, `^zSCRATCH`.
        # Reject: any pattern containing `scratch` but not anchored.
        if not re.search(r'r"\^[A-Za-z]*scratch(?:[-_\[]|\b)', line, re.IGNORECASE):
            raise AssertionError(
                f"unsafe scratch-related pattern in TEST_PATTERNS: {line.strip()}"
            )
        m = re.search(
            r'^\s*r"[^"]*\bscratch\b[^"]*"\s*,',
            PURGE_PY[m.end():],
            re.MULTILINE,
        )


def test_demo_prefix_anchored_only():
    """Bare `^demo` (no separator) MUST NOT be present — it would match
    'Demolition' SWMS records. Only `^demo-` is allowed."""
    # Every occurrence of `^demo` in a pattern string must be followed
    # by a `-` (kept from .81) or an explicit character class.
    for m in re.finditer(r'r"(\^demo[^"]*)"', PURGE_PY):
        body = m.group(1)
        # Body must be `^demo-` (or start with `^demo` followed by `[`
        # or another separator). Explicitly reject bare `^demo` on
        # its own or `^demo[a-z]`.
        assert re.match(r'^\^demo[-_\[ .]', body), (
            f"unsafe demo pattern: {body!r} — would match 'Demolition' narrative"
        )


def test_zscratch_and_structural_patterns_both_present():
    """The user-reported `zSCRATCHv51-1787556742968` must be caught by
    BOTH the literal `^zSCRATCH` AND the structural alpha-vN-timestamp
    pattern (belt-and-braces)."""
    assert r'r"^zSCRATCH"' in PURGE_PY, "^zSCRATCH literal pattern missing"
    assert r'r"^[a-zA-Z]+v\d+-\d{10,}"' in PURGE_PY, (
        "structural alpha-vN-<10+digit-timestamp> pattern missing"
    )


# ── AuditExports.jsx: blob helper + no bare anchors ─────────────

def test_open_authed_file_helper_defined():
    """v58.13.105 hoisted `openAuthedFile` to `lib/downloads.js`
    (shared across AuditExports, Dashboard, Forms, Outbox). Pin the
    shared module here + assert AuditExports imports it."""
    m = re.search(
        r"export\s+async\s+function\s+openAuthedFile\s*\(\s*fileUrl\s*,\s*filename[\s\S]{0,800}?"
        r"api\.get\(\s*path\s*,\s*\{\s*responseType:\s*['\"]blob['\"]",
        DOWNLOADS_JS,
    )
    assert m, "openAuthedFile helper missing from lib/downloads.js OR does not call api.get with responseType:'blob'"
    assert re.search(
        r"import\s*\{\s*openAuthedFile\s*\}\s*from\s*['\"]\.\./lib/downloads['\"]",
        AUDIT_JSX,
    ), "AuditExports.jsx does not import the shared openAuthedFile"


def test_open_authed_file_strips_api_prefix():
    """Backend `file_url` values already start with `/api/…`. The
    shared axios `api` instance re-adds `/api` via its baseURL — so
    the helper MUST strip the prefix before passing to axios,
    otherwise the request goes to `/api/api/files/...` and 404s."""
    assert re.search(
        r"replace\(\s*/\^\\?/api/\s*,\s*['\"]{2}\s*\)",
        DOWNLOADS_JS,
    ), "openAuthedFile does not strip the leading /api prefix"


def test_no_bare_href_backend_file_url_anchors():
    """Regression guard: no `<a href={`${BACKEND}${…file_url}`
    target="_blank">` pattern may remain on any download surface in
    AuditExports.jsx. That's the exact shape that broke bearer auth."""
    # Match the specific shape our previous code used across the three
    # download sites.
    offenders = re.findall(
        r'<a\s+href=\{`\$\{BACKEND\}\$\{[^}]*file_url[^}]*\}`\s*\}\s+target="_blank"',
        AUDIT_JSX,
    )
    assert not offenders, (
        f"found bare-anchor download sites still present: {offenders}"
    )


def test_download_buttons_call_open_authed_file():
    """All three former anchor sites must still expose their testids
    (as JSX template literals) AND call openAuthedFile. Post-.105 the
    helper is imported (not defined locally), so we expect >=3 call
    sites in the JSX plus 1 import statement, for a total of >=4
    `openAuthedFile` references in the file."""
    for tid_substring in (
        "export-download-${row.format}-${row.id}",
        "export-view-${anchor.id}",
        "export-download-${anchor.id}",
    ):
        assert tid_substring in AUDIT_JSX, f"missing testid substring: {tid_substring}"
    call_sites = len(re.findall(r'\bopenAuthedFile\b', AUDIT_JSX))
    assert call_sites >= 4, (
        f"expected >=4 openAuthedFile references (1 import + 3 call sites), got {call_sites}"
    )


# ── Version-sync forward-safe pin >= 103 ────────────────────────

def _tail(text, name):
    m = re.search(rf"{name}\s*=\s*['\"]paneltec-v[\d.]+\.(\d+)[a-z]*['\"]", text)
    assert m, f"could not read tail of {name}"
    return int(m.group(1))


def test_running_version_gte_103():
    assert _tail(VERSION_JS, "RUNNING_VERSION") >= 103


def test_cache_version_gte_103():
    assert _tail(SW_JS, "CACHE_VERSION") >= 103


def test_mobile_bundle_version_gte_103():
    assert _tail(MOBILE_TS, "MOBILE_BUNDLE_VERSION") >= 103
