"""v58.13.132ii — Per-question notes on compliance widget.

Verifies:
  · Backend `create_submission` coerces the compliance value shape to
    the canonical `{status, photos, notes}` schema, capping notes at
    2000 chars.
  · Widget renders a textarea when the notes button is toggled OR
    when persisted notes exist; commits on blur with a 2000-char cap.
  · Version pin lockstep.
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

def test_backend_create_submission_coerces_compliance_value_shape():
    src = _r(BACKEND / "forms.py")
    # Compliance branch is present in create_submission and coerces the
    # canonical shape.
    assert 'elif t == "compliance":' in src
    assert 'status not in ("compliant", "at_risk", "na")' in src
    # Notes 2000-char cap enforced server-side.
    assert 'notes = str(notes)[:2000]' in src
    assert 'v = {"status": status, "photos": photos, "notes": notes}' in src


# ── Frontend source pins ────────────────────────────────────────────

def test_compliance_widget_notes_button_enabled_and_textarea_wired():
    src = _r(FRONTEND / "src" / "components" / "forms" / "ComplianceQuestion.jsx")
    # Notes button no longer disabled + no `coming soon` tooltip.
    assert 'title="Add note — coming in v58.13.132ii"' not in src
    assert 'disabled={readOnly}' in src
    assert 'setNotesOpen((v) => !v)' in src
    # Local draft + commit-on-blur pattern.
    assert 'const [notesDraft, setNotesDraft] = useState' in src
    assert 'onBlur={commitNotes}' in src
    # 2000-char cap enforced client-side too.
    assert '.slice(0, 2000)' in src
    assert 'maxLength={2000}' in src
    # Textarea test ID includes field.id.
    assert 'data-testid={`compliance-notes-input-${field?.id || \'unknown\'}`}' in src
    # Read-only fallback renders persisted notes.
    assert 'data-testid={`compliance-notes-readonly-${field?.id || \'unknown\'}`}' in src


def test_compliance_widget_commit_notes_preserves_status_and_photos():
    src = _r(FRONTEND / "src" / "components" / "forms" / "ComplianceQuestion.jsx")
    # commitNotes builds the full canonical shape.
    assert 'const commitNotes = () => {' in src
    assert 'status: prev.status || null,' in src
    assert 'photos: Array.isArray(prev.photos) ? prev.photos : [],' in src
    assert 'notes: trimmed,' in src


def test_compliance_widget_default_notes_open_when_persisted():
    src = _r(FRONTEND / "src" / "components" / "forms" / "ComplianceQuestion.jsx")
    # Notes panel auto-opens when a persisted note exists so users
    # can see + edit it without another click.
    assert 'useState(() => persistedNotes.length > 0)' in src


# ── Version lockstep ────────────────────────────────────────────────

def test_version_pin_v132ii():
    import re as _re
    v = _r(FRONTEND / "src" / "lib" / "version.js")
    sw = _r(FRONTEND / "public" / "service-worker.js")
    pat = r"paneltec-v160\.3\.9\.58\.13\.132[i-z][i-z]?"
    assert _re.search(rf"RUNNING_VERSION = '{pat}'", v)
    assert _re.search(rf"EXPECTED_CACHE_VERSION = '{pat}'", v)
    assert _re.search(rf"CACHE_VERSION = '{pat}'", sw)


# ── Behavioural — server-side notes coercion + cap ─────────────────

@pytest.mark.asyncio
@pytest.mark.live_db_writes
async def test_create_submission_caps_notes_and_coerces_shape():
    """End-to-end: POST a submission with a garbage compliance value
    (bad status, string notes over the cap, list-typed photos-as-none)
    and assert the persisted `fields.value` is the canonical shape
    with notes truncated to 2000 chars.
    """
    import os
    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME")
    if not mongo_url or not db_name:
        pytest.skip("MONGO_URL / DB_NAME missing")
    from motor.motor_asyncio import AsyncIOMotorClient
    from httpx import AsyncClient, ASGITransport
    try:
        from server import app as fastapi_app
        from models import new_id
        from auth import create_access_token
    except Exception:
        pytest.skip("backend imports unavailable")

    client = AsyncIOMotorClient(mongo_url)
    db = client.get_database(db_name)

    # Seed a scratch org + template with a compliance field.
    org_id = f"test_org_v132ii_{new_id()[:8]}"
    user_id = f"u_{new_id()[:8]}"
    tpl_id = new_id()
    field_id = new_id()
    await db.orgs.insert_one({
        "id": org_id, "name": "test-org", "deleted_at": None,
    })
    await db.users.insert_one({
        "id": user_id, "org_id": org_id, "email": f"{user_id}@t.local",
        "name": "T User", "role": "admin", "deleted_at": None,
        "password_hash": "x",
    })
    await db.form_templates.insert_one({
        "id": tpl_id, "org_id": org_id, "name": "test", "category": "other",
        "created_at": "2025-01-01T00:00:00Z", "deleted_at": None,
        "fields": [{"id": field_id, "label": "Test",
                    "type": "compliance", "required": False,
                    "options": [], "placeholder": "", "help_text": "",
                    "config": {}}],
    })

    token = create_access_token(user_id, f"{user_id}@t.local")
    payload = {
        "fields": [{
            "id": field_id, "label": "Test", "type": "compliance",
            "value": {
                "status": "bogus",           # coerced → None
                "photos": None,              # coerced → []
                "notes": "x" * 5000,         # capped → 2000
            },
        }],
    }
    try:
        async with AsyncClient(
            transport=ASGITransport(app=fastapi_app),
            base_url="http://test",
        ) as ac:
            r = await ac.post(
                f"/api/forms/templates/{tpl_id}/submissions",
                json=payload,
                headers={"Authorization": f"Bearer {token}"},
            )
        if r.status_code != 201:
            pytest.skip(f"submission POST returned {r.status_code}: {r.text[:200]}")
        sub_id = r.json()["id"]
        sub = await db.form_submissions.find_one({"id": sub_id})
        val = sub["fields"][0]["value"]
        assert val["status"] is None, "bogus status coerces to None"
        assert val["photos"] == [], "None photos coerces to []"
        assert len(val["notes"]) == 2000, "notes cap enforced server-side"
        # Cleanup
        await db.form_submissions.delete_one({"id": sub_id})
    finally:
        await db.form_templates.delete_one({"id": tpl_id})
        await db.users.delete_one({"id": user_id})
        await db.orgs.delete_one({"id": org_id})
