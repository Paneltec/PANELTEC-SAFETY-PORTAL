"""v58.13.132br — SWMS Assignments origin-note info card.

Frontend source pins:
  · New info card in SwmsAssignmentsAdmin under the existing subtitle.
  · Copy locked verbatim (title + both sources named).
  · Style: `bg-sky-50 border border-sky-200 rounded-lg`.
  · Uses lucide `Info` icon (imported at the top of the file).
  · testid `swms-origin-note` present.
  · Version bumps forward-safe >= .132br.
"""
from __future__ import annotations
import re
from pathlib import Path

FE_ROOT = Path("/app/frontend/src")
SWMS_ADMIN = (FE_ROOT / "pages" / "SwmsAssignmentsAdmin.jsx").read_text()
VERSION_JS = (FE_ROOT / "lib" / "version.js").read_text()
SW_JS = Path("/app/frontend/public/service-worker.js").read_text()


def test_origin_note_testid_present():
    assert 'data-testid="swms-origin-note"' in SWMS_ADMIN


def test_origin_note_styling_locked():
    # Card background / border.
    assert "bg-sky-50 border border-sky-200 rounded-lg" in SWMS_ADMIN


def test_origin_note_copy_locked():
    # Title.
    assert "Where do these SWMS come from?" in SWMS_ADMIN
    # Both origin sources named.
    assert "Capture → AI SWMS Create" in SWMS_ADMIN
    assert "Upload → your own SWMS PDF dropped in via the Documents module" in SWMS_ADMIN
    # Closing sentence.
    assert "All active versions appear here regardless of source." in SWMS_ADMIN


def test_info_icon_imported():
    # Info icon from lucide-react added to the existing import list.
    assert "Info" in re.search(r"from 'lucide-react';", SWMS_ADMIN).string
    m = re.search(r"import\s*\{([^}]+)\}\s*from\s*'lucide-react'", SWMS_ADMIN)
    assert m, "lucide-react import block not found"
    names = {n.strip() for n in m.group(1).split(',')}
    assert "Info" in names, f"Info not in lucide import: {names}"


def test_note_placed_before_list_grid():
    # The info card must sit BEFORE the two-column grid (search + editor).
    note_pos = SWMS_ADMIN.find('data-testid="swms-origin-note"')
    grid_pos = SWMS_ADMIN.find("grid grid-cols-1 lg:grid-cols-[420px_1fr]")
    assert note_pos > 0 and grid_pos > 0
    assert note_pos < grid_pos, "origin note must render above the two-column list grid"


def test_version_and_cache_bumped_to_132br():
    def ge(v):
        m = re.search(r"\.132([a-z]+)$", v)
        return bool(m) and m.group(1) >= "br"
    m = re.search(r"RUNNING_VERSION\s*=\s*'([^']+)'", VERSION_JS)
    assert m and ge(m.group(1)), m and m.group(1)
    m2 = re.search(r"EXPECTED_CACHE_VERSION\s*=\s*'([^']+)'", VERSION_JS)
    assert m2 and ge(m2.group(1)), m2 and m2.group(1)
    m3 = re.search(r"CACHE_VERSION\s*=\s*'([^']+)'", SW_JS)
    assert m3 and ge(m3.group(1)), m3 and m3.group(1)
