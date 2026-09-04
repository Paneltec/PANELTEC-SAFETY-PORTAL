"""v58.13.104 — Unified QR public-URL resolver.

Runtime proof (decoded PDF QR before/after) is in the ship report. This
pytest guards the code STRUCTURE + env config so a future refactor
can't silently reintroduce the divergence between assets.py and
workers_qr.py that produced scheme-less QR URLs on preview.
"""
from __future__ import annotations
import logging
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
MOBILE = ROOT / "mobile"

QR_COMMON = (BACKEND / "qr_common.py").read_text(encoding="utf-8")
ASSETS_PY = (BACKEND / "assets.py").read_text(encoding="utf-8")
WORKERS_QR = (BACKEND / "workers_qr.py").read_text(encoding="utf-8")
ENV_TEXT = (BACKEND / ".env").read_text(encoding="utf-8")
VERSION_JS = (FRONTEND / "src" / "lib" / "version.js").read_text(encoding="utf-8")
SW_JS = (FRONTEND / "public" / "service-worker.js").read_text(encoding="utf-8")
MOBILE_TS = (MOBILE / "src" / "lib" / "version.ts").read_text(encoding="utf-8")


# ── qr_common.resolve_public_base ────────────────────────────────

def test_qr_common_exports_resolver():
    assert "def resolve_public_base" in QR_COMMON, (
        "qr_common.py missing resolve_public_base()"
    )


def test_precedence_order_is_documented_and_correct():
    """Env-var iteration order MUST be:
        REACT_APP_BACKEND_URL → PUBLIC_APP_URL → FRONTEND_PUBLIC_URL
    A different order caused the .103 preview breakage; enforce."""
    m = re.search(
        r"_CANDIDATE_ENV_VARS\s*=\s*\(\s*"
        r"\"REACT_APP_BACKEND_URL\"\s*,\s*"
        r"\"PUBLIC_APP_URL\"\s*,\s*"
        r"\"FRONTEND_PUBLIC_URL\"",
        QR_COMMON,
    )
    assert m, "candidate env-var precedence tuple is wrong or missing"


def test_empty_result_emits_warning_log():
    """Empty base MUST emit a warning at generation time so future
    misconfigurations surface in logs, not on customer phones."""
    m = re.search(
        r'logger\.warning\(\s*\n?\s*"resolve_public_base\(\)[\s\S]{0,600}?"',
        QR_COMMON,
    )
    assert m, "empty-base warning log is missing"


# Runtime behavioural tests — import the module and exercise it.

def _import_qr_common():
    import importlib, sys
    sys.path.insert(0, str(BACKEND))
    if "qr_common" in sys.modules:
        return importlib.reload(sys.modules["qr_common"])
    return importlib.import_module("qr_common")


def test_resolver_returns_react_backend_url_when_set(monkeypatch):
    for var in ("REACT_APP_BACKEND_URL", "PUBLIC_APP_URL", "FRONTEND_PUBLIC_URL"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("REACT_APP_BACKEND_URL", "https://a.example.com/")
    monkeypatch.setenv("PUBLIC_APP_URL", "https://b.example.com")
    monkeypatch.setenv("FRONTEND_PUBLIC_URL", "https://c.example.com")
    mod = _import_qr_common()
    assert mod.resolve_public_base() == "https://a.example.com"


def test_resolver_falls_back_to_public_app_url(monkeypatch):
    for var in ("REACT_APP_BACKEND_URL", "PUBLIC_APP_URL", "FRONTEND_PUBLIC_URL"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("PUBLIC_APP_URL", "https://b.example.com//")
    monkeypatch.setenv("FRONTEND_PUBLIC_URL", "https://c.example.com")
    mod = _import_qr_common()
    assert mod.resolve_public_base() == "https://b.example.com"


def test_resolver_falls_back_to_frontend_public_url(monkeypatch):
    for var in ("REACT_APP_BACKEND_URL", "PUBLIC_APP_URL", "FRONTEND_PUBLIC_URL"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("FRONTEND_PUBLIC_URL", "  https://c.example.com/  ")
    mod = _import_qr_common()
    assert mod.resolve_public_base() == "https://c.example.com"


def test_resolver_returns_empty_and_warns_when_all_unset(monkeypatch, caplog):
    for var in ("REACT_APP_BACKEND_URL", "PUBLIC_APP_URL", "FRONTEND_PUBLIC_URL"):
        monkeypatch.delenv(var, raising=False)
    mod = _import_qr_common()
    with caplog.at_level(logging.WARNING, logger="qr_common"):
        result = mod.resolve_public_base()
    assert result == ""
    assert any(
        "resolve_public_base()" in rec.message and "SCHEME-LESS" in rec.message
        for rec in caplog.records
    ), "warning log content changed — SCHEME-LESS marker missing"


# ── Delegation from assets.py + workers_qr.py ────────────────────

def test_assets_public_base_delegates_to_shared_resolver():
    """`_public_base()` in assets.py must call qr_common.resolve_public_base
    — not roll its own env-var lookup (that's what caused the .103
    divergence)."""
    m = re.search(
        r"def\s+_public_base\s*\(\s*\)\s*->\s*str:\s*[\s\S]{0,2000}?"
        r"from\s+qr_common\s+import\s+resolve_public_base[\s\S]{0,200}?"
        r"return\s+resolve_public_base\(\)",
        ASSETS_PY,
    )
    assert m, "assets.py _public_base does not delegate to qr_common"


def test_workers_qr_public_app_url_delegates_to_shared_resolver():
    m = re.search(
        r"def\s+_public_app_url\s*\(\s*\)\s*->\s*str:\s*[\s\S]{0,600}?"
        r"from\s+qr_common\s+import\s+resolve_public_base[\s\S]{0,200}?"
        r"return\s+resolve_public_base\(\)",
        WORKERS_QR,
    )
    assert m, "workers_qr.py _public_app_url does not delegate to qr_common"


def test_no_local_env_var_lookups_remain_in_qr_helpers():
    """Regression guard: neither helper may keep a local
    `os.environ.get(...)` reading REACT_APP_BACKEND_URL / PUBLIC_APP_URL
    / FRONTEND_PUBLIC_URL — that would silently reintroduce the
    divergence the .104 ship removed."""
    for path, text in (("assets.py", ASSETS_PY), ("workers_qr.py", WORKERS_QR)):
        # It's OK for the file to `import os`; look for actual gets.
        offenders = re.findall(
            r"os\.environ\.get\(\s*\"(REACT_APP_BACKEND_URL|PUBLIC_APP_URL|FRONTEND_PUBLIC_URL)\"",
            text,
        )
        assert not offenders, (
            f"{path} still reads {offenders} directly — resolver duplication"
        )


# ── Preview .env — stale UUID host no longer present ────────────

def test_preview_env_no_longer_points_at_stale_uuid_host():
    """The `3dd7823d-4048-…` UUID preview host is the exact string the
    .103 investigation traced. Reject it explicitly so a future paste
    of an old value fails CI."""
    assert "3dd7823d-4048-456d-b31d-e4cb598dc869" not in ENV_TEXT, (
        "backend/.env still contains the stale UUID preview host — "
        "the .104 preview env fix would be reverted"
    )


def test_preview_env_has_a_frontend_public_url():
    """Preview backend must have SOME FRONTEND_PUBLIC_URL set. Empty
    or missing would fall through the resolver chain and (if the
    other two aren't set either) emit the SCHEME-LESS warning."""
    m = re.search(
        r'FRONTEND_PUBLIC_URL\s*=\s*"?([^"\n]+)"?',
        ENV_TEXT,
    )
    assert m, "backend/.env missing FRONTEND_PUBLIC_URL"
    val = m.group(1).strip().strip('"')
    assert val, "FRONTEND_PUBLIC_URL is empty in backend/.env"
    assert val.startswith("http"), (
        f"FRONTEND_PUBLIC_URL value {val!r} is not an http(s) URL"
    )


# ── Version-sync forward-safe pin >= 104 ─────────────────────────

def _tail(text, name):
    m = re.search(rf"{name}\s*=\s*['\"]paneltec-v[\d.]+\.(\d+)[a-z]*['\"]", text)
    assert m, f"could not read tail of {name}"
    return int(m.group(1))


def test_running_version_gte_104():
    assert _tail(VERSION_JS, "RUNNING_VERSION") >= 104


def test_cache_version_gte_104():
    assert _tail(SW_JS, "CACHE_VERSION") >= 104


def test_mobile_bundle_version_gte_104():
    assert _tail(MOBILE_TS, "MOBILE_BUNDLE_VERSION") >= 104
