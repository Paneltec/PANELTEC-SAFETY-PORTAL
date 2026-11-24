from __future__ import annotations

import io
import sys
from pathlib import Path

from pypdf import PdfReader


BACKEND = Path(__file__).resolve().parents[2] / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from pdf_renderer import render_inspection_pdf  # noqa: E402


def test_inspection_pdf_renders_saved_label_and_notes():
    pdf_bytes = render_inspection_pdf({
        "id": "inspection-1",
        "template_name": "Site walk",
        "date": "2026-11-24",
        "workspace_id": "workspace-1",
        "notes": "Supervisor to review scaffold access before restart.",
        "checklist_items": [{
            "label": "Edge protection in place",
            "response": "fail",
            "notes": "Handrail missing beside loading bay.",
        }],
    })

    reader = PdfReader(io.BytesIO(pdf_bytes))
    text = "\n".join(page.extract_text() or "" for page in reader.pages)
    normalized_text = " ".join(text.split())

    assert "Edge protection in place" in text
    assert "Handrail missing beside loading bay." in normalized_text
    assert "Supervisor to review scaffold access before restart." in text


def test_inspection_pdf_keeps_legacy_item_field_fallback():
    pdf_bytes = render_inspection_pdf({
        "id": "inspection-legacy",
        "template_name": "Plant inspection",
        "date": "2026-11-24",
        "checklist_items": [{
            "item": "Reversing alarm operational",
            "response": "pass",
        }],
    })

    reader = PdfReader(io.BytesIO(pdf_bytes))
    text = "\n".join(page.extract_text() or "" for page in reader.pages)

    assert "Reversing alarm operational" in text
