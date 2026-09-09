"""v58.13.131 — SmartFill Fuel API discovery integration.

Locks the wire-quirk contract discovered by the probe (parameters
plural key, string error code, HTTP 400 for RPC errors) + the
classification taxonomy the future re-probe scripts will depend on.

**Discovery-only ship.** No user-facing endpoints yet. See
`/app/memory/smartfill_discovery_v58_13_131.md` for the full spec
and phase breakdown.
"""
from __future__ import annotations
import re
import os
from pathlib import Path

import pytest

ROOT = Path("/app")


def _read(p: str) -> str:
    return (ROOT / p).read_text()


SRC = _read("backend/integrations_smartfill.py")


# ── Module import + public surface ──────────────────────────────
def test_module_imports_cleanly():
    import backend.integrations_smartfill  # noqa: F401


def test_public_surface_present():
    # v58.13.131m — Vehicle:List / Vehicle:FillHistory were confirmed
    # non-existent (code 5) by both .131k and .131m probes, so their
    # wrapper stubs were removed. `get_tank_levels` remains as a
    # backwards-compat alias to `smartfill_fetch_tank_levels`.
    import backend.integrations_smartfill as m
    for name in (
        "call", "list_available_methods",
        "columnar_to_rows", "SmartFillConfigError", "SmartFillAPIError",
        # v58.13.131m production surface.
        "smartfill_fetch_tank_levels", "smartfill_fetch_transactions",
        "smartfill_fetch_tank_history", "smartfill_fetch_drivers",
        "SmartFillRateLimitError", "get_rate_limit_state",
    ):
        assert hasattr(m, name), f"missing public symbol {name}"


# ── Wire-quirk locks (discovered by .131 probe) ─────────────────
def test_rpc_body_uses_parameters_plural_key():
    """SmartFill deviates from strict JSON-RPC 2.0: the param key is
    `parameters` (plural), NOT `params`. This test locks that so a
    future refactor to the "spec-correct" name doesn't silently break
    every call."""
    # Look inside `_rpc_body` for the returned dict.
    m = re.search(r"def _rpc_body\(.*?\n(\s*[^\n]+\n)+?\s*return \{(.*?)\}", SRC, flags=re.DOTALL)
    assert m, "_rpc_body not found"
    body = m.group(2)
    assert '"parameters":' in body, "param key must be 'parameters' (plural)"
    assert '"params":' not in body, "must NOT use spec-correct 'params' key (SmartFill rejects it)"
    assert '"jsonrpc": "2.0"' in body
    assert '"method": method' in body


def test_error_class_bridges_string_code():
    """SmartFill returns `error.code` as a STRING and the human msg
    under `error.error` (not `error.message`). The `call()` fn must
    coerce both."""
    # Find the error-handling block inside `call`.
    m = re.search(r'if "error" in envelope and envelope\["error"\]:(.*?)(?=\n    return|\ndef )', SRC, flags=re.DOTALL)
    assert m, "error-handling block not found in call()"
    block = m.group(1)
    assert "int(raw_code)" in block, "string-code coercion missing"
    assert 'err.get("message") or err.get("error")' in block, \
        "must bridge both error.message + error.error keys"


def test_http_400_body_is_parsed_before_raise():
    """SmartFill returns HTTP 400 for RPC-level errors WITH a valid
    JSON-RPC error envelope. The client must parse the body FIRST,
    then only raise transport errors for 5xx / non-JSON."""
    # Locate the call() body — find the next `def ` OR `async def `
    # after the call() header, allowing comment blocks between fns.
    idx = SRC.index("async def call(")
    tail = SRC[idx:]
    # Skip past the `async def call(` line, then find the next def.
    next_def = re.search(r"\n(?:def |async def )", tail[1:])
    end = (idx + 1 + next_def.start()) if next_def else len(SRC)
    body = SRC[idx:end]
    # Ensure raise_for_status is NOT called unconditionally after post.
    # It should be gated on `>= 500` or wrapped in a `try: resp.json()`.
    assert "if resp.status_code >= 500:" in body, \
        "must only raise_for_status on 5xx (SmartFill uses 400 for RPC errors)"
    # Ensure the JSON parse happens first.
    parse_idx = body.index("resp.json()")
    raise_idx = body.index("resp.raise_for_status")
    assert parse_idx < raise_idx, "must parse body before raising"


# ── Classification taxonomy ─────────────────────────────────────
def test_probe_classifies_code_1_as_not_enabled():
    """code=1 ('Method not supported') → not_enabled. This is the
    signal for subscription-gated methods that WILL flip to
    `available` once SmartFill support enables them."""
    assert 'entry["status"] = "not_enabled"' in SRC
    # Comment block documenting the taxonomy must be present so future
    # devs (and re-probes) preserve the semantics.
    assert "Method not supported" in SRC
    assert "code 1" in SRC or 'code == 1' in SRC


def test_probe_classifies_code_5_as_method_not_found():
    assert 'entry["status"] = "method_not_found"' in SRC
    assert "No such method" in SRC or "no such method" in SRC


def test_probe_classifies_code_3_as_needs_params():
    assert 'entry["status"] = "needs_params"' in SRC
    assert "Missing parameter" in SRC or "missing parameter" in SRC


def test_candidate_list_includes_gated_tank_methods():
    """The 8 subscription-gated `Tank:*` methods discovered by the
    .131 probe must stay in the candidate list so a future re-probe
    (after SmartFill support enables them) auto-detects the flip
    to `available` without a code change."""
    for m in ("Tank:Deliveries", "Tank:Transactions", "Tank:Fills",
              "Tank:History", "Tank:Consumption", "Tank:Alarms",
              "Tank:List", "Tank:Levels"):
        assert f'"{m}"' in SRC, f"candidate {m} missing"


# ── Columnar transform ──────────────────────────────────────────
def test_columnar_to_rows_transforms_smartfill_envelope():
    from backend.integrations_smartfill import columnar_to_rows
    envelope = {
        "columns": ["Unit Number", "Tank Number", "Volume"],
        "values": [
            ["5841", "1", "355"],
            ["5842", "2", "1200"],
        ],
    }
    rows = columnar_to_rows(envelope)
    assert rows == [
        {"Unit Number": "5841", "Tank Number": "1", "Volume": "355"},
        {"Unit Number": "5842", "Tank Number": "2", "Volume": "1200"},
    ]


def test_columnar_to_rows_handles_non_columnar_gracefully():
    from backend.integrations_smartfill import columnar_to_rows
    assert columnar_to_rows([{"a": 1}]) == [{"a": 1}]
    assert columnar_to_rows({"a": 1}) == [{"a": 1}]
    assert columnar_to_rows("garbage") == []
    assert columnar_to_rows(None) == []


# ── Secret hygiene ──────────────────────────────────────────────
def test_secret_never_hardcoded_in_source():
    """The actual credential values must ONLY live in .env, never
    in the module source."""
    assert "Paneltec4869" not in SRC, "API key hardcoded in module source"
    assert "cc7593ec6a70e2f7" not in SRC, "API secret hardcoded in module source"


def test_creds_fail_fast_without_env(monkeypatch):
    """`_creds()` must raise SmartFillConfigError when any env var is
    missing, and MUST NOT echo the value in the error message."""
    monkeypatch.delenv("SMARTFILL_API_URL", raising=False)
    monkeypatch.delenv("SMARTFILL_API_KEY", raising=False)
    monkeypatch.delenv("SMARTFILL_API_SECRET", raising=False)
    from backend.integrations_smartfill import _creds, SmartFillConfigError
    with pytest.raises(SmartFillConfigError) as ei:
        _creds()
    msg = str(ei.value)
    assert "Paneltec4869" not in msg
    assert "cc7593ec6a70e2f7" not in msg
    assert "SMARTFILL_API_KEY" in msg or "SMARTFILL_API_URL" in msg


def test_secret_never_logged_in_call_or_probe():
    """No log statement in the module may format the raw request
    body or credential variable names. Only the method name + http
    status are permitted in log arguments (comments are ignored)."""
    log_call_lines = []
    for ln in SRC.splitlines():
        stripped = ln.strip()
        if not (stripped.startswith("log.") or " log." in stripped):
            continue
        # Strip trailing inline comment before the leak check.
        code, _, _ = stripped.partition("#")
        log_call_lines.append(code)
    assert log_call_lines, "no logging present — sanity check"
    for ln in log_call_lines:
        low = ln.lower()
        for banned in ("secret", "clientsecret", "envelope", "body", "params", "parameters"):
            assert banned not in low, (
                f"log statement may leak `{banned}`: {ln.strip()}"
            )


# ── Discovery memo present ──────────────────────────────────────
def test_discovery_memo_present():
    memo = ROOT / "memory" / "smartfill_discovery_v58_13_131.md"
    assert memo.exists(), "discovery memo missing"
    txt = memo.read_text()
    # Case-insensitive section checks so heading capitalisation drift
    # doesn't break the pin.
    low = txt.lower()
    for section in ("probe results", "fuel_transactions", "anomaly detection",
                    "sync strategy", "phase breakdown", "critical blocker"):
        assert section in low, f"memo missing section: {section}"


def test_probe_artifact_present_and_url_redacted():
    art = ROOT / "memory" / "smartfill_probe_v58_13_131.json"
    assert art.exists(), "probe artifact missing"
    txt = art.read_text()
    assert "fmtdata.com" not in txt, "raw endpoint URL leaked into probe artifact"
    assert "Paneltec4869" not in txt, "API key leaked into probe artifact"
    assert "cc7593ec6a70e2f7" not in txt, "API secret leaked into probe artifact"


# ── Version pin ─────────────────────────────────────────────────
def test_version_sync_at_least_131():
    # v58.13.131m widens the suffix pattern to accept multi-char
    # suffixes (`q1`, `q2`, `p_hotfix`) that landed after `.132p`.
    _CANONICAL = {
        "frontend/src/lib/version.js": r"export const RUNNING_VERSION\s*=\s*'paneltec-v160\.3\.9\.58\.13\.(\d+)([a-z0-9_]*)'",
        "frontend/public/service-worker.js": r"const CACHE_VERSION\s*=\s*'paneltec-v160\.3\.9\.58\.13\.(\d+)([a-z0-9_]*)'",
        "mobile/src/lib/version.ts": r"export const MOBILE_BUNDLE_VERSION\s*=\s*'paneltec-v160\.3\.9\.58\.13\.(\d+)([a-z0-9_]*)'",
    }
    for f, pat in _CANONICAL.items():
        m = re.search(pat, _read(f))
        assert m, f"canonical constant not found in {f}"
        assert int(m.group(1)) >= 131, f"{f} not at .131 or newer"
