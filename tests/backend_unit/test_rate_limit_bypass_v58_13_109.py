"""v58.13.109 — Rate-limit test-mode bypass.

Tests the pure `_resolve_bypass()` decision function directly with
monkeypatched env vars so the module-level `_BYPASS_ACTIVE` computed
at import time doesn't leak in. Three coverage points from the brief:

  · Bypass ON when the explicit env var is set.
  · Bypass OFF by default when no signal is present.
  · Bypass REFUSED in prod even when signals are present (guardrail).

Also spot-checks:
  · `ENV=test` triggers bypass.
  · `PYTEST_CURRENT_TEST` triggers bypass.
  · `slowapi.Limiter` instances expose `enabled` that a caller can
    read post-init (belt-and-braces for the module-init assertion).
"""
from __future__ import annotations
import importlib
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[2] / "backend"
sys.path.insert(0, str(BACKEND))


@pytest.fixture
def rl(monkeypatch):
    """Reload `rate_limit` under a controlled env-var set so
    module-level state reflects the test's monkeypatched env."""
    for k in ("TEST_MODE_BYPASS_RATE_LIMIT", "ENV", "IS_PROD"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.delenv("PYTEST_CURRENT_TEST", raising=False)
    # Drop cached import so `_BYPASS_ACTIVE` recomputes.
    sys.modules.pop("rate_limit", None)
    m = importlib.import_module("rate_limit")
    return m


def test_bypass_enabled_when_env_var_set(monkeypatch, rl):
    monkeypatch.setenv("TEST_MODE_BYPASS_RATE_LIMIT", "true")
    monkeypatch.delenv("ENV", raising=False)
    monkeypatch.delenv("IS_PROD", raising=False)
    monkeypatch.delenv("PYTEST_CURRENT_TEST", raising=False)
    assert rl._resolve_bypass() is True


def test_bypass_disabled_by_default(monkeypatch, rl):
    monkeypatch.delenv("TEST_MODE_BYPASS_RATE_LIMIT", raising=False)
    monkeypatch.delenv("ENV", raising=False)
    monkeypatch.delenv("IS_PROD", raising=False)
    monkeypatch.delenv("PYTEST_CURRENT_TEST", raising=False)
    assert rl._resolve_bypass() is False


def test_bypass_refused_in_prod_even_when_signals_present(monkeypatch, rl):
    """Prod guard wins. Signal set + `ENV=prod` = bypass REFUSED."""
    monkeypatch.setenv("TEST_MODE_BYPASS_RATE_LIMIT", "true")
    monkeypatch.setenv("ENV", "prod")
    assert rl._resolve_bypass() is False, (
        "Prod guard failed: bypass leaked through despite ENV=prod"
    )
    # Also honour IS_PROD=true as a prod signal.
    monkeypatch.delenv("ENV", raising=False)
    monkeypatch.setenv("IS_PROD", "true")
    assert rl._resolve_bypass() is False, (
        "Prod guard failed: bypass leaked through despite IS_PROD=true"
    )


# ── Spot-checks for the additional signals ──────────────────────

def test_env_test_triggers_bypass(monkeypatch, rl):
    monkeypatch.delenv("TEST_MODE_BYPASS_RATE_LIMIT", raising=False)
    monkeypatch.setenv("ENV", "test")
    monkeypatch.delenv("IS_PROD", raising=False)
    monkeypatch.delenv("PYTEST_CURRENT_TEST", raising=False)
    assert rl._resolve_bypass() is True


def test_pytest_current_test_triggers_bypass(monkeypatch, rl):
    monkeypatch.delenv("TEST_MODE_BYPASS_RATE_LIMIT", raising=False)
    monkeypatch.delenv("ENV", raising=False)
    monkeypatch.delenv("IS_PROD", raising=False)
    monkeypatch.setenv("PYTEST_CURRENT_TEST", "test_stub[node]")
    assert rl._resolve_bypass() is True


def test_limiter_instances_expose_enabled_state(rl):
    """Structural pin — slowapi `Limiter.enabled` is what the bypass
    toggle actually flips. If a future slowapi upgrade renames this
    attribute, `Limiter(..., enabled=…)` in `rate_limit.py` will
    silently no-op and this test catches it."""
    assert hasattr(rl.limiter, "enabled"), (
        "slowapi.Limiter must expose an `enabled` bool for our bypass "
        "toggle to work"
    )
    assert hasattr(rl.user_limiter, "enabled")
