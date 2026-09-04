"""v58.13.100 — Asset taxonomy reconciliation: `kind` is source of truth.

Source-scan tests + snapshot artifact verification. Matches the pattern
established by prior ships (.98 / .97 / .99): regex against JS + Python
source so a future edit that reintroduces the misclassification / bad
badge count / wrong chip label fails CI immediately.

Runtime DB-mutation proof is captured in the ship report (dry-run →
commit → idempotency check, all logged to stdout with counts). This
pytest guards the STRUCTURE of the fix.
"""
from __future__ import annotations
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
MOBILE = ROOT / "mobile"
MEMORY = ROOT / "memory"

RECONCILE_SCRIPT = (
    BACKEND / "scripts" / "analysis" / "reconcile_asset_taxonomy_v58_13_100.py"
).read_text(encoding="utf-8")
PLANT_VEHICLES_JSX = (FRONTEND / "src" / "pages" / "PlantVehicles.jsx").read_text(encoding="utf-8")
PLANT_MAINT_JSX = (FRONTEND / "src" / "pages" / "PlantMaintenanceTab.jsx").read_text(encoding="utf-8")
VERSION_JS = (FRONTEND / "src" / "lib" / "version.js").read_text(encoding="utf-8")
SW_JS = (FRONTEND / "public" / "service-worker.js").read_text(encoding="utf-8")
MOBILE_TS = (MOBILE / "src" / "lib" / "version.ts").read_text(encoding="utf-8")

SNAPSHOT_PATH = MEMORY / "asset_taxonomy_reconciliation_v58_13_100.json"


# ── Reconciliation script structural pins ────────────────────────

def test_reconcile_script_exists():
    assert RECONCILE_SCRIPT, "reconcile_asset_taxonomy_v58_13_100.py is missing"


def test_reconcile_script_defines_valid_by_kind():
    """Rule table must exist and cover all four `kind` values."""
    assert "VALID_BY_KIND" in RECONCILE_SCRIPT
    for k in ("vehicle", "plant", "tool", "container"):
        assert re.search(
            rf'["\']?{k}["\']?\s*:', RECONCILE_SCRIPT
        ), f"VALID_BY_KIND is missing the {k!r} key"


def test_reconcile_script_accepts_kind_as_asset_type_universally():
    """Post-reconciliation state (asset_type = kind) MUST be considered
    valid by the rule table, otherwise the invariant re-check after
    commit will falsely fail and future re-runs will loop."""
    # Each of the four kind sets must literally union with its own kind
    # string.
    for k in ("vehicle", "plant", "tool", "container"):
        assert re.search(
            rf'["\']?{k}["\']?\s*:.*\{{["\']?{k}["\']?\}}',
            RECONCILE_SCRIPT,
        ), f"VALID_BY_KIND[{k!r}] must include the literal {k!r} value"


def test_reconcile_script_snapshot_path_pinned():
    assert (
        '/app/memory/asset_taxonomy_reconciliation_v58_13_100.json'
        in RECONCILE_SCRIPT
    ), "snapshot path must be pinned to /app/memory/…_v58_13_100.json"


def test_reconcile_script_has_dry_and_commit_modes():
    assert "--dry-run" in RECONCILE_SCRIPT
    assert "--commit" in RECONCILE_SCRIPT
    # And they're wired into the argparse mutex group.
    assert "add_mutually_exclusive_group" in RECONCILE_SCRIPT


def test_reconcile_script_stamps_marker():
    """Every updated doc must carry a `reconciliation_v58_13_100` marker
    with `previous_asset_type` + `reconciled_at`. This is the rollback
    breadcrumb + the double-run guard."""
    assert re.search(
        r'"reconciliation_v58_13_100"\s*:\s*\{',
        RECONCILE_SCRIPT,
    )
    assert '"previous_asset_type"' in RECONCILE_SCRIPT
    assert '"reconciled_at"' in RECONCILE_SCRIPT


def test_reconcile_script_kind_is_truth():
    """The one-line summary of the ship: on write, `asset_type = kind`.
    If someone rewrites this line to source from asset_type OR from the
    Navixy classifier the reconciliation is no longer "kind is truth"."""
    assert re.search(
        r'new_asset_type\s*=\s*existing\.get\("kind"\)',
        RECONCILE_SCRIPT,
    ), "reconciliation must set asset_type from kind, not from anywhere else"


def test_reconcile_script_verifies_invariant_post_commit():
    """After committing, the script MUST rescan and assert zero
    remaining mismatches. Otherwise a bad rule change could silently
    leave the DB in a half-reconciled state."""
    assert re.search(
        r'remaining\s*=\s*await\s+find_mismatches\(\)[\s\S]{0,200}?assert\s+not\s+remaining',
        RECONCILE_SCRIPT,
    ), "post-commit invariant re-check is missing"


# ── Snapshot artifact ────────────────────────────────────────────

def test_snapshot_file_exists():
    """The reconciliation must have been RUN on this environment before
    the ship closes. Missing snapshot = migration wasn't executed."""
    assert SNAPSHOT_PATH.exists(), (
        f"snapshot missing at {SNAPSHOT_PATH} — script was never committed"
    )


def test_snapshot_has_committed_marker():
    payload = json.loads(SNAPSHOT_PATH.read_text(encoding="utf-8"))
    assert payload.get("ship") == "v58.13.100"
    assert payload.get("committed_at"), (
        "snapshot exists but committed_at is unset — dry-run only, "
        "the commit step was never run"
    )
    assert isinstance(payload.get("count"), int)
    assert isinstance(payload.get("rows"), list)


def test_snapshot_preserves_rollback_data():
    """Snapshot must carry pre-migration id + org_id + kind +
    previous asset_type for every affected row so a manual rollback
    is possible without inference."""
    payload = json.loads(SNAPSHOT_PATH.read_text(encoding="utf-8"))
    rows = payload.get("rows") or []
    if not rows:
        # Zero-mismatch snapshot is legal (idempotent re-run against a
        # cleaned DB).
        return
    r = rows[0]
    for key in ("id", "org_id", "kind", "asset_type"):
        assert key in r, f"snapshot row missing {key!r} — rollback unsafe"


# ── Frontend: PlantVehicles.jsx Tab 3 badge count ─────────────────

def test_plant_vehicles_tab3_count_filters_by_kind_vehicle():
    """The "Vehicles from Navixy" tab badge MUST filter by
    `kind === 'vehicle'`. The pre-.100 form was `{assets.length}`
    which showed the full kind-chip filter result — misleading given
    the tab label."""
    m = re.search(
        r'data-testid="vehicles-tab-list-count"[\s\S]{0,300}?'
        r'assets\.filter\(\s*\(\s*a\s*\)\s*=>\s*a\.kind\s*===\s*[\'"]vehicle[\'"]\s*\)\s*\.length',
        PLANT_VEHICLES_JSX,
    )
    assert m, (
        "Tab 3 badge count does not filter by kind === 'vehicle' — "
        "the .100 fix would be missing or reverted"
    )


def test_plant_vehicles_tab3_no_bare_assets_length():
    """Regression guard: the exact `{assets.length}` string must NOT
    appear inside the vehicles-tab-list-count span. This is the pre-.100
    bug pattern."""
    m = re.search(
        r'data-testid="vehicles-tab-list-count"[\s\S]{0,150}?\{assets\.length\}',
        PLANT_VEHICLES_JSX,
    )
    assert not m, (
        "Tab 3 badge still contains the bare `{assets.length}` from "
        "pre-.100 — this reintroduces the 246-vs-72 miscount"
    )


# ── Frontend: PlantMaintenanceTab chip labels ─────────────────────

def test_pm_chip_labels_use_colon_form():
    """Chip labels changed from `Matched (N)` → `Matched: N`. The colon
    form is unambiguous; the parens form was misread as a competing
    "unmatched-only" annotation. Same numbers, different separator."""
    assert re.search(
        r"label:\s*`Matched:\s*\$\{items\.length\s*-\s*unmatched\.total_unmatched_rows\}`",
        PLANT_MAINT_JSX,
    ), "Matched chip label doesn't use the colon form"
    assert re.search(
        r"label:\s*`Unmatched:\s*\$\{unmatched\.total_unmatched_rows\}`",
        PLANT_MAINT_JSX,
    ), "Unmatched chip label doesn't use the colon form"
    assert re.search(
        r"label:\s*`All:\s*\$\{items\.length\}`",
        PLANT_MAINT_JSX,
    ), "All chip label doesn't use the colon form"


def test_pm_chip_labels_no_bare_paren_form():
    """Regression guard: the pre-.100 pattern `` `Matched (${...})` ``
    must be gone from the pm-plant-toggle block."""
    m = re.search(
        r'data-testid="pm-plant-toggle"[\s\S]{0,600}?`Matched\s*\(',
        PLANT_MAINT_JSX,
    )
    assert not m, (
        "PlantMaintenanceTab still uses `Matched (N)` parens form — "
        "revert of the .100 chip-label change"
    )


def test_pm_chip_testids_preserved():
    """testids must not change so any existing smoke / e2e coverage
    against `pm-filter-matched` etc. keeps working. Source form is the
    template literal `pm-filter-${opt.k}` which renders as
    `pm-filter-all|matched|unmatched` at runtime."""
    assert "pm-filter-${opt.k}" in PLANT_MAINT_JSX, (
        "pm-filter-${opt.k} template literal missing — the chip testids "
        "would silently change and break existing e2e / smoke coverage"
    )
    # And the three keys still exist in the chip config so the runtime
    # ids resolve to their stable values.
    for k in ("'all'", "'matched'", "'unmatched'"):
        assert re.search(rf"\{{\s*k:\s*{k}\s*,", PLANT_MAINT_JSX), (
            f"pm chip config missing key {k}"
        )


# ── Backend endpoint consistency ─────────────────────────────────

def test_no_backend_endpoint_filters_vehicles_by_asset_type_literal():
    """No .py file under /app/backend may HARDCODE a mongo query that
    filters `assets` by `asset_type == 'vehicle'` for vehicle-scoped
    logic. Vehicle-scoped logic sources from `kind` per the .100
    reconciliation. The `_classify_vehicle_type` helper still returns
    granular asset_type slugs — that's a different code path (Navixy
    ingest classification), not a filter."""
    forbidden = re.compile(
        r'\{[^}]*"asset_type"\s*:\s*"vehicle"[^}]*\}'
    )
    offenders = []
    for py in BACKEND.rglob("*.py"):
        if "scripts" in py.parts:
            continue  # migration scripts are allowed to reference the value
        text = py.read_text(encoding="utf-8", errors="ignore")
        if forbidden.search(text):
            offenders.append(str(py.relative_to(BACKEND)))
    assert not offenders, (
        f"backend endpoints filter by asset_type='vehicle': {offenders}. "
        "Per v58.13.100 the source of truth is `kind`, not `asset_type`."
    )


def test_asset_service_recommends_forms_by_kind_not_asset_type():
    """Anchor the specific vehicle/plant form-recommendation branch to
    `kind == 'vehicle'` (not `asset_type == …`). Regression guard for
    a future refactor that could plausibly switch the filter."""
    asset_service = (BACKEND / "asset_service.py").read_text(encoding="utf-8")
    assert re.search(
        r'kind\s*==\s*"vehicle"[\s\S]{0,120}?cat\s+in\s+\{',
        asset_service,
    ), (
        "asset_service.py's form-recommendation branch no longer keys "
        "on `kind == 'vehicle'` — this would leak the vehicle-scoped "
        "recommendation to plant/tool/container assets"
    )


# ── Version-sync forward-safe pin >= 100 ─────────────────────────

def _tail(text, name):
    m = re.search(rf"{name}\s*=\s*['\"]paneltec-v[\d.]+\.(\d+)[a-z]*['\"]", text)
    assert m, f"could not read tail of {name}"
    return int(m.group(1))


def test_running_version_gte_100():
    assert _tail(VERSION_JS, "RUNNING_VERSION") >= 100


def test_cache_version_gte_100():
    assert _tail(SW_JS, "CACHE_VERSION") >= 100


def test_mobile_bundle_version_gte_100():
    assert _tail(MOBILE_TS, "MOBILE_BUNDLE_VERSION") >= 100
