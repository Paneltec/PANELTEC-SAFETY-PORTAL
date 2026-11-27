"""Isolated security tests for mobile PIN pairing and onboarding sessions."""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from starlette.requests import Request

BACKEND = Path(__file__).resolve().parents[1] / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "mobile_pairing_unit_tests")
os.environ.setdefault("JWT_SECRET", "mobile-pairing-test-secret")

import auth
import auth_mobile_pin
import mobile_auth


def _run(coro):
    return asyncio.run(coro)


def _request(authorization: str | None = None) -> Request:
    headers = []
    if authorization:
        headers.append((b"authorization", authorization.encode("ascii")))
    return Request({
        "type": "http",
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": "/test",
        "raw_path": b"/test",
        "query_string": b"",
        "headers": headers,
        "client": ("127.0.0.1", 12345),
        "server": ("test", 80),
    })


def _matches(doc: dict, query: dict) -> bool:
    for key, expected in query.items():
        if key == "mobile_devices.device_id":
            if not any(d.get("device_id") == expected
                       for d in doc.get("mobile_devices", []) if isinstance(d, dict)):
                return False
        elif isinstance(expected, dict):
            value = doc.get(key)
            if "$exists" in expected and (key in doc) != expected["$exists"]:
                return False
            if "$ne" in expected and value == expected["$ne"]:
                return False
        elif doc.get(key) != expected:
            return False
    return True


class _FakeCollection:
    def __init__(self, docs=()):
        self.docs = [dict(doc) for doc in docs]
        self.queries = []
        self.updates = []

    async def find_one(self, query=None, *args, **kwargs):
        query = query or {}
        self.queries.append(query)
        return next((dict(doc) for doc in self.docs if _matches(doc, query)), None)

    def find(self, query=None, *args, **kwargs):
        query = query or {}
        self.queries.append(query)
        return _AsyncDocs([dict(doc) for doc in self.docs if _matches(doc, query)])

    async def update_one(self, query, update, **kwargs):
        self.updates.append((query, update))
        target = next((doc for doc in self.docs if _matches(doc, query)), None)
        if target is None:
            return SimpleNamespace(modified_count=0)
        for key, values in update.get("$set", {}).items():
            target[key] = values
        for key, value in update.get("$addToSet", {}).items():
            target.setdefault(key, [])
            if value not in target[key]:
                target[key].append(value)
        return SimpleNamespace(modified_count=1)


class _AsyncDocs:
    def __init__(self, docs):
        self.docs = docs

    def __aiter__(self):
        self.index = 0
        return self

    async def __anext__(self):
        if self.index >= len(self.docs):
            raise StopAsyncIteration
        doc = self.docs[self.index]
        self.index += 1
        return doc


def _install_users(monkeypatch, *users):
    collection = _FakeCollection(users)
    monkeypatch.setattr(mobile_auth.db, "users", collection)
    monkeypatch.setattr(auth_mobile_pin.db, "users", collection)
    monkeypatch.setattr(auth.db, "users", collection)
    return collection


def test_employee_id_cannot_be_used_instead_of_a_paired_device(monkeypatch):
    users = _install_users(monkeypatch, {
        "id": "worker-1", "simpro_employee_id": "EMP-1",
        "mobile_pin_hash": "stored-pin", "mobile_devices": [],
    })

    with pytest.raises(HTTPException) as exc:
        _run(mobile_auth.pin_verify(
            mobile_auth.PinVerifyIn(pin_hash="1234", simpro_employee_id="EMP-1")
        ))

    assert exc.value.status_code == 403
    assert users.queries == []


def test_pin_verify_only_checks_the_user_paired_to_the_device(monkeypatch):
    users = _install_users(monkeypatch, {
        "id": "worker-1", "email": "worker@example.test", "name": "Worker",
        "simpro_employee_id": "EMP-1", "token_version": 8,
        "mobile_pin_hash": "1111",
        "mobile_devices": [{"device_id": "paired-device"}],
    })
    monkeypatch.setattr(mobile_auth, "_verify_pin", lambda pin, stored: pin == stored)

    result = _run(mobile_auth.pin_verify(
        mobile_auth.PinVerifyIn(pin_hash="1111", device_id="paired-device")
    ))

    assert result["user"]["id"] == "worker-1"
    payload = auth.jwt.decode(result["token"], auth._secret(), algorithms=[auth.JWT_ALGORITHM])
    assert payload["tv"] == 8


def test_unpaired_id_and_another_users_pin_are_rejected(monkeypatch):
    users = _install_users(monkeypatch, {
        "id": "worker-1", "simpro_employee_id": "EMP-1",
        "mobile_pin_hash": "1111",
        "mobile_devices": [{"device_id": "paired-device"}],
    }, {
        "id": "worker-2", "simpro_employee_id": "EMP-2",
        "mobile_pin_hash": "2222",
        "mobile_devices": [{"device_id": "other-paired-device"}],
    })
    monkeypatch.setattr(mobile_auth, "_verify_pin", lambda pin, stored: pin == stored)

    with pytest.raises(HTTPException) as exc:
        _run(mobile_auth.pin_verify(
            mobile_auth.PinVerifyIn(pin_hash="1111", device_id="other-device")
        ))
    assert exc.value.status_code == 403
    assert exc.value.detail["error"] == "device_not_paired"

    with pytest.raises(HTTPException) as exc:
        _run(mobile_auth.pin_verify(
            mobile_auth.PinVerifyIn(pin_hash="2222", device_id="paired-device")
        ))
    assert exc.value.status_code == 401
    assert all("$addToSet" not in update for _, update in users.updates)


def test_legacy_pin_login_does_not_enroll_an_unpaired_device(monkeypatch):
    users = _install_users(monkeypatch, {
        "id": "worker-1", "email": "worker@example.test",
        "mobile_pin_hash": "stored-pin", "mobile_devices": [],
    })
    attempts = _FakeCollection()
    monkeypatch.setattr(auth_mobile_pin.db, "admin_console_pin_attempts", attempts)
    monkeypatch.setattr(auth_mobile_pin, "_check_lockout", _async_noop)

    with pytest.raises(HTTPException) as exc:
        _run(auth_mobile_pin.pin_login(
            auth_mobile_pin.MobilePinLoginIn(pin="1234", device_id="unpaired-device"),
            _request(),
        ))

    assert exc.value.status_code == 403
    assert exc.value.detail["error"] == "device_not_paired"
    assert any(q.get("mobile_devices.device_id") == "unpaired-device"
               for q in users.queries)
    assert users.updates == []


def test_legacy_pin_login_does_not_match_another_accounts_pin(monkeypatch):
    users = _install_users(monkeypatch, {
        "id": "paired-user", "email": "paired@example.test",
        "mobile_pin_hash": "1111",
        "mobile_devices": [{"device_id": "paired-device"}],
    }, {
        "id": "other-user", "email": "other@example.test",
        "mobile_pin_hash": "2222",
        "mobile_devices": [{"device_id": "other-device"}],
    })
    monkeypatch.setattr(auth_mobile_pin.bcrypt, "checkpw",
                        lambda pin, stored: pin.decode() == stored.decode())
    monkeypatch.setattr(auth_mobile_pin, "_check_lockout", _async_noop)
    monkeypatch.setattr(auth_mobile_pin, "_record_failure", _async_noop)

    with pytest.raises(HTTPException) as exc:
        _run(auth_mobile_pin.pin_login(
            auth_mobile_pin.MobilePinLoginIn(pin="2222", device_id="paired-device"),
            _request(),
        ))

    assert exc.value.status_code == 401
    assert all(query.get("id") == "paired-user"
               for query in users.queries[1:])


async def _async_noop(*args, **kwargs):
    return None


def test_pin_setup_token_is_bound_to_the_redeemed_device(monkeypatch):
    user = {"id": "worker-1", "email": "worker@example.test", "token_version": 3}
    users = _install_users(monkeypatch, user)
    monkeypatch.setattr(mobile_auth, "_hash_pin", lambda pin: "hashed-pin")
    temp = mobile_auth._create_temp_session("worker-1", "qr-device")

    with pytest.raises(HTTPException) as exc:
        _run(mobile_auth.pin_set(
            mobile_auth.PinSetIn(pin_hash="1234", device_id="other-device"),
            _request(f"Bearer {temp}"),
        ))
    assert exc.value.status_code == 401
    assert users.updates == []

    result = _run(mobile_auth.pin_set(
        mobile_auth.PinSetIn(pin_hash="1234", device_id=" qr-device "),
        _request(f"Bearer {temp}"),
    ))
    assert users.docs[0]["mobile_devices"][0]["device_id"] == "qr-device"
    payload = auth.jwt.decode(result["token"], auth._secret(), algorithms=[auth.JWT_ALGORITHM])
    assert payload["tv"] == 3


def test_temporary_onboarding_token_is_not_a_normal_session(monkeypatch):
    users = _install_users(monkeypatch, {"id": "worker-1", "token_version": 0})
    temp = mobile_auth._create_temp_session("worker-1", "qr-device")

    with pytest.raises(HTTPException) as exc:
        _run(auth.get_current_user(_request(f"Bearer {temp}"), creds=None))

    assert exc.value.status_code == 401
    assert users.queries == []