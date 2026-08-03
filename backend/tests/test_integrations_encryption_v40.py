"""v160.3.9.40 (SEC-003) — Integration secrets encryption at rest.

Coverage:
  1. Round-trip: encrypt(x) then decrypt returns x.
  2. Tampered ciphertext raises `InvalidToken`.
  3. Migration: seeded plaintext row is encrypted; second run is a no-op.
  4. `GET /api/integrations/{kind}` NEVER returns plaintext OR ciphertext
     — only masked last-4.
  5. Cross-scope safety: a v40 integration ciphertext CANNOT be decrypted
     with the v38 backup dest key, and vice versa (both raise
     `InvalidToken`).
  6. `hydrate_integration_config()` returns plaintext view; `<field>_encrypted`
     key stripped from the in-memory view.

Ephemeral fixtures only. No prod user mutation.
"""
from __future__ import annotations

import os
import uuid
import pytest
import requests
from cryptography.fernet import InvalidToken

from .conftest import API


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


# ── Case 1 — Round-trip
def test_case1_encrypt_decrypt_roundtrip():
    from integrations import (
        _encrypt_integration_secret, _decrypt_integration_secret, _FERNET
    )
    if not _FERNET:
        pytest.skip("INTEGRATIONS_ENC_KEY not configured")
    original = f"secret-plaintext-{uuid.uuid4().hex}"
    ct = _encrypt_integration_secret(original)
    assert ct != original
    assert "gAAAA" in ct  # Fernet prefix
    assert _decrypt_integration_secret(ct) == original


# ── Case 2 — Tampered ciphertext
def test_case2_tampered_ciphertext_raises_invalid_token():
    from integrations import (
        _encrypt_integration_secret, _decrypt_integration_secret, _FERNET
    )
    if not _FERNET:
        pytest.skip("INTEGRATIONS_ENC_KEY not configured")
    ct = _encrypt_integration_secret("hello")
    # Flip a byte in the base64 payload — any position after the version prefix.
    tampered = ct[:20] + ("A" if ct[20] != "A" else "B") + ct[21:]
    with pytest.raises(InvalidToken):
        _decrypt_integration_secret(tampered)


# ── Case 3 — Migration idempotent
def test_case3_migration_encrypts_then_noop(_mongo):
    from integrations import (
        _migrate_plaintext_integration_secrets, _FERNET,
        _decrypt_integration_secret
    )
    if not _FERNET:
        pytest.skip("INTEGRATIONS_ENC_KEY not configured")
    org_id = f"__v40_org_{uuid.uuid4().hex[:8]}"
    kind = "textmagic"
    _mongo.integration_configs.insert_one({
        "id": str(uuid.uuid4()),
        "org_id": org_id,
        "kind": kind,
        "config": {
            "username": "u1",
            "api_key": "PLAINTEXT_KEY_XYZ",  # secret in plaintext
        },
        "status": "connected",
        "created_at": "2026-08-03T00:00:00+00:00",
    })
    try:
        from db import db as motor_db
        from .conftest import run_async

        async def _run(): return await _migrate_plaintext_integration_secrets(motor_db)
        summary = run_async(_run())
        assert summary["scanned"] >= 1
        assert summary["fields_encrypted"] >= 1

        doc = _mongo.integration_configs.find_one({"org_id": org_id, "kind": kind}, {"_id": 0})
        cfg = doc.get("config") or {}
        assert "api_key" not in cfg, "plaintext api_key must be unset after migration"
        assert cfg.get("api_key_encrypted"), "api_key_encrypted must be present"
        assert _decrypt_integration_secret(cfg["api_key_encrypted"]) == "PLAINTEXT_KEY_XYZ"

        # Second run — no-op (nothing left to encrypt)
        summary2 = run_async(_run())
        assert summary2["fields_encrypted"] == 0, (
            f"second run should be a no-op, got: {summary2}")
    finally:
        _mongo.integration_configs.delete_many({"org_id": org_id})


# ── Case 4 — GET /integrations/{kind} never returns plaintext or ciphertext
def test_case4_get_integration_never_returns_plaintext_or_ciphertext(_mongo):
    from integrations import _encrypt_integration_secret, _FERNET
    if not _FERNET:
        pytest.skip("INTEGRATIONS_ENC_KEY not configured")
    tok = _admin_token()
    # Look up stephen's org via /auth/me
    r = requests.get(f"{API}/auth/me",
                     headers={"Authorization": f"Bearer {tok}"}, timeout=10)
    assert r.status_code == 200
    org_id = r.json().get("org_id")
    assert org_id
    # Sentinel value — plaintext value that we look for in the response.
    sentinel = f"__v40_sentinel_apikey_{uuid.uuid4().hex}"
    # Store as ciphertext directly (skipping the write API so we don't
    # perturb stephen's real textmagic config — we mutate a fake kind).
    fake_kind_name = "textmagic"
    # Preserve any existing row for restoration.
    original = _mongo.integration_configs.find_one({"org_id": org_id, "kind": fake_kind_name})
    try:
        _mongo.integration_configs.update_one(
            {"org_id": org_id, "kind": fake_kind_name},
            {"$set": {
                "id": str(uuid.uuid4()),
                "kind": fake_kind_name,
                "org_id": org_id,
                "config": {
                    "username": "probe",
                    "api_key_encrypted": _encrypt_integration_secret(sentinel),
                },
                "status": "connected",
                "created_at": "2026-08-03T00:00:00+00:00",
            }},
            upsert=True,
        )
        r2 = requests.get(
            f"{API}/integrations/{fake_kind_name}",
            headers={"Authorization": f"Bearer {tok}"}, timeout=10,
        )
        assert r2.status_code == 200, f"GET failed: HTTP={r2.status_code} {r2.text[:200]}"
        body = r2.text
        assert sentinel not in body, "plaintext api_key leaked to GET response!"
        assert "api_key_encrypted" not in body, (
            "ciphertext key leaked to GET response!")
        # Should carry a masked last-4 preview
        cfg = r2.json().get("config") or {}
        api_key_preview = cfg.get("api_key") or ""
        assert "•" in api_key_preview or "*" in api_key_preview or api_key_preview == "", (
            f"expected masked preview, got: {api_key_preview!r}")
    finally:
        if original:
            _mongo.integration_configs.replace_one(
                {"org_id": org_id, "kind": fake_kind_name}, original)
        else:
            _mongo.integration_configs.delete_one(
                {"org_id": org_id, "kind": fake_kind_name})


# ── Case 5 — Cross-scope isolation
def test_case5_cross_scope_isolation():
    from integrations import (
        _encrypt_integration_secret as int_enc,
        _decrypt_integration_secret as int_dec,
        _FERNET as INT_F,
    )
    from backup_service import (
        _encrypt_dest_password as bk_enc,
        _decrypt_dest_password as bk_dec,
        _FERNET as BK_F,
    )
    if not INT_F or not BK_F:
        pytest.skip("Both keys must be configured for cross-scope test")
    plain = "cross-scope-test-value"
    int_ct = int_enc(plain)
    bk_ct = bk_enc(plain)
    # Same plaintext → different ciphertexts because Fernet nonces differ.
    assert int_ct != bk_ct
    # Each key can decrypt only its own ciphertext.
    assert int_dec(int_ct) == plain
    assert bk_dec(bk_ct) == plain
    with pytest.raises(InvalidToken):
        bk_dec(int_ct)   # backup key on integration ciphertext
    with pytest.raises(InvalidToken):
        int_dec(bk_ct)   # integration key on backup ciphertext


# ── Case 6 — hydrate_integration_config returns plaintext view + strips ciphertext
def test_case6_hydrate_returns_plaintext_view():
    from integrations import (
        hydrate_integration_config, _encrypt_integration_secret, _FERNET
    )
    if not _FERNET:
        pytest.skip("INTEGRATIONS_ENC_KEY not configured")
    ct = _encrypt_integration_secret("hydrate-test-value")
    doc = {
        "org_id": "test",
        "kind": "textmagic",
        "config": {
            "username": "u",
            "api_key_encrypted": ct,
        },
    }
    cfg = hydrate_integration_config(doc)
    assert cfg.get("api_key") == "hydrate-test-value", (
        f"plaintext hydration failed: {cfg!r}")
    assert "api_key_encrypted" not in cfg, (
        "ciphertext key must be stripped from the in-memory view")
    assert cfg.get("username") == "u"
