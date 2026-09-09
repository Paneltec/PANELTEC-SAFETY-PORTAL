"""v58.13.132cc — Sites visibility + LAST FILL 12h time · pytests.

Locks two Stephen asks bundled after the .132cb ship:

  1. `/api/sites` now returns workspace-promoted rows from the new
     `sites` collection alongside the legacy `simpro_sites` rows,
     with a `source` field on every row so SitesAdmin can render a
     chip.
  2. Per-Employee / Per-Vehicle / Admin Rollup `LAST FILL` column
     renders the full timestamp in 12-hour AM/PM format (regressed
     to date-only in .132ak).
"""
from __future__ import annotations

import re
from pathlib import Path


REPO = Path(__file__).resolve().parent.parent.parent
BACKEND = REPO / "backend"
FRONTEND = REPO / "frontend"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


# ── Backend: /api/sites union ─────────────────────────────────────

def test_sites_qr_list_sites_unions_workspace_promoted():
    src = _read(BACKEND / "sites_qr.py")
    # Simpro rows tagged.
    assert 's["source"] = "simpro"' in src or "s['source'] = 'simpro'" in src
    # Second pass over db.sites for workspace_promoted rows.
    assert "db.sites.find" in src
    assert '"source": "workspace_promoted"' in src
    # `default_for_org` + `_workspace_migrated_at` projection so the FE
    # explainer + chip can render.
    assert '"default_for_org": 1' in src
    assert '"_workspace_migrated_at": 1' in src


def test_sites_qr_list_sites_dedupes_by_simpro_site_id():
    src = _read(BACKEND / "sites_qr.py")
    assert "seen_ids" in src, "must dedupe workspace-promoted rows against simpro_site_id"


# ── Frontend: SitesAdmin explainer + Source chip ─────────────────

def test_sites_admin_renders_source_chip():
    src = _read(FRONTEND / "src" / "pages" / "SitesAdmin.jsx")
    assert re.search(r'data-testid=\{`site-source-chip-\$\{s\.simpro_site_id\}`\}', src), \
        "SitesAdmin must render a source chip with a per-row testid"
    # Source column header present.
    assert re.search(r'<th[^>]*>Source</th>', src), "Source column header missing"


def test_sites_admin_merge_explainer_and_ack():
    src = _read(FRONTEND / "src" / "pages" / "SitesAdmin.jsx")
    assert 'data-testid="sites-merge-explainer"' in src
    assert 'data-testid="sites-merge-explainer-ack"' in src
    assert "paneltec_sites_merge_ack_132cc" in src, \
        "must persist ack via a stable localStorage key"
    assert "promotedCount" in src, "banner should be conditional on promoted rows"


# ── Frontend: FuelReporting LAST FILL 12h format ─────────────────

def test_fuel_reporting_has_12h_helper():
    src = _read(FRONTEND / "src" / "pages" / "FuelReporting.jsx")
    assert "function fmtAusDateTime12h" in src
    # Uses AM/PM and 12h modulo.
    assert "'AM'" in src or "'PM'" in src or "PM" in src
    assert "% 12" in src, "must convert to 12-hour clock"


def test_fuel_reporting_row_uses_12h_timestamp():
    src = _read(FRONTEND / "src" / "pages" / "FuelReporting.jsx")
    # The rows-table LAST FILL cell must prefer latest_fill_timestamp
    # (formatted 12h) over the legacy date-only field.
    m = re.search(
        r"latest_fill_timestamp[\s\S]{0,400}?fmtAusDateTime12h\(r\.latest_fill_timestamp\)"
        r"[\s\S]{0,300}?latest_fill_date_iso",
        src,
    )
    assert m, "rows-table LAST FILL cell must render 12h timestamp with a date-only fallback"


def test_fuel_reports_backend_still_emits_timestamp():
    """Guard rail: the backend must keep emitting `latest_fill_timestamp`
    on every row of the aggregation, otherwise the .132cc FE change
    silently degrades to the date-only fallback."""
    src = _read(BACKEND / "fleet_fuel_reports.py")
    assert '"latest_fill_timestamp"' in src


# ── Version sync ──────────────────────────────────────────────────

_MIN = "132cc"


def _extract_first_token(src: str) -> str:
    m = re.search(r"v160\.3\.9\.58\.13\.(\d+[a-z]*)", src)
    assert m, "no version token found"
    return m.group(1)


def test_version_js_bumped_to_at_least_132cc():
    src = _read(FRONTEND / "src" / "lib" / "version.js")
    tok = _extract_first_token(src)
    assert tok >= _MIN, f"version.js at {tok}, want ≥ .{_MIN}"


def test_service_worker_bumped_to_at_least_132cc():
    src = _read(FRONTEND / "public" / "service-worker.js")
    m = re.search(r"CACHE_VERSION\s*=\s*'paneltec-v160\.3\.9\.58\.13\.(\d+[a-z]*)'", src)
    assert m
    assert m.group(1) >= _MIN, f"SW at {m.group(1)}, want ≥ .{_MIN}"
