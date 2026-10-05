"""Activity contract tests with an in-memory Mongo adapter; no cloud writes."""
import copy
import importlib.util
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('activity', Path(__file__).parents[1] / 'dropbox_activity.py')
activity = importlib.util.module_from_spec(spec)
spec.loader.exec_module(activity)

class Update:
    def __init__(self, query, update, **kw): self.query, self.update = query, update

class Cursor:
    def __init__(self, rows): self.rows = rows
    async def to_list(self, length=None): return copy.deepcopy(self.rows)

class Collection:
    def __init__(self): self.rows = {}
    async def find_one_and_update(self, query, update, **kw):
        await self.update_one(query, update)
        return copy.deepcopy(self.rows[query['_id']])
    async def update_one(self, query, update, **kw):
        identifier = query['_id']
        if identifier not in self.rows:
            self.rows[identifier] = {'_id': identifier, **copy.deepcopy(update.get('$setOnInsert', {}))}
        for k, v in update.get('$max', {}).items():
            self.rows[identifier][k] = max(v, self.rows[identifier].get(k, v))
    async def bulk_write(self, operations, **kw):
        for operation in operations: await self.update_one(operation.query, operation.update)
    def find(self, query):
        return Cursor([r for k, r in self.rows.items() if k in query['_id']['$in']])

class ActivityTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.db = types.SimpleNamespace(**{n: Collection() for n in (
            'dropbox_activity_folders', 'dropbox_activity_entries', 'dropbox_activity_checks')})
        self.stub = patch.dict(sys.modules, {'pymongo': types.SimpleNamespace(
            ReturnDocument=types.SimpleNamespace(AFTER=True), UpdateOne=Update)})
        self.stub.start()
        self.addCleanup(self.stub.stop)
    async def scan(self, ids, now, user='a', org='o', folder='', namespace='n'):
        rows = [{'id': i, 'name': i, 'modified': str(now)} for i in ids]
        result = await activity.annotate(self.db, org, namespace, user, folder, rows, now=now)
        return rows, result
    async def test_initial_files_and_folders_are_not_new(self):
        rows, _ = await self.scan(['file-id', 'folder-id'], 100)
        self.assertTrue(all(not r['new_since_check'] and not r['new_last_week'] for r in rows))
    async def test_new_entry_is_flagged_and_refresh_keeps_unread(self):
        await self.scan(['old'], 100)
        rows, _ = await self.scan(['old', 'new'], 110)
        self.assertFalse(rows[0]['new_since_check'])
        self.assertTrue(rows[1]['new_since_check'] and rows[1]['new_last_week'])
        rows, _ = await self.scan(['new'], 120)
        self.assertTrue(rows[0]['new_since_check'])
    async def test_check_clears_unread_but_preserves_week_and_new_arrivals(self):
        await self.scan(['old'], 100)
        _, snapshot = await self.scan(['old', 'new'], 110)
        await self.scan(['old', 'new', 'later'], 120)
        await activity.mark_checked(self.db, 'o', 'n', 'a', '', snapshot['observed_at'])
        rows, _ = await self.scan(['new', 'later'], 130)
        self.assertFalse(rows[0]['new_since_check'])
        self.assertTrue(rows[0]['new_last_week'])
        self.assertTrue(rows[1]['new_since_check'])
    async def test_week_expires_but_unread_does_not(self):
        await self.scan([], 100)
        await self.scan(['new'], 110)
        rows, _ = await self.scan(['new'], 111 + activity.WEEK)
        self.assertTrue(rows[0]['new_since_check'])
        self.assertFalse(rows[0]['new_last_week'])
    async def test_reviews_are_per_user(self):
        await self.scan([], 100)
        await self.scan([], 101, user='b')
        await self.scan(['new'], 110)
        await activity.mark_checked(self.db, 'o', 'n', 'a', '', 110)
        rows, _ = await self.scan(['new'], 120, user='b')
        self.assertTrue(rows[0]['new_since_check'])
    async def test_edit_rename_and_move_keep_identity(self):
        await self.scan(['stable-id'], 100)
        rows, _ = await self.scan(['stable-id'], 200)
        self.assertFalse(rows[0]['new_last_week'])
        rows, _ = await self.scan(['stable-id'], 300, folder='/destination')
        self.assertFalse(rows[0]['new_last_week'])
    async def test_organisation_namespace_folder_isolation_and_checkpoint_monotonic(self):
        await self.scan([], 100)
        await self.scan(['new'], 110)
        for scope in ({'org':'other'}, {'namespace':'other'}):
            rows, _ = await self.scan(['new'], 120, **scope)
            self.assertFalse(rows[0]['new_last_week'])
        await activity.mark_checked(self.db, 'o', 'n', 'a', '', 120)
        await activity.mark_checked(self.db, 'o', 'n', 'a', '', 105)
        _, state = await self.scan(['new'], 130)
        self.assertEqual(state['checked_at'], 120)
        _, state = await self.scan([], 140, folder='/other')
        self.assertEqual(state['checked_at'], 140)

if __name__ == '__main__': unittest.main()
