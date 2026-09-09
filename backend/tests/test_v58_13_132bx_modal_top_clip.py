"""v58.13.132bx — Modal top-clip fix.

Frontend source pins:
  · FuelTransactionDetailModal: outer wrapper uses `pt-20 pb-8`
    (no longer symmetric `py-8`) so the modal card starts 80px
    below the viewport top — well clear of the 64px sticky topbar.
  · SmartFillCardDrawer: panel wrapper uses `mt-16 h-[calc(100vh-4rem)]`
    so its header row starts directly below the topbar rather than
    overlapping the bell / mail / ADMIN pill / avatar.
  · Version bumped forward-safe >= .132bx.
"""
from __future__ import annotations
import re
from pathlib import Path

FE_ROOT = Path("/app/frontend/src")
DETAIL_MODAL = (FE_ROOT / "components" / "FuelTransactionDetailModal.jsx").read_text()
DRAWER = (FE_ROOT / "components" / "fleet" / "SmartFillCardDrawer.jsx").read_text()
VERSION_JS = (FE_ROOT / "lib" / "version.js").read_text()
SW_JS = Path("/app/frontend/public/service-worker.js").read_text()


def test_detail_modal_top_padding_bumped():
    # New asymmetric padding: 80px top / 32px bottom.
    assert "pt-20 pb-8" in DETAIL_MODAL
    # Old symmetric `py-8` on the outer wrapper is gone.
    assert 'items-start justify-center bg-slate-900/40 px-4 py-8' not in DETAIL_MODAL


def test_drawer_panel_offset_below_topbar():
    # Panel starts 4rem (64px = h-16) below the top and takes the
    # remaining viewport height.
    assert "mt-16 bg-white shadow-2xl" in DRAWER
    assert "h-[calc(100vh-4rem)]" in DRAWER
    # Old full-height h-full without offset is gone from THIS panel.
    assert "max-w-3xl h-full bg-white shadow-2xl" not in DRAWER


def test_version_and_cache_bumped_to_132bx():
    def ge(v):
        m = re.search(r"\.132([a-z]+)$", v)
        return bool(m) and m.group(1) >= "bx"
    m = re.search(r"RUNNING_VERSION\s*=\s*'([^']+)'", VERSION_JS)
    assert m and ge(m.group(1)), m and m.group(1)
    m2 = re.search(r"EXPECTED_CACHE_VERSION\s*=\s*'([^']+)'", VERSION_JS)
    assert m2 and ge(m2.group(1)), m2 and m2.group(1)
    m3 = re.search(r"CACHE_VERSION\s*=\s*'([^']+)'", SW_JS)
    assert m3 and ge(m3.group(1)), m3 and m3.group(1)
