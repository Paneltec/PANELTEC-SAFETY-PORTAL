"""v58.13.132id — P0 bugs batch.

Source pins + behavioural tests for:
  · ResizeObserver loop fix on Workers.jsx (RAF batching).
  · Clients section removed from WorkerViewModal (was still visible
    on Wayne Nippers's profile after .132ic).
  · SSRA-family filename matchers registered BEFORE incident matchers.
  · SWMS-N filename matcher recognises the user-reported filename.
  · Version lockstep .132id.
"""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FRONTEND = ROOT / "frontend"
BACKEND = ROOT / "backend"


def _r(p: Path) -> str:
    return p.read_text(encoding="utf-8")


# ── Frontend: ResizeObserver RAF batching + Clients removal ────────

def test_workers_resize_observer_wrapped_in_raf():
    src = _r(FRONTEND / "src" / "pages" / "Workers.jsx")
    # The ResizeObserver callback body is now inside a RAF callback so
    # the style write can't retrigger the observer synchronously.
    assert "rafId = requestAnimationFrame(" in src
    # Coalescing guard so mid-frame bursts don't stack RAFs.
    assert "if (rafId) return; // coalesce mid-frame bursts" in src
    # Cleanup cancels the pending RAF.
    assert "if (rafId) cancelAnimationFrame(rafId);" in src
    # `disposed` guard prevents the RAF from writing after unmount.
    assert "let disposed = false;" in src


def test_worker_view_modal_removes_clients_section():
    src = _r(FRONTEND / "src" / "components" / "workers" / "WorkerViewModal.jsx")
    # The section testid + section header must be gone.
    assert 'data-testid="view-section-clients"' not in src
    assert "section-clients-empty" not in src
    assert "section-clients-count" not in src
    # Comment marker so future readers know why the block is missing.
    assert "132id" in src and "Clients section removed from the VIEW" in src


# ── Backend: SSRA + SWMS filename matcher order + patterns ──────────

def test_imports_filename_matchers_ssra_before_incident():
    """SSRA matchers must come BEFORE incident matchers so an SSRA
    filename containing incident-family tokens can't be misrouted."""
    from imports import _FILENAME_MATCHERS

    patterns = [p for (p, _) in _FILENAME_MATCHERS]
    # First SSRA-catching pattern index.
    ssra_idx = next(i for i, p in enumerate(patterns) if "ssra" in p.lower())
    # First incident-family pattern index.
    incident_idx = next(i for i, p in enumerate(patterns)
                        if "near[\\s_-]*miss" in p or "incident" in p or "injury" in p or "icam" in p)
    assert ssra_idx < incident_idx, (
        f"SSRA matcher (idx {ssra_idx}) must precede incident matchers (idx {incident_idx})"
    )


def test_imports_recognises_construction_and_excavation_ssra_filename():
    """Behavioural: a filename with 'Construction & Excavation SSRA'
    OR just 'SSRA' should hit the SSRA matcher, not the incident one."""
    from imports import _FILENAME_MATCHERS

    def first_match(fname: str) -> str | None:
        stem = fname.rsplit(".", 1)[0].lower()
        for pattern, target in _FILENAME_MATCHERS:
            if re.search(pattern, stem, re.IGNORECASE):
                return target
        return None

    # Explicit SSRA variants.
    assert first_match("Drain Cleaning SSRA v2.pdf") == "Drain Cleaning SSRA"
    assert first_match("Viatec Traffic Solutions SSRA.pdf") == "Viatec Traffic Solutions SSRA"
    assert first_match("Construction & Excavation SSRA - site 42.pdf") == "Construction & Excavation SSRA"
    # Bare SSRA token — catch-all beats incident matchers.
    assert first_match("2026 SSRA follow-up.pdf") == "Construction & Excavation SSRA"
    # Site-specific-risk-assessment expansion.
    assert first_match("Site Specific Risk Assessment v3.pdf") == "Construction & Excavation SSRA"
    # SSRA with an incident token in the filename — must STILL land as SSRA.
    assert first_match("Construction & Excavation SSRA — near miss review.pdf") == "Construction & Excavation SSRA"


def test_imports_recognises_swms_n_filename_pattern():
    """The user-reported filename must hit the SWMS matcher, not
    fall through to the incident regex or the token matcher."""
    from imports import _FILENAME_MATCHERS

    def first_match(fname: str) -> str | None:
        stem = fname.rsplit(".", 1)[0].lower()
        for pattern, target in _FILENAME_MATCHERS:
            if re.search(pattern, stem, re.IGNORECASE):
                return target
        return None

    # Exact user-reported filename.
    assert first_match(
        "2026_SWMS-11_Horizontal Directional Drilling - Unloading & Operation V13.0.pdf"
    ) == "SWMS Document"
    # Canonical SWMS-N with underscore.
    assert first_match("SWMS_08_Confined_Space_Entry_V4.pdf") == "SWMS Document"
    # Bare SWMS-N (no year prefix, no version suffix).
    assert first_match("SWMS-11 traffic control.pdf") == "SWMS Document"


def test_imports_incident_matchers_still_fire_for_incident_filenames():
    """Regression guard: adding SSRA matchers must not cannibalise the
    incident matchers when the filename is genuinely incident-shaped."""
    from imports import _FILENAME_MATCHERS

    def first_match(fname: str) -> str | None:
        stem = fname.rsplit(".", 1)[0].lower()
        for pattern, target in _FILENAME_MATCHERS:
            if re.search(pattern, stem, re.IGNORECASE):
                return target
        return None

    assert first_match("2025_SF-34 Incident Hazard Report_v3.pdf") == "Incident Report"
    assert first_match("Near Miss Report_2026-02-14.pdf") == "Near Miss Report"
    assert first_match("Register of Injury Q1 2026.pdf") == "Incident Report"
    assert first_match("ICAM Report - scaffold collapse.pdf") == "Incident Report"


# ── Version pin ─────────────────────────────────────────────────────

def test_version_pin_v132id():
    v = _r(FRONTEND / "src" / "lib" / "version.js")
    assert "RUNNING_VERSION = 'paneltec-v160.3.9.58.13.132id'" in v
    assert "EXPECTED_CACHE_VERSION = 'paneltec-v160.3.9.58.13.132id'" in v
    sw = _r(FRONTEND / "public" / "service-worker.js")
    assert "CACHE_VERSION = 'paneltec-v160.3.9.58.13.132id'" in sw
