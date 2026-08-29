"""v58.13.63 — localStorage whitelist guard.

The platform JWT (`paneltec_token`) lives in `localStorage` by
design (see the docstring at the top of `frontend/src/lib/api.js`).
This test freezes the invariant so any NEW file that starts poking
at that key — or at the `bulkImport.*` job-UUID keys outside the
BulkImport page tree — will fail CI before it ships.

Static source scan only. Reads files off disk with a small
allow-list of read/write sites. If someone adds a new site, the
test message tells them to either add it to the whitelist (if it's
a legit shared helper) or refactor to import the shared axios
instance from `lib/api.js` (the correct answer for 99% of new
callers).
"""
from __future__ import annotations

import re
from pathlib import Path

_FRONTEND_SRC = Path("/app/frontend/src")

# Files that may WRITE the JWT — the auth + api modules only.
_JWT_WRITE_ALLOWED = {
    _FRONTEND_SRC / "lib" / "auth.js",
    _FRONTEND_SRC / "lib" / "api.js",  # only for the 401-drop path
}

# Files that may READ the JWT via `localStorage.getItem(TOKEN_KEY)`
# — these are all the pages that need a Bearer header on a fetch
# that doesn't go through the shared axios instance in `lib/api.js`.
# Every entry here has been reviewed and cannot trivially switch to
# the shared axios instance (BackupTab uses a second axios with a
# different baseURL, SetupWizard/BackupStatusHero use `fetch()`).
_JWT_READ_ALLOWED = {
    _FRONTEND_SRC / "lib" / "auth.js",
    _FRONTEND_SRC / "lib" / "api.js",
    _FRONTEND_SRC / "pages" / "settings" / "SetupWizard.jsx",
    _FRONTEND_SRC / "pages" / "settings" / "BackupTab.jsx",
    _FRONTEND_SRC / "pages" / "settings" / "BackupStatusHero.jsx",
}

# The BulkImport pill + wizard co-own two localStorage keys for
# cross-tab job-in-flight sync. Both must stay under this subtree.
_BULK_IMPORT_ALLOWED_ROOT = _FRONTEND_SRC / "pages" / "prestarts" / "BulkImport"

_TOKEN_KEY_LITERAL = "'paneltec_token'"
_JWT_WRITE_PATTERNS = [
    re.compile(r"localStorage\.setItem\(\s*TOKEN_KEY"),
    # Direct literal — should never be used, but the whitelist below
    # will catch it as a violation if some file starts using it.
    re.compile(r"localStorage\.setItem\(\s*['\"]paneltec_token['\"]"),
]
_JWT_READ_PATTERNS = [
    re.compile(r"localStorage\.getItem\(\s*TOKEN_KEY"),
    re.compile(r"localStorage\.getItem\(\s*['\"]paneltec_token['\"]"),
]
_BULK_IMPORT_PATTERN = re.compile(r"bulkImport\.(activeJobId|dismissedJobId)")


def _iter_source_files():
    for p in _FRONTEND_SRC.rglob("*"):
        if not p.is_file():
            continue
        if p.suffix not in {".js", ".jsx", ".ts", ".tsx"}:
            continue
        # Skip node_modules / build outputs that shouldn't be here
        # anyway but be defensive.
        if (any(part in {"node_modules", "build", "dist"} for part in p.parts)):
            continue
        # `lib/version.js` is a documentation changelog file — its
        # comments can freely mention key names (`paneltec_token`,
        # `bulkImport.activeJobId`) without those being real
        # localStorage callsites. Exclude it from every source scan.
        if p == _FRONTEND_SRC / "lib" / "version.js":
            continue
        yield p


def test_only_whitelisted_files_write_platform_jwt():
    offenders = []
    for path in _iter_source_files():
        text = path.read_text(encoding="utf-8", errors="ignore")
        for pat in _JWT_WRITE_PATTERNS:
            if pat.search(text):
                if path not in _JWT_WRITE_ALLOWED:
                    offenders.append(str(path))
                break
    assert not offenders, (
        "The following file(s) write `paneltec_token` outside the "
        "whitelist. Either move the write into `lib/auth.js` (the "
        "correct answer) or add the path to _JWT_WRITE_ALLOWED after "
        f"a security review:\n  " + "\n  ".join(offenders)
    )


def test_only_whitelisted_files_read_platform_jwt():
    offenders = []
    for path in _iter_source_files():
        text = path.read_text(encoding="utf-8", errors="ignore")
        for pat in _JWT_READ_PATTERNS:
            if pat.search(text):
                if path not in _JWT_READ_ALLOWED:
                    offenders.append(str(path))
                break
    assert not offenders, (
        "The following file(s) read `paneltec_token` from "
        "localStorage but are NOT in the read whitelist. In almost "
        "every case the fix is to `import api from '@/lib/api'` and "
        "let its request interceptor attach the Bearer header — no "
        "direct localStorage access needed. Only add to "
        "_JWT_READ_ALLOWED if the site fundamentally cannot use the "
        f"shared axios instance:\n  " + "\n  ".join(offenders)
    )


def test_no_literal_paneltec_token_string_outside_api():
    """The literal string `'paneltec_token'` must only appear in
    `lib/api.js` (where `TOKEN_KEY` is defined). Every other module
    must import `TOKEN_KEY` — that way a future key rotation is a
    single-line change."""
    offenders = []
    allowed = {_FRONTEND_SRC / "lib" / "api.js"}
    for path in _iter_source_files():
        text = path.read_text(encoding="utf-8", errors="ignore")
        if _TOKEN_KEY_LITERAL in text or '"paneltec_token"' in text:
            if path not in allowed:
                offenders.append(str(path))
    assert not offenders, (
        "Literal `'paneltec_token'` string appears outside "
        "`lib/api.js`. Import `TOKEN_KEY` from `@/lib/api` instead so "
        f"the key can be rotated in one place:\n  " + "\n  ".join(offenders)
    )


def test_bulk_import_localstorage_keys_confined_to_subtree():
    """`bulkImport.activeJobId` and `bulkImport.dismissedJobId` are
    used by the pill + wizard for cross-tab job-in-flight sync. They
    must not leak outside that subtree."""
    offenders = []
    for path in _iter_source_files():
        text = path.read_text(encoding="utf-8", errors="ignore")
        if _BULK_IMPORT_PATTERN.search(text):
            try:
                path.relative_to(_BULK_IMPORT_ALLOWED_ROOT)
            except ValueError:
                offenders.append(str(path))
    assert not offenders, (
        "The following file(s) use a `bulkImport.*` localStorage key "
        "outside `pages/prestarts/BulkImport/`. Move the callsite "
        "into that subtree or plumb job state through props/context "
        f"instead:\n  " + "\n  ".join(offenders)
    )


def test_lib_api_carries_storage_decision_doccluster():
    """The `lib/api.js` doc-cluster explaining WHY the JWT lives in
    localStorage must be present. If a future refactor removes it,
    this test will remind them to re-document the decision."""
    src = (_FRONTEND_SRC / "lib" / "api.js").read_text(encoding="utf-8")
    for marker in (
        "v58.13.63",
        "token_version",
        "HttpOnly refresh cookie",
        "Whitelist",
    ):
        assert marker in src, (
            f"lib/api.js is missing the doc-cluster marker {marker!r} "
            "— the localStorage storage decision needs to stay "
            "documented in-source"
        )


def test_version_sync_moved_past_v58_13_62():
    v_js = Path("/app/frontend/src/lib/version.js").read_text(encoding="utf-8")
    m_ts = Path("/app/mobile/src/lib/version.ts").read_text(encoding="utf-8")
    sw_js = Path(
        "/app/frontend/public/service-worker.js"
    ).read_text(encoding="utf-8")
    assert "RUNNING_VERSION = 'paneltec-v160.3.9.58.13.62'" not in v_js
    assert "'paneltec-v160.3.9.58.13.62'" not in m_ts
    assert "'paneltec-v160.3.9.58.13.62'" not in sw_js
    assert "v160.3.9.58.13.63" in v_js
