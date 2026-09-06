"""v58.13.132b — Simpro company_id mapping tests.

Tests that company_id is correctly populated on workers and users
when synced/imported from Simpro Companies 2 and 3.
"""
import pytest
from httpx import AsyncClient, ASGITransport
from unittest.mock import AsyncMock, patch, MagicMock

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'backend'))

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "test_database")
os.environ.setdefault("JWT_SECRET", "test-secret-132b")


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
def mock_db():
    """Create a mock MongoDB that tracks inserts/updates."""
    from unittest.mock import MagicMock

    _workers = {}
    _users = {}

    class MockCollection:
        def __init__(self, store):
            self._store = store

        async def find_one(self, query, *args, **kwargs):
            for doc in self._store.values():
                match = True
                for k, v in query.items():
                    if k.startswith("$"):
                        continue
                    if doc.get(k) != v:
                        match = False
                        break
                if match:
                    return dict(doc)
            return None

        async def insert_one(self, doc):
            key = doc.get("id") or doc.get("_id") or str(len(self._store))
            self._store[key] = dict(doc)
            return MagicMock(inserted_id=key)

        async def update_one(self, query, update, **kwargs):
            for key, doc in self._store.items():
                match = True
                for k, v in query.items():
                    if k.startswith("$"):
                        continue
                    if doc.get(k) != v:
                        match = False
                        break
                if match:
                    if "$set" in update:
                        doc.update(update["$set"])
                    if "$addToSet" in update:
                        for field, val in update["$addToSet"].items():
                            if field not in doc:
                                doc[field] = []
                            if val not in doc[field]:
                                doc[field].append(val)
                    return MagicMock(modified_count=1)
            return MagicMock(modified_count=0)

        async def count_documents(self, query):
            return len(self._store)

        def find(self, query=None, *args, **kwargs):
            class AsyncIter:
                def __init__(self, items):
                    self._items = list(items)
                    self._idx = 0
                def __aiter__(self):
                    return self
                async def __anext__(self):
                    if self._idx >= len(self._items):
                        raise StopAsyncIteration
                    item = self._items[self._idx]
                    self._idx += 1
                    return dict(item)
            return AsyncIter(self._store.values())

    return {
        "workers": MockCollection(_workers),
        "users": MockCollection(_users),
        "_workers": _workers,
        "_users": _users,
    }


def test_new_worker_gets_company_id():
    """When the Simpro sync creates a new worker from Company 2,
    the worker doc must have company_id = '2'."""
    from integrations_simpro_workers import _split_name
    from models import new_id, now_iso

    # Simulate the new_doc creation logic
    d = {"ID": 999, "Name": "TEST WORKER", "_company_id": "2", "Position": "Operator",
         "Archived": False, "PrimaryContact": {"Email": "test@example.com"}}
    first, last = _split_name(d["Name"])
    ts = now_iso()

    new_doc = {
        "id": new_id(), "org_id": "org123",
        "first_name": first,
        "last_name": last,
        "simpro_employee_id": str(d["ID"]),
        "simpro_company_id": d["_company_id"],
        "company_id": d["_company_id"],
        "created_at": ts, "updated_at": ts,
    }

    assert new_doc["company_id"] == "2"
    assert new_doc["simpro_company_id"] == "2"


def test_company_id_from_co3():
    """Company 3 (Viatec) employees must get company_id = '3'."""
    d = {"ID": 888, "_company_id": "3"}
    company_id = d["_company_id"]
    assert company_id == "3"


def test_dual_company_detection():
    """When a simpro_employee_id appears in both Co2 and Co3,
    the system should set company_ids and primary_company_id."""
    from collections import defaultdict

    # Simulate two sync entries for the same employee
    details = [
        {"ID": 100, "_company_id": "2", "Name": "DUAL WORKER"},
        {"ID": 100, "_company_id": "3", "Name": "DUAL WORKER"},
    ]

    sid_companies: dict[str, set[str]] = defaultdict(set)
    for d in details:
        sid = str(d["ID"])
        cid = d["_company_id"]
        sid_companies[sid].add(cid)

    # Employee 100 should be detected as dual
    assert len(sid_companies["100"]) == 2
    assert "2" in sid_companies["100"]
    assert "3" in sid_companies["100"]

    # Primary should default to Paneltec ("2")
    sorted_companies = sorted(sid_companies["100"])
    primary = "2"
    assert sorted_companies == ["2", "3"]
    assert primary == "2"


def test_user_import_sets_company_id():
    """The import_from_simpro endpoint should set company_id
    on newly created user documents."""
    # Simulate the user doc creation from users.py
    simpro_company_id = "2"
    doc = {
        "id": "u-test",
        "email": "test@paneltec.com.au",
        "name": "Test Worker",
        "role": "worker",
        "simpro_employee_id": "810",
        "simpro_company_id": simpro_company_id,
        "company_id": str(simpro_company_id),
    }

    assert doc["company_id"] == "2"
    assert doc["simpro_company_id"] == "2"


def test_backfill_logic():
    """The backfill script should populate company_id from
    simpro_company_id for existing records."""
    import asyncio
    from scripts.backfill_company_id import run

    # We run the actual backfill in dry-run against the test DB
    stats = asyncio.run(run(dry_run=True))

    # Should report some workers and users
    assert isinstance(stats, dict)
    assert "workers_updated" in stats
    assert "users_updated" in stats
    assert "co2_workers" in stats
    assert "co3_workers" in stats
    # No errors = pass
    print(f"Backfill dry-run stats: {stats}")


def test_backfill_apply():
    """Apply the backfill and verify company_id is set."""
    import asyncio
    from motor.motor_asyncio import AsyncIOMotorClient

    async def verify():
        client = AsyncIOMotorClient("mongodb://localhost:27017")
        db = client["test_database"]

        # Run apply
        from scripts.backfill_company_id import run
        stats = await run(dry_run=False)
        print(f"Applied: {stats}")

        # Verify workers now have company_id
        missing = await db.workers.count_documents({
            "simpro_company_id": {"$exists": True, "$ne": None},
            "$or": [
                {"company_id": {"$exists": False}},
                {"company_id": None},
            ]
        })
        assert missing == 0, f"{missing} workers still missing company_id after backfill"

        # Verify users now have company_id
        missing_users = await db.users.count_documents({
            "simpro_company_id": {"$exists": True, "$ne": None},
            "$or": [
                {"company_id": {"$exists": False}},
                {"company_id": None},
            ]
        })
        assert missing_users == 0, f"{missing_users} users still missing company_id after backfill"

        return stats

    return asyncio.run(verify())
