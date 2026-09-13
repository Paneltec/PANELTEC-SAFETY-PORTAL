"""v58.13.132dw — Purge for soft-deleted certificates + Fuel Price 4-decimal precision.

Locks:
  1. New `POST /api/org/insurance/{policy_type}/history/{file_id}/purge`
     endpoint — admin-only, 409 if not soft-deleted, GridFS preserved,
     audit_logs entry emitted.
  2. New `POST /api/org/insurance/{policy_type}/history/purge-all-deleted`
     endpoint — idempotent, admin-only, only purges soft-deleted rows.
  3. FE Past-Certs folder renders Purge button + Purge-all pill (both
     only when Show Deleted is ON), typed-confirm dialog needs
     "PURGE" typed exactly before Submit is armed.
  4. Fuel Price PUT accepts 4-decimal (`2.5342`) and rejects 5-decimal
     (`2.53421`).
  5. FE Fuel Price edit input has `step="0.0001"` and the CSS class
     that hides native spinner buttons.
  6. FE display of $/L surfaces rendered with 4 decimals across
     FuelReporting.jsx + FuelTransactionDetailModal.jsx.
  7. Three-way version pin at .132dw.
"""
from __future__ import annotations

import io
import os
import re
from pathlib import Path

import pytest
import requests
from bson import ObjectId
from pymongo import MongoClient

APP_ROOT = Path(__file__).resolve().parents[2]
ORG_MOD = APP_ROOT / "backend" / "org_settings.py"
FUEL_MOD = APP_ROOT / "backend" / "fuel_price_settings.py"
ORG_JSX = APP_ROOT / "frontend" / "src" / "pages" / "OrgSettings.jsx"
FUEL_JSX = APP_ROOT / "frontend" / "src" / "pages" / "FuelReporting.jsx"
FTD_MODAL = APP_ROOT / "frontend" / "src" / "components" / "FuelTransactionDetailModal.jsx"
INDEX_CSS = APP_ROOT / "frontend" / "src" / "index.css"
VERSION_JS = APP_ROOT / "frontend" / "src" / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"

API = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
ADMIN_EMAIL = "stephen@paneltec.com.au"
ADMIN_PWD = "Mcgstephen50#"


def _admin_headers():
    r = requests.post(f"{API}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PWD},
                      timeout=30)
    if r.status_code != 200:
        pytest.skip(f"admin login unavailable: {r.status_code}")
    tok = r.json().get("access_token") or r.json().get("token")
    return {"Authorization": f"Bearer {tok}"}


def _db():
    return MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


# ─── Source pins ────────────────────────────────────────────────

def test_backend_purge_endpoints_present():
    src = ORG_MOD.read_text(encoding="utf-8")
    assert "132dw" in src
    assert '@router.post("/insurance/{policy_type}/history/{file_id}/purge")' in src
    assert '@router.post("/insurance/{policy_type}/history/purge-all-deleted")' in src
    # Purge writes an audit log row with the canonical action name.
    assert '"action": "insurance_cert_purged"' in src
    # 409 gate — row must be soft-deleted first.
    assert 'raise HTTPException(\n            409,' in src or "409," in src
    # GridFS files are never physically deleted — no `fs.files.delete`
    # or similar in the purge path.
    assert "fs.files.delete" not in src
    assert "fs.chunks.delete" not in src


def test_frontend_org_page_purge_controls():
    src = ORG_JSX.read_text(encoding="utf-8")
    assert "132dw" in src
    # Per-row Purge button + Purge-all pill + typed-confirm dialog.
    assert "org-insurance-history-purge-" in src
    assert "org-insurance-history-purge-all-" in src
    assert "org-insurance-history-purge-confirm-" in src
    assert "org-insurance-history-purge-typed-" in src
    assert "org-insurance-history-purge-submit-" in src
    assert "org-insurance-history-purge-cancel-" in src
    # Typed-confirm gate uses the literal string PURGE.
    assert "typed === 'PURGE'" in src
    # Component that owns the typed-confirm dialog exists.
    assert "function PurgeConfirmDialog" in src


def test_backend_fuel_price_4decimal_validator():
    src = FUEL_MOD.read_text(encoding="utf-8")
    assert "132dw" in src
    assert "field_validator" in src
    assert "at most 4 decimal places" in src


def test_frontend_fuel_price_input_precision():
    src = FUEL_JSX.read_text(encoding="utf-8")
    assert "132dw" in src
    assert 'step="0.0001"' in src
    assert 'class="w-full px-3 py-2 rounded-lg border border-slate-300' in src or 'fuel-price-input' in src
    # Save path rejects 5+ decimals client-side too.
    assert "Up to 4 decimal places" in src
    # Display precision: header card + banner + info line use toFixed(4).
    # (Grep for the specific patterns we changed rather than every
    # instance of toFixed(4) — that's a broader signal but this
    # tightens the lock on the target surfaces.)
    assert ".toFixed(4)" in src
    # Old .toFixed(3) on $/L surfaces should be gone from the header.
    assert "provisional_price_per_litre).toFixed(3)" not in src


def test_frontend_transaction_detail_modal_4decimals():
    src = FTD_MODAL.read_text(encoding="utf-8")
    assert "fmtDollar(dpl, 4)" in src
    # v58.13.132dy — The `fmtDollar(provPrice, 4)` call site in the
    # Portal Unit Price row was removed when the row stopped
    # branching on the live `overrideActive` toggle. `provPrice` is
    # still referenced in the SmartFill raw reference caption
    # (`fmtNum(provPrice, 4)`), so the precision guarantee is
    # preserved — but the .132dw `fmtDollar(provPrice, 4)` pin
    # doesn't apply post-.132dy.
    assert "fmtNum(provPrice, 4)" in src
    # 3-decimal $/L rendering should be gone from the modal.
    assert "fmtDollar(dpl, 3)" not in src
    assert "fmtDollar(provPrice, 3)" not in src
    assert "fmtDollar(rawDpl, 3)" not in src


def test_frontend_css_hides_fuel_spinner_buttons():
    css = INDEX_CSS.read_text(encoding="utf-8")
    assert "132dw" in css
    assert ".fuel-price-input::-webkit-inner-spin-button" in css
    assert "-webkit-appearance: none" in css
    assert "-moz-appearance: textfield" in css


def test_three_way_version_sync_at_132dw():
    running = re.search(r"^export const RUNNING_VERSION = '([^']+)'",
                        VERSION_JS.read_text(), re.MULTILINE).group(1)
    expected = re.search(r"^export const EXPECTED_CACHE_VERSION = '([^']+)'",
                         VERSION_JS.read_text(), re.MULTILINE).group(1)
    cache = re.search(r"^const CACHE_VERSION = '([^']+)'",
                      SW.read_text(), re.MULTILINE).group(1)
    assert running == expected == cache
    tail = re.search(r"132([a-z]+)", running).group(1)
    assert tail >= "dw"


# ─── Behavioural — purge round-trip ─────────────────────────────

def test_purge_requires_soft_delete_first():
    """Upload an archived cert (not soft-deleted), attempt to purge,
    expect 409 with a helpful message."""
    hdr = _admin_headers()
    kind = "professional_indemnity"
    pdf = b"%PDF-1.4\n%dw-purge-409\n%%EOF\n"
    r = requests.post(f"{API}/api/org/insurance/{kind}/upload",
                      files={"file": ("live-1.pdf", io.BytesIO(pdf),
                                       "application/pdf")},
                      headers=hdr, timeout=30)
    assert r.status_code == 200
    # Upload again to force an archive of the first.
    r2 = requests.post(f"{API}/api/org/insurance/{kind}/upload",
                      files={"file": ("live-2.pdf", io.BytesIO(pdf + b"2"),
                                       "application/pdf")},
                      headers=hdr, timeout=30)
    assert r2.status_code == 200
    hist = requests.get(f"{API}/api/org/insurance/{kind}/history",
                        headers=hdr, timeout=30).json()
    live = next((r for r in hist["items"] if not r.get("deleted_at")), None)
    assert live is not None
    victim = live["certificate_id"]
    # Attempt purge on a NOT-YET-soft-deleted row → 409.
    p = requests.post(
        f"{API}/api/org/insurance/{kind}/history/{victim}/purge",
        headers=hdr, timeout=30)
    assert p.status_code == 409, p.text
    assert "soft-deleted" in p.text.lower()


def test_purge_single_removes_row_preserves_gridfs():
    """Soft-delete then purge a single row. Row disappears from
    include_deleted view; GridFS blob still resolves; audit_logs
    row present with the expected shape."""
    hdr = _admin_headers()
    kind = "professional_indemnity"
    pdf = b"%PDF-1.4\n%dw-purge-single\n%%EOF\n"
    r = requests.post(f"{API}/api/org/insurance/{kind}/upload",
                      files={"file": ("s1.pdf", io.BytesIO(pdf),
                                       "application/pdf")},
                      headers=hdr, timeout=30)
    assert r.status_code == 200
    r2 = requests.post(f"{API}/api/org/insurance/{kind}/upload",
                      files={"file": ("s2.pdf", io.BytesIO(pdf + b"2"),
                                       "application/pdf")},
                      headers=hdr, timeout=30)
    assert r2.status_code == 200
    hist = requests.get(f"{API}/api/org/insurance/{kind}/history",
                        headers=hdr, timeout=30).json()
    victim = next(r for r in hist["items"] if not r.get("deleted_at"))
    file_id = victim["certificate_id"]
    # Soft-delete
    dr = requests.delete(
        f"{API}/api/org/insurance/{kind}/history/{file_id}",
        headers=hdr, timeout=30)
    assert dr.status_code == 200
    # Purge
    pr = requests.post(
        f"{API}/api/org/insurance/{kind}/history/{file_id}/purge",
        headers=hdr, timeout=30)
    assert pr.status_code == 200, pr.text
    body = pr.json()
    assert body.get("purged") == 1
    # include_deleted=true no longer surfaces the purged row.
    all_hist = requests.get(
        f"{API}/api/org/insurance/{kind}/history",
        params={"include_deleted": "true"}, headers=hdr, timeout=30).json()
    assert not any(r["certificate_id"] == file_id
                   for r in all_hist["items"])
    # GridFS blob preserved.
    db = _db()
    assert db.fs.files.find_one({"_id": ObjectId(file_id)}) is not None
    # Audit log entry emitted.
    audit = db.audit_logs.find_one({
        "action": "insurance_cert_purged", "file_id": file_id,
    })
    assert audit is not None
    assert audit.get("policy_type") == kind
    assert audit.get("actor_id")
    assert audit.get("soft_deleted_at")


def test_purge_all_deleted_only_soft_deleted():
    """Seed 1 live + 2 soft-deleted rows; purge-all-deleted purges 2,
    leaves the live one intact."""
    hdr = _admin_headers()
    kind = "professional_indemnity"
    # Ensure a clean starting point — clear-all first to remove any
    # residuals from the previous tests.
    requests.post(f"{API}/api/org/insurance/{kind}/history/clear-all",
                  headers=hdr, timeout=30)
    # Purge whatever is left over so the count is deterministic.
    requests.post(
        f"{API}/api/org/insurance/{kind}/history/purge-all-deleted",
        headers=hdr, timeout=30)
    # Seed 3 live archives.
    for i in range(3):
        pdf = f"%PDF-1.4\n%dw-purge-all-{i}\n%%EOF\n".encode()
        r = requests.post(f"{API}/api/org/insurance/{kind}/upload",
                          files={"file": (f"pa-{i}.pdf", io.BytesIO(pdf),
                                           "application/pdf")},
                          headers=hdr, timeout=30)
        assert r.status_code == 200
    hist = requests.get(f"{API}/api/org/insurance/{kind}/history",
                        headers=hdr, timeout=30).json()
    live_ids = [r["certificate_id"] for r in hist["items"]
                if not r.get("deleted_at")]
    assert len(live_ids) >= 2, live_ids
    # Soft-delete the two OLDEST (the ones that got archived).
    for lid in live_ids[1:]:
        d = requests.delete(
            f"{API}/api/org/insurance/{kind}/history/{lid}",
            headers=hdr, timeout=30)
        assert d.status_code == 200
    # Purge-all-deleted.
    pr = requests.post(
        f"{API}/api/org/insurance/{kind}/history/purge-all-deleted",
        headers=hdr, timeout=30)
    assert pr.status_code == 200
    body = pr.json()
    assert body.get("purged") >= 2
    # Idempotent: re-run purges 0.
    pr2 = requests.post(
        f"{API}/api/org/insurance/{kind}/history/purge-all-deleted",
        headers=hdr, timeout=30)
    assert pr2.status_code == 200
    assert pr2.json().get("purged") == 0
    # Live row survived.
    remaining = requests.get(
        f"{API}/api/org/insurance/{kind}/history",
        params={"include_deleted": "true"},
        headers=hdr, timeout=30).json()
    remaining_ids = {r["certificate_id"] for r in remaining["items"]}
    assert live_ids[0] in remaining_ids


def test_purge_admin_only():
    r = requests.post(
        f"{API}/api/org/insurance/public_liability/history/xxx/purge",
        timeout=15)
    assert r.status_code in (401, 403)
    r2 = requests.post(
        f"{API}/api/org/insurance/public_liability/history/purge-all-deleted",
        timeout=15)
    assert r2.status_code in (401, 403)


# ─── Behavioural — Fuel Price 4-decimal validation ──────────────

def test_fuel_price_accepts_4_decimals():
    hdr = _admin_headers()
    # Restore original after the test so downstream tests aren't
    # perturbed by our poke.
    orig = requests.get(f"{API}/api/fleet/fuel/price-settings",
                        headers=hdr, timeout=15).json()
    original_price = orig.get("provisional_price_per_litre")
    try:
        r = requests.put(f"{API}/api/fleet/fuel/price-settings",
                         json={"provisional_price_per_litre": 2.5342},
                         headers=hdr, timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        # Persisted price should equal the input to 4dp precision.
        assert round(body["provisional_price_per_litre"], 4) == 2.5342
    finally:
        if original_price is not None:
            requests.put(
                f"{API}/api/fleet/fuel/price-settings",
                json={"provisional_price_per_litre": float(original_price)},
                headers=hdr, timeout=30)


def test_fuel_price_rejects_5_decimals():
    hdr = _admin_headers()
    r = requests.put(f"{API}/api/fleet/fuel/price-settings",
                     json={"provisional_price_per_litre": 2.53421},
                     headers=hdr, timeout=30)
    assert r.status_code == 422, r.text
    assert "4 decimal places" in r.text
