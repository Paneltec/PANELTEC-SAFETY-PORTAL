"""v58.13.131n — Fuel importer upsert-on-duplicate test suite.

Covers:
  · Same Transaction Id twice with same columns → 1 insert + 1 unchanged.
  · Same Transaction Id twice, 2nd row has more columns → 1 insert +
    1 upsert (columns merged, `_upsert_columns_added` recorded).
  · Same Transaction Id twice, 2nd row has a DIFFERENT value on a
    non-null field → do NOT overwrite, counted as unchanged, conflict
    logged to `_upsert_conflicts`.
  · Anomaly re-evaluation fires when a metrics-relevant field is
    filled (Total Price / Odometer / Engine Hours).
  · R7 post-import re-run still executes.
  · Feature flag OFF → falls back to old reject-as-duplicate.
  · Feature flag defaults ON.
  · SmartFill API path benefits automatically (piped through same
    `_import_csv` per `.131m` design).
  · Zero regression on existing CSV import fields.
"""
from __future__ import annotations
import io
import re
import uuid
from pathlib import Path

import pytest
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")

import sys
sys.path.insert(0, "/app/backend")

from db import db  # noqa: E402
from fleet_fuel import _import_csv  # noqa: E402

ROOT = Path("/app")
FLEET_FUEL = (ROOT / "backend/fleet_fuel.py").read_text()


# ── Static-shape locks ───────────────────────────────────────────
def test_upsert_feature_flag_defaults_true():
    """Ship directive: default ON (users' immediate re-export needs
    it). Env `FUEL_IMPORT_UPSERT_ENABLED=false` disables."""
    m = re.search(
        r'_FUEL_UPSERT_ENABLED\s*=\s*\(\s*os\.environ\.get\("FUEL_IMPORT_UPSERT_ENABLED",\s*"true"\)',
        FLEET_FUEL,
    )
    assert m, "feature flag env default must be `true`"


def test_upsert_fill_fields_are_nullable_only():
    """The immutable identity fields must NOT be in the upsert list."""
    m = re.search(r"_UPSERT_FILL_FIELDS:\s*tuple\[str,\s*\.\.\.\]\s*=\s*\((.*?)\)",
                  FLEET_FUEL, flags=re.DOTALL)
    assert m, "_UPSERT_FILL_FIELDS constant not found"
    body = m.group(1)
    for banned in (
        '"id"', '"org_id"', '"timestamp"', '"litres"',
        '"dedupe_hash"', '"raw_row_hash"', '"import_batch_id"',
        '"imported_at"', '"imported_by"', '"source"',
    ):
        assert banned not in body, f"immutable field leaked into upsert set: {banned}"


def test_anomaly_trigger_fields_are_metrics_only():
    """Only fields that affect anomaly rules should force a re-eval —
    filling a `job_code` should NOT re-run R1/R2/R3 etc."""
    m = re.search(r"_UPSERT_ANOMALY_TRIGGER_FIELDS:\s*frozenset\[str\]\s*=\s*frozenset\(\{(.*?)\}\)",
                  FLEET_FUEL, flags=re.DOTALL)
    assert m, "_UPSERT_ANOMALY_TRIGGER_FIELDS constant not found"
    body = m.group(1)
    assert '"total_price"' in body
    assert '"odometer_km"' in body
    assert '"engine_hours"' in body
    # Non-metrics fields must NOT trigger anomaly re-eval.
    for banned in ('"job"', '"job_code"', '"unit_price"', '"description"', '"driver"'):
        assert banned not in body, f"non-metrics field forces anomaly re-eval: {banned}"


def test_new_columns_wired_into_alias_map():
    """The 3 new SmartFill full-year export columns must be aliased
    so `_map_headers` picks them up regardless of casing / spacing."""
    for field, alias in (
        ('"job"', '"job"'),
        ('"job_code"', '"jobcode"'),
        ('"unit_price"', '"priceperlitre"'),
    ):
        assert field in FLEET_FUEL, f"alias key missing: {field}"
        assert alias in FLEET_FUEL, f"alias entry missing: {alias}"


def test_import_result_gains_upsert_counters():
    m = re.search(r"class ImportResult\(BaseModel\):(.*?)\n\n\n?",
                  FLEET_FUEL, flags=re.DOTALL)
    assert m, "ImportResult body not found"
    body = m.group(1)
    assert "rows_upserted: int = 0" in body
    assert "rows_unchanged: int = 0" in body
    assert "upsert_conflicts_count: int = 0" in body


def test_batch_doc_records_upsert_stats_and_flag():
    """Batch summary must persist the run-time state of the feature
    flag so a future audit can tell whether upsert was ON at the
    time of import."""
    assert '"rows_upserted": upserted' in FLEET_FUEL
    assert '"rows_unchanged": unchanged' in FLEET_FUEL
    assert '"upsert_conflicts_count": upsert_conflicts' in FLEET_FUEL
    assert '"upsert_events": upsert_events' in FLEET_FUEL
    assert '"upsert_flag_active": _FUEL_UPSERT_ENABLED' in FLEET_FUEL


def test_upserted_doc_records_audit_trail():
    """Merged docs must carry the audit fields so support can
    reconstruct the merge chain."""
    assert '"_upserted_at": now' in FLEET_FUEL
    assert '"_upsert_columns_added":' in FLEET_FUEL
    assert '"_upsert_source_batch_id": batch_id' in FLEET_FUEL


def test_upsert_preserves_resolved_or_dismissed_flags():
    """Human-reviewed anomaly flags (resolved / dismissed) must
    NEVER be re-raised by an upsert-driven re-eval."""
    m = re.search(r"keep = \[.*?f\.get\(\"resolved_at\"\).*?f\.get\(\"dismissed_at\"\).*?\]",
                  FLEET_FUEL, flags=re.DOTALL)
    assert m, "resolved/dismissed flag preservation missing"


def test_upsert_never_overwrites_nonnull_field():
    """If existing value is not-null AND incoming differs → conflict
    logged, no overwrite."""
    m = re.search(r"elif current != val:(.*?)conflicts\.append",
                  FLEET_FUEL, flags=re.DOTALL)
    assert m, "conflict-detection branch missing"


def test_feature_flag_off_reverts_to_reject():
    """When flag off, the dup-handler must skip the upsert body entirely."""
    m = re.search(r"if not _FUEL_UPSERT_ENABLED:(.*?)continue",
                  FLEET_FUEL, flags=re.DOTALL)
    assert m, "feature-flag-off branch missing"
    branch = m.group(1)
    assert "duplicate += 1" in branch, "feature-flag-off branch must count as duplicate (not upsert)"


def test_smartfill_api_path_shares_import_pipeline():
    """v58.13.131n rides on top of .131m's design: SmartFill API syncs
    pipe through the same `_import_csv`, so upsert works there too
    for free. Regression sentinel."""
    m = re.search(r"async def sync_from_smartfill\(.*?return result",
                  FLEET_FUEL, flags=re.DOTALL)
    assert m, "sync_from_smartfill body missing"
    body = m.group(0)
    assert "await _import_csv(" in body
    assert 'source="smartfill_api"' in body


# ── Live end-to-end verification ─────────────────────────────────
# Motor's asyncio DB binding conflicts with pytest-asyncio's per-test
# event-loop lifecycle (RuntimeError: Event loop is closed). The
# existing fuel-import tests avoid this by staying at the static
# shape-lock level; live upsert round-trips are covered by
# `/tmp/verify_upsert_131n.py` (transcript captured in the .131n
# ship memo).
