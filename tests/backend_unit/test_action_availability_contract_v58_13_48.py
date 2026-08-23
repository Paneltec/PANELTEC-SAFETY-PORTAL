"""v58.13.48 — Action-availability contract test.

Static grep of every `<CaptureCard resourceKind="X">` in the
frontend. For each call site, X must be in
`RESOURCE_TO_PATH ∪ MIRRORED_ONLY_KINDS` unless the same JSX block
explicitly passes `showPdf={false}`. Would have caught the
v58.13.46 wrong-direction fix (CS Incidents used
resourceKind="reference_library" which is neither in RESOURCE_TO_PATH
nor MIRRORED_ONLY_KINDS AND didn't set showPdf=false) automatically.

Placed under /app/tests/backend_unit/ because it imports the backend
map — but it's actually a cross-cutting invariant.
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path

import pytest

_BACKEND = Path("/app/backend")
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))
_env = _BACKEND / ".env"
if _env.exists():
    for _line in _env.read_text(encoding="utf-8").splitlines():
        _line = _line.strip()
        if not _line or _line.startswith("#") or "=" not in _line:
            continue
        _k, _, _v = _line.partition("=")
        os.environ.setdefault(_k.strip(), _v.strip().strip('"').strip("'"))

from pdf_routes import RESOURCE_TO_PATH, MIRRORED_ONLY_KINDS  # noqa: E402

FRONTEND = Path("/app/frontend/src")

_JSX_GLOBS = [
    "pages/*.jsx",
    "components/**/*.jsx",
]

_CAPTURECARD_RE = re.compile(
    # Grabs the WHOLE `<CaptureCard ...>` open tag (attributes may
    # span many lines, may contain arbitrary JSX braces). Non-greedy;
    # stops at the closing `>` that terminates the open tag or at
    # `/>` for self-closing.
    r"<CaptureCard\b(?P<attrs>[^<]*?)/?>",
    re.DOTALL,
)
_RESOURCE_KIND_RE = re.compile(r'resourceKind\s*=\s*"([^"]+)"')
_SHOW_PDF_FALSE_RE = re.compile(r"showPdf\s*=\s*\{\s*false\s*\}")


def _collect_capturecard_callsites():
    """Yield (file_path, resource_kind, has_show_pdf_false) tuples."""
    seen = []
    for pattern in _JSX_GLOBS:
        for path in FRONTEND.glob(pattern):
            if path.name == "CaptureCard.jsx":
                # Skip the component's own definition file — the
                # `<PdfActions ...>` inside the component definition
                # isn't a call site.
                continue
            src = path.read_text(encoding="utf-8")
            for m in _CAPTURECARD_RE.finditer(src):
                attrs = m.group("attrs")
                kind_m = _RESOURCE_KIND_RE.search(attrs)
                if not kind_m:
                    # Dynamic `resourceKind={someVar}` — skip. Can't
                    # statically check.
                    continue
                seen.append((
                    str(path.relative_to(FRONTEND)),
                    kind_m.group(1),
                    bool(_SHOW_PDF_FALSE_RE.search(attrs)),
                ))
    return seen


CALLSITES = _collect_capturecard_callsites()


def test_at_least_one_capturecard_callsite_found():
    """Sanity — if the regex breaks and finds nothing, the contract
    test would silently pass. Guard against that."""
    assert len(CALLSITES) >= 4, (
        f"Expected at least 4 <CaptureCard resourceKind=...> callsites "
        f"across the frontend; regex found {len(CALLSITES)}. Did the "
        f"JSX layout change? Update `_CAPTURECARD_RE`."
    )


@pytest.mark.parametrize("path, kind, show_pdf_false", CALLSITES,
                         ids=[f"{p}::{k}" for p, k, _ in CALLSITES])
def test_capturecard_kind_is_pdf_safe_or_opted_out(
        path: str, kind: str, show_pdf_false: bool):
    """Every <CaptureCard resourceKind="X"> must satisfy at least
    one of:
      (a) `X ∈ RESOURCE_TO_PATH`         — direct backend renderer.
      (b) `X ∈ MIRRORED_ONLY_KINDS`       — served via the form-
                                            submission mirrored path.
      (c) `showPdf={false}` passed        — icon suppressed on this
                                            callsite.
    Failure = the file icon would flash-and-disappear on click,
    exactly the v58.13.46 → v58.13.48 CS Incidents regression."""
    pdf_safe_kinds = set(RESOURCE_TO_PATH.keys()) | MIRRORED_ONLY_KINDS
    if kind in pdf_safe_kinds:
        return  # (a) or (b) satisfied
    assert show_pdf_false, (
        f"{path}: <CaptureCard resourceKind=\"{kind}\"> has no "
        "PDF-safe backend renderer and does not pass "
        "`showPdf={false}`. Either:\n"
        f"  · add `\"{kind}\": \"<path-segment>\"` to "
        "`backend/pdf_routes.py:RESOURCE_TO_PATH` (and a renderer "
        "to `pdf_renderer.py:RENDERERS`), OR\n"
        f"  · add `\"{kind}\"` to `MIRRORED_ONLY_KINDS` if it's "
        "served via the form_submissions mirrored path, OR\n"
        "  · pass `showPdf={false}` on the CaptureCard callsite to "
        "suppress the file icon.\n"
        f"Valid kinds today: {sorted(pdf_safe_kinds)}"
    )


def test_cs_incidents_specifically_now_pdf_safe():
    """Explicit regression assertion for the reported bug —
    CsIncidentsList.jsx must NOT set showPdf={false} anymore, must
    use `resourceKind="reference_library"` (unchanged permission
    scope), AND must set `pdfResourceKind="cs_incidents"` for the
    /pdf-token override."""
    src = (FRONTEND / "pages" / "CsIncidentsList.jsx").read_text(encoding="utf-8")
    assert "showPdf={false}" not in src, (
        "CsIncidentsList.jsx still hides the file icon — v58.13.48 "
        "restored it now that the backend has a proper renderer."
    )
    assert 'pdfResourceKind="cs_incidents"' in src, (
        "CsIncidentsList.jsx must pass `pdfResourceKind=\"cs_incidents\"` "
        "so the /pdf-token POST goes out with the correct resource "
        "key while the `<Can>` gate stays on `reference_library`."
    )
    assert 'resourceKind="reference_library"' in src, (
        "Permission scope must stay on `reference_library` — that's "
        "the domain gating CS incident CRUD endpoints backend-side."
    )
