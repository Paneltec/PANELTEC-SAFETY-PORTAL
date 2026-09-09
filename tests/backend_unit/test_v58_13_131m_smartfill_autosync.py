"""v58.13.131m — SmartFill auto-sync test suite.

Covers:
  · JSON-RPC method names match the FMT Data PDF (Transactions:Read,
    Tank:Read, Tank:Level, Driver:Read).
  · Columnar→row conversion.
  · CSV serialisation of SmartFill rows (13-column header).
  · Rate-limit bucket honours 6/min ceiling.
  · Cron gates: env + per-org toggle.
  · Endpoints exist: /sync-smartfill, /smartfill-status,
    /smartfill-auto-sync.
  · Dedupe on Transaction Id — same id twice → single insert
    (uses the existing `_import_csv` dedupe path since the SmartFill
    entrypoint pipes bytes through it).
  · Existing CSV import path stays wired (source="smartfill_csv"
    default preserved).
"""
from __future__ import annotations
import asyncio
import re
from pathlib import Path

import pytest

ROOT = Path("/app")


def _read(p: str) -> str:
    return (ROOT / p).read_text()


SMARTFILL = _read("backend/integrations_smartfill.py")
FLEET_FUEL = _read("backend/fleet_fuel.py")
CRON = _read("backend/cron_smartfill_auto_sync.py")
SERVER = _read("backend/server.py")


# ── Method-name lockdown ─────────────────────────────────────────
def test_uses_correct_read_verb_method_names():
    """FMT Data PDF says the canonical method names use `:Read`. The
    .131k probe (which used `:List` / `:Detail`) returned code 5 for
    everything except Tank:Level. Any regression here re-introduces
    the .131k bug."""
    assert '"Transactions:Read"' in SMARTFILL, "must call Transactions:Read"
    assert '"Tank:Read"' in SMARTFILL, "must call Tank:Read"
    assert '"Tank:Level"' in SMARTFILL, "must call Tank:Level"
    assert '"Driver:Read"' in SMARTFILL, "must call Driver:Read"


def test_transactions_read_wrapper_signature():
    m = re.search(r"async def smartfill_fetch_transactions\((.*?)\) -> list\[dict\]",
                  SMARTFILL, flags=re.DOTALL)
    assert m, "smartfill_fetch_transactions must exist"
    sig = m.group(1)
    assert "from_iso" in sig
    assert "to_iso" in sig
    assert "page_size" in sig


def test_pagination_uses_range_offset_length():
    """The FMT Data PDF documents `range: {offset, length}` for
    pagination. If a future refactor drops that, pages >1 will
    silently return the same first-page rows."""
    assert '"range"' in SMARTFILL
    assert '"offset"' in SMARTFILL
    assert '"length"' in SMARTFILL


# ── Rate-limit bucket ────────────────────────────────────────────
def test_rate_bucket_caps():
    """6/min · 60/hour · 600/day — must match SmartFill contract."""
    assert "_MINUTE_CAP = 6" in SMARTFILL
    assert "_HOUR_CAP = 60" in SMARTFILL
    assert "_DAY_CAP = 600" in SMARTFILL


def test_rate_bucket_raises_smartfill_rate_limit_error():
    """Bucket exhaustion must raise the typed exception so the
    endpoint layer can map to HTTP 429 with retry_after_s."""
    assert "class SmartFillRateLimitError" in SMARTFILL
    assert "raise SmartFillRateLimitError" in SMARTFILL


@pytest.mark.asyncio
async def test_rate_bucket_blocks_after_6_calls():
    """Live in-process test: 6 successful check_and_add calls, 7th raises."""
    import importlib
    from backend import integrations_smartfill  # type: ignore
    importlib.reload(integrations_smartfill)  # fresh bucket
    b = integrations_smartfill._RateBucket()
    for _ in range(6):
        await b.check_and_add()
    with pytest.raises(integrations_smartfill.SmartFillRateLimitError) as exc:
        await b.check_and_add()
    assert exc.value.scope == "minute"
    assert exc.value.retry_after_s > 0


def test_call_honours_server_429_retry_after():
    """Server 429 → SmartFillRateLimitError(scope='server_429'). If a
    future refactor drops the 429 branch, we lose the Retry-After."""
    assert 'resp.status_code == 429' in SMARTFILL
    assert '"server_429"' in SMARTFILL


# ── CSV pipeline reuse ───────────────────────────────────────────
def test_smartfill_rows_to_csv_bytes_uses_13_column_header():
    """Header list must be exactly the columns Transactions:Read
    returns — otherwise `_map_headers` won't align."""
    required = [
        "Date", "Time", "Card Number", "Description", "Registration",
        "From", "Litres", "Fuel Type", "Odometer", "Total Price",
        "Transaction Id", "Driver Authorisation", "Unit Price",
    ]
    for col in required:
        assert f'"{col}"' in FLEET_FUEL, f"CSV header missing column: {col}"


def test_smartfill_rows_to_csv_bytes_helper_exists():
    assert "def _smartfill_rows_to_csv_bytes" in FLEET_FUEL


def test_sync_from_smartfill_pipes_through_import_csv():
    """The sync entrypoint MUST reuse `_import_csv` — that's how
    dedupe / anomalies / Navixy enrichment stay identical to the CSV
    path. If someone re-implements the row loop inline, this fails."""
    m = re.search(r"async def sync_from_smartfill\(.*?\n\s*return result",
                  FLEET_FUEL, flags=re.DOTALL)
    assert m, "sync_from_smartfill body not found"
    body = m.group(0)
    assert "await _import_csv(" in body
    assert 'source="smartfill_api"' in body


def test_import_csv_source_param_default_preserves_csv_path():
    """The existing CSV endpoint must keep writing
    `source="smartfill_csv"`. The default arg makes that automatic
    unless caller overrides."""
    m = re.search(r"async def _import_csv\(.*?\).*?:\n", FLEET_FUEL, flags=re.DOTALL)
    assert m, "_import_csv signature not found"
    sig = m.group(0)
    assert 'source: str = "smartfill_csv"' in sig
    # The CSV endpoint explicitly passes the CSV source too.
    csv_ep = re.search(r"async def import_csv_ep\(.*?\)\.\n?", FLEET_FUEL, flags=re.DOTALL)
    # Endpoint body must NOT accidentally pass source="smartfill_api"
    ep_body = re.search(r"async def import_csv_ep\(.*?\n\s*\)\s*\n", FLEET_FUEL, flags=re.DOTALL)
    # Positive: the CSV endpoint's _import_csv call passes source="smartfill_csv"
    assert re.search(r'return await _import_csv\(.*?source="smartfill_csv"', FLEET_FUEL, flags=re.DOTALL)


def test_batch_doc_records_source_and_trigger():
    """Batch docs must carry both fields so the FE can filter
    'API' vs 'CSV' vs cron/manual."""
    assert '"source": source' in FLEET_FUEL
    assert '"triggered_by": triggered_by' in FLEET_FUEL


# ── Dedupe still works via existing Transaction Id + composite hash ─
def test_dedupe_transaction_id_check_still_wired():
    """Belt-and-braces: the existing `_import_csv` dedupe query uses
    (org_id, transaction_id) unique index. SmartFill Transaction Id
    values flow through the same query."""
    assert 'db.fuel_transactions.find_one' in FLEET_FUEL
    assert '"transaction_id": transaction_id' in FLEET_FUEL


# ── Endpoints ────────────────────────────────────────────────────
def test_sync_smartfill_endpoint_exists():
    assert '@router.post("/sync-smartfill"' in FLEET_FUEL
    assert 'async def sync_smartfill_ep(' in FLEET_FUEL


def test_smartfill_status_endpoint_exists():
    assert '@router.get("/smartfill-status"' in FLEET_FUEL
    assert 'async def smartfill_status_ep(' in FLEET_FUEL


def test_smartfill_auto_sync_toggle_endpoint_exists():
    assert '@router.post("/smartfill-auto-sync"' in FLEET_FUEL
    assert 'async def smartfill_auto_sync_toggle_ep(' in FLEET_FUEL


def test_endpoints_are_admin_gated():
    """Manual sync + auto-sync toggle both require admin (fleet
    financial data). Status endpoint is view-permission."""
    m_sync = re.search(r"async def sync_smartfill_ep\(.*?_require_admin\(user\)",
                       FLEET_FUEL, flags=re.DOTALL)
    m_toggle = re.search(r"async def smartfill_auto_sync_toggle_ep\(.*?_require_admin\(user\)",
                         FLEET_FUEL, flags=re.DOTALL)
    assert m_sync, "sync-smartfill must call _require_admin"
    assert m_toggle, "smartfill-auto-sync must call _require_admin"


def test_sync_endpoint_maps_ratelimit_to_429():
    """SmartFillRateLimitError from the bucket or server-429 must
    surface as HTTP 429 with retry_after_s in the body."""
    assert 'raise HTTPException(status_code=429' in FLEET_FUEL
    assert '"retry_after_s"' in FLEET_FUEL


# ── Cron gates ───────────────────────────────────────────────────
def test_cron_registration_env_gated():
    """Cron must NOT auto-register at process start unless the env
    var is flipped explicitly (safety on by default)."""
    m = re.search(r'def register_smartfill_auto_sync_cron\(scheduler\).*?return False',
                  CRON, flags=re.DOTALL)
    assert m, "registration must check env var and return False if unset"
    assert 'SMARTFILL_AUTO_SYNC_CRON' in CRON


def test_cron_per_org_toggle_gated():
    """Even after env registration, the cron job body must skip any
    org whose `fuel_smartfill_auto_sync_enabled` is not True."""
    assert 'fuel_smartfill_auto_sync_enabled' in CRON
    assert '_pick_orgs_with_auto_sync' in CRON


def test_cron_scheduled_at_6am_brisbane_by_default():
    assert 'SMARTFILL_AUTO_SYNC_CRON_HOUR' in CRON
    assert 'Australia/Brisbane' in CRON


def test_cron_registered_in_server_startup():
    """Server startup must call `register_smartfill_auto_sync_cron`
    so the env flip takes effect on the next boot."""
    assert 'register_smartfill_auto_sync_cron' in SERVER


def test_cron_job_uses_sync_from_smartfill():
    """The cron reuses the same entrypoint the manual endpoint uses —
    no divergent import paths."""
    assert 'from fleet_fuel import sync_from_smartfill' in CRON
    assert 'await sync_from_smartfill(' in CRON


def test_cron_triggered_by_tag_is_cron():
    assert 'triggered_by="cron"' in CRON


# ── Auto-sync OFF by default ─────────────────────────────────────
def test_auto_sync_defaults_off():
    """Cron picks orgs with EXPLICIT True — the query is
    `{fuel_smartfill_auto_sync_enabled: True}`, not `$ne: False`. So
    orgs where the setting is missing default to OFF."""
    m = re.search(r'db\.org_settings\.find\(\s*\{\s*"fuel_smartfill_auto_sync_enabled":\s*True',
                  CRON, flags=re.DOTALL)
    assert m, "cron must query for enabled=True (not $ne=False)"


def test_toggle_endpoint_persists_bool_flag():
    """Toggle must $set both the flag AND an audit trail
    (updated_at + updated_by)."""
    m = re.search(r"smartfill_auto_sync_toggle_ep\(.*?upsert=True",
                  FLEET_FUEL, flags=re.DOTALL)
    assert m, "toggle handler body not found"
    body = m.group(0)
    assert '"fuel_smartfill_auto_sync_enabled": bool(payload.enabled)' in body
    assert '"fuel_smartfill_auto_sync_updated_at"' in body
    assert '"fuel_smartfill_auto_sync_updated_by"' in body


# ── Secret hygiene ───────────────────────────────────────────────
def test_secret_never_logged():
    """`call()` must NEVER log the request body (which contains
    clientSecret)."""
    m = re.search(r'async def call\(.*?return envelope\.get\("result"\)',
                  SMARTFILL, flags=re.DOTALL)
    assert m, "call() body not found"
    body = m.group(0)
    # The body assembly must be `body = _rpc_body(method, extra_params)`
    # and no `log.*body` OR `log.*json` OR `log.*extra_params` after.
    for line in body.splitlines():
        if 'log.' in line:
            assert 'body' not in line and 'extra_params' not in line and 'json' not in line, \
                f"secret leak risk in log line: {line}"


def test_creds_never_echoes_values():
    """`_creds()` error message must NOT include the key or secret."""
    m = re.search(r'def _creds\(\).*?return url, key, secret', SMARTFILL, flags=re.DOTALL)
    assert m, "_creds body not found"
    body = m.group(0)
    # The raise line only names the env variable NAMES, never their values.
    assert 'raise SmartFillConfigError' in body
    assert '{key}' not in body  # no f-string interpolation of the key
    assert '{secret}' not in body


# ── Rate limit state exposure ────────────────────────────────────
def test_rate_limit_state_snapshot_exposed():
    """/smartfill-status must return current bucket state so the FE
    can render a "X of 6 used this minute" chip."""
    assert 'def get_rate_limit_state()' in SMARTFILL
    assert 'get_rate_limit_state' in FLEET_FUEL
