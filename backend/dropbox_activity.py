"""Persist first observations, not Dropbox modification dates.

The first complete listing of each folder is a baseline. Subsequent unseen
Dropbox IDs are additions; edits and renames keep their identity. Tracking is
scoped to organisation and namespace. Review checkpoints are personal.
"""
import hashlib
import json
import time

WEEK = 7 * 24 * 60 * 60


def key(*parts):
    return hashlib.sha256(json.dumps(parts, separators=(',', ':')).encode()).hexdigest()


def flags(first_seen, checked, now):
    return {
        'new_since_check': first_seen is not None and first_seen > checked,
        'new_last_week': first_seen is not None and 0 <= now - first_seen <= WEEK,
        'first_seen_at': first_seen,
    }


async def annotate(database, org, namespace, user_id, path, entries, now=None):
    from pymongo import ReturnDocument, UpdateOne
    now = time.time() if now is None else now
    scope = key(org, namespace)
    folder = key(scope, path.casefold())
    # $setOnInsert and the unique _id make simultaneous first visits agree
    # on the same baseline, including when several backend workers run.
    baseline = await database.dropbox_activity_folders.find_one_and_update(
        {'_id': folder}, {'$setOnInsert': {
            'started_at': now,
            'baseline_ids': [e['id'] for e in entries if e.get('id')],
        }}, upsert=True, return_document=ReturnDocument.AFTER,
    )
    original_ids = set(baseline['baseline_ids'])
    operations = []
    for entry in entries:
        if not entry.get('id'):
            continue
        operations.append(UpdateOne({'_id': key(scope, entry['id'])}, {
            '$setOnInsert': {'first_seen': None if entry['id'] in original_ids else now},
        }, upsert=True))
    if operations:
        await database.dropbox_activity_entries.bulk_write(operations, ordered=False)
    ids = [key(scope, e['id']) for e in entries if e.get('id')]
    records = await database.dropbox_activity_entries.find({'_id': {'$in': ids}}).to_list(length=None)
    observations = {r['_id']: r['first_seen'] for r in records}
    checkpoint = await database.dropbox_activity_checks.find_one_and_update(
        {'_id': key(folder, user_id)}, {'$setOnInsert': {'checked_at': now}},
        upsert=True, return_document=ReturnDocument.AFTER,
    )
    for entry in entries:
        first_seen = observations.get(key(scope, entry.get('id')))
        entry.update(flags(first_seen, checkpoint['checked_at'], now))
    return {'observed_at': now, 'checked_at': checkpoint['checked_at'],
            'tracking_started_at': baseline['started_at']}


async def mark_checked(database, org, namespace, user_id, path, observed_at):
    # A snapshot cutoff, rather than the button-click time, ensures additions
    # arriving while the user reads the page remain unread on the next refresh.
    folder = key(key(org, namespace), path.casefold())
    await database.dropbox_activity_checks.update_one(
        {'_id': key(folder, user_id)}, {'$max': {'checked_at': observed_at}}, upsert=True,
    )
