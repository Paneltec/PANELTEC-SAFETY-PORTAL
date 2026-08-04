"""v160.3.9.43.1 — SEC-003 CONTRACT REGRESSION.

Static scan of `/app/backend/` for the invariant:

    Every file that reads from `integration_configs` (via `find` or
    `find_one`) and later dereferences any known-secret field name
    MUST import `hydrate_integration_config` from `integrations`.

This is a CHEAP alarm: it doesn't need Mongo, doesn't need Fernet, doesn't
need any fixtures. It's a pure `re`-scan run on module source. If a
future patch introduces a raw `cfg = doc.get("config") or {}` chained
into an `api_token` / `api_key` / `password` / `session_hash` / etc. read
without going through the shim, this test will fail at CI time, before
production users see a 500 KeyError.

Prior to the v43 sweep this test would have flagged 4 files. After the
v43 sweep it should report ZERO offenders. If it fails, either:
  (a) a new site was added — go add `hydrate_integration_config`, or
  (b) the site legitimately does NOT read secret fields — add its path
      to `_EXEMPT_FILES` below with a one-line justification.
"""
from __future__ import annotations
import re
from pathlib import Path

_BACKEND = Path(__file__).resolve().parent.parent

# Fields whose read on a raw `integration_configs.config` dict is a
# smoking-gun for a missing hydrate call. These are exactly the fields
# `integrations._SECRET_FIELDS_BY_KIND` encrypts at rest.
_SECRET_FIELDS = (
    "api_token", "api_key", "password",
    "session_hash", "client_secret",
    "refresh_token", "access_token",
)

# Files that are ALLOWED to read `integration_configs` without hydrating.
# Every entry needs a one-line justification.
_EXEMPT_FILES = {
    # `integrations.py` DEFINES `hydrate_integration_config` — it can't
    # import itself. Its own raw reads either ARE the hydrator, or are
    # metadata-only (status, kind, updated_at).
    "integrations.py": "defines hydrate_integration_config",
    # `health_extras.py` reads secret-field NAMES for a presence check
    # (accepting either plaintext or `<field>_encrypted`); it never
    # deferences the plaintext value for a real API call.
    "health_extras.py": "presence-only check, accepts <field>_encrypted",
    # `cron_simpro_delta.py` reads only `cfg["org_id"]` — no secrets.
    "cron_simpro_delta.py": "reads org_id only, then delegates to refresh_workers",
    # `email_outbox.py:207` reads only `status` for the m365-connected flag.
    "email_outbox.py": "reads status only for _m365_connected()",
    # `forms_pickers.py` reads `customers_cache` (a non-secret list).
    "forms_pickers.py": "reads customers_cache only (non-secret list)",
    # `workers.py:427` reads `customers_cache` for the profile screen.
    # Its sync-from-simpro path (line 315) DOES hydrate, so `workers.py`
    # is NOT in the exempt list overall — the contract still applies. The
    # exemption here would create a false pass. So we DON'T exempt it.
}


def _find_integration_config_files() -> list[Path]:
    """Every .py under /app/backend/ that reads from integration_configs."""
    hits: list[Path] = []
    for p in _BACKEND.glob("*.py"):
        try:
            src = p.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        if re.search(r"integration_configs\.(find_one|find)\(", src):
            hits.append(p)
    return hits


def _reads_secret_field(src: str) -> list[str]:
    """Return the secret field names that this source dereferences on a
    generic dict-like variable (heuristic — reduces false positives by
    only counting reads on identifiers plausibly holding the cfg dict:
    `cfg`, `c`, `conf`, `config`, `tm_cfg`, `cust_doc`)."""
    holders = r"(?:cfg|c|conf|config|tm_cfg|nx_cfg|sim_cfg|cust_doc|m365_cfg)"
    hits = []
    for f in _SECRET_FIELDS:
        pat = rf"\b{holders}\b(?:\.get\(['\"]{f}['\"]|\[['\"]{f}['\"]\])"
        if re.search(pat, src):
            hits.append(f)
    return hits


def test_sec003_contract_every_secret_reader_hydrates():
    offenders: list[tuple[str, list[str]]] = []
    for p in _find_integration_config_files():
        name = p.name
        if name in _EXEMPT_FILES:
            continue
        src = p.read_text(encoding="utf-8", errors="ignore")
        secret_reads = _reads_secret_field(src)
        if not secret_reads:
            continue
        imports_hydrate = ("hydrate_integration_config" in src)
        if not imports_hydrate:
            offenders.append((name, secret_reads))
    assert not offenders, (
        "SEC-003 CONTRACT VIOLATION — the following files read secret "
        "fields from an integration_configs document without importing "
        "`hydrate_integration_config`. Either add the import + wrap the "
        "read, OR justify + add to `_EXEMPT_FILES`.\n\n"
        + "\n".join(f"  • {name}: reads {fields}" for name, fields in offenders)
    )


def test_sec003_contract_registers_every_known_broken_site_pre_v43():
    """Meta-test: this file itself must scan the six v43-fixed files
    (they all now hydrate) — proving the scanner is looking at real code
    and not silently short-circuiting on an empty file list."""
    known_hydrated_files = {
        "simpro_import_users.py",
        "asset_meter_history.py",
        "integrations_textmagic.py",
        "worker_certifications.py",
        "workers.py",
    }
    scanned = {p.name for p in _find_integration_config_files()}
    missing = known_hydrated_files - scanned
    assert not missing, (
        f"Scanner did not visit expected files: {missing}. "
        "The glob may be misconfigured."
    )
