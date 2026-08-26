"""v58.13.52 — Document Library folder-detail colour grouping.

Static (source-code) smoke test. We don't need to spin up Playwright
just to confirm the JSX structure — a hermetic grep-assert is
enough to guarantee the wire-up survives future refactors.

Guards:
  1. `DocumentLibraryFolder` imports `resolveGroupPalette` from the
     shared `groupPalette` module.
  2. The IMS-NN parse regex `IMS-(\\d{1,3})…` is present.
  3. The fallback chain (IMS → ai_tags[0] → mime bucket → "Other")
     is intact — verified by grepping for the tell-tale tokens.
  4. Group-header rows carry `data-testid="doc-library-group-<key>"`.
  5. Data rows apply a 4-px left stripe via inline style
     `borderLeft: '4px solid <hex>'`.
  6. Version-sync pin — this ship must bump all 3 canonical files
     to v58.13.52.
"""
from __future__ import annotations

import re
from pathlib import Path


_FRONTEND_SRC = Path("/app/frontend/src")


def _read(rel: str) -> str:
    return (_FRONTEND_SRC / rel).read_text(encoding="utf-8")


# ── 1. import wiring ────────────────────────────────────────────────


def test_document_library_imports_resolve_group_palette():
    src = _read("pages/DocumentLibrary.jsx")
    assert (
        "from '../lib/groupPalette'" in src
        or 'from "../lib/groupPalette"' in src
    ), "DocumentLibrary.jsx must import from ../lib/groupPalette"
    assert "resolveGroupPalette" in src, (
        "DocumentLibrary.jsx must import resolveGroupPalette by name"
    )


# ── 2. IMS regex ────────────────────────────────────────────────────


def test_ims_prefix_regex_is_defined():
    src = _read("pages/DocumentLibrary.jsx")
    assert "IMS_PREFIX_RE" in src, "IMS_PREFIX_RE constant missing"
    # Confirm the regex covers the observed pattern `IMS-04.01`,
    # `IMS-05.05a`, `IMS-10` — one to three digits, optional
    # `.NN[a-z]?` sub-section.
    assert re.search(
        r"IMS_PREFIX_RE\s*=\s*/IMS-\(\\d\{1,3\}\)\(\?:\\.\\d\+\[a-z\]\?\)\?/i",
        src,
    ), "IMS_PREFIX_RE must match `/IMS-(\\d{1,3})(?:\\.\\d+[a-z]?)?/i`"


# ── 3. fallback chain ───────────────────────────────────────────────


def test_group_key_fallback_chain_is_ims_tag_mime_other():
    src = _read("pages/DocumentLibrary.jsx")
    body = src.split("function docLibraryGroupKey", 1)[1].split("\n}\n", 1)[0]
    # IMS branch
    assert "IMS_PREFIX_RE.exec" in body, "IMS regex fallback missing"
    assert "padStart(2" in body, "IMS number must be zero-padded to 2 digits"
    # ai_tags branch
    assert "f.ai_tags" in body, "ai_tags fallback missing"
    # mime bucket branch
    assert "_mimeBucket" in body, "mime-bucket fallback missing"
    # final "Other"
    assert "'Other'" in body or '"Other"' in body, (
        "final 'Other' fallback missing"
    )


def test_group_ordering_puts_other_last():
    src = _read("pages/DocumentLibrary.jsx")
    body = src.split("function groupFilesForDisplay", 1)[1].split("\n}\n", 1)[0]
    # Explicit "Other last" branch
    assert "'Other'" in body, "grouping helper must reference 'Other'"
    assert "localeCompare" in body, (
        "group keys must sort by localeCompare with numeric ordering"
    )
    assert "numeric: true" in body, (
        "expected numeric-aware localeCompare (so IMS-10 sorts after IMS-2)"
    )


# ── 4. group-header rows carry testids ──────────────────────────────


def test_group_header_row_has_testid_and_palette_style():
    src = _read("pages/DocumentLibrary.jsx")
    assert 'data-testid={`doc-library-group-${groupKey}`}' in src, (
        "group-header row must carry data-testid=\"doc-library-group-<key>\""
    )
    # Header row uses palette.tint background + 3px palette.hex left border.
    assert "backgroundColor: palette.tint" in src, (
        "group-header row must tint its background from palette.tint"
    )
    assert "borderLeft: `3px solid ${palette.hex}`" in src, (
        "group-header row must show a 3-px palette.hex left border"
    )


# ── 5. data rows carry the 4-px stripe + tinted file icon ───────────


def test_data_rows_carry_4px_stripe_and_tinted_icon():
    src = _read("pages/DocumentLibrary.jsx")
    # 4-px left stripe on the data-row style.
    assert "borderLeft: `4px solid ${palette.hex}`" in src, (
        "each file-row must show a 4-px palette.hex left stripe"
    )
    # File-icon span switches from `text-slate-400` to inline
    # palette.hex color.
    assert "color: palette.hex" in src, (
        "file-icon span must inherit palette.hex, not text-slate-400"
    )


# ── 6. resolveGroupPalette gets the document-library page slug ──────


def test_resolve_group_palette_receives_document_library_page_slug():
    src = _read("pages/DocumentLibrary.jsx")
    assert "resolveGroupPalette({ groupKey, page: 'document-library' })" in src, (
        "resolveGroupPalette must be called with page: 'document-library'"
    )


# ── 7. version-sync pin for this ship ───────────────────────────────
# Forward-safe pattern (see v58.13.51 recurrence note): only pin
# what THIS ship was born with. The next ship's own test-file will
# assert its own version.


def test_version_sync_moved_past_v58_13_51():
    v_js = Path("/app/frontend/src/lib/version.js").read_text(encoding="utf-8")
    m_ts = Path("/app/mobile/src/lib/version.ts").read_text(encoding="utf-8")
    sw_js = Path("/app/frontend/public/service-worker.js").read_text(encoding="utf-8")
    assert "RUNNING_VERSION = 'paneltec-v160.3.9.58.13.51'" not in v_js
    assert "'paneltec-v160.3.9.58.13.51'" not in m_ts
    assert "'paneltec-v160.3.9.58.13.51'" not in sw_js
    assert "v160.3.9.58.13.52" in v_js, (
        "v58.13.52 changelog block missing from version.js — history rewrite?"
    )
