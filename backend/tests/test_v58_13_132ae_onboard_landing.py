"""v58.13.132ae — onboarding QR landing page + validate endpoint.

Covers:
  · GET /api/mobile/onboarding/validate/<token> returns valid=true
    for a fresh token, exposes first_name + preload.
  · validate does NOT consume the token (call it twice, redeem still
    works after).
  · validate returns valid=false / reason=expired for an expired token.
  · validate returns valid=false / reason=used after redemption.
  · validate returns valid=false / reason=unknown for a random string.
  · Cards PDF now encodes an HTTPS URL, not paneltec://.
"""
from __future__ import annotations
import uuid
from datetime import datetime, timedelta, timezone
from io import BytesIO

import pytest
import requests

pytestmark = pytest.mark.live_db_writes

BASE = "http://localhost:8001"


def _iso(dt: datetime) -> str:
    return dt.isoformat()


@pytest.mark.live_db_writes
def test_validate_and_qr_url_swap(_mongo, ephemeral_admin, ephemeral_org_id):
    admin_token = ephemeral_admin["token"]
    admin_org = ephemeral_org_id

    prefix = f"t132ae-{uuid.uuid4().hex[:6]}"
    sid = f"sid-{prefix}"
    worker = {
        "id": str(uuid.uuid4()), "org_id": admin_org,
        "first_name": f"TEST{prefix}", "last_name": "Alpha",
        "simpro_employee_id": sid,
        "company_id": "2", "company": "Paneltec",
        "active": True, "deleted_at": None,
        "email": f"alpha{prefix}@t.io",
    }
    _mongo.workers.insert_one(worker)

    # Seed 3 tokens: valid, expired, used.
    valid_tok = f"valid_{uuid.uuid4().hex}"
    expired_tok = f"expired_{uuid.uuid4().hex}"
    used_tok = f"used_{uuid.uuid4().hex}"
    now = datetime.now(timezone.utc)
    _mongo.mobile_onboarding_tokens.insert_many([
        {
            "id": str(uuid.uuid4()), "token": valid_tok,
            "simpro_employee_id": sid, "org_id": admin_org,
            "used": False, "expires_at": _iso(now + timedelta(days=7)),
            "created_at": _iso(now), "issued_by": "pytest",
        },
        {
            "id": str(uuid.uuid4()), "token": expired_tok,
            "simpro_employee_id": sid, "org_id": admin_org,
            "used": False, "expires_at": _iso(now - timedelta(days=1)),
            "created_at": _iso(now), "issued_by": "pytest",
        },
        {
            "id": str(uuid.uuid4()), "token": used_tok,
            "simpro_employee_id": sid, "org_id": admin_org,
            "used": True, "expires_at": _iso(now + timedelta(days=7)),
            "created_at": _iso(now), "issued_by": "pytest",
        },
    ])

    try:
        # ── validate: valid ──
        r = requests.get(f"{BASE}/api/mobile/onboarding/validate/{valid_tok}", timeout=10)
        assert r.status_code == 200
        d = r.json()
        assert d["valid"] is True
        assert d["first_name"] == f"TEST{prefix}"
        assert d["preload"] == "civil"

        # ── validate: expired ──
        r = requests.get(f"{BASE}/api/mobile/onboarding/validate/{expired_tok}", timeout=10)
        assert r.status_code == 200
        assert r.json() == {**r.json(), "valid": False, "reason": "expired"}
        assert r.json()["valid"] is False

        # ── validate: used ──
        r = requests.get(f"{BASE}/api/mobile/onboarding/validate/{used_tok}", timeout=10)
        assert r.status_code == 200
        assert r.json()["valid"] is False
        assert r.json()["reason"] == "used"

        # ── validate: unknown ──
        r = requests.get(f"{BASE}/api/mobile/onboarding/validate/does-not-exist", timeout=10)
        assert r.status_code == 200
        assert r.json() == {"valid": False, "reason": "unknown"}

        # ── validate is read-only (peek) — second call still valid ──
        r1 = requests.get(f"{BASE}/api/mobile/onboarding/validate/{valid_tok}", timeout=10)
        r2 = requests.get(f"{BASE}/api/mobile/onboarding/validate/{valid_tok}", timeout=10)
        assert r1.json()["valid"] is True
        assert r2.json()["valid"] is True
        # Confirm DB row still unused.
        row = _mongo.mobile_onboarding_tokens.find_one({"token": valid_tok})
        assert row["used"] is False

        # ── QR content: PDF now encodes an HTTPS URL, not paneltec:// ──
        H = {"Authorization": f"Bearer {admin_token}"}
        r = requests.get(f"{BASE}/api/mobile/onboarding/cards.pdf",
                         params={"worker_id": worker["id"]}, headers=H, timeout=15)
        assert r.status_code == 200
        # Extract the QR bytes from the PDF and decode.
        from pdf2image import convert_from_bytes
        from pyzbar.pyzbar import decode
        pages = convert_from_bytes(r.content, dpi=300)
        assert pages, "PDF has no pages"
        codes = decode(pages[0])
        assert codes, "no QR decoded from card PDF"
        qr_text = codes[0].data.decode()
        assert qr_text.startswith("https://"), f"QR should be HTTPS, got: {qr_text}"
        assert "/m/onboard/" in qr_text
        assert "preload=civil" in qr_text
        assert "paneltec://" not in qr_text
    finally:
        _mongo.workers.delete_one({"id": worker["id"]})
        _mongo.mobile_onboarding_tokens.delete_many(
            {"token": {"$in": [valid_tok, expired_tok, used_tok]}}
        )
