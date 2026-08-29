"""v58.13.62 — P0 security fixes: hardcoded secrets + silent catches.

Guards for the three surface changes shipped in this bundle:

  1. `backend/seed_stephen.py` reads its admin password from
     `SEED_STEPHEN_PASSWORD` env and fails loud if missing.
  2. `backend/scripts/live_bulk_import_dryrun.py` reads its login
     credentials from `PANELTEC_TEST_EMAIL` / `PANELTEC_TEST_PASSWORD`
     env and fails loud if either is missing.
  3. `frontend/src/serviceWorkerRegistration.js` now has diagnostic
     logging in at least 3 of the previously silent `.catch` blocks.

Static / AST-only inspection — never executes the scripts (we don't
want to import `auth.hash_password` from a unit test, and we don't
have a live backend to talk to for the dry-run driver).
"""
from __future__ import annotations

import ast
import re
from pathlib import Path


_BACKEND = Path("/app/backend")
_FRONTEND = Path("/app/frontend")
_SEED = _BACKEND / "seed_stephen.py"
_DRYRUN = _BACKEND / "scripts" / "live_bulk_import_dryrun.py"
_SW_REG = _FRONTEND / "src" / "serviceWorkerRegistration.js"


# ── 1. seed_stephen.py ──────────────────────────────────────────────


def test_seed_stephen_has_import_os():
    tree = ast.parse(_SEED.read_text(encoding="utf-8"))
    imported = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for a in node.names:
                imported.add(a.name)
    assert "os" in imported, (
        "seed_stephen.py missing `import os` — the v58.13.62 "
        "hardcoded-password fix references `os.getenv` and needs it"
    )


def test_seed_stephen_password_from_env_only():
    src = _SEED.read_text(encoding="utf-8")
    # No literal `PASSWORD = "..."` or `PASSWORD = '...'` allowed.
    lit_re = re.compile(r"^PASSWORD\s*=\s*['\"]", re.MULTILINE)
    hits = lit_re.findall(src)
    assert not hits, (
        f"seed_stephen.py has a literal PASSWORD assignment: {hits!r} "
        "— v58.13.62 requires env-only credential loading"
    )
    assert 'os.getenv("SEED_STEPHEN_PASSWORD")' in src, (
        "seed_stephen.py must read SEED_STEPHEN_PASSWORD via os.getenv"
    )


def test_seed_stephen_fails_loud_on_missing_env():
    src = _SEED.read_text(encoding="utf-8")
    # Fail-loud sentinel — SystemExit / raise on missing env.
    assert "SEED_STEPHEN_PASSWORD env var required" in src, (
        "seed_stephen.py must fail loud (SystemExit) when the env "
        "variable is missing so silent fallbacks can't ship"
    )
    assert "raise SystemExit" in src


# ── 2. scripts/live_bulk_import_dryrun.py ───────────────────────────


def test_dryrun_driver_has_import_os():
    tree = ast.parse(_DRYRUN.read_text(encoding="utf-8"))
    imported = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for a in node.names:
                imported.add(a.name)
    assert "os" in imported


def test_dryrun_driver_credentials_from_env_only():
    src = _DRYRUN.read_text(encoding="utf-8")
    # No literal `EMAIL = "some@thing"` or `PASSWORD = "..."`.
    for key in ("EMAIL", "PASSWORD"):
        lit_re = re.compile(rf"^{key}\s*=\s*['\"]", re.MULTILINE)
        hits = lit_re.findall(src)
        assert not hits, (
            f"live_bulk_import_dryrun.py has literal {key} assignment "
            f"{hits!r} — v58.13.62 requires env-only credentials"
        )
    assert 'os.getenv("PANELTEC_TEST_EMAIL")' in src
    assert 'os.getenv("PANELTEC_TEST_PASSWORD")' in src


def test_dryrun_driver_fails_loud_on_missing_env():
    src = _DRYRUN.read_text(encoding="utf-8")
    assert (
        "PANELTEC_TEST_EMAIL and PANELTEC_TEST_PASSWORD env vars required"
        in src
    ), "dry-run driver must fail loud when either env var is missing"
    assert "raise SystemExit" in src


# ── 3. serviceWorkerRegistration.js diagnostics ─────────────────────


def test_sw_registration_catches_have_logging():
    src = _SW_REG.read_text(encoding="utf-8")
    # We keep 4 intentional-silent catches (session-storage writes,
    # SKIP_WAITING postMessage, controllerchange marker, defensive
    # setInterval guard). The 4 formerly-silent catches must now
    # carry an actual console log with an error argument.
    logged = re.findall(r"console\.(warn|debug)\(\[?'\[sw\]", src)
    assert len(logged) >= 3, (
        f"serviceWorkerRegistration.js should have ≥3 `console.warn`/"
        f"`console.debug` diagnostics in its formerly silent catches; "
        f"found {len(logged)}"
    )
    # Sanity: register failure specifically must not be silent anymore.
    assert "console.warn('[sw] register failed'" in src, (
        "The top-level `navigator.serviceWorker.register(...).catch(...)` "
        "must log the failure so we can see it in browser devtools"
    )


# ── 4. Version-sync (forward-safe) ──────────────────────────────────


def test_version_sync_moved_past_v58_13_61():
    v_js = Path("/app/frontend/src/lib/version.js").read_text(encoding="utf-8")
    m_ts = Path("/app/mobile/src/lib/version.ts").read_text(encoding="utf-8")
    sw_js = Path(
        "/app/frontend/public/service-worker.js"
    ).read_text(encoding="utf-8")
    assert "RUNNING_VERSION = 'paneltec-v160.3.9.58.13.61'" not in v_js
    assert "'paneltec-v160.3.9.58.13.61'" not in m_ts
    assert "'paneltec-v160.3.9.58.13.61'" not in sw_js
    assert "v160.3.9.58.13.62" in v_js
