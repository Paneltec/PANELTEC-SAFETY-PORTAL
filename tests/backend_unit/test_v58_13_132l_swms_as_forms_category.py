"""v58.13.132l — SWMS as a mobile Forms category + preview-mode polish pytests.

Locks:
  • Backend `_list_swms_as_form_templates` contract (category filter,
    worker-scope filter, admin bypass, projection into FormTemplate shape).
  • Mobile `CATEGORY_ORDER` gains a 'swms' entry in the correct slot.
  • Mobile `FormTemplate` gains an `is_swms?` boolean marker.
  • Mobile Forms tab and Category-detail branch taps on `t.is_swms` → route
    to `/profile/swms/[id]`, not `/forms/[id]`.
  • Form runner (`[id]/index.tsx`) disables the Confirm & Submit button
    when `isPreviewSession()` returns true and renders a "Preview mode —
    read only" chip.
  • All 3 canonical version files pin to `.132l` or forward.
"""
from __future__ import annotations
import asyncio
import re
import uuid
from pathlib import Path

import pytest

BACKEND_FORMS = Path("/app/backend/forms.py")
MOBILE_SVC = Path("/app/mobile/src/services/forms.ts")
MOBILE_TAB = Path("/app/mobile/app/(tabs)/forms.tsx")
MOBILE_CAT = Path("/app/mobile/app/forms/category/[key].tsx")
MOBILE_RUNNER = Path("/app/mobile/app/forms/[id]/index.tsx")

VERSION_JS = Path("/app/frontend/src/lib/version.js")
VERSION_TS = Path("/app/mobile/src/lib/version.ts")
SERVICE_WORKER = Path("/app/frontend/public/service-worker.js")


# ─────────────── Backend source-pins ───────────────

@pytest.fixture(scope="module")
def backend_src() -> str:
    return BACKEND_FORMS.read_text()


def test_swms_added_to_allowed_categories(backend_src: str) -> None:
    # ALLOWED_CATEGORIES must accept 'swms' so _norm_category('swms')
    # returns 'swms' (not 'general').
    block = re.search(r"ALLOWED_CATEGORIES\s*=\s*\{(.+?)\}", backend_src, re.DOTALL)
    assert block, "ALLOWED_CATEGORIES set not found"
    assert "\"swms\"" in block.group(1), "swms not in ALLOWED_CATEGORIES"


def test_bridge_helper_defined(backend_src: str) -> None:
    assert "async def _list_swms_as_form_templates" in backend_src, \
        "bridge helper missing"
    # Signature must include the 4 named params exactly.
    m = re.search(
        r"async def _list_swms_as_form_templates\([^)]*\)\s*->\s*list\[dict\]",
        backend_src,
    )
    assert m, "bridge helper signature wrong"
    sig = m.group(0)
    for p in ("org_id", "category", "worker_id", "admin_bypass"):
        assert p in sig, f"bridge helper missing param {p}"


def _bridge_body(backend_src: str) -> str:
    """Extract just the `_list_swms_as_form_templates` function body."""
    marker = "async def _list_swms_as_form_templates"
    after = backend_src.split(marker, 1)[1]
    # Terminate at the next top-level decorator or function definition.
    m = re.search(r"\n(?:@\w|async def |def )", after)
    return after[: m.start()] if m else after


def test_bridge_reads_from_db_swms_not_form_templates(backend_src: str) -> None:
    body = _bridge_body(backend_src)
    assert "db.swms.find" in body, "bridge does not read from db.swms"
    # And never writes anywhere.
    for verb in ("insert_one", "insert_many", "update_one", "update_many",
                 "delete_one", "delete_many", "find_one_and_update"):
        assert verb not in body, f"bridge unexpectedly mutates ({verb})"


def test_bridge_emits_is_swms_marker(backend_src: str) -> None:
    body = _bridge_body(backend_src)
    assert '"is_swms": True' in body
    assert '"category": "swms"' in body
    # Empty fields — SWMS is never a fill-in form runner target.
    assert '"fields": []' in body


def test_bridge_called_from_list_templates(backend_src: str) -> None:
    # Both the for_worker branch AND the admin/no-worker branch must call
    # the bridge so SWMS surfaces for every caller class.
    lt_start = backend_src.find("async def list_templates")
    lt_end = backend_src.find("async def _list_swms_as_form_templates")
    assert lt_start != -1 and lt_end != -1 and lt_end > lt_start
    lt = backend_src[lt_start:lt_end]
    call_sites = lt.count("_list_swms_as_form_templates(")
    assert call_sites >= 2, (
        f"expected >=2 bridge call sites in list_templates, got {call_sites}"
    )


def test_bridge_worker_scope_gate(backend_src: str) -> None:
    body = _bridge_body(backend_src)
    # Must consult applies_to.worker_ids for non-admin filtering.
    assert "worker_ids" in body
    assert "admin_bypass" in body


# ─────────────── Backend behavioural test ───────────────

@pytest.mark.asyncio
async def test_bridge_behavioural_worker_scope_and_admin_bypass() -> None:
    """Round-trip: seed 3 SWMS docs (2 assigned to worker A, 1 to worker B),
    verify:
      • worker A → 2 rows
      • worker B → 1 row
      • admin_bypass → 3 rows
      • category='inspection' → 0 rows (wrong category filter)
      • superseded SWMS excluded
    """
    from db import db  # backend module
    from forms import _list_swms_as_form_templates

    org_id = f"TEST-132l-{uuid.uuid4().hex[:8]}"
    worker_a = f"TEST-132l-wa-{uuid.uuid4().hex[:6]}"
    worker_b = f"TEST-132l-wb-{uuid.uuid4().hex[:6]}"

    docs = [
        {"id": f"TEST-132l-swms-1-{uuid.uuid4().hex[:6]}", "org_id": org_id,
         "title": "Confined Space Entry", "code": "SW-01", "version": "3",
         "status": "current", "job_description": "Enter tanks safely.",
         "deleted_at": None,
         "applies_to": {"worker_ids": [worker_a], "roles": [], "company_ids": []}},
        {"id": f"TEST-132l-swms-2-{uuid.uuid4().hex[:6]}", "org_id": org_id,
         "title": "Working at Heights", "code": "SW-02", "version": "2",
         "status": "current", "scope": "Above 2m fall risk.",
         "deleted_at": None,
         "applies_to": {"worker_ids": [worker_a, worker_b], "roles": [],
                        "company_ids": []}},
        {"id": f"TEST-132l-swms-3-{uuid.uuid4().hex[:6]}", "org_id": org_id,
         "title": "Superseded Legacy Doc", "code": "SW-OLD", "version": "1",
         "status": "superseded", "deleted_at": None,
         "applies_to": {"worker_ids": [worker_a, worker_b]}},
    ]
    await db.swms.insert_many(docs)
    try:
        # Worker A
        wa = await _list_swms_as_form_templates(
            org_id=org_id, category=None, worker_id=worker_a, admin_bypass=False,
        )
        assert len(wa) == 2
        assert all(r["is_swms"] is True for r in wa)
        assert all(r["category"] == "swms" for r in wa)
        assert {r["name"] for r in wa} == {"Confined Space Entry",
                                           "Working at Heights"}

        # Worker B
        wb = await _list_swms_as_form_templates(
            org_id=org_id, category=None, worker_id=worker_b, admin_bypass=False,
        )
        assert len(wb) == 1
        assert wb[0]["name"] == "Working at Heights"

        # Admin bypass
        adm = await _list_swms_as_form_templates(
            org_id=org_id, category=None, worker_id=None, admin_bypass=True,
        )
        assert len(adm) == 2, "superseded SWMS must be excluded even for admin"

        # Explicit category='swms' → same 2 for admin
        adm_swms = await _list_swms_as_form_templates(
            org_id=org_id, category="swms", worker_id=None, admin_bypass=True,
        )
        assert len(adm_swms) == 2

        # Wrong category filter → 0
        adm_wrong = await _list_swms_as_form_templates(
            org_id=org_id, category="inspection", worker_id=None, admin_bypass=True,
        )
        assert adm_wrong == []

        # Non-admin with no worker → 0
        none = await _list_swms_as_form_templates(
            org_id=org_id, category=None, worker_id=None, admin_bypass=False,
        )
        assert none == []

        # Sort by name (case-insensitive)
        names = [r["name"] for r in adm]
        assert names == sorted(names, key=str.lower)
    finally:
        await db.swms.delete_many({"org_id": org_id})


# ─────────────── Mobile source-pins ───────────────

@pytest.fixture(scope="module")
def mobile_svc_src() -> str:
    return MOBILE_SVC.read_text()


def test_swms_in_category_order_between_general_and_prestart(
    mobile_svc_src: str,
) -> None:
    block = re.search(
        r"CATEGORY_ORDER:\s*CategoryMeta\[\]\s*=\s*\[(.+?)\];",
        mobile_svc_src,
        re.DOTALL,
    )
    assert block, "CATEGORY_ORDER declaration not found"
    keys = re.findall(r"key:\s*'([^']+)'", block.group(1))
    assert "swms" in keys, "swms missing from CATEGORY_ORDER"
    # Positioned between general and pre_start.
    i_gen = keys.index("general")
    i_swms = keys.index("swms")
    i_pre = keys.index("pre_start")
    assert i_gen < i_swms < i_pre, (
        f"swms in wrong slot: {keys}"
    )


def test_form_template_interface_has_is_swms(mobile_svc_src: str) -> None:
    assert "is_swms?: boolean" in mobile_svc_src


@pytest.fixture(scope="module")
def mobile_tab_src() -> str:
    return MOBILE_TAB.read_text()


def test_tab_search_result_branches_on_is_swms(mobile_tab_src: str) -> None:
    # A conditional routing branch — SWMS → /profile/swms/[id], else runner.
    assert "t.is_swms" in mobile_tab_src
    assert "/profile/swms/[id]" in mobile_tab_src


@pytest.fixture(scope="module")
def mobile_cat_src() -> str:
    return MOBILE_CAT.read_text()


def test_category_detail_branches_on_is_swms(mobile_cat_src: str) -> None:
    assert "t.is_swms" in mobile_cat_src
    assert "/profile/swms/[id]" in mobile_cat_src


# ─────────────── Preview-mode polish source-pins ───────────────

@pytest.fixture(scope="module")
def runner_src() -> str:
    return MOBILE_RUNNER.read_text()


def test_runner_imports_is_preview_session(runner_src: str) -> None:
    assert "isPreviewSession" in runner_src, \
        "runner does not import isPreviewSession"
    # And it's imported from the auth service, not redeclared.
    assert re.search(
        r"import\s*\{[^}]*isPreviewSession[^}]*\}\s*from\s*['\"][^'\"]*services/auth['\"]",
        runner_src,
    ), "isPreviewSession not imported from services/auth"


def test_runner_has_preview_disabled_button(runner_src: str) -> None:
    assert 'testID="form-submit-btn-preview-disabled"' in runner_src
    assert 'testID="form-preview-chip"' in runner_src
    # The chip label must convey read-only state.
    assert "Preview mode — read only" in runner_src


def test_runner_still_has_live_submit_button(runner_src: str) -> None:
    # The non-preview branch must remain fully wired.
    assert 'testID="form-submit-btn"' in runner_src
    assert "onPress={handleSubmit}" in runner_src


# ─────────────── Version pins ───────────────

@pytest.mark.parametrize("path,pattern", [
    (VERSION_JS,     r"RUNNING_VERSION\s*=\s*'([^']+)'"),
    (VERSION_TS,     r"MOBILE_BUNDLE_VERSION\s*=\s*'([^']+)'"),
    (SERVICE_WORKER, r"CACHE_VERSION\s*=\s*'([^']+)'"),
])
def test_version_pinned_to_132l_or_forward(path: Path, pattern: str) -> None:
    src = path.read_text()
    m = re.search(pattern, src)
    assert m, f"version constant not found in {path.name}"
    v = m.group(1)
    # Accept `.132l` and any suffix beyond (`.132l_hotfix`, `.132m`, `.133`, …).
    tail = v.split("v160.3.9.58.13.", 1)[-1]
    # Forward-safe: starts with 132l OR a version-string later than 132l.
    assert re.match(r"^132(l|[m-z])", tail) or re.match(r"^(13[3-9]|1[4-9]\d|[2-9]\d\d)", tail), (
        f"{path.name} version {v} appears earlier than .132l"
    )
