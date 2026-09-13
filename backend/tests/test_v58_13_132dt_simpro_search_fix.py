"""v58.13.132dt — Simpro customer search dropdown fix.

Locks the fix for the .132dq bug where /integrations/simpro/customers/search
returned empty items on every substring query because the `_match` filter
targeted keys (`company_name`, `contact_name`, `email`, `given_name`,
`family_name`) that were never present on cached rows.

Coverage:
  1. `_normalise_customer` preserves company_name / contact_name /
     given_name / family_name / _href from the raw Simpro list payload.
  2. `_match` filters over the ACTUAL keys and the `type`/`company_label`
     display fields for good measure.
  3. Behavioural: `q=an` returns > 0 matches with a real `email` populated
     via the on-demand detail-endpoint enrichment.
  4. Admin-gated: unauth'd request → 401/403.
  5. FE lock: the picker dropdown component still renders when
     `suggestions.length > 0` with the correct field bindings.
  6. Version-sync at .132dt across the 3 canonical strings.
"""
from __future__ import annotations

import os
import re
from pathlib import Path

import pytest
import requests

APP_ROOT = Path(__file__).resolve().parents[2]
SIMPRO_MOD = APP_ROOT / "backend" / "integrations_simpro.py"
ORG_JSX = APP_ROOT / "frontend" / "src" / "pages" / "OrgSettings.jsx"
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


# ─── Source pins ────────────────────────────────────────────────

def test_normalise_customer_preserves_split_fields():
    src = SIMPRO_MOD.read_text(encoding="utf-8")
    assert "132dt" in src
    # New alias fields present in the returned dict.
    for field in ('"company_name":', '"contact_name":',
                  '"given_name":', '"family_name":', '"_href":'):
        assert field in src, f"missing normalised field emit: {field}"


def test_match_filters_over_real_cache_keys():
    src = SIMPRO_MOD.read_text(encoding="utf-8")
    # The _match closure must include `name` (fallback), the split
    # fields, and NOT rely purely on pre-.132dt keys that were never
    # populated. `email` may still be in the haystack (once enriched).
    m = re.search(
        r'def _match\(r: dict\) -> bool:\s*'
        r'hay = " "\.join\(str\(r\.get\(k\) or ""\) for k in\s*'
        r'\(([^)]+)\)\)\.lower\(\)',
        src, re.DOTALL)
    assert m, "_match tuple not found"
    keys = m.group(1)
    for required in ("name", "company_name", "contact_name",
                     "given_name", "family_name"):
        assert f'"{required}"' in keys, f"_match missing key: {required}"


def test_email_enrichment_helpers_present():
    src = SIMPRO_MOD.read_text(encoding="utf-8")
    # On-demand detail-endpoint enrichment for the top-N matches +
    # the 30-minute in-process cache that keeps typing snappy.
    assert "_CUSTOMER_EMAIL_CACHE" in src
    assert "_CUSTOMER_EMAIL_TTL_S" in src
    assert "_fetch_customer_email" in src
    assert "_enrich_emails" in src
    # Bounded semaphore so we don't hammer Simpro.
    assert "asyncio.Semaphore" in src


def test_frontend_picker_still_wired():
    src = ORG_JSX.read_text(encoding="utf-8")
    assert 'data-testid="insurance-email-simpro-search"' in src
    assert 'data-testid="insurance-email-simpro-suggestions"' in src
    # Response payload key on the dropdown map is `simproResults`
    # semantically — the OrgSettings modal uses `suggestions`. Either
    # way the FE reads `.items` from the response, and the button
    # renders when the state array has length > 0.
    assert "suggestions.length > 0" in src
    assert "suggestions.map" in src
    # The clicked row must pass the CUSTOMER'S EMAIL — not the label —
    # to addRecipient, so the M365 dispatch downstream ships to the
    # correct address.
    assert "addRecipient(s.email" in src


def test_three_way_version_sync_at_132dt():
    running = re.search(r"^export const RUNNING_VERSION = '([^']+)'",
                        VERSION_JS.read_text(), re.MULTILINE).group(1)
    expected = re.search(r"^export const EXPECTED_CACHE_VERSION = '([^']+)'",
                         VERSION_JS.read_text(), re.MULTILINE).group(1)
    cache = re.search(r"^const CACHE_VERSION = '([^']+)'",
                      SW.read_text(), re.MULTILINE).group(1)
    assert running == expected == cache
    tail = re.search(r"132([a-z]+)", running).group(1)
    assert tail >= "dt"


# ─── Behavioural ────────────────────────────────────────────────

def test_customers_search_returns_matches_with_emails():
    """Regression lock for the .132dq bug: a common substring must
    return > 0 items, and at least one row must have a real email
    populated via the on-demand detail enrichment. Skips gracefully
    if Simpro isn't connected in this environment."""
    hdr = _admin_headers()
    r = requests.get(
        f"{API}/api/integrations/simpro/customers/search",
        params={"q": "an", "limit": 15}, headers=hdr, timeout=60)
    assert r.status_code == 200, r.text
    body = r.json()
    if not body.get("connected"):
        pytest.skip("Simpro not connected in this environment")
    items = body.get("items") or []
    assert len(items) > 0, "substring 'an' should match >= 1 customer"
    # Response rows carry the new normalised shape.
    row = items[0]
    for key in ("simpro_customer_id", "simpro_company_id", "name",
                "company_name", "type", "_href"):
        assert key in row, f"missing key on response row: {key}"
    # Substring hit must match somewhere in the name/company_name/
    # contact_name/etc. — case-insensitive.
    def _hay(r):
        return " ".join(str(r.get(k) or "") for k in
                        ("name", "company_name", "contact_name",
                         "given_name", "family_name", "type"))
    assert any("an" in _hay(r).lower() for r in items)
    # At least one row should end up with a real email string via
    # the on-demand enrichment. (Not every Simpro customer has one
    # on file, so we don't require ALL rows — just at least one.)
    assert any((r.get("email") or "").strip() for r in items), \
        "expected at least one enriched email in the response"


def test_customers_search_admin_only():
    """Unauth'd request must be rejected."""
    r = requests.get(
        f"{API}/api/integrations/simpro/customers/search",
        params={"q": "a"}, timeout=15)
    assert r.status_code in (401, 403)
