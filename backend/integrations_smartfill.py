"""v58.13.131 — SmartFill fuel API integration (discovery / probe).

This module is Phase 1 of the fuel-usage feature. Purpose:
  · Provide a thin, secret-safe httpx wrapper around SmartFill's
    JSON-RPC 2.0 endpoint (`https://fmtdata.com/API/api.php`).
  · Expose two probe helpers used by the discovery report AND the
    forthcoming `/fleet/fuel/sync` command:
      - `list_available_methods()`  → best-effort discovery via a
        curated candidate list (SmartFill does NOT publish a
        machine-readable discovery method; the JSON-RPC spec's
        `system.listMethods` is documented as unsupported here).
      - `call(method, params)`      → generic RPC invoker.
  · Provide typed pass-throughs for the two methods documented in
    the sample screenshot (`Tank:Level`) and the two we EXPECT to
    exist based on SmartFill's public docs (`Vehicle:List`,
    `Vehicle:FillHistory`).

**No writes to Mongo, no user-facing endpoints, no scheduled task
in this ship.** The `/fleet/fuel/sync` HTTP surface + persistence
lands in v58.13.131b (Phase 2, gated on the discovery green-light).

## Secret handling
- URL / clientReference / clientSecret ONLY read via
  `os.environ` — never hardcoded, never persisted to Mongo.
- `_creds()` centralises the lookup + raises a clean
  `SmartFillConfigError` if either is missing (never echoes the
  secret in the error message).
- The `httpx` client is created per-call with a 15s timeout to
  match `asset_navixy_sync.py`'s existing pattern.
- Logging: `.info` on method + status. NEVER log the secret,
  never log the raw JSON-RPC body (may include SFL codes /
  unit identifiers that could ease lateral movement).

## JSON-RPC 2.0 shape (verified against user's screenshot)
Request:
```
{
  "jsonrpc": "2.0",
  "method": "Tank:Level",
  "params": {"clientReference": "…", "clientSecret": "…"},
  "id": 1
}
```
Response: standard JSON-RPC. Errors carry `error.code` + `error.message`.
"""
from __future__ import annotations
import logging
import os
import time
from typing import Any, Optional

import httpx

log = logging.getLogger("paneltec.smartfill")

# Candidate method names probed in `list_available_methods`. Sourced
# from the user's screenshot (`Tank:Level`), SmartFill's public API
# guide (mirrored in `/app/memory/smartfill_discovery_v58_13_131.md`),
# and the "colon-prefixed namespace" naming pattern the API uses.
_CANDIDATE_METHODS: tuple[str, ...] = (
    # ── AVAILABLE on our subscription (verified .131 probe) ──
    "Tank:Level",
    # ── RECOGNISED but subscription-gated (code 1: "Method not
    #     supported") on our current tier. Kept in the list so a
    #     future re-probe auto-detects the flip to `available` after
    #     SmartFill support enables them — no code change needed.
    "Tank:List",
    "Tank:Levels",
    "Tank:Alarms",
    "Tank:Deliveries",
    "Tank:Transactions",
    "Tank:Fills",
    "Tank:History",
    "Tank:Consumption",
    # ── High-confidence guesses (colon-namespaced siblings). All
    #     returned code 5 ("No such method") on .131 probe — kept
    #     for completeness in case SmartFill adds them later.
    "Vehicle:List",
    "Vehicle:FillHistory",
    "Vehicle:Detail",
    "Transaction:List",
    "Transaction:Detail",
    "Fill:List",
    "Fill:Detail",
    "Unit:List",
    "Site:List",
    # ── Introspection guesses (SmartFill does not publish these
    #     but a probe costs nothing).
    "system.listMethods",
    "System:ListMethods",
    "API:Methods",
)


class SmartFillConfigError(RuntimeError):
    """Raised when SMARTFILL_API_KEY or SMARTFILL_API_SECRET are missing."""


class SmartFillAPIError(RuntimeError):
    """Wraps a SmartFill JSON-RPC error response. Carries the JSON-RPC
    error code + message but NEVER the request params (which include
    the secret)."""
    def __init__(self, code: int, message: str, method: str):
        self.code = code
        self.method = method
        super().__init__(f"SmartFill {method} → JSON-RPC error {code}: {message}")


def _creds() -> tuple[str, str, str]:
    """Return `(url, key, secret)` from env. Fail fast with a clean
    error that NEVER echoes the values."""
    url = os.environ.get("SMARTFILL_API_URL")
    key = os.environ.get("SMARTFILL_API_KEY")
    secret = os.environ.get("SMARTFILL_API_SECRET")
    missing = [n for n, v in (
        ("SMARTFILL_API_URL", url),
        ("SMARTFILL_API_KEY", key),
        ("SMARTFILL_API_SECRET", secret),
    ) if not v]
    if missing:
        raise SmartFillConfigError(
            f"SmartFill not configured: missing env {', '.join(missing)}"
        )
    return url, key, secret  # type: ignore[return-value]


def _rpc_body(method: str, extra_params: Optional[dict] = None, req_id: int = 1) -> dict:
    """Assemble the JSON-RPC 2.0 body. Credentials are injected here
    from env so callers never touch the secret directly.

    NOTE: SmartFill diverges from strict JSON-RPC 2.0 — the param
    key is `parameters` (plural), not `params`. Discovered by probe
    on v58.13.131 (400 → 200 flip when the key rename landed).
    """
    _, key, secret = _creds()
    params: dict = {"clientReference": key, "clientSecret": secret}
    if extra_params:
        params.update(extra_params)
    return {
        "jsonrpc": "2.0",
        "method": method,
        "parameters": params,
        "id": req_id,
    }


async def call(
    method: str,
    extra_params: Optional[dict] = None,
    *,
    timeout: float = 15.0,
) -> Any:
    """Invoke a SmartFill JSON-RPC method. Returns `result` payload.

    Never logs the request body (contains the secret). Logs only the
    method name + HTTP status + response `error.code` / `result`
    presence.
    """
    url, _, _ = _creds()
    body = _rpc_body(method, extra_params)
    log.info("smartfill call method=%s", method)  # do not log payload
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(url, json=body)
    log.info("smartfill call method=%s http_status=%s", method, resp.status_code)
    # SmartFill returns valid JSON-RPC error envelopes with HTTP 400
    # (e.g. `{"error":{"code":"3","error":"Missing parameter",...}}`),
    # so we parse the body FIRST and only raise on transport-level
    # failures (5xx, non-JSON, network).
    try:
        envelope = resp.json()
    except ValueError:
        resp.raise_for_status()  # re-raise as httpx.HTTPError with body
        raise SmartFillAPIError(-32700, "non-json response", method)
    if resp.status_code >= 500:
        resp.raise_for_status()
    if not isinstance(envelope, dict):
        raise SmartFillAPIError(-32700, "non-object response", method)
    if "error" in envelope and envelope["error"]:
        err = envelope["error"] or {}
        # SmartFill returns `code` as a STRING and `error` as the
        # message (not `message`). Bridge both spellings so callers
        # can still `except SmartFillAPIError as e: e.code == 3`.
        raw_code = err.get("code")
        try:
            code_int = int(raw_code) if raw_code is not None else -1
        except (TypeError, ValueError):
            code_int = -1
        msg = err.get("message") or err.get("error") or "unknown"
        raise SmartFillAPIError(code_int, str(msg), method)
    return envelope.get("result")


def columnar_to_rows(result: Any) -> list[dict]:
    """SmartFill returns a `{columns: [...], values: [[...], ...]}`
    envelope for list-shaped methods. Convert to a list of dicts
    keyed by column name so downstream code doesn't drift on column
    order. Non-columnar payloads pass through unchanged (wrapped in a
    single-element list if dict, empty list otherwise)."""
    if isinstance(result, dict) and isinstance(result.get("columns"), list) and isinstance(result.get("values"), list):
        cols = result["columns"]
        return [
            {cols[i]: (row[i] if i < len(row) else None) for i in range(len(cols))}
            for row in result["values"]
        ]
    if isinstance(result, list):
        return result
    if isinstance(result, dict):
        return [result]
    return []


async def get_tank_levels() -> Any:
    """`Tank:Level` — snapshot of all tank levels for the org.
    Fields per the screenshot: Unit Number, Tank Number, Description,
    Volume, Volume Percent, Capacity, Tank SFL, Status,
    Last Updated, Timezone.
    """
    return await call("Tank:Level")


async def get_vehicle_list() -> Any:
    """`Vehicle:List` — HIGH-CONFIDENCE GUESS. Probe result recorded
    in the discovery memo. If SmartFill returns
    `method not found`, we fall through to `Fill:List` +
    per-transaction vehicle attribution instead."""
    return await call("Vehicle:List")


async def get_vehicle_fill_history(
    vehicle_id: Optional[str] = None,
    from_iso: Optional[str] = None,
    to_iso: Optional[str] = None,
) -> Any:
    """`Vehicle:FillHistory` — HIGH-CONFIDENCE GUESS. Same fallback
    note as `get_vehicle_list`. Params (if the method is supported):
    `vehicleId`, `fromDate`, `toDate` (ISO 8601)."""
    extra: dict = {}
    if vehicle_id is not None:
        extra["vehicleId"] = vehicle_id
    if from_iso is not None:
        extra["fromDate"] = from_iso
    if to_iso is not None:
        extra["toDate"] = to_iso
    return await call("Vehicle:FillHistory", extra or None)


async def list_available_methods(
    *,
    candidates: Optional[tuple[str, ...]] = None,
) -> dict:
    """Probe SmartFill for supported methods.

    Iterates the `_CANDIDATE_METHODS` list (or a caller-supplied
    list), invokes each with just the credential params, and
    classifies:
      · `available` — HTTP 200 + `result` key present + no `error`.
      · `unauthorized` — JSON-RPC error code matches auth family
                          (401 / -32001..-32003 depending on server).
      · `method_not_found` — JSON-RPC -32601 or `"method"` in
                          the error message (case-insensitive).
      · `error` — everything else (transport / 5xx / unparseable).

    Never returns the response body — only the classification + a
    truncated error message for the report. Callers persist this
    to `/app/memory/smartfill_discovery_v58_13_131.md`.
    """
    cands = candidates or _CANDIDATE_METHODS
    out: dict = {
        "probed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "url": os.environ.get("SMARTFILL_API_URL"),
        "candidate_count": len(cands),
        "results": [],
    }
    for m in cands:
        entry: dict = {"method": m}
        try:
            result = await call(m, timeout=10.0)
            entry["status"] = "available"
            # Record only the SHAPE of the result — never the values.
            if isinstance(result, dict) and isinstance(result.get("columns"), list):
                cols = result["columns"]
                vals = result.get("values") or []
                entry["shape"] = f"columnar[{len(vals)} rows × {len(cols)} cols]"
                entry["row_keys"] = list(cols)
            elif isinstance(result, list):
                entry["shape"] = f"list[{len(result)}]"
                if result and isinstance(result[0], dict):
                    entry["row_keys"] = sorted(result[0].keys())
            elif isinstance(result, dict):
                entry["shape"] = "object"
                entry["row_keys"] = sorted(result.keys())
            else:
                entry["shape"] = type(result).__name__
        except SmartFillAPIError as e:
            msg = (str(e) or "").lower()
            code = e.code
            # SmartFill error taxonomy (empirical, .131 probe):
            #   · code 1 "Method not supported"  → recognised but the
            #                                       account/subscription
            #                                       tier can't invoke it.
            #                                       Fix: contact SmartFill
            #                                       to enable.
            #   · code 3 "Missing parameter"     → method exists + is
            #                                       enabled; caller
            #                                       needs to supply more
            #                                       params.
            #   · code 5 "No such method"        → method name doesn't
            #                                       exist.
            if code == 5 or "no such method" in msg or "unknown method" in msg:
                entry["status"] = "method_not_found"
            elif code == 1 or "method not supported" in msg or "not enabled" in msg:
                entry["status"] = "not_enabled"
            elif code == 3 and ("missing parameter" in msg or "missing" in msg):
                entry["status"] = "needs_params"
            elif code in (-32001, -32002, -32003, 401) or "auth" in msg or "credential" in msg or "unauthori" in msg:
                entry["status"] = "unauthorized"
            else:
                entry["status"] = "error"
            entry["code"] = code
            # Truncate to keep memo compact + avoid leaking anything odd.
            entry["message"] = (str(e) or "")[:200]
        except httpx.HTTPError as e:
            entry["status"] = "transport_error"
            entry["message"] = str(e)[:200]
        except Exception as e:  # pylint: disable=broad-except
            entry["status"] = "unexpected"
            entry["message"] = str(e)[:200]
        out["results"].append(entry)
    return out
