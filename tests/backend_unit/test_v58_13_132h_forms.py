"""
v58.13.132h — Forms Library tab: backend endpoint validation.
Tests the forms templates list, admin-only gating, and submission round-trip.
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


# ── Tests ──

@pytest.mark.anyio
async def test_forms_templates_list():
    """GET /api/forms/templates returns a non-empty list of categorised templates."""
    jwt, _ = await _get_token()
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.get(f"{BASE}/api/forms/templates", headers={"Authorization": f"Bearer {jwt}"})
    assert r.status_code == 200
    templates = r.json()
    assert isinstance(templates, list)
    assert len(templates) > 0
    # Verify structure
    t = templates[0]
    assert "id" in t
    assert "name" in t
    assert "category" in t
    assert "fields" in t


@pytest.mark.anyio
async def test_forms_categories_present():
    """Verify the expected categories exist in the templates list."""
    jwt, _ = await _get_token()
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.get(f"{BASE}/api/forms/templates", headers={"Authorization": f"Bearer {jwt}"})
    templates = r.json()
    categories = set(t["category"] for t in templates)
    # Admin user should see at least general + admin categories
    assert "general" in categories, f"Missing 'general' category. Found: {categories}"
    # The 'admin' category may or may not be present depending on data
    # But at least some categories should exist
    assert len(categories) >= 2, f"Expected multiple categories, found: {categories}"


@pytest.mark.anyio
async def test_forms_admin_category_gated():
    """Admin user sees 'admin' category templates; the backend filters for non-admins."""
    jwt, user = await _get_token()
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.get(f"{BASE}/api/forms/templates", headers={"Authorization": f"Bearer {jwt}"})
    templates = r.json()
    categories = set(t["category"] for t in templates)
    if user.get("role") == "admin":
        assert "admin" in categories, "Admin user should see admin category"
    # Non-admin testing would require a worker account — verified client-side


@pytest.mark.anyio
async def test_form_template_detail():
    """GET /api/forms/templates/{id} returns full template with fields."""
    jwt, _ = await _get_token()
    async with httpx.AsyncClient(timeout=15) as c:
        # First get list
        r = await c.get(f"{BASE}/api/forms/templates", headers={"Authorization": f"Bearer {jwt}"})
        templates = r.json()
        assert len(templates) > 0
        tid = templates[0]["id"]
        # Fetch detail
        r2 = await c.get(f"{BASE}/api/forms/templates/{tid}", headers={"Authorization": f"Bearer {jwt}"})
    assert r2.status_code == 200
    detail = r2.json()
    assert detail["id"] == tid
    assert "fields" in detail
    assert isinstance(detail["fields"], list)


@pytest.mark.anyio
async def test_form_access_check():
    """GET /api/forms/templates/{id}/access-check returns access info."""
    jwt, _ = await _get_token()
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.get(f"{BASE}/api/forms/templates", headers={"Authorization": f"Bearer {jwt}"})
        templates = r.json()
        assert len(templates) > 0
        tid = templates[0]["id"]
        r2 = await c.get(f"{BASE}/api/forms/templates/{tid}/access-check", headers={"Authorization": f"Bearer {jwt}"})
    assert r2.status_code == 200
    ac = r2.json()
    assert "ok" in ac
    assert "mode" in ac


@pytest.mark.anyio
async def test_form_submission_round_trip():
    """POST /api/forms/templates/{id}/submissions creates a submission."""
    jwt, _ = await _get_token()
    async with httpx.AsyncClient(timeout=15) as c:
        # Find a simple form (general category, few fields)
        r = await c.get(f"{BASE}/api/forms/templates", headers={"Authorization": f"Bearer {jwt}"})
        templates = r.json()
        # Pick one with few fields for clean testing
        simple = None
        for t in templates:
            if t.get("category") == "near_miss" and len(t.get("fields", [])) <= 15:
                simple = t
                break
        if not simple:
            simple = templates[0]

        tid = simple["id"]
        # Build minimal payload
        fields_payload = []
        for f in simple.get("fields", []):
            val = None
            if f["type"] == "text":
                val = "Test value"
            elif f["type"] == "textarea":
                val = "Test description"
            elif f["type"] == "date":
                val = "2026-09-06"
            elif f["type"] == "select" and f.get("options"):
                val = f["options"][0]
            elif f["type"] == "radio" and f.get("options"):
                val = f["options"][0]
            fields_payload.append({
                "id": f["id"],
                "label": f["label"],
                "type": f["type"],
                "value": val,
            })

        r2 = await c.post(
            f"{BASE}/api/forms/templates/{tid}/submissions",
            headers={"Authorization": f"Bearer {jwt}"},
            json={"fields": fields_payload},
        )
    # Should succeed (201 or 200)
    assert r2.status_code in (200, 201), f"Submission failed: {r2.status_code} {r2.text}"
    sub = r2.json()
    assert "id" in sub
    assert sub.get("template_id") == tid
