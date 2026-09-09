"""
v58.13.132j — Forms: Category-first navigation + Review-before-Submit.
Tests form templates listing, category grouping, submission round-trip,
and field payload validation (review mode data integrity).
"""
import os
import pytest
import httpx

BASE = os.getenv("BACKEND_URL", "http://localhost:8001")
EMAIL = "stephen@paneltec.com.au"
PASSWORD = "Mcgstephen50#"

# ── Auth helper ──

_token_cache = {}

async def _get_token():
    if "jwt" in _token_cache:
        return _token_cache["jwt"], _token_cache["user"]
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.post(f"{BASE}/api/auth/login", json={"email": EMAIL, "password": PASSWORD})
        r.raise_for_status()
        data = r.json()
        _token_cache["jwt"] = data["access_token"]
        _token_cache["user"] = data.get("user", {})
        return _token_cache["jwt"], _token_cache["user"]


@pytest.fixture
def anyio_backend():
    return "asyncio"


# ── Category-first navigation tests ──

@pytest.mark.anyio
async def test_templates_grouped_by_category():
    """Templates list contains at least 3 distinct categories for grid display."""
    jwt, _ = await _get_token()
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.get(f"{BASE}/api/forms/templates", headers={"Authorization": f"Bearer {jwt}"})
    assert r.status_code == 200
    templates = r.json()
    categories = set(t["category"] for t in templates)
    assert len(categories) >= 3, f"Expected 3+ categories for grid, got: {categories}"


@pytest.mark.anyio
async def test_templates_have_category_field():
    """Every template has a category field (required for grouping)."""
    jwt, _ = await _get_token()
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.get(f"{BASE}/api/forms/templates", headers={"Authorization": f"Bearer {jwt}"})
    templates = r.json()
    for t in templates:
        assert "category" in t, f"Template {t.get('name')} missing category field"
        assert t["category"], f"Template {t.get('name')} has empty category"


@pytest.mark.anyio
async def test_template_detail_has_fields():
    """Template detail endpoint returns fields array for form runner rendering."""
    jwt, _ = await _get_token()
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.get(f"{BASE}/api/forms/templates", headers={"Authorization": f"Bearer {jwt}"})
        templates = r.json()
        assert len(templates) > 0
        tid = templates[0]["id"]
        r2 = await c.get(f"{BASE}/api/forms/templates/{tid}", headers={"Authorization": f"Bearer {jwt}"})
    assert r2.status_code == 200
    detail = r2.json()
    assert "fields" in detail
    assert isinstance(detail["fields"], list)
    if len(detail["fields"]) > 0:
        field = detail["fields"][0]
        assert "id" in field
        assert "label" in field
        assert "type" in field


# ── Review-before-Submit tests ──

@pytest.mark.anyio
async def test_submission_round_trip_with_review_payload():
    """
    Simulate Review-before-Submit: build a payload from template fields,
    submit it, and verify the response preserves field structure.
    This validates that the review screen's data is submission-ready.
    """
    jwt, _ = await _get_token()
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.get(f"{BASE}/api/forms/templates", headers={"Authorization": f"Bearer {jwt}"})
        templates = r.json()
        # Find a form with few fields
        simple = None
        for t in templates:
            if len(t.get("fields", [])) <= 10 and len(t.get("fields", [])) > 0:
                simple = t
                break
        if not simple:
            simple = templates[0]

        tid = simple["id"]
        # Build payload mimicking what review mode would produce
        fields_payload = []
        for f in simple.get("fields", []):
            val = None
            ftype = f["type"]
            if ftype == "text":
                val = "Review test value"
            elif ftype == "textarea":
                val = "Review test description — verified before submit"
            elif ftype == "date":
                val = "2026-09-06"
            elif ftype == "number":
                val = "42"
            elif ftype in ("select", "radio") and f.get("options"):
                val = f["options"][0]
            elif ftype == "gps":
                val = {"lat": -34.79, "lng": 149.13, "address": "Test location"}
            elif ftype == "photo":
                val = []
            fields_payload.append({
                "id": f["id"],
                "label": f["label"],
                "type": ftype,
                "value": val,
            })

        r2 = await c.post(
            f"{BASE}/api/forms/templates/{tid}/submissions",
            headers={"Authorization": f"Bearer {jwt}"},
            json={"fields": fields_payload},
        )
    assert r2.status_code in (200, 201), f"Submission failed: {r2.status_code} {r2.text}"
    sub = r2.json()
    assert "id" in sub
    assert sub.get("template_id") == tid
    # Verify field count matches
    assert len(sub.get("fields", [])) == len(fields_payload), "Field count mismatch after submission"


@pytest.mark.anyio
async def test_submission_preserves_field_values():
    """
    Submit with known values and verify the response fields
    retain those values (data integrity through review→submit pipeline).
    """
    jwt, _ = await _get_token()
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.get(f"{BASE}/api/forms/templates", headers={"Authorization": f"Bearer {jwt}"})
        templates = r.json()
        # Find a form with a text field
        target = None
        text_field = None
        for t in templates:
            for f in t.get("fields", []):
                if f["type"] == "text":
                    target = t
                    text_field = f
                    break
            if target:
                break
        if not target or not text_field:
            pytest.skip("No template with text field found")

        test_value = "Review-mode integrity check v132j"
        fields_payload = [{
            "id": text_field["id"],
            "label": text_field["label"],
            "type": "text",
            "value": test_value,
        }]

        r2 = await c.post(
            f"{BASE}/api/forms/templates/{target['id']}/submissions",
            headers={"Authorization": f"Bearer {jwt}"},
            json={"fields": fields_payload},
        )
    assert r2.status_code in (200, 201)
    sub = r2.json()
    submitted_fields = {f["id"]: f for f in sub.get("fields", [])}
    assert text_field["id"] in submitted_fields
    assert submitted_fields[text_field["id"]]["value"] == test_value


@pytest.mark.anyio
async def test_access_check_for_form_runner():
    """Access check endpoint works (needed by form runner before rendering)."""
    jwt, _ = await _get_token()
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.get(f"{BASE}/api/forms/templates", headers={"Authorization": f"Bearer {jwt}"})
        templates = r.json()
        assert len(templates) > 0
        tid = templates[0]["id"]
        r2 = await c.get(
            f"{BASE}/api/forms/templates/{tid}/access-check",
            headers={"Authorization": f"Bearer {jwt}"},
        )
    assert r2.status_code == 200
    ac = r2.json()
    assert "ok" in ac
    assert "mode" in ac


@pytest.mark.anyio
async def test_submission_list_after_submit():
    """After submitting, the submissions list for that template shows the new entry."""
    jwt, _ = await _get_token()
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.get(f"{BASE}/api/forms/templates", headers={"Authorization": f"Bearer {jwt}"})
        templates = r.json()
        # Use first template
        tid = templates[0]["id"]

        # Submit
        fields_payload = [{
            "id": "test_field",
            "label": "Test",
            "type": "text",
            "value": "v132j list check",
        }]
        await c.post(
            f"{BASE}/api/forms/templates/{tid}/submissions",
            headers={"Authorization": f"Bearer {jwt}"},
            json={"fields": fields_payload},
        )

        # List submissions
        r3 = await c.get(
            f"{BASE}/api/forms/templates/{tid}/submissions",
            headers={"Authorization": f"Bearer {jwt}"},
        )
    assert r3.status_code == 200
    subs = r3.json()
    assert isinstance(subs, list)
    assert len(subs) > 0
    assert subs[0].get("template_id") == tid
