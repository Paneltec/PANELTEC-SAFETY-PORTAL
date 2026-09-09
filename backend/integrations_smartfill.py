"""v58.13.131m — SmartFill JSON-RPC 2.0 integration (production surface).

## Provenance
- `.131`   — First probe. Discovered `parameters` (not `params`) key.
- `.131k`  — Re-probe with a broadened candidate list. Concluded that
             only `Tank:Level` was accessible — WRONG at the naming
             level (candidate list never tried the `:Read` verbs).
- `.131m`  — SmartFill support confirmed the correct method names live
             in the FMT Data Web API PDF. Live-verified in
             `/app/memory/v58_13_131m_probe_raw.json`:
               · `Transactions:Read`  → available (13-col columnar)
               · `Tank:Read`          → available (13-col columnar)
               · `Tank:Level`         → available (10-col columnar)
               · `Asset:Read`         → gated (code 3, needs required
                                          params — deferred)
               · `Driver:Read`        → available (6-col columnar)

## What this module exposes
- `SmartFillConfigError`     — env-missing exception.
- `SmartFillAPIError`        — JSON-RPC error envelope; carries `code`
                                + `message` + `method`, NEVER the raw
                                request body (which includes the
                                secret).
- `SmartFillRateLimitError`  — raised when the in-process token bucket
                                is exhausted. Carries `retry_after_s`.
- `_creds()`                 — env lookup with clean fail-fast on
                                missing keys.
- `columnar_to_rows(result)` — flatten `{columns, values}` envelope.
- `call(method, extra_params)` — generic RPC invoker with rate-limit
                                 + Retry-After honouring.
- `smartfill_fetch_transactions(from_iso, to_iso, page_size)`
                              — paginated `Transactions:Read` wrapper.
- `smartfill_fetch_tank_history(unit_number, from_iso, to_iso)`
                              — `Tank:Read` wrapper.
- `smartfill_fetch_tank_levels()`
                              — `Tank:Level` wrapper.
- `smartfill_fetch_drivers()` — `Driver:Read` wrapper.
- `get_rate_limit_state()`    — snapshot the bucket for `/status`.

## Rate limits (SmartFill contract)
6 requests / minute · 60 / hour · 600 / day. The bucket applies to
both the manual endpoint AND the cron.

## Secret hygiene
- URL / clientReference / clientSecret ONLY read via `os.environ`.
- `_creds()` fails fast on missing values — never echoes them.
- `call()` NEVER logs the request body. Only method + status + code.
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
from typing import Any, AsyncIterator, Optional

import httpx

log = logging.getLogger("paneltec.smartfill")

# ── Method catalogue (kept for future probe passes) ──────────────
# `.131m` — Superset of the `.131k` list + the four `:Read` verbs
# that support confirmed as canonical. `list_available_methods()`
# still uses this so a future re-probe records the current state.
_CANDIDATE_METHODS: tuple[str, ...] = (
    # ── AVAILABLE on our subscription (verified .131m re-probe) ──
    "Transactions:Read",
    "Tank:Read",
    "Tank:Level",
    "Driver:Read",
    # ── Available in the PDF but gated on our account tier ──
    "Asset:Read",
    # ── Historic candidate rows (kept so a re-probe still records
    #     their status; all returned code 5 or code 1 in .131k) ──
    "Tank:List", "Tank:Levels", "Tank:Alarms", "Tank:Deliveries",
    "Tank:Transactions", "Tank:Fills", "Tank:History", "Tank:Consumption",
    "Vehicle:List", "Vehicle:FillHistory", "Vehicle:Detail",
    "Transaction:List", "Transaction:Detail",
    "Fill:List", "Fill:Detail", "Unit:List", "Site:List",
    "system.listMethods", "System:ListMethods", "API:Methods",
)


# ── Exceptions ───────────────────────────────────────────────────
class SmartFillConfigError(RuntimeError):
    """Raised when SMARTFILL_* env vars are missing."""


class SmartFillAPIError(RuntimeError):
    """Wraps a SmartFill JSON-RPC error envelope. Carries the JSON-RPC
    error code + message but NEVER the request params (which include
    the secret)."""
    def __init__(self, code: int, message: str, method: str):
        self.code = code
        self.method = method
        super().__init__(f"SmartFill {method} → JSON-RPC error {code}: {message}")


class SmartFillRateLimitError(RuntimeError):
    """Raised when the in-process token bucket is exhausted OR the
    server returns 429. Carries `retry_after_s`."""
    def __init__(self, retry_after_s: float, scope: str):
        self.retry_after_s = retry_after_s
        self.scope = scope  # "minute" | "hour" | "day" | "server_429"
        super().__init__(f"SmartFill rate limit exhausted at {scope} scope — retry in {retry_after_s:.1f}s")


# ── Credentials + JSON-RPC body ──────────────────────────────────
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
    """Assemble the JSON-RPC 2.0 body. Credentials injected here so
    callers never touch the secret directly.

    NOTE: SmartFill diverges from strict JSON-RPC 2.0 — the param key
    is `parameters` (plural), not `params`. Discovered by probe on
    v58.13.131 (400 → 200 flip when the key rename landed).
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


# ── Rate limiter (per-process token bucket) ──────────────────────
# SmartFill contract: 6/min, 60/hour, 600/day. In this deployment
# there is a SINGLE uvicorn worker, so the in-process bucket is
# authoritative. If the deployment ever forks to N workers this
# needs to move to Redis / Mongo — flagged in the discovery memo.
class _RateBucket:
    """Simple sliding-window bucket keyed on (minute, hour, day).

    All hits are recorded as timestamps in `_hits`. Before each hit we
    prune expired timestamps and check against the three ceilings.
    """
    _MINUTE_CAP = 6
    _HOUR_CAP = 60
    _DAY_CAP = 600

    def __init__(self) -> None:
        self._hits: list[float] = []
        self._lock = asyncio.Lock()
        self._last_error_at: Optional[float] = None
        self._last_error_scope: Optional[str] = None

    def _prune(self, now: float) -> None:
        # 24 h horizon.
        cutoff = now - 86400
        self._hits = [t for t in self._hits if t >= cutoff]

    async def check_and_add(self) -> None:
        """Register a request or raise `SmartFillRateLimitError`."""
        async with self._lock:
            now = time.monotonic()
            self._prune(now)
            m = sum(1 for t in self._hits if t >= now - 60)
            h = sum(1 for t in self._hits if t >= now - 3600)
            d = len(self._hits)
            if m >= self._MINUTE_CAP:
                retry = 60 - (now - min(t for t in self._hits if t >= now - 60))
                self._last_error_at = now
                self._last_error_scope = "minute"
                raise SmartFillRateLimitError(retry, "minute")
            if h >= self._HOUR_CAP:
                retry = 3600 - (now - min(t for t in self._hits if t >= now - 3600))
                self._last_error_at = now
                self._last_error_scope = "hour"
                raise SmartFillRateLimitError(retry, "hour")
            if d >= self._DAY_CAP:
                retry = 86400 - (now - min(self._hits))
                self._last_error_at = now
                self._last_error_scope = "day"
                raise SmartFillRateLimitError(retry, "day")
            self._hits.append(now)

    def snapshot(self) -> dict:
        now = time.monotonic()
        self._prune(now)
        m = sum(1 for t in self._hits if t >= now - 60)
        h = sum(1 for t in self._hits if t >= now - 3600)
        d = len(self._hits)
        return {
            "minute_used": m, "minute_cap": self._MINUTE_CAP,
            "hour_used": h, "hour_cap": self._HOUR_CAP,
            "day_used": d, "day_cap": self._DAY_CAP,
            "last_error_scope": self._last_error_scope,
            "last_error_at_monotonic": self._last_error_at,
        }


_BUCKET = _RateBucket()


def get_rate_limit_state() -> dict:
    return _BUCKET.snapshot()


# ── Generic RPC invoker ──────────────────────────────────────────
async def call(
    method: str,
    extra_params: Optional[dict] = None,
    *,
    timeout: float = 20.0,
    _skip_rate_limit: bool = False,
) -> Any:
    """Invoke a SmartFill JSON-RPC method. Returns the `result` payload.

    Raises:
        SmartFillConfigError   — env not configured.
        SmartFillAPIError      — JSON-RPC error envelope.
        SmartFillRateLimitError — bucket exhausted OR 429 from server.
        httpx.HTTPError        — transport / 5xx.

    Never logs the request body (contains the secret).
    """
    if not _skip_rate_limit:
        await _BUCKET.check_and_add()

    url, _, _ = _creds()
    body = _rpc_body(method, extra_params)
    log.info("smartfill call method=%s", method)  # do not log payload
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(url, json=body)
    log.info("smartfill call method=%s http_status=%s", method, resp.status_code)

    # 429 handling — SmartFill may respond with 429 + `Retry-After`.
    if resp.status_code == 429:
        retry = float(resp.headers.get("Retry-After", "60"))
        raise SmartFillRateLimitError(retry, "server_429")

    try:
        envelope = resp.json()
    except ValueError:
        resp.raise_for_status()
        raise SmartFillAPIError(-32700, "non-json response", method)
    if resp.status_code >= 500:
        resp.raise_for_status()
    if not isinstance(envelope, dict):
        raise SmartFillAPIError(-32700, "non-object response", method)
    if "error" in envelope and envelope["error"]:
        err = envelope["error"] or {}
        raw_code = err.get("code")
        try:
            code_int = int(raw_code) if raw_code is not None else -1
        except (TypeError, ValueError):
            code_int = -1
        msg = err.get("message") or err.get("error") or "unknown"
        raise SmartFillAPIError(code_int, str(msg), method)
    return envelope.get("result")


# ── Columnar → rows helper ───────────────────────────────────────
def columnar_to_rows(result: Any) -> list[dict]:
    """SmartFill returns a `{columns: [...], values: [[...], ...]}`
    envelope for list-shaped methods. Convert to a list of dicts
    keyed by column name so downstream code doesn't drift on column
    order.

    v58.13.132ap — SmartFill's Transactions:Read now returns the
    row array under the key `data` (not `values`). Both are
    handled here so tank / driver methods keep working AND
    transactions get parsed. Ordering: check both keys, take
    whichever is a non-empty list of lists.
    """
    if isinstance(result, dict) and isinstance(result.get("columns"), list):
        cols = result["columns"]
        rows_raw = None
        for k in ("values", "data", "rows"):
            v = result.get(k)
            if isinstance(v, list):
                rows_raw = v
                break
        if rows_raw is not None:
            return [
                {cols[i]: (row[i] if i < len(row) else None) for i in range(len(cols))}
                for row in rows_raw
                if isinstance(row, list)
            ]
    if isinstance(result, list):
        return result
    if isinstance(result, dict):
        return [result]
    return []


# ── Typed wrappers (production methods) ──────────────────────────
async def smartfill_fetch_tank_levels() -> list[dict]:
    """`Tank:Level` — snapshot of all tank levels for the org.
    Columns: Unit Number, Tank Number, Description, Volume,
             Volume Percent, Capacity, Tank SFL, Status,
             Last Updated, Timezone.
    """
    return columnar_to_rows(await call("Tank:Level"))


async def smartfill_fetch_drivers() -> list[dict]:
    """`Driver:Read` — driver register.
    Columns: Authorisation Value, ISO Access, Sequence Number,
             Expiry, Name, Enabled.
    """
    return columnar_to_rows(await call("Driver:Read"))


async def smartfill_fetch_tank_history(
    *, from_iso: Optional[str] = None, to_iso: Optional[str] = None,
) -> list[dict]:
    """`Tank:Read` — tank fills + delivery history.
    Columns: Date, Time, DateTime, Unit Number, Tank Number,
             Record Type, Record Sub Type, Volume, Volumetric Units,
             Order Number, Cost Price/L, Delivery Price, Timezone.
    """
    extra: dict = {}
    if from_iso:
        extra["From Timestamp"] = from_iso
    if to_iso:
        extra["To Timestamp"] = to_iso
    return columnar_to_rows(await call("Tank:Read", extra or None))


async def smartfill_fetch_transactions(
    *,
    from_iso: Optional[str] = None,
    to_iso: Optional[str] = None,
    page_size: int = 1000,
    max_pages: int = 200,
) -> list[dict]:
    """`Transactions:Read` — paginated pull. Handles the SmartFill
    `range: {offset, length}` pagination shape from the FMT Data PDF.

    Columns: Date, Time, Card Number, Description, Registration,
             From, Litres, Fuel Type, Odometer, Total Price,
             Transaction Id, Driver Authorisation, Unit Price.

    Rate-limits itself between pages so a single call never blows the
    6/min ceiling (waits ~10s between pages if hit).

    v58.13.132aq — max_pages raised 50 → 200 so orgs with 50k+ row
    histories don't drop today's rows off the tail of the pull. Also
    request `Sort By: Date DESC` — SmartFill silently ignores unknown
    params (as we saw with From/To Timestamp), so worst case it's
    a no-op; best case we get newest-first pagination and today's
    rows land in page 1.
    """
    all_rows: list[dict] = []
    offset = 0
    for page in range(max_pages):
        extra: dict = {
            "range": {"offset": offset, "length": page_size},
            "Sort By": "Date DESC",
        }
        if from_iso:
            extra["From Timestamp"] = from_iso
        if to_iso:
            extra["To Timestamp"] = to_iso
        try:
            result = await call("Transactions:Read", extra)
        except SmartFillRateLimitError as e:
            # Per-page throttle — wait then retry once.
            log.info("smartfill Transactions:Read rate-limit at page=%s — sleeping %.1fs",
                     page, e.retry_after_s)
            await asyncio.sleep(min(e.retry_after_s, 65.0))
            result = await call("Transactions:Read", extra)
        rows = columnar_to_rows(result)
        all_rows.extend(rows)
        # Stop when a page returns < page_size rows (last page).
        if len(rows) < page_size:
            break
        offset += page_size
    return all_rows


# ── Discovery helper (unchanged surface — used by probe scripts) ─
async def list_available_methods(
    *,
    candidates: Optional[tuple[str, ...]] = None,
) -> dict:
    """Best-effort discovery. Iterates the candidate list, invokes each
    with only the credential params, and classifies:
      · `available` — HTTP 200 + `result` key present.
      · `not_enabled` — code 1 "Method not supported" (subscription).
      · `needs_params` — code 3 "Missing parameter" (method exists).
      · `method_not_found` — code 5 "No such method".
      · `unauthorized` — auth-family error.
      · `error` / `transport_error` — everything else.
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
            if code == 5 or "no such method" in msg:
                entry["status"] = "method_not_found"
            elif code == 1 or "method not supported" in msg or "not enabled" in msg:
                entry["status"] = "not_enabled"
            elif code == 3:
                entry["status"] = "needs_params"
            elif code in (-32001, -32002, -32003, 401) or "auth" in msg or "unauthori" in msg:
                entry["status"] = "unauthorized"
            else:
                entry["status"] = "error"
            entry["code"] = code
            entry["message"] = (str(e) or "")[:200]
        except SmartFillRateLimitError as e:
            entry["status"] = "rate_limited"
            entry["retry_after_s"] = e.retry_after_s
        except httpx.HTTPError as e:
            entry["status"] = "transport_error"
            entry["message"] = str(e)[:200]
        except Exception as e:  # pylint: disable=broad-except
            entry["status"] = "unexpected"
            entry["message"] = str(e)[:200]
        out["results"].append(entry)
    return out
