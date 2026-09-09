"""v58.13.131o — SmartFill card ↔ worker mapping test suite.

Covers:
  · WorkerIn / SmartFillCardEntry Pydantic shape.
  · Worker admin endpoints (list / add / remove).
  · Cross-worker uniqueness on ACTIVE (assigned_to=null) assignments.
  · Card resolver: date-window match, tightest-window preference,
    open-ended active, historical closed window.
  · Fuel_transactions insert path: `resolved_driver_name` computed
    from a pre-loaded card index.
  · Reporting layer: `_key_label` for scope="employee" prefers
    resolved_driver_name → csv driver → "Card N (unlinked)" fallback.
  · Backfill script exists + is idempotent.
"""
from __future__ import annotations
import re
from pathlib import Path

import pytest

ROOT = Path("/app")


def _read(p: str) -> str:
    return (ROOT / p).read_text()


WORKERS = _read("backend/workers.py")
FLEET_FUEL = _read("backend/fleet_fuel.py")
FLEET_FUEL_REPORTS = _read("backend/fleet_fuel_reports.py")
BACKFILL = _read("backend/scripts/backfill_resolved_driver_name_v58_13_131o.py")
FE_SECTION = _read("frontend/src/components/workers/SmartFillCardsSection.jsx")
FE_MODAL = _read("frontend/src/components/workers/WorkerViewModal.jsx")


# ── Pydantic shape ──────────────────────────────────────────────
def test_smartfill_card_entry_model_declares_required_fields():
    m = re.search(r"class SmartFillCardEntry\(BaseModel\):(.*?)\n\n\n",
                  WORKERS, flags=re.DOTALL)
    assert m, "SmartFillCardEntry model not found"
    body = m.group(1)
    assert "card_number: str" in body
    assert "assigned_from: Optional[str]" in body
    assert "assigned_to: Optional[str]" in body
    assert "notes: Optional[str]" in body


def test_smartfill_card_entry_validates_yyyy_mm_dd():
    """Date bounds must be YYYY-MM-DD or None. Prevents garbage
    strings landing in an audit-scoped field."""
    assert re.search(r'@field_validator\("assigned_from", "assigned_to"\)', WORKERS)
    assert 'ISO_DATE_RE.match(v)' in WORKERS


# ── Endpoints ───────────────────────────────────────────────────
def test_list_endpoint_exists():
    assert '@router.get("/{worker_id}/smartfill-cards")' in WORKERS
    assert 'async def list_smartfill_cards' in WORKERS


def test_add_endpoint_exists_and_requires_write():
    assert '@router.post("/{worker_id}/smartfill-cards")' in WORKERS
    m = re.search(r"async def add_smartfill_card\(.*?_require_write\(user\)",
                  WORKERS, flags=re.DOTALL)
    assert m, "add endpoint must call _require_write"


def test_remove_endpoint_exists():
    assert '@router.delete("/{worker_id}/smartfill-cards/{card_number}"' in WORKERS
    assert 'async def remove_smartfill_card' in WORKERS


def test_add_rejects_active_dup_on_same_worker():
    """Same card_number added twice with no `assigned_to` on either
    must reject as duplicate (409)."""
    m = re.search(r'async def add_smartfill_card\(.*?raise HTTPException\(409,\s*"Card number already linked to this worker \(active\)"',
                  WORKERS, flags=re.DOTALL)
    assert m


def test_add_rejects_active_conflict_across_workers():
    """A card that's active on another worker must reject with a
    guidance message telling the admin to close the old assignment."""
    m = re.search(r'"smartfill_card_numbers":\s*\{"\$elemMatch":\s*\{\s*"card_number":\s*entry\["card_number"\]',
                  WORKERS, flags=re.DOTALL)
    assert m, "cross-worker uniqueness query missing"
    assert 'Close that assignment first with `assigned_to`' in WORKERS


# ── Resolver behaviour ──────────────────────────────────────────
def test_resolver_helper_exists_and_is_pure():
    """`resolve_driver_by_card` must be a pure fn (no DB access) —
    the index is passed in so the caller can preload once per batch."""
    m = re.search(r"def resolve_driver_by_card\(\s*\*,\s*card_number.*?index.*?\):",
                  FLEET_FUEL, flags=re.DOTALL)
    assert m, "resolver signature not found"
    # Body should have no direct db. access.
    body_m = re.search(r"def resolve_driver_by_card\(.*?\n(?=\n\n|\nasync def |\ndef )",
                       FLEET_FUEL, flags=re.DOTALL)
    if body_m:
        body = body_m.group(0)
        assert "await db." not in body, "resolver must not hit DB"


def test_resolver_scores_closed_window_over_open():
    """When multiple entries match, prefer the one with both bounds
    set (tighter window) over an open-ended active one."""
    m = re.search(r"# Score: closed windows.*?tightest match", FLEET_FUEL, flags=re.DOTALL)
    assert m


def test_resolver_returns_none_on_no_match():
    assert "if not candidates:" in FLEET_FUEL
    m = re.search(r"if not candidates:\s*\n\s*return None", FLEET_FUEL)
    assert m


def test_index_loader_only_reads_active_workers():
    """`_load_card_worker_index` must filter `deleted_at: None` +
    require the worker to actually have cards linked."""
    m = re.search(r"async def _load_card_worker_index\(org_id.*?\)\s*->\s*dict:.*?return index",
                  FLEET_FUEL, flags=re.DOTALL)
    assert m, "index loader body not found"
    body = m.group(0)
    assert '"deleted_at": None' in body
    assert '"smartfill_card_numbers": {"$exists": True, "$ne": []}' in body


# ── Insert-time resolution ──────────────────────────────────────
def test_import_preloads_card_index_once():
    """The batch loop must call `_load_card_worker_index` ONCE per
    org, before the row loop. Not per-row (would be O(rows) DB hits)."""
    assert "_card_index = await _load_card_worker_index(org_id)" in FLEET_FUEL


def test_insert_doc_carries_resolved_driver_name():
    """New fuel_transactions docs must set `resolved_driver_name`
    (and `_worker_id`) at insert time."""
    assert '"resolved_driver_name": (' in FLEET_FUEL
    assert '"resolved_driver_worker_id": (' in FLEET_FUEL


def test_upsert_fills_resolved_name_when_card_arrives():
    """When an upsert fills a previously-null card_number, the
    resolver must fire against the merged doc."""
    m = re.search(r"merged_card =.*?resolve_driver_by_card\(",
                  FLEET_FUEL, flags=re.DOTALL)
    assert m, "upsert resolver hook missing"


# ── Report layer ────────────────────────────────────────────────
def test_report_prefers_resolved_over_csv_driver():
    """Per-employee rollup key selector: prefer resolved_driver_name,
    then csv `driver`, then `Card N (unlinked)` fallback."""
    m = re.search(r'if scope == "employee":\s*\n\s*.*?resolved = \(t\.get\("resolved_driver_name"\)',
                  FLEET_FUEL_REPORTS, flags=re.DOTALL)
    assert m, "employee scope must consult resolved_driver_name first"


def test_report_labels_unlinked_cards():
    assert 'f"Card {card} (unlinked)"' in FLEET_FUEL_REPORTS


def test_report_projection_pulls_card_and_resolved_fields():
    """Reports must project the new fields — otherwise the resolver
    key selector always falls through to `(no driver)`."""
    m = re.search(r'projection = \{(.*?)\}\s*\n\s*txs = \[',
                  FLEET_FUEL_REPORTS, flags=re.DOTALL)
    assert m, "reports projection block not found"
    projection = m.group(1)
    assert '"card_number": 1' in projection
    assert '"resolved_driver_name": 1' in projection


# ── Backfill script ─────────────────────────────────────────────
def test_backfill_script_dry_run_default():
    """Backfill must default to dry-run so accidental runs don't
    silently mutate a whole tenant."""
    assert '"--commit", action="store_true"' in BACKFILL
    assert 'commit=args.commit' in BACKFILL
    m = re.search(r"if commit:\s*\n.*?await db\.fuel_transactions\.update_one",
                  BACKFILL, flags=re.DOTALL)
    assert m


def test_backfill_script_idempotent_skip_when_unchanged():
    """If the doc already has the exact resolved name AND the exact
    computed_price, skip the write — otherwise re-running would bump
    `updated_at` for no reason."""
    m = re.search(r"# Only write if the doc actually changes\.", BACKFILL)
    assert m
    m2 = re.search(r"if not updates:\s*\n\s*continue", BACKFILL)
    assert m2


def test_backfill_records_unresolved_cards_summary():
    """Admins need visibility into which card numbers HAVE txns but
    aren't linked to any worker — so they know what to link."""
    assert 'unresolved: dict[str, int] = {}' in BACKFILL
    assert 'unresolved[card] = unresolved.get(card, 0) + 1' in BACKFILL


# ── Frontend section ────────────────────────────────────────────
def test_frontend_section_component_exists():
    assert 'export default function SmartFillCardsSection' in FE_SECTION


def test_frontend_section_wires_all_three_endpoints():
    assert "/workers/${workerId}/smartfill-cards" in FE_SECTION
    assert "api.get(" in FE_SECTION
    assert "api.post(" in FE_SECTION
    assert "api.delete(" in FE_SECTION


def test_frontend_section_gated_by_canedit_for_writes():
    """Read is always allowed (viewer). Add + Remove must be gated
    by `canEdit` so contractor-rep-with-workers.view can't touch."""
    assert "{canEdit && !adding && (" in FE_SECTION  # Add card button
    assert "{canEdit && (" in FE_SECTION            # Remove button


def test_frontend_section_wired_into_modal():
    assert "import SmartFillCardsSection from './SmartFillCardsSection'" in FE_MODAL
    assert "<SmartFillCardsSection workerId={workerId} canEdit={canManageWorker} />" in FE_MODAL


def test_frontend_section_has_stable_testids():
    """FE test coverage / support docs pin these — keep them stable."""
    for tid in (
        'data-testid="view-section-smartfill-cards"',
        'data-testid="smartfill-card-add-toggle"',
        'data-testid="smartfill-card-add-form"',
        'data-testid="smartfill-card-input-number"',
        'data-testid="smartfill-card-submit"',
        'data-testid="smartfill-cards-list"',
    ):
        assert tid in FE_SECTION, f"missing testid: {tid}"


# ── Version pin ─────────────────────────────────────────────────
def test_version_at_least_132q4():
    txt = _read("frontend/src/lib/version.js")
    # v58.13.132r bumped to `.132r` (superset of the .132q4 baseline).
    assert re.search(r"paneltec-v160\.3\.9\.58\.13\.132(q4|r|s|t)", txt) or \
           re.search(r"paneltec-v160\.3\.9\.58\.13\.13[3-9]", txt), \
           "RUNNING_VERSION not at .132q4 or newer"


# ── v58.13.131o (post-ship amendment) — computed_price_per_litre ─
def test_compute_price_helper_normal_case():
    """$622.38 / 207.460 L = $3.000 (user's actual example)."""
    from backend import fleet_fuel as ff  # type: ignore
    assert ff._compute_price_per_litre(622.38, 207.460) == 3.000


def test_compute_price_helper_returns_none_on_missing_total():
    from backend import fleet_fuel as ff  # type: ignore
    assert ff._compute_price_per_litre(None, 45.5) is None
    assert ff._compute_price_per_litre("", 45.5) is None


def test_compute_price_helper_returns_none_on_zero_litres():
    """No div-by-zero crash on zero-litre rows (rare but possible on
    a pump miscount or a receipt-only reconciliation row)."""
    from backend import fleet_fuel as ff  # type: ignore
    assert ff._compute_price_per_litre(100.0, 0) is None
    assert ff._compute_price_per_litre(100.0, 0.0) is None
    assert ff._compute_price_per_litre(100.0, None) is None
    assert ff._compute_price_per_litre(100.0, -5) is None


def test_compute_price_helper_returns_none_on_junk():
    from backend import fleet_fuel as ff  # type: ignore
    assert ff._compute_price_per_litre("junk", 10) is None
    assert ff._compute_price_per_litre(10, "junk") is None


def test_insert_doc_carries_computed_price_per_litre():
    """New fuel_transactions docs must set the computed price at
    insert time, so downstream (reports + AssetDrawer) don't need
    to fall back to ad-hoc math."""
    assert '"computed_price_per_litre": _compute_price_per_litre(total_price, litres)' in FLEET_FUEL


def test_upsert_refreshes_computed_price_when_total_price_filled():
    """When an upsert fills `total_price` on a previously-null row,
    the amendment must recompute the price."""
    m = re.search(
        r"merged_total = updates\.get\(\"total_price\", dup\.get\(\"total_price\"\)\).*?"
        r"new_cpl = _compute_price_per_litre",
        FLEET_FUEL, flags=re.DOTALL,
    )
    assert m, "upsert cpl-refresh hook missing"


def test_r7_uses_computed_price_first_with_ad_hoc_fallback():
    """R7 procurement outlier must prefer the stored
    computed_price_per_litre; only fall back to total_price/litres
    for pre-.131o rows that haven't been backfilled yet."""
    m = re.search(
        r"dpl = r\.get\(\"computed_price_per_litre\"\).*?"
        r"if dpl is None:\s*\n\s*dpl = price / litres",
        FLEET_FUEL, flags=re.DOTALL,
    )
    assert m, "R7 must consult computed_price_per_litre first"


def test_backfill_script_also_populates_computed_price():
    """The backfill run must ALSO populate computed_price_per_litre
    on legacy 1348 rows so the FE / reports show consistent numbers
    without waiting for the next re-import."""
    assert '_compute_price_per_litre(tx.get("total_price"), tx.get("litres"))' in BACKFILL
    assert 'updates["computed_price_per_litre"] = cpl' in BACKFILL


def test_backfill_all_orgs_finds_price_backfill_candidates():
    """`--all-orgs` must include orgs with fuel data even if no
    cards are linked yet (otherwise the price backfill silently
    skips them)."""
    m = re.search(
        r'db\.fuel_transactions\.find\(\s*\{"deleted_at": None,\s*'
        r'"computed_price_per_litre": \{"\$exists": False\}',
        BACKFILL, flags=re.DOTALL,
    )
    assert m, "orgs list must also include fuel-txn orgs missing computed_price"


def test_raw_unit_price_preserved_for_audit():
    """The raw `unit_price` field from SmartFill is preserved on the
    doc for audit. It is NEVER used for display / R7 math."""
    assert '"unit_price": unit_price,' in FLEET_FUEL
    # But it must not be part of R7's projection or math.
    r7_m = re.search(r"async def _reflag_procurement_outliers.*?ranked\.sort",
                     FLEET_FUEL, flags=re.DOTALL)
    assert r7_m, "R7 body not found"
    r7_body = r7_m.group(0)
    assert '"unit_price"' not in r7_body, "R7 must not consult raw unit_price"

