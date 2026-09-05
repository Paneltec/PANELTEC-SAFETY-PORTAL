"""v58.13.120e — Phase 5 cleanup: retire legacy PM endpoints,
delete legacy frontend files, move XLSX importer to Settings,
convert `LegacyVehiclesRedirect` into a permanent shim with a
self-cleaning toast expiry.

Locks:
  · `backend/plant_maintenance.py` retires four dead endpoints
    (`/orphan-count`, `/` list, `/unmatched`, `/grouped`) and keeps
    `{uid}` GET/PATCH/DELETE + `/reimport` POST.
  · Four legacy frontend files no longer exist on disk and are no
    longer imported anywhere:
      · `pages/PlantVehicles.jsx`
      · `pages/PlantMaintenanceTab.jsx`
      · `components/vehicles/PlantMaintenanceDrawer.jsx`
      · `components/vehicles/PurgeTestDataModal.jsx`
    The `components/vehicles/` directory is fully removed.
  · New page `pages/settings/AdminImports.jsx` exists and wraps the
    unchanged `POST /plant-maintenance/reimport` endpoint.
  · `App.js` registers `/app/settings/imports` and no longer
    imports `PlantVehicles`.
  · `LegacyVehiclesRedirect` is retained indefinitely (user policy
    call). `FLEET_GRACE_ENDS_AT` is replaced with
    `TOAST_EXPIRES_AT = '2026-10-04T00:00:00Z'` — the redirect
    itself never expires, only its user-facing toast does.
"""
from __future__ import annotations
import re
from pathlib import Path

PM_PY = Path("/app/backend/plant_maintenance.py").read_text()
APP_JS = Path("/app/frontend/src/App.js").read_text()
IMPORTS_PAGE = Path("/app/frontend/src/pages/settings/AdminImports.jsx").read_text()


# ── Backend: retired endpoints ────────────────────────────────────
def test_dead_pm_endpoints_removed():
    """The four dead endpoints must no longer exist as `@router.get`
    definitions. Retirement note is source-pinned so a future
    reader can grep for `v58.13.120e — Retired`."""
    for retired in ('/orphan-count', '/unmatched', '/grouped'):
        assert f'@router.get("{retired}")' not in PM_PY, (
            f"retired endpoint still defined: {retired}"
        )
    # The bare list endpoint `@router.get("/")` is retired too.
    assert '@router.get("/")' not in PM_PY
    # Retirement note is present.
    assert 'v58.13.120e — Retired four dead endpoints' in PM_PY


def test_kept_pm_endpoints_still_defined():
    """The single-row + reimport surface stays wired for the Fleet
    Register + AdminImports page."""
    assert '@router.get("/{uid}")' in PM_PY
    assert '@router.patch("/{uid}")' in PM_PY
    assert '@router.delete("/{uid}")' in PM_PY
    assert '@router.post("/reimport"' in PM_PY


# ── Frontend: legacy files deleted ────────────────────────────────
def test_legacy_frontend_files_deleted():
    for p in (
        "/app/frontend/src/pages/PlantVehicles.jsx",
        "/app/frontend/src/pages/PlantMaintenanceTab.jsx",
        "/app/frontend/src/components/vehicles/PlantMaintenanceDrawer.jsx",
        "/app/frontend/src/components/vehicles/PurgeTestDataModal.jsx",
    ):
        assert not Path(p).exists(), f"legacy file still exists: {p}"
    # And the containing directory is gone.
    assert not Path("/app/frontend/src/components/vehicles").exists()


def test_no_lingering_imports_of_deleted_files():
    """A repo-wide grep confirms no `import` / `from` line still
    references the deleted modules. Comments and version-file
    changelog mentions are allowed."""
    import subprocess
    r = subprocess.run(
        ["grep", "-rln",
         "-E", r"^\s*import.*(PlantVehicles|PlantMaintenanceTab|PlantMaintenanceDrawer|PurgeTestDataModal)",
         "/app/frontend/src/"],
        capture_output=True, text=True,
    )
    assert r.returncode == 1, f"lingering imports found:\n{r.stdout}"


# ── New Settings → Imports page ───────────────────────────────────
def test_admin_imports_page_exists_and_uses_reimport():
    assert IMPORTS_PAGE, "AdminImports.jsx missing"
    assert 'export default function AdminImports' in IMPORTS_PAGE
    assert "api.post('/plant-maintenance/reimport', fd" in IMPORTS_PAGE
    # Permission-gated via existing Can wrapper.
    assert 'resource="assets" action="edit"' in IMPORTS_PAGE
    # Testids for the new page.
    for tid in ('admin-imports-page', 'admin-imports-file-input',
                'admin-imports-submit', 'admin-imports-back-to-fleet'):
        assert f'data-testid="{tid}"' in IMPORTS_PAGE


def test_app_js_registers_settings_imports_route():
    assert 'import AdminImports from \'@/pages/settings/AdminImports\';' in APP_JS
    assert '<Route path="settings/imports" element={<AdminImports />} />' in APP_JS


# ── App.js: PlantVehicles fully unwired ──────────────────────────
def test_app_js_no_plant_vehicles_import_or_route():
    # Import line gone (comment mentions are fine).
    assert 'import PlantVehicles' not in APP_JS
    # No live route to PlantVehicles component.
    assert 'element={<PlantVehicles' not in APP_JS


# ── LegacyVehiclesRedirect retained indefinitely + toast expires ──
def test_legacy_redirect_retained_indefinitely():
    assert 'function LegacyVehiclesRedirect()' in APP_JS
    assert '<Route path="vehicles" element={<LegacyVehiclesRedirect />} />' in APP_JS
    assert '<Route path="vehicles/*" element={<LegacyVehiclesRedirect />} />' in APP_JS
    # FLEET_GRACE_ENDS_AT is retired — replaced by an
    # "indefinitely retained" comment. Only the LIVE definition
    # is banned; historical comment mentions are fine.
    assert 'export const FLEET_GRACE_ENDS_AT' not in APP_JS
    assert 'retained indefinitely' in APP_JS


def test_toast_expires_at_constant_present():
    assert "export const TOAST_EXPIRES_AT = '2026-10-04T00:00:00Z';" in APP_JS
    # The toast fire is gated on the current date being before the expiry.
    assert 'nowIso < TOAST_EXPIRES_AT' in APP_JS


# ── Version pin ───────────────────────────────────────────────────
_TAIL_RE = re.compile(r"58\.13\.(\d+)([a-z]?)(\d*)")


def test_version_bumps_meet_120e():
    for label, path in (
        ("frontend/version.js", "/app/frontend/src/lib/version.js"),
        ("service-worker.js", "/app/frontend/public/service-worker.js"),
        ("mobile/version.ts", "/app/mobile/src/lib/version.ts"),
    ):
        blob = Path(path).read_text()
        matches = _TAIL_RE.findall(blob)
        parsed = [(int(n), letter, int(sub or "0"))
                  for (n, letter, sub) in matches]
        assert parsed, f"{label} has no 58.13.<tail> version"
        highest = max(parsed)
        assert highest >= (120, "e", 0), (
            f"{label} latest tail={highest} < (120, 'e', 0)"
        )
