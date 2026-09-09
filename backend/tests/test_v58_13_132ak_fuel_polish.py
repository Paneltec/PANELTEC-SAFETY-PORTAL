"""v58.13.132ak — Fuel Report per-row `Last fill` + default sort.

Locks in:
  1. `rows[i].latest_fill_date_iso` populated for every aggregated
     row (max date_iso within the group).
  2. Rows sorted by `latest_fill_date_iso` desc — most recently
     fuelled entity at the top.
  3. Aggregated CSV export column `Fills` → `Last fill`.
  4. SmartFill auto-sync cron is registered at process start (env
     `SMARTFILL_AUTO_SYNC_CRON=1`).
"""
from __future__ import annotations

import pytest
import requests

pytestmark = pytest.mark.live_db_writes

BASE = "http://localhost:8001"
ADMIN_EMAIL = "stephen@paneltec.com.au"
ADMIN_PASS = "Mcgstephen50#"


@pytest.fixture(scope="module")
def admin_token() -> str:
    r = requests.post(
        f"{BASE}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASS},
        timeout=10,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    tok = body.get("access_token") or body.get("token")
    assert tok
    return tok


def _hdr(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}"}


@pytest.mark.live_db_writes
def test_rows_include_latest_fill_date_iso(admin_token):
    r = requests.get(
        f"{BASE}/api/fleet/fuel/reports",
        params={"scope": "vehicle", "period": "weekly",
                "from": "2026-08-31", "to": "2026-09-06"},
        headers=_hdr(admin_token), timeout=15,
    )
    assert r.status_code == 200
    rows = r.json()["rows"]
    assert len(rows) > 0
    for row in rows:
        assert "latest_fill_date_iso" in row, (
            f"row {row.get('label')!r} missing latest_fill_date_iso"
        )
        # ISO YYYY-MM-DD when populated (may be '' only if the group
        # somehow had no date_iso — shouldn't happen for real data).
        v = row["latest_fill_date_iso"]
        assert v == "" or (len(v) == 10 and v[4] == "-" and v[7] == "-"), (
            f"invalid latest_fill_date_iso: {v!r}"
        )


@pytest.mark.live_db_writes
def test_rows_default_sort_is_latest_fill_desc(admin_token):
    r = requests.get(
        f"{BASE}/api/fleet/fuel/reports",
        params={"scope": "vehicle", "period": "weekly",
                "from": "2026-08-31", "to": "2026-09-06"},
        headers=_hdr(admin_token), timeout=15,
    )
    rows = r.json()["rows"]
    dates = [row["latest_fill_date_iso"] for row in rows]
    assert dates == sorted(dates, reverse=True), (
        f"rows not sorted by latest_fill_date_iso desc — got {dates}"
    )


@pytest.mark.live_db_writes
def test_employee_scope_also_sorted_by_last_fill(admin_token):
    """Employee scope gets the same treatment (Stephen's brief)."""
    r = requests.get(
        f"{BASE}/api/fleet/fuel/reports",
        params={"scope": "employee", "period": "weekly",
                "from": "2026-08-31", "to": "2026-09-06"},
        headers=_hdr(admin_token), timeout=15,
    )
    rows = r.json()["rows"]
    if len(rows) >= 2:
        dates = [row["latest_fill_date_iso"] for row in rows]
        assert dates == sorted(dates, reverse=True)


@pytest.mark.live_db_writes
def test_csv_export_swaps_fills_column_for_last_fill(admin_token):
    r = requests.get(
        f"{BASE}/api/fleet/fuel/reports/export",
        params={"scope": "vehicle", "period": "weekly",
                "from": "2026-08-31", "to": "2026-09-06"},
        headers=_hdr(admin_token), timeout=15,
    )
    assert r.status_code == 200
    text = r.content.decode("utf-8")
    # Metadata block still present.
    assert text.startswith("Report range,")
    # Find the data header.
    header = next(l for l in text.splitlines() if l.startswith("Vehicle,"))
    parts = [p.strip() for p in header.split(",")]
    # `Fills` no longer present, `Last fill` inserted right after label.
    assert "Fills" not in parts, f"Fills column should be gone, got {parts}"
    assert parts[1] == "Last fill", f"expected Last fill 2nd, got {parts}"
    # First data row's 2nd cell is a YYYY-MM-DD.
    data_row = next(l for l in text.splitlines()
                    if not l.startswith(("Report range", "Scope", "Period",
                                         "Generated", "Latest txn", "Vehicle"))
                    and l.strip())
    cells = data_row.split(",")
    assert len(cells[1]) == 10 and cells[1][4] == "-" and cells[1][7] == "-", (
        f"CSV row's Last fill cell not YYYY-MM-DD: {cells[1]!r}"
    )


@pytest.mark.live_db_writes
def test_smartfill_cron_registered_after_env_flip(admin_token):
    """Fix A — SMARTFILL_AUTO_SYNC_CRON=1 wired at process start."""
    r = requests.get(
        f"{BASE}/api/fleet/fuel/smartfill-status",
        headers=_hdr(admin_token), timeout=10,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["cron_registered"] is True, (
        "SmartFill cron should be registered after SMARTFILL_AUTO_SYNC_CRON=1 "
        f"+ supervisor restart — got status: {body}"
    )
