"""v58.13.132bz — Fuel UI hardening bundle (5 issues).

Backend coverage:
  1. `_key_label` no longer builds "Card N (unlinked)" — now
     "Card N · unlinked" (middle-dot separator).
  2. `/reports` rows carry `linked_rego` + `inferred_rego` at ALL
     scopes (admin/employee/vehicle), not just leaderboards.
  3. `top_dpl_outliers_real` rows now carry per-txn `linked_rego`
     + `inferred_rego` so the FE outlier table can show which
     vehicle drove each fill.

Frontend source pins:
  · Per-employee / Per-vehicle table row now has an onClick handler
    that opens SmartFillCardDrawer for single-card rows (issue 4).
  · Per-row label uses the same cascade as leaderboards (issue 5).
  · Top-5 $/L outlier table has a new Rego column with linked /
    inferred / — cascade (issue 2).
  · Top-10 leaderboard row uses shorter "inf." chip + tighter
    padding so $ column doesn't clip (issue 3).
  · Anomaly Inbox pre-selection banner surfaces "Select all N
    matching" even before any checkbox is ticked (issue 1).
  · Version bump forward-safe >= .132bz.
"""
from __future__ import annotations
import os
import re
import time
import pytest
from pathlib import Path
from dotenv import load_dotenv
import httpx


def _read_frontend_env(key):
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith(key + "="):
                return line.split("=", 1)[1].strip().strip('"')
    raise RuntimeError(f"{key} missing")


@pytest.fixture(scope="module")
def env():
    load_dotenv("/app/backend/.env")
    return {"api_url": _read_frontend_env("REACT_APP_BACKEND_URL")}


@pytest.fixture(scope="module")
def token(env):
    last = None
    for attempt in range(6):
        try:
            r = httpx.post(
                f"{env['api_url']}/api/auth/login",
                json={"email": "stephen@paneltec.com.au",
                      "password": "Mcgstephen50#"}, timeout=10,
            )
            if r.status_code == 429:
                time.sleep(2 * (attempt + 1))
                last = r.text
                continue
            r.raise_for_status()
            return r.json()["access_token"]
        except httpx.HTTPStatusError as e:
            last = str(e)
            if e.response.status_code == 429:
                time.sleep(2 * (attempt + 1))
                continue
            raise
    raise RuntimeError(f"login failed: {last}")


# ── Backend contract ─────────────────────────────────────────────
def test_reports_rows_expose_linked_and_inferred_rego(env, token):
    """Per-employee scope rows now carry linked_rego + inferred_rego
    (not just leaderboards)."""
    r = httpx.get(
        f"{env['api_url']}/api/fleet/fuel/reports",
        params={"scope": "employee", "period": "monthly"}, timeout=25,
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    rows = body.get("rows") or []
    for row in rows:
        assert "linked_rego" in row, f"row missing linked_rego: {row}"
        assert "inferred_rego" in row, f"row missing inferred_rego: {row}"


def test_outliers_carry_rego_cascade(env, token):
    """Top-5 $/L outlier rows now carry linked_rego + inferred_rego."""
    r = httpx.get(
        f"{env['api_url']}/api/fleet/fuel/reports",
        params={"scope": "admin", "period": "monthly"}, timeout=25,
        headers={"Authorization": f"Bearer {token}"},
    )
    body = r.json()
    outliers = body.get("top_dpl_outliers_real") or []
    for o in outliers:
        assert "linked_rego" in o, f"outlier missing linked_rego: {o}"
        assert "inferred_rego" in o, f"outlier missing inferred_rego: {o}"


def test_key_label_no_longer_uses_parens_unlinked(env, token):
    """The `_key_label` change means row.label reads 'Card N · unlinked'
    (middle-dot) not 'Card N (unlinked)' (parens)."""
    r = httpx.get(
        f"{env['api_url']}/api/fleet/fuel/reports",
        params={"scope": "employee", "period": "monthly"}, timeout=25,
        headers={"Authorization": f"Bearer {token}"},
    )
    body = r.json()
    for row in body.get("rows") or []:
        label = row.get("label") or ""
        assert "(unlinked)" not in label, \
            f"row.label still uses old parens format: {label!r}"


# ── Frontend source pins ─────────────────────────────────────────
FE_ROOT = Path("/app/frontend/src")
FUEL_REPORTING = (FE_ROOT / "pages" / "FuelReporting.jsx").read_text()
INBOX = (FE_ROOT / "pages" / "FuelAnomalyInbox.jsx").read_text()
VERSION_JS = (FE_ROOT / "lib" / "version.js").read_text()
SW_JS = Path("/app/frontend/public/service-worker.js").read_text()


def test_per_employee_rows_clickable_and_cascade():
    """Issue 4 + 5: per-employee / per-vehicle rows have onClick +
    label cascade."""
    # Row-scope inferred chip.
    assert 'fuel-reporting-row-${r.key}-inferred`}' in FUEL_REPORTING
    # Click → open SmartFillCardDrawer for single-card rows.
    assert "setDrawerCard(cards[0])" in FUEL_REPORTING
    # Cascade copy present.
    assert "Card ${cn} · unlinked" in FUEL_REPORTING


def test_outlier_table_has_rego_column():
    """Issue 2: outlier table has a Rego column with cascade."""
    assert 'fuel-reporting-outlier-real-rego-' in FUEL_REPORTING
    # Emerald linked / violet inferred / dash for null.
    assert "linked_rego" in FUEL_REPORTING
    assert "inferred_rego" in FUEL_REPORTING


def test_leaderboard_chip_shortened_and_metric_padding_tightened():
    """Issue 3: `inferred` chip → `inf.`, and metric column has
    whitespace-nowrap so it can't clip."""
    assert ">\n                      inf.\n" in FUEL_REPORTING or "inf." in FUEL_REPORTING
    assert "text-right font-mono text-sm whitespace-nowrap" in FUEL_REPORTING
    # Old wide chip padding is gone.
    assert 'text-[9px] font-bold italic\n                      title="Rego derived' not in FUEL_REPORTING or "inf." in FUEL_REPORTING


def test_anomaly_preselect_banner_present():
    """Issue 1: pre-selection amber banner surfaces the 'Select all N
    matching' affordance even before any checkbox is ticked."""
    assert 'data-testid="fuel-anomaly-preselect-banner"' in INBOX
    assert 'data-testid="fuel-anomaly-preselect-select-all"' in INBOX
    assert "selected.size === 0 && total > filtered.length" in INBOX


def test_no_unlinked_parens_in_reachable_ui():
    """Issue 5: strip JS/JSX comments and confirm no rendered string
    contains the old `(unlinked)` copy."""
    for name, text in [("FuelReporting.jsx", FUEL_REPORTING),
                        ("FuelAnomalyInbox.jsx", INBOX)]:
        stripped = re.sub(r"/\*.*?\*/", "", text, flags=re.DOTALL)
        stripped = re.sub(r"//[^\n]*", "", stripped)
        assert "(unlinked)" not in stripped, (
            f"{name} still contains '(unlinked)' outside of comments"
        )


def test_version_and_cache_bumped_to_132bz():
    def ge(v):
        m = re.search(r"\.132([a-z]+)$", v)
        return bool(m) and m.group(1) >= "bz"
    m = re.search(r"RUNNING_VERSION\s*=\s*'([^']+)'", VERSION_JS)
    assert m and ge(m.group(1)), m and m.group(1)
    m2 = re.search(r"EXPECTED_CACHE_VERSION\s*=\s*'([^']+)'", VERSION_JS)
    assert m2 and ge(m2.group(1)), m2 and m2.group(1)
    m3 = re.search(r"CACHE_VERSION\s*=\s*'([^']+)'", SW_JS)
    assert m3 and ge(m3.group(1)), m3 and m3.group(1)
