"""SmartFill credentials can come from the environment OR from
Settings → Integrations (stored in the database) — Fuel Reports must
work on a new host without env files."""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import integrations_smartfill as sf  # noqa: E402

ENV = (sf.ENV_URL, sf.ENV_KEY, sf.ENV_SECRET)


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for n in ENV:
        monkeypatch.delenv(n, raising=False)
    yield


def test_unconfigured_raises_friendly_message():
    assert sf.is_configured() is False
    with pytest.raises(sf.SmartFillConfigError) as ei:
        sf._creds()
    assert "Settings → Integrations → SmartFill" in str(ei.value)
    assert "SMARTFILL_API_SECRET" not in str(ei.value)   # no env jargon for admins


def test_apply_config_fills_env_and_defaults_url():
    assert sf.apply_config({"api_key": " PANELTEC ", "api_secret": "s3cret"}) is True
    assert sf._creds() == (sf.DEFAULT_API_URL, "PANELTEC", "s3cret")


def test_apply_config_keeps_explicit_url_and_ignores_blanks():
    sf.apply_config({"api_url": "https://example.test/api", "api_key": "K", "api_secret": "S"})
    sf.apply_config({"api_url": "", "api_key": None, "api_secret": "   "})
    assert sf._creds() == ("https://example.test/api", "K", "S")


def test_env_wins_over_db_at_startup(monkeypatch):
    for n, v in zip(ENV, ("https://env.test", "ENVKEY", "ENVSECRET")):
        monkeypatch.setenv(n, v)
    import asyncio
    # No DB access should be attempted when the env is complete.
    assert asyncio.run(sf.load_config_from_db()) is True
    assert sf._creds() == ("https://env.test", "ENVKEY", "ENVSECRET")


def test_rpc_body_uses_db_credentials():
    sf.apply_config({"api_key": "REF", "api_secret": "SEC"})
    body = sf._rpc_body("Tank:Level")
    assert body["parameters"]["clientReference"] == "REF"
    assert body["parameters"]["clientSecret"] == "SEC"
    assert body["method"] == "Tank:Level"
