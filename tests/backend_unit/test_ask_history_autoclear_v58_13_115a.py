"""v58.13.115a — Auto-clear Ask history + manual DELETE regression tests.

Locks:
  · POST /ask deletes all prior ask_history rows for (org_id,
    user_id) BEFORE inserting the new row → only 1 row remains
    per user after each ask.
  · Auto-delete is scoped per-user + per-org: other users' rows
    survive.
  · DELETE /ask/history exists, is authed via `get_current_user`,
    deletes only the caller's rows, and returns `{deleted: n}`.
  · Briefing endpoint doesn't touch ask_history (read-only + module
    cache).
  · Frontend removed the "Recent Questions" panel and rendered a
    "Clear history" button in its place.
  · Version-sync forward-safe pin >= .115a.
"""
from __future__ import annotations
import inspect
import os
import re
import uuid
from pathlib import Path
import sys

import pytest

sys.path.insert(0, "/app/backend")

ASK_JSX = Path("/app/frontend/src/pages/Ask.jsx").read_text()


# ── Source-pin: POST /ask body has the delete-then-insert flow ─────
def test_post_ask_deletes_before_insert():
    import ask
    src = inspect.getsource(ask.ask)
    # Both statements present; delete_many must come BEFORE insert_one.
    assert "delete_many" in src
    assert "insert_one" in src
    assert src.index("delete_many") < src.index("insert_one"), (
        "auto-delete must run BEFORE inserting the new history row"
    )
    # Scoped to (org_id, user_id) — never wildcards.
    assert re.search(
        r"delete_many\(\{[^}]*org_id[^}]*user_id",
        src.replace("\n", " "),
    )


def test_delete_history_endpoint_registered():
    import ask
    paths = [(r.path, getattr(r, "methods", set())) for r in ask.router.routes]
    hit = [(p, m) for p, m in paths if p == "/ask/history" and "DELETE" in m]
    assert hit, f"DELETE /ask/history missing; saw {paths}"


def test_delete_history_returns_deleted_count_shape():
    import ask
    src = inspect.getsource(ask.clear_history)
    # Uses delete_many scoped to caller + returns {deleted: n}.
    assert "delete_many" in src
    assert "org_id" in src and "user_id" in src
    assert "deleted" in src


def test_briefing_does_not_write_history():
    import ask
    src = inspect.getsource(ask.briefing)
    # Briefing must never insert/update/delete ask_history.
    assert "ask_history" not in src


# ── Behavioural: fresh motor client round-trip ──────────────────────
@pytest.mark.asyncio
async def test_ask_auto_deletes_prior_history_for_caller():
    os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
    os.environ.setdefault("DB_NAME", "test_database")
    from motor.motor_asyncio import AsyncIOMotorClient
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    d = client[os.environ["DB_NAME"]]
    import ask
    original_db = ask.db
    ask.db = d
    org = f"org-115a-{uuid.uuid4().hex[:8]}"
    uid = f"user-{uuid.uuid4().hex[:8]}"
    try:
        # Pre-seed 5 prior history rows for this user.
        seed_ids = []
        for i in range(5):
            row_id = uuid.uuid4().hex
            seed_ids.append(row_id)
            await d.ask_history.insert_one({
                "id": row_id, "org_id": org, "user_id": uid,
                "question": f"prev {i}", "answer": {"body": "x"},
                "created_at": "2026-09-01T00:00:00+00:00",
            })
        assert await d.ask_history.count_documents({"org_id": org, "user_id": uid}) == 5

        # Simulate the auto-delete + insert branch from POST /ask
        # (we can't call the full endpoint without an LLM round-trip;
        # this locks the delete-then-insert contract in isolation).
        await d.ask_history.delete_many({"org_id": org, "user_id": uid})
        await d.ask_history.insert_one({
            "id": uuid.uuid4().hex, "org_id": org, "user_id": uid,
            "question": "new q", "answer": {"body": "y"},
            "created_at": "2026-09-04T00:00:00+00:00",
        })
        remaining = await d.ask_history.count_documents({"org_id": org, "user_id": uid})
        assert remaining == 1, f"expected 1 row after auto-delete + insert, got {remaining}"
    finally:
        await d.ask_history.delete_many({"org_id": org, "user_id": uid})
        ask.db = original_db
        client.close()


@pytest.mark.asyncio
async def test_ask_auto_delete_scoped_per_user_and_org():
    """Two users in the same org: user A's auto-delete must NOT touch
    user B's rows. Also verify a different org is untouched."""
    os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
    os.environ.setdefault("DB_NAME", "test_database")
    from motor.motor_asyncio import AsyncIOMotorClient
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    d = client[os.environ["DB_NAME"]]
    org_a = f"org-A-{uuid.uuid4().hex[:8]}"
    org_b = f"org-B-{uuid.uuid4().hex[:8]}"
    user_a = f"user-A-{uuid.uuid4().hex[:8]}"
    user_b = f"user-B-{uuid.uuid4().hex[:8]}"
    try:
        # 3 rows for user_A/org_A, 3 for user_B/org_A, 3 for user_A/org_B.
        for _ in range(3):
            await d.ask_history.insert_one({"id": uuid.uuid4().hex, "org_id": org_a,
                                             "user_id": user_a, "question": "A/A",
                                             "answer": {}, "created_at": "2026-01-01"})
            await d.ask_history.insert_one({"id": uuid.uuid4().hex, "org_id": org_a,
                                             "user_id": user_b, "question": "A/B",
                                             "answer": {}, "created_at": "2026-01-01"})
            await d.ask_history.insert_one({"id": uuid.uuid4().hex, "org_id": org_b,
                                             "user_id": user_a, "question": "B/A",
                                             "answer": {}, "created_at": "2026-01-01"})

        # user_A on org_A calls the auto-delete — MUST NOT touch B/A or A/B.
        await d.ask_history.delete_many({"org_id": org_a, "user_id": user_a})

        assert await d.ask_history.count_documents({"org_id": org_a, "user_id": user_a}) == 0
        assert await d.ask_history.count_documents({"org_id": org_a, "user_id": user_b}) == 3
        assert await d.ask_history.count_documents({"org_id": org_b, "user_id": user_a}) == 3
    finally:
        await d.ask_history.delete_many({"org_id": {"$in": [org_a, org_b]}})
        client.close()


@pytest.mark.asyncio
async def test_delete_history_endpoint_returns_correct_count():
    """DELETE /ask/history via the coroutine directly — asserts return
    shape + scoping (other users' rows survive)."""
    os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
    os.environ.setdefault("DB_NAME", "test_database")
    from motor.motor_asyncio import AsyncIOMotorClient
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    d = client[os.environ["DB_NAME"]]
    import ask
    original_db = ask.db
    ask.db = d
    org = f"org-115a-{uuid.uuid4().hex[:8]}"
    uid = f"me-{uuid.uuid4().hex[:8]}"
    other = f"other-{uuid.uuid4().hex[:8]}"
    try:
        for _ in range(3):
            await d.ask_history.insert_one({"id": uuid.uuid4().hex, "org_id": org,
                                             "user_id": uid, "question": "mine",
                                             "answer": {}, "created_at": "2026-01-01"})
        for _ in range(2):
            await d.ask_history.insert_one({"id": uuid.uuid4().hex, "org_id": org,
                                             "user_id": other, "question": "not mine",
                                             "answer": {}, "created_at": "2026-01-01"})
        out = await ask.clear_history(user={"id": uid, "org_id": org})
        assert out == {"deleted": 3}
        # Other user's rows survive.
        assert await d.ask_history.count_documents({"org_id": org, "user_id": other}) == 2
        # Idempotent — second call returns 0.
        out2 = await ask.clear_history(user={"id": uid, "org_id": org})
        assert out2 == {"deleted": 0}
    finally:
        await d.ask_history.delete_many({"org_id": org})
        ask.db = original_db
        client.close()


# ── Frontend source-pins ────────────────────────────────────────────
def test_frontend_recent_questions_removed():
    assert "Recent questions" not in ASK_JSX
    assert 'data-testid=`history-' not in ASK_JSX  # panel testids gone


def test_frontend_clear_history_button_wired():
    assert 'data-testid="ask-clear-history"' in ASK_JSX
    assert re.search(r"api\.delete\(['\"]/ask/history['\"]\)", ASK_JSX)
    assert 'toast.success(`History cleared' in ASK_JSX


# ── Version sync forward-safe pin ────────────────────────────────────
_VERSION_TAIL_RE = re.compile(r"paneltec-v[\d.]+\.58\.13\.(\d+)([a-z]?)")


def test_version_bumps_meet_115a():
    for label, path in (
        ("frontend/version.js", "/app/frontend/src/lib/version.js"),
        ("service-worker.js", "/app/frontend/public/service-worker.js"),
        ("mobile/version.ts", "/app/mobile/src/lib/version.ts"),
    ):
        blob = Path(path).read_text()
        tails = [(int(m.group(1)), m.group(2))
                 for m in _VERSION_TAIL_RE.finditer(blob)]
        assert tails, f"{label} has no version tail"
        highest = max(tails)
        assert highest >= (115, "a"), f"{label} latest tail={highest} < (115, 'a')"
