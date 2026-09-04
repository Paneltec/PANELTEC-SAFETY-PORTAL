"""v58.13.33 — MisclassifiedImportBanner FE smoke."""
from __future__ import annotations
from pathlib import Path
import re

APP = Path("/app")
BANNER = APP / "frontend/src/components/MisclassifiedImportBanner.jsx"


def test_banner_component_file_exists():
    assert BANNER.exists()


def test_banner_has_conditional_detection_logic():
    src = BANNER.read_text(encoding="utf-8")
    # Detection signals covered.
    assert "fieldsEmpty" in src
    assert "templateMismatch" in src
    assert "isImported" in src
    # inferTemplateType imported from the shared palette module.
    assert "inferTemplateType" in src
    # Compound gate: imported AND (empty OR mismatch)
    assert re.search(r"isImported\s*&&\s*\(", src)


def test_banner_has_stop_propagation_on_interactions():
    src = BANNER.read_text(encoding="utf-8")
    # Click handler must guard flash-bug.
    assert "e.stopPropagation()" in src
    assert "e.preventDefault()" in src


def test_banner_has_expected_testids():
    src = BANNER.read_text(encoding="utf-8")
    assert 'data-testid="misclassified-import-banner"' in src
    assert 'data-testid="misclassified-banner-title"' in src
    assert 'data-testid="misclassified-banner-source-btn"' in src


def test_banner_uses_amber_palette():
    """Amber = informational-warning per app palette. Not rose
    (destructive) and not blue (informational-neutral)."""
    src = BANNER.read_text(encoding="utf-8")
    assert "border-amber-300" in src
    assert "bg-amber-50" in src
    assert "text-amber-900" in src


def test_banner_returns_null_when_not_applicable():
    src = BANNER.read_text(encoding="utf-8")
    assert "if (!show) return null" in src


def test_version_sync_current():
    running = (APP / "frontend/src/lib/version.js").read_text(encoding="utf-8")
    sw = (APP / "frontend/public/service-worker.js").read_text(encoding="utf-8")
    mobile = (APP / "mobile/src/lib/version.ts").read_text(encoding="utf-8")
    m = re.search(r"export const RUNNING_VERSION = '(paneltec-v[\d.]+[a-z]*)'", running)
    assert m
    current = m.group(1)
    assert f"'{current}'" in sw
    assert f"'{current}'" in mobile
