"""v160.3.9.21b — Shared ingester safety helpers.

Two utilities every XLSX ingester now flows through so partial-column
exports can't wipe existing fields:

    merge_safe_upsert()
        $set = only non-empty incoming fields (metadata excluded).
        $setOnInsert = created_at / imported_at / imported_by / id.
        upsert=True → single call handles both insert + update paths.
        Empty incoming values NEVER touch existing fields.
        Audits every insert + update with before/after content hashes.

    detect_schema_shrink()
        Compares the incoming row set's key union against every
        populated key currently in the collection. If any populated
        column has been dropped by the incoming export → writes a
        `schema_shrink_detected` audit row and returns the list.
        Ingesters can log a warning to stdout on top of that.

Every ingester carries a one-line comment
    # Merge-safe: incoming empties never wipe existing fields (v160.3.9.21b)
so the intent is grep-visible at the call sites.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Iterable

# Fields that are ingest metadata — never overwritten by a subsequent
# import (`$setOnInsert` handles the create-once slots).
_INSERT_ONLY_META: set[str] = {
    "id", "created_at", "imported_at", "imported_by",
}

# Fields excluded from the schema-shrink comparison because they're
# server-side ingest metadata, not real spreadsheet columns.
_SCHEMA_IGNORE: set[str] = {
    "_id", "id", "content_hash",
    "created_at", "updated_at", "imported_at", "imported_by",
    "deleted_at", "deleted_by",
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _drop_empty(row: dict) -> dict:
    """Keep only fields with a real value (drop None / '' / [] / {})."""
    out: dict = {}
    for k, v in row.items():
        if v in (None, "", [], {}):
            continue
        out[k] = v
    return out


async def merge_safe_upsert(
    *,
    collection,
    audit_collection,
    key_field: str,
    incoming: dict,
    existing: dict | None,
    actor_id: str,
    content_hash: str,
    audit_extra: dict | None = None,
) -> str:
    """Merge-safe upsert.

    Returns one of ``"inserted" | "updated" | "unchanged"``.

    * Incoming empties are dropped, so existing fields are never wiped.
    * ``imported_at`` / ``imported_by`` / ``created_at`` stamp ONCE
      on insert via ``$setOnInsert``; subsequent runs leave them alone.
    * ``updated_at`` refreshes on every write.
    * A row is written to ``audit_collection`` on both insert + update.
    """
    key_value = incoming[key_field]
    now = _now_iso()

    if existing and existing.get("content_hash") == content_hash:
        return "unchanged"

    set_fields = {
        k: v for k, v in _drop_empty(incoming).items()
        if k not in _INSERT_ONLY_META
    }
    set_fields["content_hash"] = content_hash
    set_fields["updated_at"] = now

    set_on_insert = {
        "id": incoming.get("id") or str(uuid.uuid4()),
        "created_at": now,
        "imported_at": now,
        "imported_by": actor_id,
    }
    # Mongo rejects overlap between $set and $setOnInsert — trim any
    # metadata that leaked through above.
    for k in list(set_on_insert.keys()):
        set_fields.pop(k, None)

    await collection.update_one(
        {key_field: key_value},
        {"$set": set_fields, "$setOnInsert": set_on_insert},
        upsert=True,
    )

    action = "update" if existing else "insert"
    audit_doc = {
        "id": str(uuid.uuid4()),
        key_field: key_value,
        "action": action,
        "at": now,
        "actor_id": actor_id,
        "after_hash": content_hash,
    }
    if existing:
        audit_doc["before_hash"] = existing.get("content_hash")
    if audit_extra:
        audit_doc.update(audit_extra)
    await audit_collection.insert_one(audit_doc)
    return "inserted" if action == "insert" else "updated"


async def detect_schema_shrink(
    *,
    collection,
    audit_collection,
    incoming_rows: Iterable[dict],
    actor_id: str,
    ignore_fields: set[str] | None = None,
) -> list[str]:
    """Return the list of columns present in the live collection but
    absent from the incoming export. Writes one
    ``schema_shrink_detected`` audit row when the list is non-empty.

    Empty return value = no shrink (either identical or expanded).
    """
    ignore = set(_SCHEMA_IGNORE) | set(ignore_fields or set())

    incoming: set[str] = set()
    for r in incoming_rows:
        for k, v in r.items():
            if v in (None, "", [], {}) or k in ignore:
                continue
            incoming.add(k)

    existing_keys: set[str] = set()
    async for doc in collection.find({"deleted_at": None}, {"_id": 0}):
        for k, v in doc.items():
            if v in (None, "", [], {}) or k in ignore:
                continue
            existing_keys.add(k)

    if not existing_keys:
        return []

    dropped = sorted(existing_keys - incoming)
    if not dropped:
        return []

    await audit_collection.insert_one({
        "id": str(uuid.uuid4()),
        "action": "schema_shrink_detected",
        "at": _now_iso(),
        "actor_id": actor_id,
        "missing_columns": dropped,
        "incoming_columns": sorted(incoming),
    })
    return dropped
