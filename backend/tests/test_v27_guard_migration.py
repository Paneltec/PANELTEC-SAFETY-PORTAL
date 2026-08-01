"""v160.3.9.27 — Guard-migration regression tests.

For each of the 10 migrated code paths, this suite asserts that the new
`require_permission(...)` dep still returns HTTP 403 to a non-admin
authenticated role (`hseq_lead`) — proving that (a) the token gate is
firing and (b) the pre-migration behaviour is preserved.

Fixtures reused from `test_admin_guards.py`: `_mongo`, `ephemeral_users`,
`tokens`. `pytest` finds them via test-directory scope, no import
needed. The `NON_ADMIN_ROLES` constant covers hseq_lead / worker /
supervisor / manager / auditor.

Modules covered (10):
  1..7  master_risks, list_forms, incident_root_causes, cs_incident,
        list_roles, completed_training, companies  →  reference_library.edit
  8     sites_qr                                    →  sites.delete
  9     comms_safe_mode                             →  notifications.edit
 10     email_outbox (bulk-delete)                  →  notifications.delete
"""
from __future__ import annotations

import os
import uuid

import pytest
import requests


API = os.environ.get("VITE_BACKEND_URL") or os.environ.get(
    "REACT_APP_BACKEND_URL"
) or "http://localhost:8001"
API = API.rstrip("/") + "/api"


def _hdr(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ─────────────────────────────────────────────────────────────
# Reference-library resource — 7 RA routers
# ─────────────────────────────────────────────────────────────

_RA_MODULES = [
    ("/master-risks",         {"risk_id": "probe"}),
    ("/list-forms",           {"list_form_id": "probe", "name": "probe"}),
    ("/incident-root-causes", {"question_id": "probe", "description": "probe"}),
    ("/cs-incident",          {"issue_number": "probe"}),
    ("/list-roles",           {"role_id": "probe", "role_title": "probe"}),
    ("/completed-training",   {"competency": "probe"}),
    ("/companies",            {"company_id": "probe", "company": "probe"}),
]


@pytest.mark.parametrize("prefix,body", _RA_MODULES, ids=[m[0] for m in _RA_MODULES])
def test_v27_ra_router_hseq_lead_gets_reference_library_token_denial(prefix, body, tokens):
    """POST as hseq_lead → 403 with `Permission denied: reference_library.edit`."""
    payload = {**body}
    # Give every payload a unique tag so we never accidentally hit an existing row.
    tag = f"v27-{uuid.uuid4().hex[:8]}"
    for k, v in list(payload.items()):
        if isinstance(v, str) and v == "probe":
            payload[k] = f"{v}-{tag}"
    r = requests.post(f"{API}{prefix}/", headers=_hdr(tokens["hseq_lead"]),
                      json=payload, timeout=15)
    assert r.status_code == 403, (
        f"{prefix} POST as hseq_lead → HTTP {r.status_code} "
        f"(expected 403). Body: {r.text[:200]}"
    )
    detail = (r.json() or {}).get("detail", "")
    assert "reference_library" in detail, (
        f"{prefix} POST detail={detail!r} "
        f"(expected 'Permission denied: reference_library.edit')"
    )


def test_v27_ra_master_risks_admin_still_allowed(tokens):
    """Positive control — admin still hits the write path successfully."""
    rid = f"v27-admin-probe-{uuid.uuid4().hex[:8]}"
    r = requests.post(f"{API}/master-risks/", headers=_hdr(tokens["admin"]),
                      json={"risk_id": rid, "activity": "guard migration probe"},
                      timeout=15)
    assert r.status_code == 200 or r.status_code == 201, (
        f"admin POST /master-risks → HTTP {r.status_code}. Body: {r.text[:200]}"
    )
    # Cleanup the probe row.
    requests.delete(f"{API}/master-risks/{rid}", headers=_hdr(tokens["admin"]),
                    timeout=5)


# ─────────────────────────────────────────────────────────────
# sites — sites.delete on manual sign-off endpoint
# ─────────────────────────────────────────────────────────────

def test_v27_sites_qr_hseq_lead_denied(tokens):
    """DELETE /sites/{...}/active-signons/{...} as hseq_lead → 403 sites.delete."""
    r = requests.delete(
        f"{API}/sites/nonexistent-site/active-signons/nonexistent-signon",
        headers=_hdr(tokens["hseq_lead"]),
        timeout=10,
    )
    assert r.status_code == 403, (
        f"sites DELETE as hseq_lead → HTTP {r.status_code} "
        f"(expected 403). Body: {r.text[:200]}"
    )
    detail = (r.json() or {}).get("detail", "")
    assert "sites" in detail, (
        f"sites DELETE detail={detail!r} (expected 'Permission denied: sites.delete')"
    )


# ─────────────────────────────────────────────────────────────
# comms_safe_mode — notifications.edit
# ─────────────────────────────────────────────────────────────

def test_v27_comms_safe_mode_hseq_lead_denied(tokens):
    """PATCH /comms-safe-mode as hseq_lead → 403 notifications.edit."""
    r = requests.patch(
        f"{API}/admin/comms-safe-mode", headers=_hdr(tokens["hseq_lead"]),
        json={"mode": "off"}, timeout=10,
    )
    assert r.status_code == 403, (
        f"PATCH /comms-safe-mode as hseq_lead → HTTP {r.status_code} "
        f"(expected 403). Body: {r.text[:200]}"
    )
    detail = (r.json() or {}).get("detail", "")
    assert "notifications" in detail, (
        f"comms_safe_mode detail={detail!r} "
        f"(expected 'Permission denied: notifications.edit')"
    )


# ─────────────────────────────────────────────────────────────
# email_outbox — notifications.delete on bulk-delete
# ─────────────────────────────────────────────────────────────

def test_v27_email_outbox_bulk_delete_hseq_lead_denied(tokens):
    """POST /outbox/bulk-delete as hseq_lead → 403 notifications.delete."""
    r = requests.post(
        f"{API}/email/outbox/bulk-delete", headers=_hdr(tokens["hseq_lead"]),
        json={"ids": ["nonexistent"]}, timeout=10,
    )
    assert r.status_code == 403, (
        f"POST /outbox/bulk-delete as hseq_lead → HTTP {r.status_code} "
        f"(expected 403). Body: {r.text[:200]}"
    )
    detail = (r.json() or {}).get("detail", "")
    assert "notifications" in detail, (
        f"email_outbox bulk-delete detail={detail!r} "
        f"(expected 'Permission denied: notifications.delete')"
    )
