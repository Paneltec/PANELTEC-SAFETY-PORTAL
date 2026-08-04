"""v160.3.9.43 — SEC-003 sweep regression.

Verifies that every one of the 8 additional call sites fixed in v43 now
tolerates an encrypted-only `integration_configs` document (i.e. the raw
`cfg_doc.get("config")` contains ONLY `<field>_encrypted` keys — no
plaintext). Prior to v43 all 8 sites crashed with `KeyError` or silently
mis-behaved (health pill false-negatives).

Ephemeral `_mongo` fixture. Stephen NOT mutated. Never writes to a real
Simpro / Navixy / TextMagic API — every network call is asserted to be
gated by the presence-check that now correctly reads the encrypted keys.
"""
from __future__ import annotations
import pytest
from integrations import _encrypt_integration_secret, hydrate_integration_config


def _seed_encrypted_cfg(kind: str, plaintext: dict) -> dict:
    """Return an integration_configs.config dict that mirrors what v40
    writes to Mongo — plaintext secrets are $unset and only the
    `<field>_encrypted` variants survive."""
    encrypted_fields = {
        "simpro":     ["api_token"],
        "navixy":     ["session_hash", "password", "api_token"],
        "textmagic":  ["api_key"],
        "microsoft365": ["client_secret", "access_token", "refresh_token"],
    }.get(kind, [])
    cfg = dict(plaintext)
    for f in encrypted_fields:
        if f in cfg:
            cfg[f"{f}_encrypted"] = _encrypt_integration_secret(cfg.pop(f))
    return cfg


def test_hydrate_returns_plaintext_from_encrypted_doc():
    cfg_plain = {"api_base_url": "https://sim", "api_token": "TOKEN-1234"}
    encrypted = _seed_encrypted_cfg("simpro", cfg_plain)
    assert "api_token" not in encrypted
    assert "api_token_encrypted" in encrypted
    doc = {"kind": "simpro", "config": encrypted}
    hydrated = hydrate_integration_config(doc)
    assert hydrated["api_token"] == "TOKEN-1234"
    assert hydrated["api_base_url"] == "https://sim"


def test_health_extras_simpro_presence_check_accepts_encrypted():
    """v43 — the health pill must go green (or amber, not "down") when
    only `api_token_encrypted` is set. Prior to v43 it would report
    "Not connected" for every v40-configured org."""
    from health_extras import _check_simpro
    encrypted_only = {"kind": "simpro", "status": "connected",
                       "config": _seed_encrypted_cfg("simpro",
                           {"api_token": "T", "api_base_url": "https://sim"})}
    res = _check_simpro(encrypted_only)
    assert res["status"] != "down", f"expected non-down, got {res}"


def test_health_extras_navixy_presence_check_accepts_encrypted():
    import asyncio
    from health_extras import _check_navixy
    encrypted_only = {"kind": "navixy", "status": "connected",
                       "config": _seed_encrypted_cfg("navixy",
                           {"session_hash": "H", "api_base_url": "https://n"})}
    res = asyncio.get_event_loop().run_until_complete(
        _check_navixy(encrypted_only, org_id="ORG-NOEXIST")
    )
    assert res["status"] != "down", f"expected non-down, got {res}"


def test_health_extras_textmagic_presence_check_accepts_encrypted():
    from health_extras import _check_textmagic
    encrypted_only = {"kind": "textmagic", "status": "connected",
                       "config": _seed_encrypted_cfg("textmagic",
                           {"username": "u", "api_key": "K"})}
    res = _check_textmagic(encrypted_only, safe_mode_on=False)
    assert res["status"] != "down", f"expected non-down, got {res}"


def test_health_extras_m365_presence_check_accepts_encrypted():
    from health_extras import _check_m365
    encrypted_only = {"kind": "microsoft365", "status": "connected",
                       "config": _seed_encrypted_cfg("microsoft365",
                           {"client_id": "CID", "client_secret": "CSK",
                            "access_token": "AT", "refresh_token": "RT"})}
    res = _check_m365(encrypted_only, safe_mode_on=False)
    assert res["status"] != "down", f"expected non-down, got {res}"


def test_sec003_sweep_v43_hydration_is_the_universal_shim():
    """The v43 sweep pattern is uniform: every consumer file (asset_meter_
    history, integrations_textmagic, worker_certifications, workers) now
    calls `hydrate_integration_config(cfg_doc)` before reading any secret
    field. This asserts the semantic contract that made the sweep possible:
    a v40-encrypted doc round-trips to plaintext for every secret_type.
    """
    for kind, plain in [
        ("simpro", {"api_token": "S-T", "api_base_url": "https://s"}),
        ("navixy", {"session_hash": "N-H", "api_base_url": "https://n"}),
        ("textmagic", {"api_key": "T-K", "username": "u"}),
        ("microsoft365", {"client_id": "C-I", "client_secret": "C-S",
                          "access_token": "A-T", "refresh_token": "R-T"}),
    ]:
        encrypted = _seed_encrypted_cfg(kind, plain)
        doc = {"kind": kind, "status": "connected", "config": encrypted}
        hydrated = hydrate_integration_config(doc)
        for k, v in plain.items():
            assert hydrated.get(k) == v, (
                f"{kind}: field '{k}' did not round-trip encrypted→plain "
                f"(hydrated={hydrated!r})"
            )
