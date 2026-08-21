"""v58.13.10 — Smoke checks for SW auto-activate + version bump propagation.

Grep-verifies the three properties that need to hold in
`frontend/public/service-worker.js` for new bundles to reach every open
tab on next reload without manual unregister:

1. `self.skipWaiting()` — install handler must call it so the incoming
   SW leaves the "waiting" state immediately.
2. `self.clients.claim()` — activate handler must call it so the new
   SW takes control of already-open pages without a full close.
3. `paneltec_sw_force_reload` broadcast — activate handler must
   postMessage every window client so the page-side listener in
   `serviceWorkerRegistration.js` fires `location.reload()` exactly
   once per new version (sessionStorage-guarded).

These three, together with the page-side listener + `updatefound` /
`controllerchange` handling in `serviceWorkerRegistration.js`, are what
make version bumps propagate. This smoke is a static check only —
runtime SW behaviour is not reachable from pytest.
"""
from __future__ import annotations

from pathlib import Path

SW = Path("/app/frontend/public/service-worker.js")
SW_REG = Path("/app/frontend/src/serviceWorkerRegistration.js")


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def test_service_worker_skip_waiting_on_install():
    src = _read(SW)
    # There are two legitimate call sites: unconditional inside
    # `install`, and inside the `SKIP_WAITING` message handler. Both
    # must remain.
    assert src.count("self.skipWaiting()") >= 2, (
        "service-worker.js must call self.skipWaiting() in the "
        "install handler AND in the SKIP_WAITING message handler."
    )


def test_service_worker_clients_claim_on_activate():
    src = _read(SW)
    assert "self.clients.claim()" in src, (
        "service-worker.js must call self.clients.claim() on activate."
    )


def test_service_worker_broadcasts_force_reload():
    src = _read(SW)
    assert "paneltec_sw_force_reload" in src, (
        "service-worker.js must postMessage a "
        "`paneltec_sw_force_reload` payload to every window client on "
        "activate — this is what unsticks browsers whose old SW was "
        "controlling the tab."
    )


def test_page_side_force_reload_listener_wired():
    src = _read(SW_REG)
    # v96.2 attaches the listener unconditionally at module scope so
    # even browsers that never called `registerServiceWorker` (dev
    # mode, or NODE_ENV != production paths) still pick up the
    # broadcast.
    assert "paneltec_sw_force_reload" in src, (
        "serviceWorkerRegistration.js must handle the "
        "`paneltec_sw_force_reload` message."
    )
    assert "attachForceReloadListener" in src, (
        "The listener is expected to live in "
        "attachForceReloadListener() and be attached at module load."
    )
    assert "window.location.reload()" in src, (
        "The listener must actually reload on the broadcast."
    )
