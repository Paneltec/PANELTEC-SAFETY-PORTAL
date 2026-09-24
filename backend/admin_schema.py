"""v58.13.132mt — Admin schema inspector.

Read-only DB schema documentation surface. Built for a future handover
to another software team (MySQL shop) — they will want a full manifest
of every collection, its indexes, its field types, and a redacted sample
doc for reference.

Endpoints (all admin-only, mounted at `/api/schema/*`):
  · GET  /api/schema/collections
      Returns [{name, count, size_bytes, index_count,
                sample_field_types: {field: type}}] for every collection.
  · GET  /api/schema/collection/{name}
      Deep-inspect one collection — indexes, field-type map with
      null-counts and (redacted) sample values, one redacted sample doc.
  · GET  /api/schema/export?format=json|md
      Downloadable full-database schema in JSON or Markdown.

Results are cached in the `schema_cache` collection with a 6-hour TTL.
Pass `?refresh=true` to force regeneration. All expensive work runs
inside a shielded try/except per collection so a single bad collection
never fails the whole scan; failed collections are logged and returned
as `{name, error}` entries in the response.

PII redaction: any field whose flattened path matches PII_PATTERNS has
its sample values replaced with the literal string "REDACTED". Password
hashes, tokens, emails, phone numbers, DOBs, and personal names of
workers/users are covered. This is intentionally aggressive — the
schema doc is meant to describe SHAPE, not carry data.
"""
from __future__ import annotations

import io
import json
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response

from auth import get_current_user
from db import db

log = logging.getLogger("paneltec.admin.schema")

router = APIRouter(prefix="/schema", tags=["admin-schema"])

# --------------------------------------------------------------------------
# Config
# --------------------------------------------------------------------------
CACHE_TTL_HOURS = 6
SAMPLE_DOCS_SHALLOW = 100   # for the /collections summary
SAMPLE_DOCS_DEEP = 200      # for the /collection/{name} deep-inspect
MAX_FLATTEN_DEPTH = 3
MAX_SAMPLE_VALUES = 3
QUERY_TIMEOUT_MS = 15_000

# Field-name patterns that trigger PII redaction of sample values.
PII_PATTERNS = [
    re.compile(r"(^|[._])(password|pwd|passwd)", re.I),
    re.compile(r"(^|[._])(token|jwt|secret|api_key|apikey)", re.I),
    re.compile(r"(^|[._])(hash|salt)$", re.I),
    re.compile(r"(^|[._])email(s)?$", re.I),
    re.compile(r"(^|[._])(phone|mobile|contact_number|tel)", re.I),
    re.compile(r"(^|[._])(dob|date_of_birth|birthday)", re.I),
    re.compile(r"(^|[._])(ssn|tfn|tax_file_number|abn|acn)", re.I),
    re.compile(r"(^|[._])(pin|otp|code)$", re.I),
    # personal-name fields (aggressive; the schema doc is about shape).
    re.compile(r"(^|[._])(first_name|last_name|full_name|given_name|surname)", re.I),
    re.compile(r"(^|[._])(worker_name|user_name|display_name)", re.I),
    # v58.13.132mt-fix — Also catch bare `name` (top-level or nested
    # like `worker.name`, `reporter.name`, `assigned_to.name`). This
    # over-redacts things like `folder.name` / `role.name` but the
    # SHAPE (types_seen, null_pct) is unaffected — we lose only the
    # sample values. Acceptable trade for the "no personal names"
    # guarantee.
    re.compile(r"(?:^|\.)name$", re.I),
    re.compile(r"(^|[._])(personal_note|note_body)", re.I),
]


def _require_admin(user: dict) -> None:
    if (user or {}).get("role") != "admin":
        raise HTTPException(403, "Admin only")


def _is_pii(path: str) -> bool:
    return any(p.search(path) for p in PII_PATTERNS)


# --------------------------------------------------------------------------
# Type inference
# --------------------------------------------------------------------------
def _type_name(v: Any) -> str:
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "bool"
    if isinstance(v, int):
        return "int"
    if isinstance(v, float):
        return "float"
    if isinstance(v, str):
        return "string"
    if isinstance(v, bytes):
        return "binary"
    if isinstance(v, datetime):
        return "datetime"
    if isinstance(v, ObjectId):
        return "ObjectId"
    if isinstance(v, list):
        return "array"
    if isinstance(v, dict):
        return "object"
    return type(v).__name__


def _redact_value(path: str, v: Any) -> Any:
    """Return a JSON-safe representation of `v`, redacted if PII."""
    if _is_pii(path):
        return "REDACTED"
    if v is None or isinstance(v, (bool, int, float, str)):
        return v
    if isinstance(v, ObjectId):
        return str(v)
    if isinstance(v, datetime):
        return v.isoformat()
    if isinstance(v, bytes):
        return f"<bytes: {len(v)}>"
    if isinstance(v, list):
        return [_redact_value(f"{path}.[]", x) for x in v[:MAX_SAMPLE_VALUES]]
    if isinstance(v, dict):
        return {k: _redact_value(f"{path}.{k}", val) for k, val in list(v.items())[:5]}
    return str(v)


def _walk_doc(
    doc: dict,
    field_map: dict[str, dict],
    depth: int = 0,
    prefix: str = "",
) -> None:
    """Recursively walk a doc, updating `field_map[path]` with observed
    type + sample. Bounded by MAX_FLATTEN_DEPTH to keep inference fast."""
    if depth > MAX_FLATTEN_DEPTH:
        return
    for k, v in doc.items():
        path = f"{prefix}.{k}" if prefix else k
        entry = field_map.setdefault(path, {
            "types_seen": set(),
            "null_count": 0,
            "sample_values": [],
            "nested": False,
            "array_of": None,
        })
        tname = _type_name(v)
        entry["types_seen"].add(tname)
        if v is None:
            entry["null_count"] += 1
            continue
        if isinstance(v, dict):
            entry["nested"] = True
            _walk_doc(v, field_map, depth + 1, path)
            continue
        if isinstance(v, list):
            if v:
                inner_types = {_type_name(x) for x in v[:20]}
                entry["array_of"] = sorted(inner_types)
                # If array of dicts, walk the first element's shape.
                for x in v[:3]:
                    if isinstance(x, dict):
                        _walk_doc(x, field_map, depth + 1, f"{path}.[]")
            else:
                entry["array_of"] = []
            continue
        if len(entry["sample_values"]) < MAX_SAMPLE_VALUES:
            red = _redact_value(path, v)
            if red not in entry["sample_values"]:
                entry["sample_values"].append(red)


def _finalize_field_map(field_map: dict[str, dict], docs_seen: int) -> dict:
    """Convert sets → sorted lists and compute null_pct."""
    out: dict[str, dict] = {}
    for path, e in sorted(field_map.items()):
        out[path] = {
            "types_seen": sorted(e["types_seen"]),
            "null_count": e["null_count"],
            "null_pct": round((e["null_count"] / docs_seen) * 100, 1) if docs_seen else 0,
            "nested": e["nested"],
            "array_of": e["array_of"],
            "sample_values": e["sample_values"],
        }
    return out


# --------------------------------------------------------------------------
# Collection introspection
# --------------------------------------------------------------------------
async def _coll_stats(name: str) -> dict:
    """Return {count, size_bytes, avg_doc_size, index_count} via collStats.
    Failures degrade to zero-values so the caller can still show a row."""
    try:
        stats = await db.command({"collStats": name})
    except Exception as exc:  # noqa: BLE001
        log.warning("collStats failed for %s: %s", name, exc)
        return {"count": 0, "size_bytes": 0, "avg_doc_size": 0, "index_count": 0}
    return {
        "count": int(stats.get("count", 0)),
        "size_bytes": int(stats.get("size", 0)),
        "avg_doc_size": int(stats.get("avgObjSize", 0) or 0),
        "index_count": int(stats.get("nindexes", 0)),
    }


async def _sample_docs(name: str, limit: int) -> list[dict]:
    """Return up to `limit` docs from the collection. Uses a bounded
    cursor with server-side timeout to avoid hanging on huge collections."""
    try:
        cursor = db[name].find({}, projection=None).limit(limit).max_time_ms(QUERY_TIMEOUT_MS)
        return [d async for d in cursor]
    except Exception as exc:  # noqa: BLE001
        log.warning("sample failed for %s: %s", name, exc)
        return []


async def _collection_indexes(name: str) -> list[dict]:
    try:
        info = await db[name].index_information()
    except Exception as exc:  # noqa: BLE001
        log.warning("index_information failed for %s: %s", name, exc)
        return []
    out: list[dict] = []
    for idx_name, meta in info.items():
        out.append({
            "name": idx_name,
            "keys": [{"field": k, "direction": v} for k, v in meta.get("key", [])],
            "unique": bool(meta.get("unique", False)),
            "sparse": bool(meta.get("sparse", False)),
            "ttl_seconds": meta.get("expireAfterSeconds"),
        })
    return out


async def _introspect_shallow(name: str) -> dict:
    """Fast per-collection summary used by /collections list."""
    stats = await _coll_stats(name)
    field_map: dict[str, dict] = {}
    docs = await _sample_docs(name, SAMPLE_DOCS_SHALLOW)
    for d in docs:
        _walk_doc(d, field_map, depth=0, prefix="")
    # Shallow: only top-level types, no samples (keep response small).
    shallow_types = {
        k: sorted(v["types_seen"])
        for k, v in field_map.items()
        if "." not in k
    }
    return {
        "name": name,
        **stats,
        "sample_field_types": shallow_types,
    }


async def _introspect_deep(name: str) -> dict:
    """Full deep inspection: fields (dotted, redacted samples), indexes,
    one redacted sample doc. Used by /collection/{name} and /export."""
    stats = await _coll_stats(name)
    indexes = await _collection_indexes(name)
    docs = await _sample_docs(name, SAMPLE_DOCS_DEEP)
    field_map: dict[str, dict] = {}
    for d in docs:
        _walk_doc(d, field_map, depth=0, prefix="")
    fields = _finalize_field_map(field_map, len(docs))
    sample_doc = _redact_value("", docs[0]) if docs else None
    return {
        "name": name,
        **stats,
        "indexes": indexes,
        "field_types": fields,
        "sample_document": sample_doc,
        "sampled_docs": len(docs),
    }


# --------------------------------------------------------------------------
# Cache
# --------------------------------------------------------------------------
async def _cache_get(key: str, refresh: bool) -> Any | None:
    if refresh:
        return None
    doc = await db.schema_cache.find_one({"_id": key})
    if not doc:
        return None
    ts = doc.get("generated_at")
    if not isinstance(ts, datetime):
        return None
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    if datetime.now(timezone.utc) - ts > timedelta(hours=CACHE_TTL_HOURS):
        return None
    return doc.get("payload")


async def _cache_set(key: str, payload: Any) -> None:
    await db.schema_cache.update_one(
        {"_id": key},
        {"$set": {
            "generated_at": datetime.now(timezone.utc),
            "payload": payload,
        }},
        upsert=True,
    )


async def _cache_meta(key: str) -> dict | None:
    doc = await db.schema_cache.find_one({"_id": key}, {"generated_at": 1})
    if not doc or not isinstance(doc.get("generated_at"), datetime):
        return None
    ts = doc["generated_at"]
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return {"generated_at": ts.isoformat()}


# --------------------------------------------------------------------------
# Endpoints
# --------------------------------------------------------------------------
@router.get("/collections")
async def list_collections(
    refresh: bool = Query(False, description="Force regeneration, ignore cache."),
    user: dict = Depends(get_current_user),
):
    _require_admin(user)
    key = "collections_summary"
    cached = await _cache_get(key, refresh)
    if cached is not None:
        meta = await _cache_meta(key)
        return {"cached": True, "generated_at": meta["generated_at"] if meta else None, "collections": cached}

    names = sorted(await db.list_collection_names())
    results: list[dict] = []
    failed: list[dict] = []
    for n in names:
        # Skip Mongo system collections; they aren't useful to a handover.
        if n.startswith("system."):
            continue
        try:
            results.append(await _introspect_shallow(n))
        except Exception as exc:  # noqa: BLE001
            log.exception("shallow introspect failed for %s", n)
            failed.append({"name": n, "error": str(exc)})
    await _cache_set(key, results)
    meta = await _cache_meta(key)
    return {
        "cached": False,
        "generated_at": meta["generated_at"] if meta else None,
        "collections": results,
        "failed": failed,
    }


@router.get("/collection/{name}")
async def get_collection(
    name: str,
    refresh: bool = Query(False, description="Force regeneration, ignore cache."),
    user: dict = Depends(get_current_user),
):
    _require_admin(user)
    # Guard: only real collections in this DB.
    known = set(await db.list_collection_names())
    if name not in known:
        raise HTTPException(404, f"Unknown collection: {name}")

    key = f"coll_{name}"
    cached = await _cache_get(key, refresh)
    if cached is not None:
        meta = await _cache_meta(key)
        return {"cached": True, "generated_at": meta["generated_at"] if meta else None, **cached}

    payload = await _introspect_deep(name)
    await _cache_set(key, payload)
    meta = await _cache_meta(key)
    return {"cached": False, "generated_at": meta["generated_at"] if meta else None, **payload}


def _render_markdown(schema: dict) -> str:
    """Render a full schema payload as a printable markdown document."""
    out = io.StringIO()
    out.write("# Paneltec — Database Schema\n\n")
    out.write(f"Generated: {schema.get('generated_at', 'unknown')}  \n")
    out.write(f"Collections: {len(schema.get('collections', []))}\n\n")
    out.write("---\n\n")
    for c in schema.get("collections", []):
        name = c.get("name", "?")
        out.write(f"## `{name}`\n\n")
        out.write(f"- Documents: **{c.get('count', 0):,}**\n")
        out.write(f"- Total size: **{c.get('size_bytes', 0):,}** bytes\n")
        out.write(f"- Avg doc size: **{c.get('avg_doc_size', 0):,}** bytes\n")
        out.write(f"- Indexes: **{c.get('index_count', 0)}**\n\n")

        indexes = c.get("indexes") or []
        if indexes:
            out.write("### Indexes\n\n")
            out.write("| Name | Keys | Unique | Sparse | TTL (s) |\n")
            out.write("|------|------|--------|--------|---------|\n")
            for i in indexes:
                keys = ", ".join(f"{k['field']}:{k['direction']}" for k in (i.get("keys") or []))
                out.write(f"| `{i.get('name')}` | {keys} | {i.get('unique')} | {i.get('sparse')} | {i.get('ttl_seconds') or ''} |\n")
            out.write("\n")

        fields = c.get("field_types") or {}
        if fields:
            out.write("### Fields\n\n")
            out.write("| Path | Types | Null % | Array of | Samples |\n")
            out.write("|------|-------|--------|----------|---------|\n")
            for path, meta in fields.items():
                types = ", ".join(meta.get("types_seen") or [])
                arr = ", ".join(meta.get("array_of") or []) if meta.get("array_of") else ""
                samples = ", ".join(json.dumps(s, default=str) for s in (meta.get("sample_values") or []))
                out.write(f"| `{path}` | {types} | {meta.get('null_pct', 0)} | {arr} | {samples} |\n")
            out.write("\n")
        out.write("\n")
    return out.getvalue()


@router.get("/export")
async def export_schema(
    format: str = Query("json", pattern="^(json|md)$"),
    refresh: bool = Query(False),
    user: dict = Depends(get_current_user),
):
    _require_admin(user)
    key = f"export_full"
    cached = await _cache_get(key, refresh)
    if cached is None:
        names = sorted(await db.list_collection_names())
        collections: list[dict] = []
        failed: list[dict] = []
        for n in names:
            if n.startswith("system."):
                continue
            try:
                collections.append(await _introspect_deep(n))
            except Exception as exc:  # noqa: BLE001
                log.exception("deep introspect failed for %s", n)
                failed.append({"name": n, "error": str(exc)})
        cached = {"collections": collections, "failed": failed}
        await _cache_set(key, cached)

    meta = await _cache_meta(key)
    generated_at = meta["generated_at"] if meta else datetime.now(timezone.utc).isoformat()

    if format == "md":
        md = _render_markdown({"generated_at": generated_at, **cached})
        return Response(
            content=md,
            media_type="text/markdown; charset=utf-8",
            headers={"Content-Disposition": 'attachment; filename="paneltec_schema.md"'},
        )
    # default json
    payload = json.dumps({"generated_at": generated_at, **cached}, indent=2, default=str)
    return Response(
        content=payload,
        media_type="application/json",
        headers={"Content-Disposition": 'attachment; filename="paneltec_schema.json"'},
    )
