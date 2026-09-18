"""v58.13.132io — /api/auth/me `role_label` projection fix.

Root cause locked by this suite:
    Even though `.132in` set `role_label` on the synthetic preview user
    dict inside `auth.get_current_user`, the `/api/auth/me` endpoint
    (auth.py:me) pipes the dict through `_to_user_out()` — a strict
    WHITELIST projection at auth.py:166 — which had no `role_label`
    entry. The field was silently dropped before the response left the
    backend, so the mobile Profile screen always saw
    `res.data.role_label === None` and cascaded down to the collapsed
    `role`/`role_id` values, displaying "Admin" for every previewed
    scope.

Fix locked here:
    · `_to_user_out()` now surfaces `role_label` + `preview`.
    · `/api/auth/me` echoes them (behavioural round-trip below).
"""
from __future__ import annotations

from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[2]
FRONTEND = ROOT / "frontend"
BACKEND = ROOT / "backend"


def _r(p: Path) -> str:
    return p.read_text(encoding="utf-8")


# ── Backend source pins ────────────────────────────────────────────

def test_to_user_out_surfaces_role_label_and_preview_flag():
    """The whitelist projection that /api/auth/me runs must include
    role_label + preview. Absence of either is the .132io bug."""
    src = _r(BACKEND / "auth.py")
    assert '"role_label": doc.get("role_label"),' in src, (
        "_to_user_out must surface role_label so /api/auth/me returns it"
    )
    assert '"preview": doc.get("preview", False),' in src, (
        "_to_user_out must surface preview so the mobile client can "
        "explicitly branch on the preview state without relying on "
        "sessionStorage inspection"
    )


def test_to_user_out_still_surfaces_pre_132io_fields():
    """Regression guard: don't accidentally drop any pre-.132io field."""
    src = _r(BACKEND / "auth.py")
    for pin in (
        '"id": doc["id"]',
        '"email": doc["email"]',
        '"name": doc["name"]',
        '"role": doc["role"]',
        '"org_id": doc["org_id"]',
        '"workspace_ids": doc.get("workspace_ids", [])',
        '"company_id": doc.get("company_id")',
        '"role_id": doc.get("role_id")',
        '"activation_status": doc.get("activation_status")',
        '"created_at": doc["created_at"]',
    ):
        assert pin in src, f"_to_user_out lost pre-.132io field: {pin}"


# ── Version lockstep ───────────────────────────────────────────────

def test_version_pin_v132io():
    import re as _re
    v = _r(FRONTEND / "src" / "lib" / "version.js")
    sw = _r(FRONTEND / "public" / "service-worker.js")
    pat = r"paneltec-v160\.3\.9\.58\.13\.132(?:io|i[p-z]|[j-z][a-z]?)"
    assert _re.search(rf"RUNNING_VERSION = '{pat}'", v), \
        "RUNNING_VERSION must be at or beyond .132io"
    assert _re.search(rf"EXPECTED_CACHE_VERSION = '{pat}'", v), \
        "EXPECTED_CACHE_VERSION must be at or beyond .132io"
    assert _re.search(rf"CACHE_VERSION = '{pat}'", sw), \
        "service-worker CACHE_VERSION must be at or beyond .132io"


# ── Behavioural: /api/auth/me returns role_label for preview + real users ─

def test_preview_user_dict_round_trips_through_to_user_out():
    """The exact dict shape produced by get_current_user's preview
    branch must survive _to_user_out with role_label + preview intact."""
    from auth import _to_user_out
    synthetic = {
        "id": "preview-paneltec_civil-e18f9bc0",
        "email": "matchu_03@hotmail.com",
        "name": "MATTHEW WELLS (preview)",
        "role": "worker",
        "role_id": "paneltec_civil",
        "role_label": "Paneltec Civil",
        "org_id": "org_test",
        "workspace_ids": [],
        "company_id": None,
        "activation_status": "active",
        "created_at": "2026-09-18T06:49:30.770257+00:00",
        "preview": True,
        "preview_worker_id": "9499d899-12fe-4292-8ced-e4e08cf8202a",
        "preview_scope": "paneltec_civil",
        "preview_modules": [],
    }
    out = _to_user_out(synthetic)
    assert out["role_label"] == "Paneltec Civil"
    assert out["preview"] is True
    assert out["name"] == "MATTHEW WELLS (preview)"
    assert out["role_id"] == "paneltec_civil"
    # The internal preview_* scaffolding is deliberately NOT surfaced.
    assert "preview_worker_id" not in out
    assert "preview_scope" not in out
    assert "preview_modules" not in out


def test_real_user_without_role_label_returns_none_not_missing():
    """Real (non-preview) users don't carry role_label on their Mongo
    doc. The projection must return `None` for the field (not omit it)
    so mobile client code that does `data.role_label || fallback` still
    works — a missing key vs. a null value are the same to JavaScript's
    `||`, but explicit-null is friendlier to typed callers."""
    from auth import _to_user_out
    real = {
        "id": "808cb7de-985a-4c49-8554-9c67e5e86313",
        "email": "stephen@paneltec.com.au",
        "name": "Stephen Guy",
        "role": "admin",
        "org_id": "org_test",
        "workspace_ids": [],
        "company_id": None,
        "role_id": "admin",
        "activation_status": "active",
        "created_at": "2026-09-18T00:00:00+00:00",
        # No role_label, no preview.
    }
    out = _to_user_out(real)
    assert "role_label" in out and out["role_label"] is None
    assert "preview" in out and out["preview"] is False


# ── Test suite forward-compat guard ────────────────────────────────

def test_ship_memo_present():
    """Every ship writes a memo — the .132io memo must exist so the
    audit trail stays complete."""
    memo = ROOT / "memory" / "v58_13_132io_role_label_projection_shipped_finish_deferred.md"
    assert memo.exists(), f"Missing ship memo: {memo}"
    body = memo.read_text(encoding="utf-8")
    assert "132io" in body
    assert "_to_user_out" in body
