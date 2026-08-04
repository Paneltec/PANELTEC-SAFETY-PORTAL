# Live DB Write Guard (v57.2)

Every pytest run in this repo boots a "production DB write guard"
that intercepts calls to `pymongo.collection.Collection` write
methods (`insert_one`, `update_one`, `delete_one`, `bulk_write`,
`find_one_and_update`, etc.) and REJECTS them if the target database
name matches the production DB (`os.environ["DB_NAME"]`, typically
`paneltec` / `test_database` — whatever the running instance uses).

## Why

The Users & Permissions v57.1 outage was caused by 13 ephemeral test
users that leaked into the production `users` collection because an
earlier pytest iteration errored before its cleanup step ran. Every
one of those docs was missing a `name` field, so `_user_out()`
KeyError'd and 500'd the entire Users list.

The guard prevents that class of outage from recurring.

## The default behaviour

**Every write goes through the guard.** Any test that tries to write
to the prod DB will see a `RuntimeError` like:

```
live-DB-guard: refusing to call Collection.insert_one(...) on
'paneltec.users' without the @pytest.mark.live_db_writes opt-in.
See backend/tests/README_live_db_guard.md.
```

Reads (`find`, `find_one`, `count_documents`, `aggregate`, etc.) are
never guarded — most tests only need to read live data + hit the
running API.

## Escape hatch

If a test genuinely needs to write to the production DB, mark it:

```python
import pytest

@pytest.mark.live_db_writes
def test_something_that_must_write():
    ...
```

The mark flips `_ALLOW_PROD_WRITES = True` for the duration of that
test only. Teardown restores the guard.

**The test author is responsible for cleanup.** The guard doesn't
verify that you cleaned up — it just gets out of your way. Use a
`try / finally` block:

```python
@pytest.mark.live_db_writes
def test_role_gating():
    client = pymongo.MongoClient(os.environ["MONGO_URL"])
    db = client[os.environ.get("DB_NAME", "paneltec")]
    role_id = f"test-role-{uuid.uuid4().hex[:8]}"
    db.roles.insert_one({"id": role_id, "role_id": role_id, ...})
    try:
        # ... exercise the code path that reads this role ...
    finally:
        db.roles.delete_one({"id": role_id})
```

## What the guard does NOT catch

- **Server-side writes.** The running FastAPI backend is a separate
  process with its own motor client — the guard only patches the
  pytest process. Tests that hit `POST /api/foo` and cause the server
  to write on your behalf are NOT blocked. That's usually fine —
  those endpoints should have their own idempotency / cleanup
  contracts.
- **Direct-motor tests.** `motor.motor_asyncio.AsyncIOMotorCollection`
  is a separate class. If a future test uses motor directly, mirror
  the guard for that class or use a pymongo client instead.
- **Ephemeral DBs.** If your test creates its own MongoClient against
  a name that differs from `os.environ["DB_NAME"]`, writes pass
  through unguarded — do whatever you want with your throwaway DB.

## Turning the guard off entirely (not recommended)

Set `_ALLOW_PROD_WRITES = True` at the top of `conftest.py`. Don't do
this on `main` — use the marker.
