"""v58.13.132gm — Clipboard paste for cert / doc uploaders."""
from __future__ import annotations

import re
from pathlib import Path

import pytest

APP_ROOT = Path(__file__).resolve().parents[2]
FE = APP_ROOT / "frontend" / "src"

HOOK = FE / "lib" / "useClipboardPaste.js"
EQ = FE / "pages" / "EquipmentRegister.jsx"
PNC = FE / "components" / "workers" / "PrivateConfidentialPanel.jsx"
DL = FE / "pages" / "DocumentLibrary.jsx"
VERSION_JS = FE / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def test_shared_hook_exists_with_screenshot_rename_logic():
    src = _read(HOOK)
    assert "export default function useClipboardPaste" in src
    assert "kind !== 'file'" in src
    assert "Pasted-image-" in src
    assert "e.preventDefault()" in src
    assert "window.addEventListener('paste'" in src


def test_equipment_modal_wires_paste_and_shows_hint():
    src = _read(EQ)
    assert "import useClipboardPaste from '@/lib/useClipboardPaste'" in src
    assert "useClipboardPaste(uploadPasted, isEdit" in src
    assert 'data-testid="equipment-paste-hint"' in src
    assert "Ctrl/Cmd" in src
    # Paste only fires when editing an existing row (need eid to POST).
    assert "!isEdit" in src or "isEdit &&" in src or "isEdit ? " in src


def test_private_confidential_wires_paste_and_updates_hint():
    src = _read(PNC)
    assert "import useClipboardPaste" in src
    assert "useClipboardPaste(upload," in src
    # New consolidated hint text visible.
    assert "Drop files, click to browse, or paste (Ctrl/Cmd+V)" in src


def test_document_library_uses_shared_hook_not_inline_listener():
    src = _read(DL)
    assert "import useClipboardPaste from '../lib/useClipboardPaste'" in src
    assert "useClipboardPaste(uploadFiles, canEdit" in src
    # Inline `window.addEventListener('paste', onPaste)` should be gone.
    assert "window.addEventListener('paste', onPaste)" not in src


def test_version_bumped_to_132gm():
    js = _read(VERSION_JS)
    sw = _read(SW)
    assert re.search(r"RUNNING_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132gm'", js)
    assert re.search(r"EXPECTED_CACHE_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132gm'", js)
    assert re.search(r"CACHE_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132gm'", sw)
