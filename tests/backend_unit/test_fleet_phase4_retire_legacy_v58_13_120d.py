"""v58.13.120d — Phase 4: retire the legacy /app/vehicles surface.

Locks:
  · `fleet.py::_flag_enabled` defaults to True when the env var is
    missing or empty. Explicit `false`/`0`/`no`/`off` still wins for
    rollback.
  · `App.js` defines `LegacyVehiclesRedirect` that maps
    `/app/vehicles` and `/app/vehicles/*` to `/app/fleet`, preserving
    all query params (notably `?open=<id>`).
  · The redirect fires a one-per-session Sonner toast keyed on
    `fleet_moved_toast_v58_13_120d` with 8s duration and "Learn more"
    action.
  · The `<Route path="vehicles" element={<PlantVehicles />} />`
    entry is retired — the redirect route wins.
  · `AppShell.jsx` sidebar has ZERO "Plant & Vehicles" entries and
    exactly ONE "Fleet & Service Register" entry (nav-fleet).
  · `backend/ask.py::_DEEP_LINK_TEMPLATES` registers `asset` →
    `/app/fleet?open={id}` for Ask Intelligence citations.
  · `App.js` exports `FLEET_GRACE_ENDS_AT = '2026-09-11T00:00:00Z'`
    as the self-documenting Phase 5 kill-date.
"""
from __future__ import annotations
import os
import re
from pathlib import Path

import pytest


FLEET = Path("/app/backend/fleet.py").read_text()
ASK = Path("/app/backend/ask.py").read_text()
APP_JS = Path("/app/frontend/src/App.js").read_text()
SHELL = Path("/app/frontend/src/components/layout/AppShell.jsx").read_text()


# ── Backend feature-flag default flipped ──────────────────────────
def test_flag_default_is_now_true():
    # Missing / empty env var → True.
    assert 'if v is None or v == "":' in FLEET
    assert 'return True' in FLEET
    # Explicit truthy values still supported (rollback path).
    assert '{"1", "true", "yes", "on"}' in FLEET


def test_flag_can_be_disabled_via_env_var(monkeypatch):
    """Confirm the rollback path: explicit env var still overrides."""
    from importlib import reload
    import fleet as fleet_mod
    reload(fleet_mod)
    # Reload picks up env-var reads at request time, so we just check
    # the private helper directly.
    monkeypatch.setenv("FLEET_REGISTER_ENABLED", "false")
    assert fleet_mod._flag_enabled() is False
    monkeypatch.setenv("FLEET_REGISTER_ENABLED", "0")
    assert fleet_mod._flag_enabled() is False
    monkeypatch.setenv("FLEET_REGISTER_ENABLED", "true")
    assert fleet_mod._flag_enabled() is True
    monkeypatch.delenv("FLEET_REGISTER_ENABLED", raising=False)
    assert fleet_mod._flag_enabled() is True   # missing → True


# ── Redirect wire ─────────────────────────────────────────────────
def test_legacy_vehicles_redirect_component_present():
    assert 'function LegacyVehiclesRedirect()' in APP_JS
    # Uses Navigate with `replace`.
    assert '<Navigate to={target} replace />' in APP_JS
    # Preserves `?open=<id>` and every other query param.
    assert 'const qs = sp.toString();' in APP_JS
    assert 'qs ? `/app/fleet?${qs}` : \'/app/fleet\'' in APP_JS


def test_legacy_vehicles_routes_registered():
    # Both bare and wildcard mounts.
    assert '<Route path="vehicles" element={<LegacyVehiclesRedirect />} />' in APP_JS
    assert '<Route path="vehicles/*" element={<LegacyVehiclesRedirect />} />' in APP_JS
    # And the pre-.120d PlantVehicles route is gone.
    assert '<Route path="vehicles" element={<PlantVehicles />} />' not in APP_JS


def test_toast_fires_once_per_session():
    assert "LEGACY_VEHICLES_TOAST_SESSION_KEY" in APP_JS
    assert "'fleet_moved_toast_v58_13_120d'" in APP_JS
    assert 'sessionStorage.getItem(LEGACY_VEHICLES_TOAST_SESSION_KEY)' in APP_JS
    # 8-second auto-dismiss per user directive.
    assert 'duration: 8000' in APP_JS
    # "Learn more" action wire.
    assert "label: 'Learn more'" in APP_JS


def test_grace_end_constant_exported():
    # v58.13.120e — `FLEET_GRACE_ENDS_AT` was superseded by
    # `TOAST_EXPIRES_AT` (the redirect itself now runs indefinitely;
    # only the user-facing toast expires).
    assert "export const TOAST_EXPIRES_AT = '2026-10-04T00:00:00Z';" in APP_JS
    # Self-documenting comment mentions Phase 5.
    assert 'Phase 5' in APP_JS


# ── Sidebar: 0 vehicles entries, exactly 1 fleet entry ────────────
def test_sidebar_has_zero_plant_vehicles_and_one_fleet_entry():
    # No live sidebar entry named "Plant & Vehicles" (comments allowed).
    label_hits = 0
    for line in SHELL.splitlines():
        stripped = line.lstrip()
        if stripped.startswith('//') or stripped.startswith('*'):
            continue
        if "label: 'Plant & Vehicles'" in line:
            label_hits += 1
    assert label_hits == 0, f"expected 0 Plant & Vehicles sidebar entries, found {label_hits}"
    # Exactly one Fleet & Service Register entry.
    fleet_hits = SHELL.count("label: 'Fleet & Service Register'")
    assert fleet_hits == 1, f"expected 1 Fleet entry, found {fleet_hits}"
    # And the retired testid is gone from live JSX.
    live_only = "\n".join(l for l in SHELL.splitlines()
                           if not l.lstrip().startswith('//'))
    assert "testid: 'nav-vehicles'" not in live_only
    assert "testid: 'nav-fleet'" in live_only


# ── Ask Intelligence `asset` deep-link ────────────────────────────
def test_ask_intelligence_asset_deep_link_registered():
    assert '"asset":' in ASK
    assert '"/app/fleet?open={id}"' in ASK


# ── Hard-coded /app/vehicles references (limited scan) ────────────
def test_no_user_facing_hardlinks_to_old_vehicles_route():
    """A tight regression: no user-clickable button / link should
    hard-code `/app/vehicles` in the parts of the codebase we
    explicitly cleaned up. Legacy references inside PlantVehicles.jsx
    itself and its retired-in-Phase-5 helpers are still allowed
    since that file is scheduled for deletion on FLEET_GRACE_ENDS_AT."""
    targets = [
        "/app/frontend/src/pages/Dashboard.jsx",
        "/app/frontend/src/pages/FormAssignmentsAdmin.jsx",
        "/app/frontend/src/lib/appFeatureRegistry.js",
    ]
    for t in targets:
        blob = Path(t).read_text()
        # Only flag JSX / literal string mentions, not comments.
        for line in blob.splitlines():
            stripped = line.lstrip()
            if stripped.startswith('//') or stripped.startswith('*'):
                continue
            assert "'/app/vehicles'" not in line and '"/app/vehicles"' not in line, (
                f"{t}: live reference to /app/vehicles: {stripped[:100]}"
            )


# ── Version bump ──────────────────────────────────────────────────
_TAIL_RE = re.compile(r"58\.13\.(\d+)([a-z]?)(\d*)")


def test_version_bumps_meet_120d():
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
        assert highest >= (120, "d", 0), (
            f"{label} latest tail={highest} < (120, 'd', 0)"
        )
