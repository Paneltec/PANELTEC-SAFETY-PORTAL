"""v160.3.9.12a — Generate a synthetic Daily Pre-Start PDF fixture.

Produces `/app/backend/test_fixtures/prestart_sample.pdf` — a single-page
ReportLab-rendered mock that echoes the exact 20 field labels from the
production Daily Pre-Start template (`id=536805af-…`) with a few ticked
Pass/Fail radios so the smoke test can prove the pdftoppm→PNG→Claude
pipeline runs end-to-end.

Not intended to be pixel-perfect — this is a pipeline smoke fixture, not
a rendering-accuracy fixture.
"""
from __future__ import annotations

from pathlib import Path

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

FIXTURE_DIR = Path(__file__).resolve().parents[1] / "test_fixtures"
FIXTURE_DIR.mkdir(parents=True, exist_ok=True)
OUT_PATH = FIXTURE_DIR / "prestart_sample.pdf"

# Verbatim from db.form_templates id=536805af-e397-451f-94f0-30296d8f3a97.
DAILY_PRESTART_LABELS = [
    "Date", "Operator (Name)", "Location", "Select Vehicle",
    "Glass & Lenses — Windscreen, mirrors & light covers",
    "Tyres — Tread, sidewalls & air pressure",
    "Vehicle Panels, Bumper & Tray — Panels, bumper bar & tray free from damage",
    "Signs, Tools & Equipment — Speed signs, bollards, cones, weights, SSBs, all traffic control devices",
    "Fire Extinguisher & First Aid Kit — In date, on board, complete & accessible",
    "Under Bonnet Inspection — No hose wear, no oil / fluid leaks under the cab",
    "Seat Belts — Buckles, webbing, latch plate, retractor & pillar loop",
    "Globes & Alarms — Indicators, arrow boards, headlights, brake / reverse / work / flashing lights & reverse alarms",
    "Dashboard — Service KM/hrs, dashboard lights, no warning lights",
    "Cleanliness of Cab — Previous operator left cab free of rubbish",
    "I confirm I am in a 'Fit and Proper' state and Compliant with all Paneltec Policies prior to entering the vehicle.",
    "Odometer reading (km)",
    "Fault / Hazard — Are you submitting a Service Request or Fault Notification today?",
    "Details of fault / hazard (fill in if Yes above)",
    "Photos of defect / service sticker / odometer (fill in if Yes above)",
    "Pre-Start complete",
]

# Sample filled values — enough for Claude to have something to extract.
SAMPLE_VALUES = {
    "Date": "2024-08-14",
    "Operator (Name)": "Stephen McGuinness",
    "Location": "Chullora Depot — 12 Waterloo Rd",
    "Select Vehicle": "H89MY — Isuzu N-Series",
    "Odometer reading (km)": "128,432",
    "Fault / Hazard — Are you submitting a Service Request or Fault Notification today?": "No",
    "Pre-Start complete": "Yes",
}


def _draw(c: canvas.Canvas) -> None:
    width, height = A4
    y = height - 20 * mm

    # Header band.
    c.setFillColorRGB(0.973, 0.451, 0.086)  # brand orange
    c.rect(0, height - 15 * mm, width, 15 * mm, stroke=0, fill=1)
    c.setFillColorRGB(1, 1, 1)
    c.setFont("Helvetica-Bold", 14)
    c.drawString(20 * mm, height - 10 * mm, "Paneltec Civil · Daily Pre-Start")
    c.setFont("Helvetica", 9)
    c.drawRightString(width - 20 * mm, height - 10 * mm, "Fixture · smoke test")

    c.setFillColorRGB(0, 0, 0)
    y = height - 25 * mm

    for label in DAILY_PRESTART_LABELS:
        c.setFont("Helvetica-Bold", 8)
        # Wrap long labels onto up to 2 lines manually — ReportLab canvas
        # has no auto-wrap, so we chunk on width.
        remaining = label
        max_chars = 95
        printed_lines = 0
        while remaining and printed_lines < 2:
            chunk = remaining[:max_chars]
            if len(remaining) > max_chars:
                # Break on last space to avoid mid-word cuts.
                cut = chunk.rfind(" ")
                if cut > 40:
                    chunk = chunk[:cut]
            c.drawString(20 * mm, y, chunk)
            remaining = remaining[len(chunk):].lstrip()
            y -= 4 * mm
            printed_lines += 1

        value = SAMPLE_VALUES.get(label)
        c.setFont("Helvetica", 8)
        if value:
            c.drawString(25 * mm, y, f"→ {value}")
            y -= 5 * mm
        else:
            # Simulated Pass/Fail/N/A radio group with the "Pass" one ticked.
            for i, opt in enumerate(("Pass", "Fail", "N/A")):
                x = 25 * mm + i * 22 * mm
                c.circle(x, y + 1, 1.4, stroke=1, fill=1 if opt == "Pass" else 0)
                c.drawString(x + 3 * mm, y, opt)
            y -= 6 * mm

        if y < 25 * mm:
            c.showPage()
            y = height - 20 * mm

    # Fake signature line.
    c.setFont("Helvetica", 8)
    c.drawString(20 * mm, 18 * mm, "Signature: ______________________")
    c.drawString(120 * mm, 18 * mm, "Date signed: 14/08/2024")


def main() -> Path:
    c = canvas.Canvas(str(OUT_PATH), pagesize=A4)
    _draw(c)
    c.showPage()
    c.save()
    return OUT_PATH


if __name__ == "__main__":
    p = main()
    print(f"wrote {p} ({p.stat().st_size} bytes)")
