"""v57.2 — smoke test that the live-DB write guard REJECTS unmarked writes.

This is a "meta" test — it exists solely to prove the guard is armed.
Two twin tests:
  • without the marker  → the write must raise `RuntimeError`.
  • with    the marker  → the write must succeed (we then delete our
    own probe row so no leak).
"""
import os
import uuid
from datetime import datetime, timezone

import pymongo
import pytest


def _client():
    return pymongo.MongoClient(os.environ["MONGO_URL"])


def test_guard_blocks_unmarked_write():
    """Without `@pytest.mark.live_db_writes` the guard must raise."""
    client = _client()
    db = client[os.environ.get("DB_NAME", "paneltec")]
    probe = {"id": f"guard-smoke-{uuid.uuid4().hex[:8]}",
             "email": "guard-smoke@example.com",
             "role": "worker", "role_id": "worker",
             "created_at": datetime.now(timezone.utc).isoformat()}
    with pytest.raises(RuntimeError, match="live-DB-guard"):
        db.users.insert_one(probe)
    # And make sure no row leaked.
    assert db.users.count_documents({"id": probe["id"]}) == 0


@pytest.mark.live_db_writes
def test_guard_allows_marked_write():
    """With the marker the same insert must succeed. Test author is
    responsible for the cleanup."""
    client = _client()
    db = client[os.environ.get("DB_NAME", "paneltec")]
    probe = {"id": f"guard-smoke-{uuid.uuid4().hex[:8]}",
             "email": "guard-smoke-ok@example.com",
             "name": "Guard Smoke OK",
             "role": "worker", "role_id": "worker",
             "created_at": datetime.now(timezone.utc).isoformat()}
    try:
        db.users.insert_one(probe)
        assert db.users.count_documents({"id": probe["id"]}) == 1
    finally:
        db.users.delete_one({"id": probe["id"]})
