"""v58.13.132ig — Compliance question widget + template help_text + migration.

Source-pins the widget import + wiring, TemplateBuilder editor field,
backend field-type acceptance + help_text persistence, migration
script CLI shape + mapping table, and version lockstep. Plus a small
behavioural check on the migration mapping (pure-function, no DB
writes).
"""
from __future__ import annotations

from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
FRONTEND = ROOT / "frontend"
BACKEND = ROOT / "backend"


def _r(p: Path) -> str:
    return p.read_text(encoding="utf-8")


# ── Backend source pins ─────────────────────────────────────────────

def test_backend_forms_accepts_compliance_field_type():
    src = _r(BACKEND / "forms.py")
    # The 'compliance' entry is the final member of ALLOWED_FIELD_TYPES.
    assert '"compliance"}' in src
    assert "ALLOWED_FIELD_TYPES = {" in src


def test_backend_clean_field_persists_help_text():
    src = _r(BACKEND / "forms.py")
    assert 'help_text = str(f.get("help_text") or "").strip()[:500]' in src
    assert '"help_text": help_text,' in src


def test_backend_migration_script_exists_with_argparse():
    p = BACKEND / "scripts" / "migrate_compliance_status_v58_13_132ig.py"
    src = _r(p)
    # argparse with --commit (dry-run is the default).
    assert '"--commit"' in src
    assert '"--dry-run"' in src
    # Legacy → new-status mapping locked.
    assert '"yes": "compliant"' in src
    assert '"no": "at_risk"' in src
    assert '"na": "na"' in src
    # _legacy_status preserved (Stephen's 5a default).
    assert '"_legacy_status":' in src
    # Idempotent guard: dict values are skipped.
    assert "if isinstance(fld_val, dict):" in src
    # Doesn't touch fields that aren't `radio` (safety).
    assert 'tpl_field.get("type") != "radio"' in src


def test_backend_migration_mapping_and_needs_migration():
    """Behavioural check on the pure-function mapping table.
    No DB writes — imports the module and exercises the helpers.
    """
    import importlib
    mod = importlib.import_module(
        "scripts.migrate_compliance_status_v58_13_132ig",
    )
    # Mapping table covers the 5 canonical variants.
    assert mod._map_status("Yes") == "compliant"
    assert mod._map_status("no") == "at_risk"
    assert mod._map_status("N/A") == "na"
    assert mod._map_status("NA") == "na"
    assert mod._map_status("Not Applicable") == "na"
    # Non-radio field → skip.
    assert mod._needs_migration("Yes", {"type": "text", "options": []}) is False
    # Radio with <2 options → skip.
    assert mod._needs_migration("Yes", {"type": "radio", "options": ["Yes"]}) is False
    # Already-migrated dict value → skip.
    assert mod._needs_migration(
        {"status": "compliant"}, {"type": "radio", "options": ["Yes", "No"]},
    ) is False
    # Happy path.
    assert mod._needs_migration(
        "Yes", {"type": "radio", "options": ["Yes", "No", "N/A"]},
    ) is True


# ── Frontend source pins ────────────────────────────────────────────

def test_compliance_widget_component_exists():
    p = FRONTEND / "src" / "components" / "forms" / "ComplianceQuestion.jsx"
    src = _r(p)
    # Three canonical status keys.
    assert "key: 'compliant'" in src
    assert "key: 'at_risk'" in src
    assert "key: 'na'" in src
    # Brand danger red for AT RISK, emerald for COMPLIANT, slate for N/A.
    assert "bg-emerald-500 text-white" in src
    assert "bg-rose-500 text-white" in src
    assert "bg-slate-400 text-white" in src
    # Info popover renders only when help_text is set.
    assert "helpText ? (" in src
    # Value shape merges photos/notes to protect future ships.
    assert "photos: Array.isArray(prev.photos)" in src
    # Test IDs suffixed by field.id.
    assert 'data-testid={`compliance-btn-${btn.key}' in src


def test_forms_page_wires_compliance_type():
    src = _r(FRONTEND / "src" / "pages" / "Forms.jsx")
    assert "import ComplianceQuestion from '../components/forms/ComplianceQuestion'" in src
    assert "field.type === 'compliance'" in src


def test_is_answer_valid_handles_compliance():
    src = _r(FRONTEND / "src" / "lib" / "isAnswerValid.js")
    assert "if (t === 'compliance')" in src
    assert "value.status === 'compliant'" in src
    assert "value.status === 'at_risk'" in src
    assert "value.status === 'na'" in src


def test_template_builder_exposes_compliance_type_and_help_text():
    src = _r(FRONTEND / "src" / "components" / "forms" / "TemplateBuilder.jsx")
    # New type in the picker.
    assert "{ key: 'compliance'," in src
    # Help-text input renders + testid.
    assert 'data-testid={`builder-help-text-${field.id}`}' in src
    # Save payload includes help_text (trimmed + capped).
    assert "help_text: (f.help_text || '').trim().slice(0, 500)" in src


# ── Version lockstep ────────────────────────────────────────────────

def test_version_pin_v132ig():
    import re as _re
    v = _r(FRONTEND / "src" / "lib" / "version.js")
    sw = _r(FRONTEND / "public" / "service-worker.js")
    # Forward-safe: accept .132ig or any later `.132<letter+letter>` tail.
    pat = r"paneltec-v160\.3\.9\.58\.13\.132[i-z][g-z]?"
    assert _re.search(rf"RUNNING_VERSION = '{pat}'", v)
    assert _re.search(rf"EXPECTED_CACHE_VERSION = '{pat}'", v)
    assert _re.search(rf"CACHE_VERSION = '{pat}'", sw)


# ── Migration script CLI ────────────────────────────────────────────

def test_migration_script_cli_dry_run_default(tmp_path, monkeypatch):
    """Invoke the script's `main()` in dry-run mode against a stub DB.
    We don't hit real Mongo — just assert the CLI parses + returns 0
    without touching the DB when `--commit` is absent.
    """
    import importlib
    mod = importlib.import_module(
        "scripts.migrate_compliance_status_v58_13_132ig",
    )

    async def _fake_migrate(commit: bool) -> dict:
        assert commit is False, "default invocation must be dry-run"
        return {"scanned": 0, "would_update": 0, "fields_migrated": 0,
                "commit": False}

    monkeypatch.setattr(mod, "_migrate", _fake_migrate)
    code = mod.main([])
    assert code == 0


def test_migration_script_cli_commit_flag(monkeypatch):
    import importlib
    mod = importlib.import_module(
        "scripts.migrate_compliance_status_v58_13_132ig",
    )
    seen: dict = {}

    async def _fake_migrate(commit: bool) -> dict:
        seen["commit"] = commit
        return {"scanned": 1, "would_update": 1, "fields_migrated": 1,
                "commit": commit}

    monkeypatch.setattr(mod, "_migrate", _fake_migrate)
    code = mod.main(["--commit"])
    assert code == 0
    assert seen.get("commit") is True
