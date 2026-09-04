"""v58.13.111a — Copy fix regression tests for the Certifications page.

Locks:
  · Backend `_status_for` differentiates "expiry field left blank"
    ("Expiry not set") from "genuinely no expiry" ("No expiry"),
    keyed off `held_no_expiry`.
  · Frontend Certifications.jsx renders "Not set" (soft-gray italic)
    for null-expiry cells instead of the ambiguous em-dash.
  · Frontend `preview_broken` handling: amber "RE-UPLOAD" pill, view
    button pre-empts the modal with a toast instead of loading a
    broken PDF.
  · Audit script (`audit_doc_files_v58_13_111.py`) still exists, is
    module-loadable, and its two flag-triggering conditions are
    unchanged (size<100+stub sniff OR pdf mime + text sniff).
  · Version-sync forward-safe pin >= .111a across the 3 canonical
    version strings.
"""
from __future__ import annotations
import importlib
import re
from datetime import date
from pathlib import Path
import sys

sys.path.insert(0, "/app/backend")


# ── Backend `_status_for` copy contract ──────────────────────────────
def test_status_for_expiry_not_set():
    from worker_certifications import _status_for
    today = date(2026, 2, 15)
    # Has file, no expiry, held_no_expiry NOT True → "Expiry not set".
    row = {"doc_file_id": "f1", "expiry_date": None}
    s = _status_for(row, today)
    assert s["key"] == "no_expiry"
    assert s["label"] == "Expiry not set"

    row2 = {"doc_file_id": "f1", "expiry_date": None, "held_no_expiry": False}
    assert _status_for(row2, today)["label"] == "Expiry not set"


def test_status_for_held_no_expiry_kept():
    from worker_certifications import _status_for
    today = date(2026, 2, 15)
    row = {"doc_file_id": "f1", "expiry_date": None, "held_no_expiry": True}
    s = _status_for(row, today)
    assert s["key"] == "no_expiry"
    assert s["label"] == "No expiry", (
        "held_no_expiry=True must still label 'No expiry' — Expiry not set is"
        " only for the 'admin forgot to fill in the date' case."
    )


def test_status_for_missing_file_unchanged():
    from worker_certifications import _status_for
    today = date(2026, 2, 15)
    row = {"doc_file_id": None, "expiry_date": None}
    assert _status_for(row, today)["key"] == "missing_file"


def test_status_for_valid_expiry_unchanged():
    from worker_certifications import _status_for
    today = date(2026, 2, 15)
    row = {"doc_file_id": "f1", "expiry_date": "2027-05-01"}
    s = _status_for(row, today)
    assert s["key"] == "valid"


# ── Frontend Certifications.jsx source-pins ─────────────────────────
CERT_JSX = Path("/app/frontend/src/pages/Certifications.jsx").read_text()


def test_frontend_empty_expiry_cell_reads_not_set():
    assert 'italic text-slate-400' in CERT_JSX
    assert '>Not set<' in CERT_JSX or "Not set" in CERT_JSX
    assert re.search(r'data-testid=\{[^}]*cert-expiry-notset', CERT_JSX)


def test_frontend_preview_broken_pill_wired():
    assert 'preview_broken' in CERT_JSX
    assert re.search(r'data-testid=\{[^}]*cert-preview-broken', CERT_JSX)
    # The amber "RE-UPLOAD" pill only renders when preview_broken is truthy.
    assert 'RE-UPLOAD' in CERT_JSX


def test_frontend_view_button_shortcircuits_broken():
    # The view button reads `if (c.preview_broken) { toast.error(...); return; }`
    # BEFORE it opens the modal so users never hit the 415 preview path.
    assert re.search(
        r'if\s*\(\s*c\.preview_broken\s*\)\s*\{[^}]*toast\.error',
        CERT_JSX,
        re.DOTALL,
    )


# ── Audit script surface + flagging matrix ──────────────────────────
def test_audit_script_module_loadable():
    mod = importlib.import_module("backend.scripts.audit_doc_files_v58_13_111")
    assert callable(mod.main)
    assert callable(mod._should_flag)


def test_audit_should_flag_stub_placeholder():
    from backend.scripts.audit_doc_files_v58_13_111 import _should_flag
    # 20-byte text posing as a PDF — hits the size<100 branch first.
    ok, reason = _should_flag(20, "application/pdf", "text")
    assert ok is True
    assert "stubbed placeholder" in reason
    # A bigger (>=100) text-as-pdf still gets flagged via the mime/sniff
    # mismatch branch — that's the exact class the .111 fix targeted.
    ok2, reason2 = _should_flag(500, "application/pdf", "text")
    assert ok2 is True
    assert "claims PDF but is text" in reason2


def test_audit_should_flag_tiny_stub():
    from backend.scripts.audit_doc_files_v58_13_111 import _should_flag
    ok, reason = _should_flag(3, "application/pdf", "unknown")
    assert ok is True
    assert "stubbed placeholder" in reason


def test_audit_should_not_flag_real_files():
    from backend.scripts.audit_doc_files_v58_13_111 import _should_flag
    assert _should_flag(500_000, "application/pdf", "pdf") == (False, "")
    assert _should_flag(200_000, "image/jpeg", "jpeg") == (False, "")
    assert _should_flag(38_000, "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                        "zip") == (False, "")


# ── Version sync forward-safe pin ────────────────────────────────────
def _read(path: str) -> str:
    return Path(path).read_text()


VERSION_TAIL_RE = re.compile(r"paneltec-v[\d.]+\.58\.13\.(\d+)([a-z]?)")


def _tail_version(s: str) -> tuple[int, str]:
    """Return (patch-number, letter-suffix) so '.112' > '.111a' > '.111'."""
    m = VERSION_TAIL_RE.search(s)
    assert m, f"could not find version tail in: {s[:400]}"
    return (int(m.group(1)), m.group(2))


def test_version_bumps_meet_111a():
    running = _read("/app/frontend/src/lib/version.js")
    sw = _read("/app/frontend/public/service-worker.js")
    mob = _read("/app/mobile/src/lib/version.ts")
    # Extract the CANONICAL version — the last patch number in the file
    # is the current ship; earlier hits in the change-log block are
    # historical. Scan every match and pick the max.
    for label, blob in (("frontend/version.js", running),
                        ("service-worker.js", sw),
                        ("mobile/version.ts", mob)):
        all_tails = [(int(m.group(1)), m.group(2))
                     for m in VERSION_TAIL_RE.finditer(blob)]
        assert all_tails, f"{label} has no version tail"
        highest = max(all_tails)
        # >= (111, 'a') per forward-safe pin.
        assert highest >= (111, "a"), f"{label} latest tail={highest} < (111, 'a')"
