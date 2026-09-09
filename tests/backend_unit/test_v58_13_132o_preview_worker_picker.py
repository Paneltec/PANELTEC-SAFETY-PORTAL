"""v58.13.132o — Live Preview bug fix + preview-as-worker picker pytests.

Coverage:
  • Backend behavioural: preview-user with worker_id returns a JWT whose
    claims include preview_worker_id + the worker's email; the
    `.user` payload reflects the worker's real name/company; a bad
    worker_id returns 404; workers listing endpoint returns org-scoped
    active workers.
  • Preview session STILL enforces read-only 403 on writes when scoped
    to a worker.
  • Mobile source-pins: every auth screen calls `isPreviewSession` and
    replaces to /(tabs)/home when true; splash forwards
    `preview_worker_id` and honours `?reset=1`.
  • Frontend source-pins: worker dropdown + reset button testids present;
    computeExpoUrl takes a workerId; api.get('/mobile/preview-user/workers')
    call wired.
"""
from __future__ import annotations
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

import jwt
import pytest


# ─────────────── Backend behavioural ───────────────

@pytest.mark.asyncio
async def test_preview_user_worker_scoped_and_read_only_and_workers_feed() -> None:
    """Round-trip:
      1. Seed 2 workers.
      2. Call `mint_preview_user(role_id, worker_id)` — assert JWT claims +
         .user payload reflect the worker's real profile.
      3. Bad worker_id → 404.
      4. `list_preview_workers` returns both seeded workers.
      5. Decode the JWT and verify `preview_mode_read_only` triggers via
         auth.get_current_user's shim (write-block enforced) — done here
         by asserting the payload carries `type=preview`+`preview=True`
         (the block is a request-method branch that's covered by the
         .132j pytest already; we assert the JWT ingredients here).
    """
    from db import db
    from mobile_preview import (
        mint_preview_user, list_preview_workers,
    )
    from auth import JWT_ALGORITHM, _secret
    from fastapi import HTTPException

    tag = uuid.uuid4().hex[:8]
    org_id = f"TEST-132o-{tag}"
    admin = {"id": f"admin-{tag}", "org_id": org_id, "role": "admin"}

    w1_id = f"w1-{tag}"; w2_id = f"w2-{tag}"
    await db.workers.insert_many([
        {"id": w1_id, "org_id": org_id, "email": f"alice-{tag}@paneltec.local",
         "first_name": "Alice", "last_name": "Anders", "position": "Concreter",
         "simpro_company_id": "2", "deleted_at": None},
        {"id": w2_id, "org_id": org_id, "email": f"bob-{tag}@paneltec.local",
         "first_name": "Bob", "last_name": "Brown", "position": "Foreman",
         "simpro_company_id": "3", "deleted_at": None},
    ])
    try:
        # ── Worker-scoped mint ──
        res = await mint_preview_user(
            role_id="worker", worker_id=w1_id, _admin=admin,
        )
        assert res.preview is True
        assert res.worker_scoped is True
        assert res.user["preview_worker_id"] == w1_id
        assert res.user["name"] == "Alice Anders (preview)"
        assert res.user["email"] == f"alice-{tag}@paneltec.local"
        assert res.user["company_id"] == "2"

        # ── Decode JWT and check claims ──
        decoded = jwt.decode(res.token, _secret(), algorithms=[JWT_ALGORITHM])
        assert decoded["type"] == "preview"
        assert decoded["preview"] is True
        assert decoded["preview_worker_id"] == w1_id
        assert decoded["email"] == f"alice-{tag}@paneltec.local"
        assert decoded["role_id"] == "worker"
        assert decoded["org_id"] == org_id
        # 15-min expiry ± some tolerance.
        exp_delta = decoded["exp"] - decoded["iat"]
        assert 14 * 60 <= exp_delta <= 16 * 60

        # ── Non-worker (role-only) mint still works — no worker binding. ──
        res_no_worker = await mint_preview_user(
            role_id="admin", worker_id=None, _admin=admin,
        )
        assert res_no_worker.worker_scoped is False
        assert res_no_worker.user["preview"] is True
        assert "preview_worker_id" not in res_no_worker.user

        # ── Bad worker id → 404 ──
        try:
            await mint_preview_user(
                role_id="worker", worker_id=f"nonexistent-{tag}", _admin=admin,
            )
            raise AssertionError("expected 404 for bad worker_id")
        except HTTPException as e:
            assert e.status_code == 404

        # ── Cross-org isolation: admin in org X cannot preview worker
        #    in org Y. ──
        other_admin = {"id": f"admin-Y-{tag}", "org_id": f"OTHER-{tag}", "role": "admin"}
        try:
            await mint_preview_user(
                role_id="worker", worker_id=w1_id, _admin=other_admin,
            )
            raise AssertionError("expected 404 for cross-org worker preview")
        except HTTPException as e:
            assert e.status_code == 404

        # ── Workers feed ──
        feed = await list_preview_workers(_admin=admin)
        ids = {w.id for w in feed.workers}
        assert w1_id in ids and w2_id in ids
        # Sorted by name — Alice before Bob.
        names = [w.name for w in feed.workers if w.id in {w1_id, w2_id}]
        assert names == ["Alice Anders", "Bob Brown"]
        alice = next(w for w in feed.workers if w.id == w1_id)
        assert alice.company_id == "2"
        assert alice.position == "Concreter"
    finally:
        await db.workers.delete_many({"org_id": org_id})


# ─────────────── auth.get_current_user preview shim honours new claims ───

def test_auth_preview_shim_honours_worker_email_and_id() -> None:
    """Source-pin: `auth.get_current_user`'s preview branch reads
    `preview_worker_id` and `email` from the JWT payload so the synthetic
    user resolves the worker's real data."""
    src = Path("/app/backend/auth.py").read_text()
    branch_start = src.find('if payload.get("type") == "preview"')
    assert branch_start != -1
    # Grab the ~40 lines that make up the branch.
    branch = src[branch_start:branch_start + 2000]
    assert "worker_email = payload.get(\"email\")" in branch
    assert "preview_worker_id = payload.get(\"preview_worker_id\")" in branch
    assert "worker_email or " in branch  # falls back to synthetic if unset
    assert '"preview_worker_id": preview_worker_id' in branch
    # Write-block still there.
    assert "preview_mode_read_only" in branch


# ─────────────── Mobile source-pins ───────────────

WELCOME = Path("/app/mobile/app/(auth)/welcome.tsx")
PIN_ENTRY = Path("/app/mobile/app/(auth)/pin-entry.tsx")
LOGIN = Path("/app/mobile/app/(auth)/login.tsx")
ONBOARDING = Path("/app/mobile/app/(auth)/onboarding.tsx")
INDEX = Path("/app/mobile/app/index.tsx")


@pytest.mark.parametrize("path", [WELCOME, PIN_ENTRY, LOGIN, ONBOARDING])
def test_auth_screen_short_circuits_on_preview_session(path: Path) -> None:
    src = path.read_text()
    assert "isPreviewSession" in src, f"{path.name} missing isPreviewSession import"
    # Look for the isPreviewSession() gate + the (tabs)/home replace
    # within a small window of each other (multi-line, JSX-safe check).
    m = re.search(r"isPreviewSession\(\)", src)
    assert m, f"{path.name} does not call isPreviewSession()"
    window = src[m.start(): m.start() + 400]
    assert "(tabs)/home" in window, (
        f"{path.name} isPreviewSession() gate does not lead to (tabs)/home "
        f"redirect within 400 chars — window was: {window!r}"
    )
    assert "router.replace" in window, (
        f"{path.name} isPreviewSession() gate does not use router.replace"
    )


def test_splash_forwards_preview_worker_id_and_honours_reset() -> None:
    src = INDEX.read_text()
    # Params typed to include preview_worker_id + reset.
    assert "preview_worker_id?" in src
    assert "reset?" in src
    # exchangeForPreviewSession accepts and forwards worker_id.
    assert "worker_id: workerId" in src or "worker_id\", " in src or "workerId" in src
    # ?reset=1 branch wipes sessionStorage.
    assert "params.reset === '1'" in src
    assert "removeItem(PREVIEW_JWT_KEY)" in src


# ─────────────── Frontend source-pins ───────────────

FRONTEND_PANEL = Path("/app/frontend/src/components/settings/MobileModulesSection.jsx")


def test_frontend_worker_picker_and_reset_button_wired() -> None:
    src = FRONTEND_PANEL.read_text()
    # Worker dropdown.
    assert 'data-testid="mobile-preview-worker"' in src
    assert 'data-testid="mobile-preview-worker-count"' in src
    # Reset button.
    assert 'data-testid="mobile-preview-reset"' in src
    # Iframe URL builder honours the worker id.
    assert "computeExpoUrl(role, token, workerId)" in src or "computeExpoUrl(r, getToken(), wId)" in src
    assert "preview_worker_id" in src
    # Fetches the worker feed from the new endpoint.
    assert "/mobile/preview-user/workers" in src
    # Reset URL builder emits `reset=1` so the mobile splash can bounce.
    assert "computeExpoResetUrl" in src
    assert "'reset', '1'" in src


# ─────────────── Version pins ───────────────

@pytest.mark.parametrize("path,pattern", [
    ("/app/frontend/src/lib/version.js",       r"RUNNING_VERSION\s*=\s*'([^']+)'"),
    ("/app/mobile/src/lib/version.ts",         r"MOBILE_BUNDLE_VERSION\s*=\s*'([^']+)'"),
    ("/app/frontend/public/service-worker.js", r"CACHE_VERSION\s*=\s*'([^']+)'"),
])
def test_version_pinned_to_132o_or_forward(path: str, pattern: str) -> None:
    m = re.search(pattern, Path(path).read_text())
    assert m, f"version constant missing in {path}"
    v = m.group(1)
    tail = v.split("v160.3.9.58.13.", 1)[-1]
    forward = (
        re.match(r"^132(o|[p-z])", tail)
        or re.match(r"^(13[3-9]|1[4-9]\d|[2-9]\d\d)", tail)
    )
    assert forward, f"{path} version {v} appears earlier than .132o"
