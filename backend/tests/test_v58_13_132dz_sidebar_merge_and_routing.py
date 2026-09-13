"""v58.13.132dz — Sidebar category merge + auto-routing rule.

Locks the three-part ship:

1. **CS Incidents → Incident Reports**
   Every `cs_incident_issues` doc lives in `incidents` under
   `migrated_from: "cs_incidents"`. FE sidebar entry gone.
   `GET /api/cs-incident/` returns 410.

2. **Hazard Reports → Risk Assessments**
   Every `form_submissions` row that used to carry
   `template_category_snapshot IN ["hazard", "near_miss"]` now
   carries `"risk_assessment"` + `migrated_from: "hazard_reports"`
   + `_original_category`. Native `hazards` docs copied into
   new `risk_assessments` collection with `migrated_from:
   "hazards"`. Hazard Reports sidebar entry is PRESERVED.

3. **Auto-routing rule**
   `form_routing_rules` collection seeded with one rule for
   Construction & Excavation SSRA →  `risk_assessment`.
   `resolve_template_category(template)` prefers the rule table
   over the template's declared `category`.
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path

import pytest
from pymongo import MongoClient

APP_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(APP_ROOT / "backend"))

# v58.13.132dz — Use the shared session-scoped event loop so Motor's
# async client stays bound to a single loop across multiple test
# invocations. `asyncio.run(...)` would create + tear down a fresh
# loop per call, and Motor's cached client would then fault on the
# second call with "Event loop is closed".
from tests.conftest import run_async  # noqa: E402

APPSHELL = APP_ROOT / "frontend" / "src" / "components" / "layout" / "AppShell.jsx"
APP_JS = APP_ROOT / "frontend" / "src" / "App.js"
CS_INCIDENT_PY = APP_ROOT / "backend" / "cs_incident.py"
FORM_ROUTING_PY = APP_ROOT / "backend" / "form_routing.py"
FORMS_PY = APP_ROOT / "backend" / "forms.py"
IMPORTS_PY = APP_ROOT / "backend" / "imports.py"
BULK_PY = APP_ROOT / "backend" / "bulk_import_prestarts.py"
VERSION_JS = APP_ROOT / "frontend" / "src" / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"
MIGRATION_SCRIPT = APP_ROOT / "backend" / "scripts" / "migrate_sidebar_merge_v58_13_132dz.py"

SSRA_TEMPLATE_ID = "dc28f66a-a385-4a64-b5f0-d92bfd7b1798"
API = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")


def _db():
    return MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


# ─── Part 1: FE sidebar / route lock ────────────────────────────

def test_appshell_no_cs_incidents_sidebar_entry():
    src = APPSHELL.read_text(encoding="utf-8")
    # Sidebar testid + label are GONE.
    assert 'nav-submissions-cs-incidents' not in src, (
        "CS Incidents sidebar entry still present in AppShell.jsx"
    )
    assert "'CS Incidents'" not in src and '"CS Incidents"' not in src, (
        "'CS Incidents' label still rendered in AppShell.jsx"
    )
    # Reasoned deletion comment references .132dz.
    assert "132dz" in src


def test_appshell_hazard_reports_entry_retained():
    """Per Stephen: Hazard Reports sidebar entry stays (may be empty)."""
    src = APPSHELL.read_text(encoding="utf-8")
    assert 'nav-hazards' in src
    assert "'Hazard Reports'" in src or '"Hazard Reports"' in src


def test_appshell_risk_assessments_entry_retained():
    src = APPSHELL.read_text(encoding="utf-8")
    assert 'nav-risk-assessments' in src
    assert 'Risk Assessments' in src


def test_appjs_cs_incidents_routes_redirected():
    """`/app/submissions/*` should now route to `/app/incidents`."""
    src = APP_JS.read_text(encoding="utf-8")
    # No live import of CsIncidentsList (commented-out is fine).
    live_import = re.search(
        r"^import\s+CsIncidentsList\s+from",
        src, re.MULTILINE,
    )
    assert live_import is None, "CsIncidentsList is still actively imported"
    # Redirect to /app/incidents wired.
    assert 'submissions/cs-incidents"' in src
    assert 'Navigate to="/app/incidents"' in src


# ─── Part 2: Backend 410 gate on cs-incident router ─────────────

def test_cs_incident_router_deprecation_gate():
    src = CS_INCIDENT_PY.read_text(encoding="utf-8")
    assert "_deprecated_gate" in src
    assert "status_code=410" in src
    assert "dependencies=[Depends(_deprecated_gate)]" in src
    assert "132dz" in src


def test_cs_incident_router_returns_410_live():
    import requests
    r = requests.get(f"{API}/api/cs-incident/")
    assert r.status_code == 410, (
        f"Expected 410 Gone, got {r.status_code}: {r.text[:120]}"
    )
    # Body carries a pointer to the new endpoint.
    assert "incidents" in r.text.lower()


# ─── Part 3: form_routing helper + rule table ───────────────────

def test_form_routing_module_exports():
    """The helper must exist + expose the two functions callers use."""
    src = FORM_ROUTING_PY.read_text(encoding="utf-8")
    assert "async def resolve_template_category" in src
    assert "async def ensure_form_routing_rules" in src
    assert "SEED_RULES" in src
    # SSRA template ID hardcoded in the seed set.
    assert SSRA_TEMPLATE_ID in src


def test_forms_py_uses_routing_helper():
    src = FORMS_PY.read_text(encoding="utf-8")
    assert "from form_routing import resolve_template_category" in src
    assert "await resolve_template_category(template)" in src
    # Old inline fallback shouldn't be the primary path anymore.
    inline = "template.get(\"category\") or \"general\""
    lines = [
        L for L in src.splitlines()
        if inline in L and "resolve_template_category" not in L
    ]
    # The inline pattern may survive inside docstrings / comments, so
    # only fail if it appears in a JSON-doc assignment block.
    for L in lines:
        # Rule out safe occurrences (comments, doc strings) — any
        # remaining hit inside a dict literal is a smell.
        if "template_category_snapshot" in L:
            raise AssertionError(
                f"forms.py still has inline `{inline}` on a "
                f"template_category_snapshot line: {L!r}"
            )


def test_imports_py_uses_routing_helper():
    src = IMPORTS_PY.read_text(encoding="utf-8")
    assert "from form_routing import resolve_template_category" in src
    assert "await resolve_template_category(matched)" in src


def test_bulk_import_prestarts_uses_routing_helper():
    src = BULK_PY.read_text(encoding="utf-8")
    assert "from form_routing import resolve_template_category" in src
    assert "await resolve_template_category(_tpl_row)" in src


def test_form_routing_rules_seeded_in_db():
    db = _db()
    if "form_routing_rules" not in db.list_collection_names():
        pytest.skip("form_routing_rules not yet initialised on this env")
    rule = db.form_routing_rules.find_one(
        {"template_id": SSRA_TEMPLATE_ID, "active": True},
    )
    assert rule is not None, (
        "SSRA routing rule not seeded in form_routing_rules"
    )
    assert rule["destination_category"] == "risk_assessment"
    assert "Construction" in (rule.get("template_name_hint") or "")


def test_resolver_prefers_rule_over_template_category():
    """Live behavioural: pass a template dict with declared
    `category="hazard"` but matching the SSRA id → resolver must
    return `"risk_assessment"`."""
    from form_routing import resolve_template_category, _reload_cache

    async def _go():
        # Force a cache reload against the live DB (which is
        # seeded with the SSRA rule by ensure_form_routing_rules
        # at server startup).
        await _reload_cache()
        cat = await resolve_template_category({
            "id": SSRA_TEMPLATE_ID,
            "category": "hazard",  # would normally route to Hazard Reports
        })
        return cat

    got = run_async(_go())
    assert got == "risk_assessment", (
        f"resolve_template_category returned {got!r}; expected 'risk_assessment'"
    )


def test_resolver_falls_back_to_template_category_when_no_rule():
    from form_routing import resolve_template_category, _reload_cache

    async def _go():
        await _reload_cache()
        # A template id with no rule → the declared category wins.
        cat = await resolve_template_category({
            "id": "no-such-template-id-9f81f",
            "category": "inspection",
        })
        return cat

    got = run_async(_go())
    assert got == "inspection"


def test_resolver_defaults_to_general_when_neither_present():
    from form_routing import resolve_template_category, _reload_cache

    async def _go():
        await _reload_cache()
        cat = await resolve_template_category({
            "id": "no-such-template-id-abcde",
        })
        return cat

    got = run_async(_go())
    assert got == "general"


# ─── Part 4: Migration audit (post-commit state) ────────────────

def test_migration_script_exists_and_dry_run_default():
    src = MIGRATION_SCRIPT.read_text(encoding="utf-8")
    # Argparse guard so a naïve invocation is a no-op.
    assert 'argparse.ArgumentParser' in src
    assert '"--commit"' in src or "'--commit'" in src
    assert '"--dry-run"' in src or "'--dry-run'" in src
    # Idempotency guard field.
    assert "_migrated_at_v58_13_132dz" in src
    # Three migrations covered.
    assert "migrate_cs_incidents" in src
    assert "migrate_hazard_form_submissions" in src
    assert "migrate_hazards_collection" in src


def test_cs_incidents_migrated_to_incidents():
    db = _db()
    src_total = db.cs_incident_issues.count_documents({})
    if src_total == 0:
        pytest.skip("no cs_incident_issues on this env")
    # Every source row has the stamp.
    stamped = db.cs_incident_issues.count_documents({
        "_migrated_at_v58_13_132dz": {"$exists": True},
    })
    assert stamped == src_total, (
        f"only {stamped}/{src_total} cs_incident_issues carry the "
        f"migration stamp"
    )
    # Destination has audit tag on the migrated rows.
    tagged = db.incidents.count_documents({"migrated_from": "cs_incidents"})
    assert tagged >= src_total, (
        f"only {tagged}/{src_total} incidents rows carry "
        f"migrated_from=cs_incidents"
    )


def test_hazards_form_submissions_recategorised():
    db = _db()
    # No more `hazard` / `near_miss` rows exist on form_submissions.
    n_hazard = db.form_submissions.count_documents({
        "template_category_snapshot": "hazard",
    })
    n_near = db.form_submissions.count_documents({
        "template_category_snapshot": "near_miss",
    })
    assert n_hazard == 0, (
        f"{n_hazard} form_submissions still carry category=hazard"
    )
    assert n_near == 0, (
        f"{n_near} form_submissions still carry category=near_miss"
    )
    # Every re-stamped row carries the audit tag + `_original_category`.
    migrated = db.form_submissions.count_documents({
        "migrated_from": "hazard_reports",
    })
    assert migrated > 0
    orig = db.form_submissions.count_documents({
        "migrated_from": "hazard_reports",
        "_original_category": {"$in": ["hazard", "near_miss"]},
    })
    assert orig == migrated, (
        "not every migrated row carries `_original_category`"
    )


def test_native_hazards_copied_into_risk_assessments():
    db = _db()
    if "hazards" not in db.list_collection_names():
        pytest.skip("no native hazards collection on this env")
    src = db.hazards.count_documents({})
    dst = db.risk_assessments.count_documents({"migrated_from": "hazards"})
    assert dst >= src, (
        f"only {dst}/{src} native hazards docs copied into risk_assessments"
    )
    # Source collection preserved (not hard-deleted).
    src_stamped = db.hazards.count_documents({
        "_migrated_at_v58_13_132dz": {"$exists": True},
    })
    assert src_stamped == src


def test_migration_idempotent_second_run():
    """Re-invoking the migration must be a no-op."""
    import subprocess
    result = subprocess.run(
        ["python", "-m", "backend.scripts.migrate_sidebar_merge_v58_13_132dz",
         "--commit"],
        capture_output=True, text=True, cwd=str(APP_ROOT), timeout=60,
    )
    assert result.returncode == 0, (
        f"migration re-run failed: stderr={result.stderr[:400]}"
    )
    out = result.stdout
    # All three migrations report "nothing to do" or "migrated=0".
    assert "cs_incidents]" in out
    assert "migrated=     0" in out or "migrated 0 docs" in out
    # Third invocation on hazards native should report already_migrated>0.
    m = re.search(r"hazards:\s+migrated=\s*0\s+already=(\d+)", out)
    assert m and int(m.group(1)) > 0, out


# ─── Version sync ────────────────────────────────────────────────

def test_three_way_sync_at_132dz_or_later():
    running = re.search(r"^export const RUNNING_VERSION = '([^']+)'",
                        VERSION_JS.read_text(), re.MULTILINE).group(1)
    expected = re.search(r"^export const EXPECTED_CACHE_VERSION = '([^']+)'",
                         VERSION_JS.read_text(), re.MULTILINE).group(1)
    cache = re.search(r"^const CACHE_VERSION = '([^']+)'",
                      SW.read_text(), re.MULTILINE).group(1)
    assert running == expected == cache
    tail = re.search(r"132([a-z]+)", running).group(1)
    assert tail >= "dz"
