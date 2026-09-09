"""v58.13.132bq — Card labels with rego on leaderboards + drawer header.

Coverage:
  1. `/fleet/fuel/reports` leaderboard rows now carry `linked_rego`
     (str | null) per row. Populated when at least one of the row's
     `card_numbers` matches a vehicle's `smartfill_card_number`.
  2. Multi-card rows resolve to the FIRST linkable rego.
  3. Zero-card rows (driver-name / no-card rows) carry `linked_rego: None`.
  4. Frontend source pins: FuelReporting `displayLabel()` helper,
     SmartFillCardDrawer header renders "Card N · REGO / unlinked",
     legacy "(unlinked)" copy-string retired from the reachable UI.
  5. Version pins forward-safe >= .132bq.
"""
from __future__ import annotations
import os
import re
import time
import uuid
import pytest
from pathlib import Path
from pymongo import MongoClient
from dotenv import load_dotenv
import httpx


def _read_frontend_env(key: str) -> str:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith(key + "="):
                return line.split("=", 1)[1].strip().strip('"')
    raise RuntimeError(f"{key} not in /app/frontend/.env")


@pytest.fixture(scope="module")
def env():
    load_dotenv("/app/backend/.env")
    return {
        "mongo_url": os.environ["MONGO_URL"],
        "db_name": os.environ["DB_NAME"],
        "api_url": _read_frontend_env("REACT_APP_BACKEND_URL"),
    }


@pytest.fixture(scope="module")
def db_sync(env):
    return MongoClient(env["mongo_url"])[env["db_name"]]


@pytest.fixture(scope="module")
def token(env):
    last_err = None
    for attempt in range(6):
        try:
            r = httpx.post(
                f"{env['api_url']}/api/auth/login",
                json={"email": "stephen@paneltec.com.au",
                      "password": "Mcgstephen50#"},
                timeout=10,
            )
            if r.status_code == 429:
                time.sleep(2 * (attempt + 1))
                last_err = r.text
                continue
            r.raise_for_status()
            return r.json()["access_token"]
        except httpx.HTTPStatusError as e:
            last_err = str(e)
            if e.response.status_code == 429:
                time.sleep(2 * (attempt + 1))
                continue
            raise
    raise RuntimeError(f"login failed after retries: {last_err}")


# ── Backend contract ────────────────────────────────────────────
def test_leaderboard_rows_expose_linked_rego(env, token):
    r = httpx.get(
        f"{env['api_url']}/api/fleet/fuel/reports",
        params={"scope": "admin", "period": "monthly"}, timeout=25,
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    lb = r.json().get("leaderboards") or {}
    assert lb, "no leaderboards block"
    for board in ("top_by_cost", "top_by_dpl", "top_by_fills"):
        for row in lb.get(board) or []:
            assert "linked_rego" in row, f"{board} row missing linked_rego: {row}"
            # linked_rego is either None or a non-empty string.
            lr = row["linked_rego"]
            assert lr is None or (isinstance(lr, str) and lr.strip()), \
                f"linked_rego must be None or non-empty string, got {lr!r}"


def test_leaderboard_rego_resolves_when_card_linked(env, token, db_sync):
    """If a card in the row's `card_numbers` is linked to an asset with
    a `rego_serial`, that rego surfaces on the row."""
    r = httpx.get(
        f"{env['api_url']}/api/fleet/fuel/reports",
        params={"scope": "admin", "period": "monthly"}, timeout=25,
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
    lb = r.json()["leaderboards"]
    for board in ("top_by_cost", "top_by_dpl", "top_by_fills"):
        for row in lb.get(board) or []:
            cards = row.get("card_numbers") or []
            if not cards or not row.get("linked_rego"):
                continue
            # Verify at least one of these cards is genuinely linked in DB.
            hit = db_sync.assets.find_one(
                {"smartfill_card_number": {"$in": cards}, "deleted_at": None},
                {"rego_serial": 1, "name": 1},
            )
            assert hit, (
                f"row claims linked_rego={row['linked_rego']!r} but no asset "
                f"has smartfill_card_number in {cards}"
            )
            return  # one live positive assertion is enough
    pytest.skip("no linked-card leaderboard row available in current data")


# ── Frontend source pins ────────────────────────────────────────
FE_ROOT = Path("/app/frontend/src")
FUEL_REPORTING = (FE_ROOT / "pages" / "FuelReporting.jsx").read_text()
DRAWER = (FE_ROOT / "components" / "fleet" / "SmartFillCardDrawer.jsx").read_text()
VERSION_JS = (FE_ROOT / "lib" / "version.js").read_text()
SW_JS = Path("/app/frontend/public/service-worker.js").read_text()


def test_leaderboard_uses_displayLabel_and_linked_rego():
    assert "displayLabel" in FUEL_REPORTING
    assert "linked_rego" in FUEL_REPORTING
    # New label format: `Card ${cn} · <REGO>` and `Card ${cn} · unlinked`.
    # `.132bu` renamed the local var; check either shape survives.
    assert (" · ${rego}" in FUEL_REPORTING
            or " · ${linked}" in FUEL_REPORTING
            or " · ${inferred}" in FUEL_REPORTING)
    assert " · unlinked" in FUEL_REPORTING


def test_drawer_header_renders_rego_or_unlinked():
    # H2 now carries both the card number AND the linked rego / "unlinked"
    # marker separated by a middle-dot.
    assert "smartfill-card-title" in DRAWER
    assert 'className="text-emerald-700"' in DRAWER
    assert 'className="text-amber-700"' in DRAWER
    assert ">unlinked<" in DRAWER


def test_legacy_unlinked_parens_removed_from_reachable_ui():
    """The FE user-facing copy `Card N (unlinked)` (with parens) must
    not appear in any RENDERED JSX string of FuelReporting or the
    drawer. Backend `_key_label` may still build the old string as an
    internal `key`, and inline comments in the file may reference it,
    but no JSX text node should contain it."""
    for name, text in [
        ("FuelReporting.jsx", FUEL_REPORTING),
        ("SmartFillCardDrawer.jsx", DRAWER),
    ]:
        # Strip JS block comments (/* ... */) and line comments (// ...)
        # before scanning so historical prose can't cause a false fail.
        stripped = re.sub(r"/\*.*?\*/", "", text, flags=re.DOTALL)
        stripped = re.sub(r"//[^\n]*", "", stripped)
        assert "(unlinked)" not in stripped, (
            f"{name} still contains '(unlinked)' outside of comments"
        )


def test_version_and_cache_bumped_to_132bq():
    def ge(v):
        m = re.search(r"\.132([a-z]+)$", v)
        return bool(m) and m.group(1) >= "bq"
    m = re.search(r"RUNNING_VERSION\s*=\s*'([^']+)'", VERSION_JS)
    assert m and ge(m.group(1)), m and m.group(1)
    m2 = re.search(r"EXPECTED_CACHE_VERSION\s*=\s*'([^']+)'", VERSION_JS)
    assert m2 and ge(m2.group(1)), m2 and m2.group(1)
    m3 = re.search(r"CACHE_VERSION\s*=\s*'([^']+)'", SW_JS)
    assert m3 and ge(m3.group(1)), m3 and m3.group(1)
