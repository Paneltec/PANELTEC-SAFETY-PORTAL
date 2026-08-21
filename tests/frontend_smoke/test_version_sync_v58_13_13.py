"""v58.13.13 — Version-sync guardrail.

Static-grep pytest that asserts the three canonical version strings
are identical, character-for-character, AND that the top changelog
entry in `frontend/src/lib/version.js` references the same version.

This suite exists specifically to catch the bug pattern that produced
v58.13.7 → v58.13.12 drift in the RUNNING_VERSION export:

    v58.13.9  ship: bumped CACHE_VERSION + MOBILE_BUNDLE_VERSION,
                    prepended a changelog block, forgot the
                    RUNNING_VERSION export at line 1910.
    v58.13.10 ship: same pattern.
    v58.13.11 ship: same pattern.
    v58.13.12 ship: same pattern.
    → Result: browsers reported v58.13.7 in every UI surface
      (sidebar footer, ActiveSessionsPanel, UserManual, and the
      CacheBusterBanner mismatch trigger) for four consecutive
      shipped versions. Bundle was always current; the string
      it displayed was not.

Contract enforced here:
    1. All three canonical version strings match exactly.
    2. They match the strict format `paneltec-v<6-part-dotted>`
       (rejects typos like an extra character or missing dot).
    3. The top-of-file changelog banner in version.js opens with
       a `// vXXX` block that references the same version string.

Location: `/app/tests/frontend_smoke/` — outside `--reload-dir
/app/backend`, per the v58.13.10 hard rule.
"""
from __future__ import annotations

import re
from pathlib import Path

VERSION_JS = Path("/app/frontend/src/lib/version.js")
MOBILE_TS = Path("/app/mobile/src/lib/version.ts")
SW_JS = Path("/app/frontend/public/service-worker.js")

# `paneltec-v<major>.<minor>.<patch>.<phase>.<step>.<sub>` — exactly 6
# dot-separated integer parts, all required. Rejects a missing dot,
# an extra dot, or a stray non-digit character.
CANONICAL_RE = re.compile(r"^paneltec-v\d+(?:\.\d+){5}$")


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def _extract(pattern: re.Pattern[str], text: str, file_label: str) -> str:
    m = pattern.search(text)
    if not m:
        raise AssertionError(
            f"Could not locate version constant in {file_label}. "
            "The declaration or its quoting may have changed."
        )
    return m.group(1)


# Precompile the per-file regexes once so failures point at the exact
# grep, not the whole test body.
_RUNNING_VERSION_RE = re.compile(
    r"""^\s*export\s+const\s+RUNNING_VERSION\s*=\s*['"]([^'"]+)['"]""",
    re.MULTILINE,
)
_MOBILE_RE = re.compile(
    r"""^\s*export\s+const\s+MOBILE_BUNDLE_VERSION\s*=\s*['"]([^'"]+)['"]""",
    re.MULTILINE,
)
_CACHE_RE = re.compile(
    r"""^\s*const\s+CACHE_VERSION\s*=\s*['"]([^'"]+)['"]""",
    re.MULTILINE,
)


def _running_version() -> str:
    return _extract(_RUNNING_VERSION_RE, _read(VERSION_JS), "version.js")


def _mobile_version() -> str:
    return _extract(_MOBILE_RE, _read(MOBILE_TS), "mobile/version.ts")


def _cache_version() -> str:
    return _extract(_CACHE_RE, _read(SW_JS), "service-worker.js")


# ─── Canonical shape ───────────────────────────────────────────────────

def test_running_version_matches_canonical_format():
    v = _running_version()
    assert CANONICAL_RE.match(v), (
        f"RUNNING_VERSION={v!r} does not match "
        f"paneltec-v<int>.<int>.<int>.<int>.<int>.<int>."
    )


def test_mobile_version_matches_canonical_format():
    v = _mobile_version()
    assert CANONICAL_RE.match(v), (
        f"MOBILE_BUNDLE_VERSION={v!r} does not match canonical format."
    )


def test_cache_version_matches_canonical_format():
    v = _cache_version()
    assert CANONICAL_RE.match(v), (
        f"CACHE_VERSION={v!r} does not match canonical format."
    )


# ─── Three-way identity ────────────────────────────────────────────────

def test_all_three_canonical_versions_identical():
    rv, mv, cv = _running_version(), _mobile_version(), _cache_version()
    assert rv == mv == cv, (
        "Canonical version strings must be IDENTICAL across all three "
        "files. Current state:\n"
        f"  RUNNING_VERSION       (version.js)         = {rv!r}\n"
        f"  MOBILE_BUNDLE_VERSION (mobile/version.ts)  = {mv!r}\n"
        f"  CACHE_VERSION         (service-worker.js)  = {cv!r}\n"
        "This is the exact drift the v58.13.9→.12 shipping run "
        "produced — see /app/memory/PRD.md ship-checklist."
    )


# ─── Changelog banner must reference the exported version ──────────────

def test_top_changelog_entry_references_current_running_version():
    src = _read(VERSION_JS)
    # Grab the first `// v160....` header line after the file's opening
    # comment banner. This is the "top changelog entry" — the block
    # that documents the ship producing the current RUNNING_VERSION.
    m = re.search(r"//\s*(v160\.\d+(?:\.\d+){3,5}[^\s—]*)\s*—", src)
    assert m, (
        "Could not locate the top changelog banner in version.js. "
        "Every ship must prepend a `// vXXX — <summary>` block."
    )
    top_banner_version = m.group(1)  # e.g. "v160.3.9.58.13.13"
    rv = _running_version()  # e.g. "paneltec-v160.3.9.58.13.13"
    expected_suffix = "paneltec-" + top_banner_version
    assert rv == expected_suffix, (
        "Top changelog entry references "
        f"{top_banner_version!r} but RUNNING_VERSION export is "
        f"{rv!r}. This is the exact drift the v58.13.9-through-.12 "
        "shipping run produced — one of the two lines was updated, "
        "the other forgotten. Fix: bring both in sync."
    )
