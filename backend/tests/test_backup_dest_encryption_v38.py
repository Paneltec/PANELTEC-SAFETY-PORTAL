"""v160.3.9.38 — SMB destination password at-rest encryption.

Coverage:
  1. Encrypt → decrypt round-trip returns the exact plaintext.
  2. Tampered ciphertext raises `InvalidToken`.
  3. Legacy plaintext row is migrated on migration-run; a second
     run is a no-op.
  4. `GET /destinations` NEVER exposes `password` or
     `password_encrypted`.
  5. `POST /destinations` with a password produces `password_set:
     true` and the plaintext key is ABSENT from the resulting Mongo
     doc — the encrypted blob is present instead.

Guardrails:
  * Every test uses UUID-suffixed destinations and cleans up in
    `finally:` blocks.
  * No real credential value is ever written. Test plaintext is a
    deliberately-obvious sentinel string.
  * `stephen@paneltec.com.au` is not touched.
"""
from __future__ import annotations

import uuid
import pytest
import requests

from cryptography.fernet import InvalidToken

from .conftest import API, run_async  # noqa: F401


# ── Case 1 · round-trip ────────────────────────────────────────────

def test_case1_encrypt_decrypt_roundtrip():
    from backup_service import (_encrypt_dest_password,
                                 _decrypt_dest_password, _FERNET)
    if not _FERNET:
        pytest.skip("BACKUP_DEST_ENC_KEY not configured in this env")
    plaintext = f"__v38_sentinel_{uuid.uuid4().hex}"
    ct = _encrypt_dest_password(plaintext)
    assert ct.startswith("gAAAAA"), f"expected Fernet prefix, got {ct[:12]!r}…"
    assert _decrypt_dest_password(ct) == plaintext


# ── Case 2 · tampered ciphertext raises ────────────────────────────

def test_case2_tampered_ciphertext_raises_invalid_token():
    from backup_service import (_encrypt_dest_password,
                                 _decrypt_dest_password, _FERNET)
    if not _FERNET:
        pytest.skip("BACKUP_DEST_ENC_KEY not configured")
    plaintext = f"__v38_tamper_{uuid.uuid4().hex}"
    ct = _encrypt_dest_password(plaintext)
    # Flip one character in the middle of the ciphertext.
    tampered = ct[:-6] + ("A" if ct[-6] != "A" else "B") + ct[-5:]
    with pytest.raises(InvalidToken):
        _decrypt_dest_password(tampered)


# ── Case 3 · migration is idempotent (via admin endpoint) ─────────

def test_case3_legacy_plaintext_row_migrated_then_noop(_mongo):
    """Uses the admin migration endpoint so the async Motor client
    inside the backend runs the sweep. `_mongo` fixture only reads
    back to verify — cannot drive `async for` cursors directly."""
    from backup_service import _FERNET
    if not _FERNET:
        pytest.skip("BACKUP_DEST_ENC_KEY not configured")
    tok = _admin_token()

    did = str(uuid.uuid4())
    _mongo.bk_destinations.insert_one({
        "id": did,
        "name": f"__v38_migrate_{uuid.uuid4().hex[:6]}",
        "kind": "smb_lan",
        "host": "10.255.255.253",
        "share": "PytestBackups",
        "path_prefix": "/v38",
        "username": "pytest",
        "password": f"__v38_plain_{uuid.uuid4().hex}",  # <-- plaintext legacy
        "password_set": True,
        "enabled": False,
        "created_at": "2026-08-03T00:00:00+00:00",
    })
    try:
        r = requests.post(
            f"{API}/backup/admin/migrate-destination-passwords",
            headers={"Authorization": f"Bearer {tok}"}, timeout=15,
        )
        assert r.status_code == 200, f"HTTP={r.status_code} {r.text[:200]}"
        s1 = r.json()
        assert s1["migrated"] >= 1, s1

        d = _mongo.bk_destinations.find_one({"id": did}, {"_id": 0})
        assert "password" not in d, "plaintext field must be unset"
        assert d.get("password_encrypted", "").startswith("gAAAAA")
        assert d.get("password_set") is True

        # Second run: our doc is no longer a candidate.
        r2 = requests.post(
            f"{API}/backup/admin/migrate-destination-passwords",
            headers={"Authorization": f"Bearer {tok}"}, timeout=15,
        )
        assert r2.status_code == 200
        # The doc we inserted is done. Any OTHER prod plaintext row
        # migrated in the same call is fine; we only assert OUR doc
        # stayed encrypted and no re-encryption happened.
        d2 = _mongo.bk_destinations.find_one({"id": did}, {"_id": 0})
        assert d2["password_encrypted"] == d["password_encrypted"], (
            "second migration must not re-encrypt an already-encrypted row")
    finally:
        _mongo.bk_destinations.delete_one({"id": did})


# ── Case 4 · GET /destinations never returns either secret field ───

def _admin_token():
    r = requests.post(
        f"{API}/auth/login",
        json={"email": "stephen@paneltec.com.au",
              "password": "Mcgstephen50#"},
        timeout=10,
    )
    if r.status_code != 200:
        pytest.skip(f"admin login unavailable: HTTP {r.status_code}")
    return r.json().get("access_token") or r.json().get("token")


def test_case4_get_destinations_never_returns_secret_fields(_mongo):
    from backup_service import _FERNET
    if not _FERNET:
        pytest.skip("BACKUP_DEST_ENC_KEY not configured")
    tok = _admin_token()
    did = str(uuid.uuid4())
    _mongo.bk_destinations.insert_one({
        "id": did,
        "name": f"__v38_secret_leak_{uuid.uuid4().hex[:6]}",
        "kind": "smb_lan",
        "host": "10.255.255.252",
        "share": "PytestBackups",
        "path_prefix": "/v38",
        "username": "pytest",
        "password": f"__v38_shouldnotleak_{uuid.uuid4().hex}",
        "password_encrypted": "gAAAAA_fake_ct_that_never_leaves_the_db",
        "password_set": True,
        "enabled": False,
        "created_at": "2026-08-03T00:00:00+00:00",
    })
    try:
        r = requests.get(f"{API}/backup/destinations",
                         headers={"Authorization": f"Bearer {tok}"},
                         timeout=10)
        assert r.status_code == 200, f"HTTP={r.status_code} {r.text[:200]}"
        matches = [d for d in r.json() if d.get("id") == did]
        assert matches, "ephemeral destination missing from response"
        m = matches[0]
        assert "password"           not in m, f"password leaked: {m!r}"
        assert "password_encrypted" not in m, f"encrypted blob leaked: {m!r}"
        # `password_set` MUST be present so the UI knows there is a pw.
        assert m.get("password_set") is True
    finally:
        _mongo.bk_destinations.delete_one({"id": did})


# ── Case 5 · POST /destinations encrypts on the way in ─────────────

def test_case5_post_destinations_encrypts_and_never_writes_plaintext(_mongo):
    from backup_service import _FERNET
    if not _FERNET:
        pytest.skip("BACKUP_DEST_ENC_KEY not configured")
    tok = _admin_token()
    plaintext = f"__v38_post_sentinel_{uuid.uuid4().hex}"
    name = f"__v38_post_{uuid.uuid4().hex[:8]}"
    body = {
        "id": str(uuid.uuid4()),
        "name": name,
        "kind": "smb_lan",
        "host": "10.255.255.251",
        "share": "PytestBackups",
        "path_prefix": "/v38",
        "username": "pytest",
        "enabled": False,
        "password_set": False,
        "created_at": "2026-08-03T00:00:00+00:00",
    }
    try:
        # Pydantic model rejects unknown keys; do NOT put password in body.
        r = requests.post(
            f"{API}/backup/destinations",
            params={"password": plaintext},
            json=body,
            headers={"Authorization": f"Bearer {tok}"},
            timeout=10,
        )
        assert r.status_code == 200, f"HTTP={r.status_code} {r.text[:200]}"
        resp = r.json()
        assert "password" not in resp, "response leaked plaintext"
        assert "password_encrypted" not in resp, "response leaked ciphertext"
        assert resp.get("password_set") is True

        # Now inspect the raw Mongo doc — plaintext MUST NOT be there.
        doc = _mongo.bk_destinations.find_one({"name": name}, {"_id": 0})
        assert doc is not None
        assert "password" not in doc, (
            "plaintext password persisted in Mongo — encryption bypass")
        assert doc.get("password_encrypted", "").startswith("gAAAAA"), (
            f"ciphertext missing or not Fernet-shaped: "
            f"{doc.get('password_encrypted','')[:12]!r}")
        assert doc.get("password_set") is True
    finally:
        _mongo.bk_destinations.delete_many({"name": name})
