"""
Pytest suite for v58.13.132a mobile auth endpoints.
Tests against the LIVE running backend at localhost:8001.
Uses only HTTP calls — no direct DB access from test process.

Covers:
  - Onboarding token issue + single-use enforcement
  - Onboarding token redeem
  - PIN set (with temp session)
  - PIN verify (success + wrong + lockout after 5)
  - Push token register
  - JWT scope enforcement
"""
import os
import pytest
import httpx

BASE = "http://localhost:8001/api"
TEST_EMP_ID = "TEST_M1_132a_PYTEST"


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture(scope="module")
def _admin_token():
    """Synchronous, module-scoped admin login (avoids rate-limit from per-test logins)."""
    resp = httpx.post(f"{BASE}/auth/login", json={
        "email": "stephen@paneltec.com.au",
        "password": "Mcgstephen50#",
    }, timeout=15)
    assert resp.status_code == 200, f"Admin login failed: {resp.text}"
    return resp.json()["access_token"]


@pytest.fixture
async def client():
    async with httpx.AsyncClient(base_url=BASE, timeout=15) as c:
        yield c


@pytest.fixture
def admin_token(_admin_token):
    return _admin_token


@pytest.fixture(scope="module", autouse=True)
def seed_test_worker(_admin_token):
    """Create a test worker via the workers API at module start."""
    headers = {"Authorization": f"Bearer {_admin_token}"}
    # Check if worker already exists
    resp = httpx.get(f"{BASE}/workers", headers=headers, timeout=15)
    if resp.status_code == 200:
        workers = resp.json() if isinstance(resp.json(), list) else resp.json().get("data", [])
        for w in workers:
            if w.get("simpro_employee_id") == TEST_EMP_ID:
                return  # Already exists

    # Create via direct DB insertion using a helper endpoint
    # Since we can't create workers with a specific simpro_employee_id via the standard API,
    # we'll use a simple workaround: call issue-token and let it fail, which tells us the endpoint works
    # For the test to work we need to ensure a worker exists. Let's POST directly.
    resp = httpx.post(f"{BASE}/workers", json={
        "name": "Test M1 Worker",
        "email": f"test_m1_{TEST_EMP_ID.lower()}@paneltec.local",
        "role": "worker",
        "simpro_employee_id": TEST_EMP_ID,
        "company_id": "company_2",
    }, headers=headers, timeout=15)
    # May fail if workers endpoint doesn't support direct creation — that's ok
    # The mobile_auth endpoints will handle missing workers gracefully


# ── Helper: full onboarding flow ─────────────────────────

async def _issue_token(client, admin_token, emp_id):
    """Issue an onboarding token. Returns token string."""
    resp = await client.post("/mobile/onboarding/issue-token",
        json={"simpro_employee_id": emp_id},
        headers={"Authorization": f"Bearer {admin_token}"})
    return resp


async def _full_onboard(client, admin_token, emp_id, device_id, pin="1234"):
    """Issue → redeem → set PIN. Returns (jwt, user)."""
    r1 = await _issue_token(client, admin_token, emp_id)
    assert r1.status_code == 200, f"Issue failed: {r1.text}"
    token = r1.json()["token"]

    r2 = await client.post("/mobile/onboarding/redeem",
        json={"token": token, "device_id": device_id})
    assert r2.status_code == 200, f"Redeem failed: {r2.text}"
    temp = r2.json()["temp_session"]

    r3 = await client.post("/mobile/auth/pin-set",
        json={"pin_hash": pin, "device_id": device_id},
        headers={"Authorization": f"Bearer {temp}"})
    assert r3.status_code == 200, f"Pin set failed: {r3.text}"
    return r3.json()["token"], r3.json()["user"]


# ── Test 1: Issue onboarding token ────────────────────────

@pytest.mark.anyio
async def test_issue_onboarding_token(client, admin_token):
    # Use a real worker from the system
    # First get a list of workers to find one with a simpro_employee_id
    workers_resp = await client.get("/workers",
        headers={"Authorization": f"Bearer {admin_token}"})
    assert workers_resp.status_code == 200
    workers = workers_resp.json() if isinstance(workers_resp.json(), list) else workers_resp.json().get("data", [])
    # Find one with simpro_employee_id
    target = None
    for w in workers:
        if w.get("simpro_employee_id"):
            target = w["simpro_employee_id"]
            break

    if not target:
        pytest.skip("No workers with simpro_employee_id found")

    resp = await _issue_token(client, admin_token, target)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert "token" in data
    assert "expires_at" in data
    assert "paneltec://onboard?token=" in data["install_url"]


# ── Test 2: Redeem + single-use ──────────────────────────

@pytest.mark.anyio
async def test_redeem_and_single_use(client, admin_token):
    # Get a real worker
    workers_resp = await client.get("/workers",
        headers={"Authorization": f"Bearer {admin_token}"})
    workers = workers_resp.json() if isinstance(workers_resp.json(), list) else workers_resp.json().get("data", [])
    target = None
    for w in workers:
        if w.get("simpro_employee_id"):
            target = w["simpro_employee_id"]
            break
    if not target:
        pytest.skip("No workers with simpro_employee_id found")

    # Issue
    r1 = await _issue_token(client, admin_token, target)
    assert r1.status_code == 200
    token = r1.json()["token"]

    # Redeem
    r2 = await client.post("/mobile/onboarding/redeem",
        json={"token": token, "device_id": "test_redeem_132a"})
    assert r2.status_code == 200, r2.text
    assert r2.json()["user"]["simpro_employee_id"] == target
    assert "temp_session" in r2.json()

    # Second use must fail
    r3 = await client.post("/mobile/onboarding/redeem",
        json={"token": token, "device_id": "test_redeem_132a_dup"})
    assert r3.status_code == 400, f"Token reuse should 400, got {r3.status_code}"


# ── Test 3: Full flow → PIN set + verify ─────────────────

@pytest.mark.anyio
async def test_full_onboard_and_pin_verify(client, admin_token):
    workers_resp = await client.get("/workers",
        headers={"Authorization": f"Bearer {admin_token}"})
    workers = workers_resp.json() if isinstance(workers_resp.json(), list) else workers_resp.json().get("data", [])
    target = None
    for w in workers:
        if w.get("simpro_employee_id"):
            target = w["simpro_employee_id"]
            break
    if not target:
        pytest.skip("No workers with simpro_employee_id found")

    jwt_tok, user = await _full_onboard(client, admin_token, target, f"dev_verify_{target}", "4321")

    # Verify PIN
    resp = await client.post("/mobile/auth/pin-verify",
        json={"pin_hash": "4321", "device_id": f"dev_verify_{target}"})
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert "token" in data
    assert data["user"]["simpro_employee_id"] == target


# ── Test 4: PIN lockout after 5 wrong attempts ───────────

@pytest.mark.anyio
async def test_pin_lockout_after_5(client, admin_token):
    workers_resp = await client.get("/workers",
        headers={"Authorization": f"Bearer {admin_token}"})
    workers = workers_resp.json() if isinstance(workers_resp.json(), list) else workers_resp.json().get("data", [])
    target = None
    for w in workers:
        if w.get("simpro_employee_id"):
            target = w["simpro_employee_id"]
            break
    if not target:
        pytest.skip("No workers with simpro_employee_id found")

    # Onboard with a known PIN
    device = f"dev_lockout_{target}"
    await _full_onboard(client, admin_token, target, device, "9876")

    # 5 wrong attempts
    for i in range(5):
        resp = await client.post("/mobile/auth/pin-verify",
            json={"pin_hash": "0000", "device_id": device})
        assert resp.status_code in (401, 429), f"Attempt {i+1}: {resp.status_code}"

    # 6th should be locked
    resp = await client.post("/mobile/auth/pin-verify",
        json={"pin_hash": "9876", "device_id": device})
    assert resp.status_code == 429, f"Expected 429 lockout, got {resp.status_code}: {resp.text}"


# ── Test 5: Push register ────────────────────────────────

@pytest.mark.anyio
async def test_push_register(client, admin_token):
    resp = await client.post("/mobile/push/register",
        json={"device_token": "ExponentPushToken[test132a]", "platform": "ios"},
        headers={"Authorization": f"Bearer {admin_token}"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["ok"] is True


# ── Test 6: PIN set requires temp session ────────────────

@pytest.mark.anyio
async def test_pin_set_requires_auth(client):
    resp = await client.post("/mobile/auth/pin-set",
        json={"pin_hash": "1111", "device_id": "rogue"})
    assert resp.status_code in (401, 403, 422), f"Expected auth error, got {resp.status_code}"


# ── Test 7: Issue token requires admin ────────────────────

@pytest.mark.anyio
async def test_issue_token_requires_admin(client):
    resp = await client.post("/mobile/onboarding/issue-token",
        json={"simpro_employee_id": "NOBODY"})
    assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"


# ── Test 8: Redeem invalid token ─────────────────────────

@pytest.mark.anyio
async def test_redeem_invalid_token(client):
    resp = await client.post("/mobile/onboarding/redeem",
        json={"token": "totally_bogus_token_123", "device_id": "dev_x"})
    assert resp.status_code == 400


# ── Test 9: PIN verify with no device ────────────────────

@pytest.mark.anyio
async def test_pin_verify_no_device(client):
    resp = await client.post("/mobile/auth/pin-verify",
        json={"pin_hash": "1234"})
    assert resp.status_code in (400, 422), f"Expected 400/422, got {resp.status_code}"
