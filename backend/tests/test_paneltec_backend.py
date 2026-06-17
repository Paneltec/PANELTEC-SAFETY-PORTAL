"""End-to-end backend tests for Paneltec Civil Phase 2."""
import io
import os
import time
import uuid

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://whs-compliance.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

DEMO_EMAIL = "demo@paneltec.com"
WORKER_EMAIL = "worker@paneltec.com"
ADMIN_EMAIL = "admin@paneltec.com"
PASSWORD = "demo123"


# ---------- Fixtures ----------
@pytest.fixture(scope="session")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _login(s, email, password):
    r = s.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    return r


@pytest.fixture(scope="session")
def demo_token(session):
    r = _login(session, DEMO_EMAIL, PASSWORD)
    assert r.status_code == 200, f"demo login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def demo_user(session):
    r = _login(session, DEMO_EMAIL, PASSWORD)
    assert r.status_code == 200
    return r.json()["user"]


@pytest.fixture(scope="session")
def worker_token(session):
    r = _login(session, WORKER_EMAIL, PASSWORD)
    assert r.status_code == 200, f"worker login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def admin_token(session):
    r = _login(session, ADMIN_EMAIL, PASSWORD)
    assert r.status_code == 200
    return r.json()["access_token"]


def _hdr(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ---------- Auth ----------
class TestAuth:
    def test_login_success_returns_token_and_user(self, session):
        r = _login(session, DEMO_EMAIL, PASSWORD)
        assert r.status_code == 200
        data = r.json()
        assert "access_token" in data and isinstance(data["access_token"], str) and len(data["access_token"]) > 20
        u = data["user"]
        assert u["email"] == DEMO_EMAIL
        assert u["role"] == "hseq_lead"
        assert u.get("org_id")
        assert isinstance(u.get("workspace_ids"), list) and len(u["workspace_ids"]) >= 1

    def test_login_invalid_returns_401(self, session):
        r = session.post(f"{API}/auth/login", json={"email": DEMO_EMAIL, "password": "wrong"}, timeout=20)
        assert r.status_code == 401

    def test_me_with_token(self, session, demo_token):
        r = session.get(f"{API}/auth/me", headers=_hdr(demo_token), timeout=15)
        assert r.status_code == 200
        u = r.json()
        assert u["email"] == DEMO_EMAIL
        assert u["role"] == "hseq_lead"

    def test_me_without_token(self, session):
        r = session.get(f"{API}/auth/me", timeout=15)
        assert r.status_code in (401, 403)


# ---------- Dashboard ----------
class TestDashboard:
    def test_metrics_with_token(self, session, demo_token):
        r = session.get(f"{API}/dashboard/metrics", headers=_hdr(demo_token), timeout=15)
        assert r.status_code == 200
        d = r.json()
        for k in ["swms_count", "prestarts_count", "diary_count", "hazards_count", "incidents_count", "inspections_count"]:
            assert k in d, f"missing {k}"
            assert isinstance(d[k], int)
            assert d[k] >= 4, f"{k}={d[k]} expected >=4"
        assert "attention_score" in d
        # accept either "band" or "attention_band"
        assert ("band" in d) or ("attention_band" in d)

    def test_metrics_without_token(self, session):
        r = session.get(f"{API}/dashboard/metrics", timeout=15)
        assert r.status_code in (401, 403)


# ---------- OpenAPI ----------
class TestOpenAPI:
    def test_openapi_includes_routers(self, session):
        r = session.get(f"{API}/openapi.json", timeout=15)
        assert r.status_code == 200
        spec = r.json()
        paths = " ".join(spec.get("paths", {}).keys())
        for needle in ["/api/auth/login", "/api/swms", "/api/pre-starts", "/api/site-diary",
                       "/api/hazards", "/api/incidents", "/api/inspections",
                       "/api/dashboard/metrics", "/api/ai/swms-draft"]:
            assert needle in paths, f"missing path {needle}"


# ---------- Generic CRUD per entity ----------
ENTITIES = {
    "swms": {
        "path": "swms",
        "min_seed": 8,
        "create_payload": lambda ws: {
            "workspace_id": ws,
            "title": f"TEST_SWMS_{uuid.uuid4().hex[:6]}",
            "job_description": "Test job description for SWMS",
            "tasks": [{"step": "step1", "hazards": ["h1"], "controls": ["c1"]}],
            "ppe": ["hi-vis"],
            "status": "draft",
        },
        "patch": {"title": "TEST_SWMS_UPDATED"},
    },
    "pre-starts": {
        "path": "pre-starts",
        "min_seed": 12,
        "create_payload": lambda ws: {
            "workspace_id": ws,
            "date": "2026-01-15",
            "crew_lead": "Test Lead",
            "work_summary": "Test work summary",
            "hazards": ["hazard1"],
            "swms_links": [],
            "sign_ons": [],
        },
        "patch": {"crew_lead": "Updated Lead"},
    },
    "site-diary": {
        "path": "site-diary",
        "min_seed": 10,
        "create_payload": lambda ws: {
            "workspace_id": ws,
            "date": "2026-01-15",
            "raw_notes": "TEST raw notes",
            "structured": {"activities": [], "delays": [], "deliveries": [], "visitors": [], "weather": "sunny", "safety_observations": []},
        },
        "patch": {"raw_notes": "updated notes"},
    },
    "hazards": {
        "path": "hazards",
        "min_seed": 6,
        "create_payload": lambda ws: {
            "workspace_id": ws,
            "title": f"TEST_HAZ_{uuid.uuid4().hex[:6]}",
            "severity": "medium",
            "description": "Test hazard",
            "controls": ["c1"],
        },
        "patch": {"severity": "high"},
    },
    "incidents": {
        "path": "incidents",
        "min_seed": 4,
        "create_payload": lambda ws: {
            "workspace_id": ws,
            "title": f"TEST_INC_{uuid.uuid4().hex[:6]}",
            "occurred_at": "2026-01-15T10:00:00Z",
            "category": "near_miss",
            "description": "Test incident",
            "immediate_actions": "actions",
            "follow_ups": [],
            "status": "open",
        },
        "patch": {"status": "investigating"},
    },
    "inspections": {
        "path": "inspections",
        "min_seed": 6,
        "create_payload": lambda ws: {
            "workspace_id": ws,
            "template": "site_walk",
            "template_name": "Site walk",
            "date": "2026-01-15",
            "title": f"TEST_INS_{uuid.uuid4().hex[:6]}",
            "items": [{"label": "Item 1", "result": "pass", "notes": ""}],
        },
        "patch": {"title": "TEST_INS_UPDATED"},
    },
}


@pytest.mark.parametrize("entity_key", list(ENTITIES.keys()))
def test_entity_crud(session, demo_token, demo_user, entity_key):
    cfg = ENTITIES[entity_key]
    path = cfg["path"]
    ws = demo_user["workspace_ids"][0]

    # LIST
    r = session.get(f"{API}/{path}", headers=_hdr(demo_token), timeout=20)
    assert r.status_code == 200, f"list {path} failed: {r.status_code} {r.text[:200]}"
    items = r.json()
    assert isinstance(items, list)
    assert len(items) >= cfg["min_seed"], f"{path} seeded count {len(items)} < {cfg['min_seed']}"

    # CREATE
    payload = cfg["create_payload"](ws)
    r = session.post(f"{API}/{path}", headers=_hdr(demo_token), json=payload, timeout=20)
    assert r.status_code in (200, 201), f"create {path} failed: {r.status_code} {r.text[:300]}"
    created = r.json()
    cid = created.get("id") or created.get("_id")
    assert cid, f"no id returned for {path}: {created}"

    # GET single
    r = session.get(f"{API}/{path}/{cid}", headers=_hdr(demo_token), timeout=20)
    assert r.status_code == 200, f"get one {path} failed: {r.status_code} {r.text[:200]}"

    # PATCH
    r = session.patch(f"{API}/{path}/{cid}", headers=_hdr(demo_token), json=cfg["patch"], timeout=20)
    assert r.status_code in (200, 204), f"patch {path} failed: {r.status_code} {r.text[:200]}"

    # Verify patch persisted
    r = session.get(f"{API}/{path}/{cid}", headers=_hdr(demo_token), timeout=20)
    assert r.status_code == 200
    body = r.json()
    key, val = list(cfg["patch"].items())[0]
    assert body.get(key) == val, f"patch did not persist for {path}: expected {val}, got {body.get(key)}"

    # DELETE
    r = session.delete(f"{API}/{path}/{cid}", headers=_hdr(demo_token), timeout=20)
    assert r.status_code in (200, 204), f"delete {path} failed: {r.status_code}"

    # Verify soft-delete -> 404
    r = session.get(f"{API}/{path}/{cid}", headers=_hdr(demo_token), timeout=20)
    assert r.status_code == 404, f"deleted {path} still accessible (status {r.status_code})"


def test_entity_requires_auth(session):
    r = session.get(f"{API}/swms", timeout=15)
    assert r.status_code in (401, 403)


# ---------- SWMS review RBAC ----------
class TestSwmsReview:
    def test_worker_forbidden(self, session, demo_token, demo_user, worker_token):
        # Create SWMS as demo (hseq_lead)
        payload = ENTITIES["swms"]["create_payload"](demo_user["workspace_ids"][0])
        r = session.post(f"{API}/swms", headers=_hdr(demo_token), json=payload, timeout=20)
        assert r.status_code in (200, 201)
        sid = r.json()["id"]

        # Worker tries to review
        r = session.post(f"{API}/swms/{sid}/review", headers=_hdr(worker_token),
                         json={"action": "approve"}, timeout=20)
        assert r.status_code == 403

        # hseq_lead can approve
        r = session.post(f"{API}/swms/{sid}/review", headers=_hdr(demo_token),
                         json={"action": "approve"}, timeout=20)
        assert r.status_code in (200, 204), f"approve failed: {r.status_code} {r.text[:200]}"

        # Verify status update
        r = session.get(f"{API}/swms/{sid}", headers=_hdr(demo_token), timeout=20)
        assert r.status_code == 200
        st = r.json().get("status")
        assert st in ("approved", "active", "accepted"), f"status after approve = {st}"

        # cleanup
        session.delete(f"{API}/swms/{sid}", headers=_hdr(demo_token), timeout=15)


# ---------- AI endpoints ----------
class TestAI:
    def test_swms_draft(self, session, demo_token):
        r = session.post(
            f"{API}/ai/swms-draft",
            headers=_hdr(demo_token),
            json={"job_description": "Install rebar on Level 2 slab", "location": "Sydney CBD"},
            timeout=120,
        )
        if r.status_code == 503:
            pytest.skip(f"AI swms-draft 503 (likely budget): {r.text[:200]}")
        assert r.status_code == 200, f"{r.status_code} {r.text[:400]}"
        d = r.json()
        for k in ["tasks", "hazards", "controls", "ppe"]:
            assert k in d, f"missing {k} in response"

    def test_diary_structure(self, session, demo_token):
        r = session.post(
            f"{API}/ai/diary-structure",
            headers=_hdr(demo_token),
            json={"raw_notes": "Poured concrete 7am. Crane delayed 30min. Visitor: inspector. Weather sunny."},
            timeout=120,
        )
        if r.status_code == 503:
            pytest.skip(f"AI diary-structure 503: {r.text[:200]}")
        assert r.status_code == 200, f"{r.status_code} {r.text[:400]}"
        d = r.json()
        for k in ["activities", "delays", "deliveries", "visitors", "weather", "safety_observations"]:
            assert k in d, f"missing {k}"

    def test_hazard_vision(self, session, demo_token):
        # Build a small valid JPEG using PIL if available
        try:
            from PIL import Image
            img = Image.new("RGB", (320, 240), (200, 50, 50))
            buf = io.BytesIO()
            img.save(buf, format="JPEG")
            buf.seek(0)
        except Exception:
            pytest.skip("PIL not available to build test image")

        files = {"file": ("hazard.jpg", buf.getvalue(), "image/jpeg")}
        headers = {"Authorization": f"Bearer {demo_token}"}
        r = requests.post(f"{API}/ai/hazard-vision", headers=headers, files=files, timeout=120)
        if r.status_code == 503:
            pytest.skip(f"AI hazard-vision 503: {r.text[:200]}")
        assert r.status_code == 200, f"{r.status_code} {r.text[:400]}"
        d = r.json()
        for k in ["identified_hazards", "suggested_controls", "severity", "summary", "photo_url"]:
            assert k in d, f"missing {k} in hazard-vision response"
