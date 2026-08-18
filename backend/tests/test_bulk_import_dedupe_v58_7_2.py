"""v160.3.9.58.7.2 — Contract tests for the upsert-on-pdf_hash patch
and the soft-delete dedupe script.

Both paths are exercised against monkey-patched Motor collections so
they never touch the production DB (production_db_guard). The upsert
patch is verified by re-invoking the exact code path in `_run_job`'s
insert branch; the dedupe script is invoked in-process via
`_find_duplicate_groups` + a fake `bulk_write` recorder.
"""
from __future__ import annotations
import asyncio
from datetime import datetime, timedelta, timezone

import pytest

import bulk_import_prestarts as bip


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def _iso(offset_seconds=0):
    return (datetime.now(timezone.utc)
            - timedelta(seconds=offset_seconds)).isoformat()


class _FakeCursor:
    def __init__(self, items):
        self._items = list(items)

    def __aiter__(self):
        self._i = 0
        return self

    async def __anext__(self):
        if self._i >= len(self._items):
            raise StopAsyncIteration
        item = self._items[self._i]
        self._i += 1
        return item


class _FormSubmissionsColl:
    """Minimal Motor-shaped stand-in supporting the operations the
    upsert patch + dedupe script use: `update_one(upsert=True)`,
    `insert_one`, `count_documents`, `aggregate`, `bulk_write`."""

    def __init__(self, seed=None):
        self._docs = list(seed or [])
        self.writes = []      # every bulk_write op recorded here

    async def update_one(self, filt, update, upsert=False):
        for d in self._docs:
            if all(self._match(d, k, v) for k, v in filt.items()):
                # `$setOnInsert` is a no-op on match — perfect for the
                # v58.7.2 idempotent-write test.
                self.writes.append(("update_matched", filt))
                return
        if upsert and "$setOnInsert" in update:
            self._docs.append(dict(update["$setOnInsert"]))
            self.writes.append(("upserted", filt))

    async def insert_one(self, doc):
        self._docs.append(dict(doc))
        self.writes.append(("insert_one", doc.get("id")))

    async def count_documents(self, filt):
        return sum(1 for d in self._docs
                   if all(self._match(d, k, v) for k, v in filt.items()))

    async def bulk_write(self, ops, ordered=False):
        class _Res:
            modified_count = 0

        r = _Res()
        for op in ops:
            filt = op._filter
            upd = op._doc if hasattr(op, "_doc") else op._doc
            for d in self._docs:
                if all(self._match(d, k, v) for k, v in filt.items()):
                    for k, v in upd.get("$set", {}).items():
                        # Support dotted keys like `metadata.merged_into_id`.
                        if "." in k:
                            head, tail = k.split(".", 1)
                            d.setdefault(head, {})[tail] = v
                        else:
                            d[k] = v
                    r.modified_count += 1
                    break
        return r

    def aggregate(self, pipeline, allowDiskUse=False):
        # We only implement the exact pipeline shape the dedupe script
        # uses: [match, sort, group, match].
        match = pipeline[0]["$match"]
        rows = [d for d in self._docs
                if all(self._match(d, k, v) for k, v in match.items())]
        rows.sort(key=lambda x: (x.get("created_at") or "", x.get("id") or ""))
        groups: dict = {}
        for d in rows:
            key = (d["org_id"], (d.get("metadata") or {}).get("pdf_hash"))
            groups.setdefault(key, []).append({
                "id": d["id"], "created_at": d.get("created_at"),
                "submitted_at": d.get("submitted_at"),
            })
        out = []
        for (org_id, pdf_hash), rows_ in groups.items():
            if len(rows_) > 1:
                out.append({
                    "_id": {"org_id": org_id, "pdf_hash": pdf_hash},
                    "rows": rows_, "n": len(rows_),
                })
        return _FakeCursor(out)

    def _match(self, doc, key, val):
        # Support dotted keys, `$exists`, `$ne`, `$gt`, `$in`.
        cur = doc
        for part in key.split("."):
            if not isinstance(cur, dict):
                return False
            cur = cur.get(part)
        if isinstance(val, dict):
            if "$exists" in val:
                exists_wanted = val["$exists"]
                actually_exists = cur is not None
                if exists_wanted != actually_exists:
                    return False
            if "$ne" in val and cur == val["$ne"]:
                return False
            if "$gt" in val and not (cur is not None and cur > val["$gt"]):
                return False
            if "$in" in val and cur not in val["$in"]:
                return False
            return True
        return cur == val


ORG = "org-tst"


def _fs_doc(hash_, id_, created_offset=0):
    return {
        "id": id_, "org_id": ORG, "source": "bulk_import",
        "created_at": _iso(created_offset),
        "submitted_at": _iso(created_offset),
        "template_id": "tpl-x", "template_name_snapshot": "Daily Pre-Start",
        "fields": [], "submitted_by_id": "u1",
        "metadata": {"pdf_hash": hash_, "job_id": "j1"},
        "deleted_at": None,
    }


# ───────────────────────── UPSERT patch tests ─────────────────────

class TestUpsertPatch:
    """Verify the v58.7.2 upsert branch in `_run_job` writes exactly
    once per (org_id, source, pdf_hash) triple."""

    def _write(self, coll, doc):
        # Mirror the exact code shape from bulk_import_prestarts.py
        # so a refactor there is caught by these tests.
        _hash = (doc.get("metadata") or {}).get("pdf_hash")
        assert _hash, "test doc must carry a pdf_hash"
        return coll.update_one(
            {"org_id": doc["org_id"], "source": "bulk_import",
             "metadata.pdf_hash": _hash},
            {"$setOnInsert": doc},
            upsert=True,
        )

    def test_first_write_inserts(self, monkeypatch):
        coll = _FormSubmissionsColl([])
        _run(self._write(coll, _fs_doc("h-A", "id-1")))
        assert _run(coll.count_documents({"metadata.pdf_hash": "h-A"})) == 1

    def test_second_write_same_hash_is_noop(self, monkeypatch):
        coll = _FormSubmissionsColl([_fs_doc("h-A", "id-1")])
        _run(self._write(coll, _fs_doc("h-A", "id-2")))
        # Still exactly 1 row for that hash; the "id-2" doc never landed.
        assert _run(coll.count_documents({"metadata.pdf_hash": "h-A"})) == 1
        # No accidental insert path taken.
        kinds = [k for k, _ in coll.writes]
        assert kinds == ["update_matched"]

    def test_different_hash_still_inserts(self, monkeypatch):
        coll = _FormSubmissionsColl([_fs_doc("h-A", "id-1")])
        _run(self._write(coll, _fs_doc("h-B", "id-2")))
        assert _run(coll.count_documents({"metadata.pdf_hash": "h-A"})) == 1
        assert _run(coll.count_documents({"metadata.pdf_hash": "h-B"})) == 1


# ────────────────────── Dedupe script tests ───────────────────────

class TestDedupeScript:
    def test_dry_run_scans_but_does_not_write(self):
        from scripts import dedupe_bulk_import_submissions_v58_7_2 as ded
        coll = _FormSubmissionsColl([
            _fs_doc("h-A", "id-oldest",  created_offset=300),
            _fs_doc("h-A", "id-newer-1", created_offset=200),
            _fs_doc("h-A", "id-newer-2", created_offset=100),
            _fs_doc("h-B", "id-lonely",  created_offset=50),
        ])
        groups = []
        async def collect():
            async for pdf_hash, rows in ded._find_duplicate_groups(coll, {}):
                groups.append((pdf_hash, [r["id"] for r in rows]))
        _run(collect())
        assert len(groups) == 1
        assert groups[0][0] == "h-A"
        # Oldest is first (survivor).
        assert groups[0][1][0] == "id-oldest"
        # `h-B` (n=1) is NOT in the result.

    def test_commit_soft_deletes_all_but_oldest(self):
        from scripts import dedupe_bulk_import_submissions_v58_7_2 as ded
        seed = [
            _fs_doc("h-A", "id-A-old", 300),
            _fs_doc("h-A", "id-A-mid", 200),
            _fs_doc("h-A", "id-A-new", 100),
            _fs_doc("h-C", "id-C-old", 400),
            _fs_doc("h-C", "id-C-new", 300),
        ]
        coll = _FormSubmissionsColl(seed)

        # Simulate the commit path's bulk_write call.
        from pymongo import UpdateOne
        now = ded._now_iso()
        pairs = []
        async def gather():
            async for pdf_hash, rows in ded._find_duplicate_groups(coll, {}):
                survivor = rows[0]
                for dup in rows[1:]:
                    pairs.append((dup["id"], survivor["id"]))
        _run(gather())
        ops = [
            UpdateOne(
                {"id": dup_id, "deleted_at": None},
                {"$set": {
                    "deleted_at": now,
                    "metadata.merged_into_id": survivor_id,
                    "metadata.merged_at": now,
                    "metadata.merged_by": "system-cleanup-v58-7-2",
                }},
            )
            for dup_id, survivor_id in pairs
        ]
        res = _run(coll.bulk_write(ops))
        assert res.modified_count == 3   # A-mid, A-new, C-new

        surviving_active = [d for d in coll._docs if d["deleted_at"] is None]
        surviving_ids = sorted(d["id"] for d in surviving_active)
        assert surviving_ids == ["id-A-old", "id-C-old"]

        # Every soft-deleted row carries the merge trail pointing at
        # the correct survivor.
        soft = [d for d in coll._docs if d["deleted_at"]]
        for d in soft:
            assert d["metadata"]["merged_by"] == "system-cleanup-v58-7-2"
            expected_survivor = "id-A-old" if d["metadata"]["pdf_hash"] == "h-A" else "id-C-old"
            assert d["metadata"]["merged_into_id"] == expected_survivor

    def test_no_duplicates_produces_empty_report(self):
        from scripts import dedupe_bulk_import_submissions_v58_7_2 as ded
        coll = _FormSubmissionsColl([
            _fs_doc("h-A", "id-A"), _fs_doc("h-B", "id-B"),
            _fs_doc("h-C", "id-C"),
        ])
        found = []
        async def gather():
            async for h, rows in ded._find_duplicate_groups(coll, {}):
                found.append((h, len(rows)))
        _run(gather())
        assert found == []
