"""v58.13.101 — Purge Test Data UX tail:
    · SystemSettings.jsx checkbox-required hint next to disabled Delete button
    · PlantVehicles.jsx admin-only "N test records detected" banner
      (deep-links to /app/settings/system#purge-test-data)

Source-scan tests. Prod runtime already proven via curl on ship-day
(960 rows + 958 cascade removed, second dry-run returned 0). This
pytest guards the STRUCTURE of the UX fix so a future edit can't
silently regress it.
"""
from __future__ import annotations
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FRONTEND = ROOT / "frontend"
MOBILE = ROOT / "mobile"

SYSSET_JSX = (FRONTEND / "src" / "pages" / "SystemSettings.jsx").read_text(encoding="utf-8")
PV_JSX = (FRONTEND / "src" / "pages" / "PlantVehicles.jsx").read_text(encoding="utf-8")
VERSION_JS = (FRONTEND / "src" / "lib" / "version.js").read_text(encoding="utf-8")
SW_JS = (FRONTEND / "public" / "service-worker.js").read_text(encoding="utf-8")
MOBILE_TS = (MOBILE / "src" / "lib" / "version.ts").read_text(encoding="utf-8")


# ── Fix 1 — SystemSettings.jsx: ack hint + card anchor ─────────────

def test_purge_card_has_anchor_id():
    """Card wrapper must carry `id="purge-test-data"` so
    `/app/settings/system#purge-test-data` deep-links scroll into view.
    Also `scroll-mt-24` so the fixed top-bar doesn't cover the card."""
    m = re.search(
        r'<div\s+id="purge-test-data"[^>]*data-testid="purge-test-data-card"',
        SYSSET_JSX,
    )
    assert m, "Purge card wrapper missing id='purge-test-data' anchor"
    assert "scroll-mt-24" in SYSSET_JSX, (
        "Purge card wrapper missing scroll-mt-24 — hash-linked nav will "
        "land underneath the fixed top-bar"
    )


def test_ack_required_hint_renders_when_unticked():
    """The `purge-ack-required-hint` element must be guarded by
    `!ack && dry.grand_total > 0 && !busy` so it appears only when
    the button is genuinely blocked on the checkbox."""
    m = re.search(
        r'\{\s*!ack\s*&&\s*dry\.grand_total\s*>\s*0\s*&&\s*!busy\s*&&\s*\('
        r'[\s\S]{0,400}?data-testid="purge-ack-required-hint"',
        SYSSET_JSX,
    )
    assert m, (
        "Ack-required hint not gated on `!ack && dry.grand_total > 0 && !busy` "
        "— the hint could show at the wrong times"
    )


def test_ack_required_hint_message_names_the_checkbox():
    """The hint copy must reference the checkbox action — otherwise it
    doesn't tell the user what to do to enable the button."""
    m = re.search(
        r'data-testid="purge-ack-required-hint"[\s\S]{0,300}?'
        r'checkbox[\s\S]{0,80}?enable[\s\S]{0,20}?delete',
        SYSSET_JSX,
        re.IGNORECASE,
    )
    assert m, (
        "Ack-required hint copy doesn't reference the checkbox action — "
        "the pre-.101 regression class (silent grey button) could return"
    )


def test_delete_button_still_gated_on_ack():
    """Regression guard: the Delete button MUST still be
    `disabled={!ack || busy || dry.grand_total === 0}`. The .101 ship
    fixes DISCOVERABILITY of the ack requirement, it does NOT weaken the
    safety gate."""
    m = re.search(
        r'onClick=\{confirmDelete\}\s+disabled=\{!ack\s*\|\|\s*busy\s*\|\|\s*dry\.grand_total\s*===\s*0\}',
        SYSSET_JSX,
    )
    assert m, (
        "Delete button ack-gate weakened or removed — this would allow a "
        "click through without the user acknowledging irreversibility"
    )


# ── Fix 2 — PlantVehicles.jsx: admin-only test-data banner ─────────

def test_plant_vehicles_imports_alert_triangle():
    m = re.search(
        r"import\s*\{[^}]*AlertTriangle[^}]*\}\s*from\s*['\"]lucide-react['\"]",
        PV_JSX,
    )
    assert m, "AlertTriangle icon not imported from lucide-react"


def test_test_data_count_fetch_is_admin_gated():
    """Fetch MUST be gated on `pmUser?.role === 'admin'`. Otherwise
    non-admin viewers get a spurious 403 network call on every mount
    (server-side handler will reject anyway, but the client should
    never fire the request)."""
    m = re.search(
        r"useEffect\(\(\)\s*=>\s*\{[\s\S]{0,600}?"
        r"if\s*\(\s*pmUser\?\.role\s*!==\s*['\"]admin['\"]\s*\)\s*return;"
        r"[\s\S]{0,600}?api\.post\(\s*['\"]/admin/purge-test-data\?dry_run=1['\"]",
        PV_JSX,
    )
    assert m, (
        "testDataCount fetch is not admin-gated OR doesn't call the "
        "existing .81 dry-run endpoint"
    )


def test_test_data_banner_renders_when_admin_and_count_positive():
    m = re.search(
        r'\{\s*pmUser\?\.role\s*===\s*[\'"]admin[\'"]\s*&&\s*testDataCount\s*>\s*0\s*&&\s*\('
        r'[\s\S]{0,800}?data-testid="vehicles-test-data-banner"',
        PV_JSX,
    )
    assert m, (
        "Test-data banner not gated on `pmUser?.role === 'admin' && "
        "testDataCount > 0`"
    )


def test_test_data_banner_has_testids():
    for tid in (
        "vehicles-test-data-banner",
        "vehicles-test-data-banner-count",
        "vehicles-test-data-banner-cta",
    ):
        assert tid in PV_JSX, f"missing testid {tid!r}"


def test_test_data_banner_cta_opens_modal_v58_13_116():
    """v58.13.116 SUPERSEDES the .101 deep-link contract.
    CTA is now a `<button onClick={() => setPurgeModalOpen(true)}>`
    that opens an in-context confirm modal instead of navigating away
    to /app/settings/system#purge-test-data. The type-to-confirm
    modal keeps the destructive action behind a two-step gate."""
    m = re.search(
        r'onClick=\{\(\)\s*=>\s*setPurgeModalOpen\(true\)\}[\s\S]{0,300}?'
        r'data-testid="vehicles-test-data-banner-cta"',
        PV_JSX,
    )
    assert m, (
        "Banner CTA no longer wired to open the .116 purge modal — "
        "either the state setter renamed or the testid moved"
    )
    # The old page-away Link must be gone.
    assert '/app/settings/system#purge-test-data' not in PV_JSX
    # Modal is mounted with onPurged wiring.
    assert '<PurgeTestDataModal' in PV_JSX


def test_test_data_banner_placement_above_tabs():
    """Banner must render BETWEEN <HowThisWorks/> and <Tabs>. Placing
    it inside the tabs body would only surface on one specific sub-tab,
    which defeats the point of the discoverability fix. v58.13.116
    adds a `<PurgeTestDataModal>` mount just after the banner block
    (still above <Tabs>) so the position contract holds either way."""
    m = re.search(
        r'<HowThisWorks[^/]*/>\s*[\s\S]{0,2000}?'
        r'data-testid="vehicles-test-data-banner"[\s\S]{0,2000}?'
        r'<Tabs\s',
        PV_JSX,
    )
    assert m, (
        "Test-data banner is not positioned between <HowThisWorks/> "
        "and <Tabs> — it may be hidden inside a tab body"
    )


# ── Version-sync forward-safe pin >= 101 ───────────────────────────

def _tail(text, name):
    m = re.search(rf"{name}\s*=\s*['\"]paneltec-v[\d.]+\.(\d+)[a-z]*['\"]", text)
    assert m, f"could not read tail of {name}"
    return int(m.group(1))


def test_running_version_gte_101():
    assert _tail(VERSION_JS, "RUNNING_VERSION") >= 101


def test_cache_version_gte_101():
    assert _tail(SW_JS, "CACHE_VERSION") >= 101


def test_mobile_bundle_version_gte_101():
    assert _tail(MOBILE_TS, "MOBILE_BUNDLE_VERSION") >= 101
