"""v58.13.132hf — Text-extraction infra pins.

Locks:
  · text_extraction module dispatches correctly for the 5 mime
    families and returns the promised shape.
  · document_library wires _extract_and_persist on the upload path
    and exposes admin backfill endpoints (start/status/cancel).
  · server.py boot hook creates the Mongo text index + schedules
    the delayed backfill.
  · Version-file lockstep.
"""
from __future__ import annotations

import io
import re
import sys
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[2]
BACKEND = APP_ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

DOCLIB_PY = BACKEND / "document_library.py"
SERVER_PY = BACKEND / "server.py"
EXTRACT_PY = BACKEND / "text_extraction.py"
VERSION_JS = APP_ROOT / "frontend" / "src" / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


# ─── text_extraction module ────────────────────────────────────

def test_extract_module_exists_and_exports_entry_point():
    from text_extraction import extract_text  # noqa: F401
    assert extract_text is not None


def test_extract_plain_text():
    from text_extraction import extract_text
    result = extract_text(b"hello world", mime="text/plain", filename="note.txt")
    assert result["status"] == "ok"
    assert result["engine"] == "plain"
    assert "hello world" in result["text"]
    assert result["chars"] > 0


def test_extract_docx():
    from docx import Document as _Doc
    from text_extraction import extract_text
    doc = _Doc()
    doc.add_paragraph("PPE checklist for working at heights")
    doc.add_paragraph("Harness must be inspected before use")
    buf = io.BytesIO(); doc.save(buf)
    result = extract_text(buf.getvalue(),
                          mime="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                          filename="test.docx")
    assert result["status"] == "ok"
    assert result["engine"] == "python-docx"
    assert "PPE checklist" in result["text"]
    assert "Harness" in result["text"]


def test_extract_xlsx():
    from openpyxl import Workbook
    from text_extraction import extract_text
    wb = Workbook(); ws = wb.active; ws.title = "Register"
    ws.append(["ID", "Name", "Value"])
    ws.append([1, "Bomb Threat Report", "SF-22"])
    buf = io.BytesIO(); wb.save(buf)
    result = extract_text(buf.getvalue(),
                          mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                          filename="reg.xlsx")
    assert result["status"] == "ok"
    assert result["engine"] == "openpyxl"
    assert "SF-22" in result["text"]
    assert "Register" in result["text"]


def test_extract_unsupported_returns_failed():
    from text_extraction import extract_text
    result = extract_text(b"raw bytes", mime="application/x-thing",
                          filename="mystery.xyz")
    assert result["status"] == "failed"
    assert result["engine"] == "unsupported"


def test_extract_empty_bytes_returns_failed():
    from text_extraction import extract_text
    result = extract_text(b"", mime="application/pdf", filename="empty.pdf")
    assert result["status"] == "failed"


def test_extract_caps_extraction_at_200k_chars():
    from text_extraction import extract_text, MAX_EXTRACTED_CHARS
    big = ("x" * (MAX_EXTRACTED_CHARS + 5000)).encode()
    result = extract_text(big, mime="text/plain", filename="big.txt")
    assert result["chars"] <= MAX_EXTRACTED_CHARS + 20  # + tail marker
    assert "…[truncated]" in result["text"]


# ─── document_library wiring ───────────────────────────────────

def test_upload_kicks_extract_background_task():
    src = _read(DOCLIB_PY)
    assert "_extract_and_persist(" in src
    m = re.search(
        r'@router\.post\("/folders/\{folder_id\}/files".*?return \{"saved": saved',
        src, re.DOTALL,
    )
    assert m, "upload handler not found"
    body = m.group(0)
    assert "_asyncio.create_task(_extract_and_persist(" in body, \
        "upload must fire-and-forget extraction"


def test_backfill_endpoints_defined_admin_only():
    src = _read(DOCLIB_PY)
    for route in (
        '@router.post("/admin/backfill-extracted-text")',
        '@router.get("/admin/backfill-extracted-text/status")',
        '@router.post("/admin/backfill-extracted-text/cancel")',
    ):
        assert route in src, f"missing route: {route}"
    # Each must be admin-gated.
    assert src.count('_require(user, {"admin"}, action="backfill') >= 2


def test_extract_and_persist_stamps_doc_files():
    src = _read(DOCLIB_PY)
    m = re.search(
        r'async def _extract_and_persist\(.*?return result',
        src, re.DOTALL,
    )
    assert m
    body = m.group(0)
    for field in (
        '"extracted_text":',
        '"extracted_text_at":',
        '"extraction_engine":',
        '"extraction_status":',
        '"extracted_chars":',
    ):
        assert field in body, f"stamp field missing: {field}"
    assert "$inc" in body and '"extraction_failed_count": 1' in body, \
        "failed rows must $inc extraction_failed_count"


def test_backfill_state_progress_fields_present():
    src = _read(DOCLIB_PY)
    m = re.search(r"_BACKFILL_STATE: dict = \{.*?\}", src, re.DOTALL)
    assert m
    body = m.group(0)
    for k in ("running", "total", "done", "ok", "failed", "cancel_requested",
              "engines", "started_at", "finished_at"):
        assert f'"{k}"' in body, f"progress key missing: {k}"


def test_schedule_boot_backfill_defined():
    src = _read(DOCLIB_PY)
    assert re.search(r'async def schedule_boot_backfill\(delay_seconds: int = 300\)', src)


# ─── server.py startup wiring ──────────────────────────────────

def test_server_startup_creates_text_index_and_schedules_backfill():
    src = _read(SERVER_PY)
    assert "schedule_boot_backfill" in src, \
        "server.py must import + invoke schedule_boot_backfill"
    assert 'name="doc_files_fulltext"' in src, \
        "doc_files fulltext index must be created on boot"
    assert '"extracted_text"' in src


# ─── Version lockstep ──────────────────────────────────────────

def test_version_lockstep_pinned_at_132hf():
    for path, key in (
        (VERSION_JS, "RUNNING_VERSION"),
        (VERSION_JS, "EXPECTED_CACHE_VERSION"),
        (SW, "CACHE_VERSION"),
    ):
        m = re.search(
            rf"{key}\s*=\s*'paneltec-v160\.3\.9\.58\.13\.132h([a-z])'",
            _read(path),
        )
        assert m, f"{key} not pinned to .132h?"
        assert m.group(1) >= "f", f"{key} must be >= .132hf"
