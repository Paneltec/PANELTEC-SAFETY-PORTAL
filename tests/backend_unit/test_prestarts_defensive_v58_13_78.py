"""v58.13.78 — Prod /app/pre-starts Cloudflare 520 defensive fix.

Static source-pins for the three defensive changes in
`backend/crud.py::build_router()`:

  1. `_safe_encode_list(docs, route_hint)` wraps the final list return
     so a single unserialisable doc can't crash the response stream.
  2. `_slim_mirror_metadata(row)` strips heavy blob fields from the
     mirrored `form_submissions` rows before serialisation.
  3. `list_items` handler wraps the whole body in a try/except that
     logs the failing user + resource and returns HTTP 500 with a
     clean JSON body instead of dropping the connection.

Plus the default `limit` drop from 200 → 100 and the version-sync
invariant.
"""
from __future__ import annotations
import importlib
import sys
from pathlib import Path

APP = Path(__file__).resolve().parent.parent.parent
BACKEND = APP / "backend"
FRONTEND = APP / "frontend"
MOBILE = APP / "mobile"

if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

CRUD_PY = (BACKEND / "crud.py").read_text(encoding="utf-8")
VERSION_JS = (FRONTEND / "src" / "lib" / "version.js").read_text(encoding="utf-8")
SW_JS = (FRONTEND / "public" / "service-worker.js").read_text(encoding="utf-8")
MOBILE_TS = (MOBILE / "src" / "lib" / "version.ts").read_text(encoding="utf-8")


# ─────────────────────────────────────────────────────────────
# Helpers exist and behave as expected
# ─────────────────────────────────────────────────────────────
def test_safe_encode_helper_exists_and_is_defensive():
    crud = importlib.import_module("crud")
    assert hasattr(crud, "_safe_encode_list"), (
        "crud.py must expose `_safe_encode_list(docs, route_hint)`."
    )
    # Well-formed input: returns encoded copies.
    out = crud._safe_encode_list([{"id": "a"}, {"id": "b"}], "/pre-starts")
    assert len(out) == 2 and out[0]["id"] == "a"

    # Unserialisable input: dropped, not raised. Non-UTF-8 bytes cause
    # `jsonable_encoder` to throw UnicodeDecodeError; a plain `object()`
    # throws ValueError. Both must be swallowed.
    bad = [
        {"id": "ok"},
        {"id": "bad-bytes", "raw": b"\xff\xfe\xfd"},
        {"id": "bad-object", "x": object()},
        {"id": "also-ok"},
    ]
    out = crud._safe_encode_list(bad, "/pre-starts")
    # The bad rows MUST be dropped so the good rows still surface.
    ids = [r["id"] for r in out]
    assert "ok" in ids and "also-ok" in ids, (
        "_safe_encode_list must never raise on a single bad row — "
        "must log-and-skip so the rest of the response survives."
    )
    assert "bad-bytes" not in ids and "bad-object" not in ids, (
        "Bad rows (non-UTF-8 bytes, opaque objects) should have been "
        "dropped by the encoder."
    )


def test_slim_mirror_metadata_strips_heavy_fields():
    crud = importlib.import_module("crud")
    heavy = {"id": "1", "metadata": {
        "raw_extraction_json": "x" * 10_000_000,
        "raw_html": "y" * 5_000_000,
        "claude_response": {"junk": "x" * 100_000},
        "keep_me": "yes",
    }, "attachments": [
        {"filename": "a.pdf", "base64": "data:..." + "z" * 5_000_000},
        {"filename": "b.png", "data_url": "data:..." + "w" * 100_000},
    ]}
    out = crud._slim_mirror_metadata(heavy)
    assert "raw_extraction_json" not in out["metadata"]
    assert "raw_html" not in out["metadata"]
    assert "claude_response" not in out["metadata"]
    assert out["metadata"]["keep_me"] == "yes", (
        "Only known heavy fields must be stripped — everything else "
        "in `metadata` must survive."
    )
    for a in out["attachments"]:
        assert "base64" not in a
        assert "data_url" not in a
        assert a.get("filename")  # descriptor preserved


def test_slim_mirror_is_idempotent_on_shapes_without_metadata():
    crud = importlib.import_module("crud")
    # Missing metadata / attachments — must not raise.
    assert crud._slim_mirror_metadata({"id": "no-meta"}) == {"id": "no-meta"}
    row = {"id": "meta-not-dict", "metadata": "some-string"}
    assert crud._slim_mirror_metadata(row) == row


# ─────────────────────────────────────────────────────────────
# Source-pins on the handler
# ─────────────────────────────────────────────────────────────
def test_default_list_limit_dropped_to_100():
    # v58.13.84 (A3): max cap dropped 50000 → 5000, default still 100.
    assert "limit: int = Query(100, ge=1, le=5000)" in CRUD_PY, (
        "Default list `limit` must be dropped from 200 → 100 so the "
        "prod response never balloons on a first-load."
    )


def test_top_level_try_except_wraps_list_impl():
    """The public `list_items` route must wrap the body in
    try/except so a crash NEVER drops the response mid-stream."""
    assert "async def _list_impl(" in CRUD_PY, (
        "The list-body implementation must be extracted into "
        "`_list_impl(...)` so the handler wrapper can try/except it."
    )
    # The wrapper must exist and raise HTTPException on failure, not
    # let the exception bubble to Starlette's default handler (which
    # emits a 500 response but only AFTER the response body streaming
    # has begun).
    idx = CRUD_PY.index("async def list_items(")
    body = CRUD_PY[idx:idx + 2500]
    assert "return await _list_impl(" in body, (
        "list_items must delegate to `_list_impl(...)` after entering "
        "the try block."
    )
    assert "raise HTTPException(" in body and "list_items_failed" in body, (
        "list_items must raise a well-formed HTTPException with a "
        "clean JSON body (`list_items_failed`) rather than letting a "
        "crash propagate mid-stream."
    )


def test_safe_encode_is_wired_into_list_return():
    assert "_safe_encode_list(docs" in CRUD_PY, (
        "The list handler must return `_safe_encode_list(docs, ...)` "
        "so per-doc failures don't crash the whole response."
    )


def test_slim_mirror_is_wired_into_list_flow():
    assert "_slim_mirror_metadata(_m)" in CRUD_PY, (
        "The list handler must call `_slim_mirror_metadata(_m)` on "
        "each mirrored row before merging into the response."
    )


# ─────────────────────────────────────────────────────────────
# Version sync — >= 78 (forward-safe)
# ─────────────────────────────────────────────────────────────
def _tail(text: str, needle: str) -> int:
    import re
    m = re.search(
        needle + r"\s*=\s*['\"]paneltec-v160\.3\.9\.58\.13\.(\d+)['\"]",
        text,
    )
    assert m, f"{needle}: version literal not found"
    return int(m.group(1))


def test_running_version_bumped_to_at_least_78():
    n = _tail(VERSION_JS, "RUNNING_VERSION")
    assert n >= 78, f"RUNNING_VERSION tail must be >= 78 (got {n})"


def test_cache_version_bumped_to_at_least_78():
    n = _tail(SW_JS, "CACHE_VERSION")
    assert n >= 78, f"CACHE_VERSION tail must be >= 78 (got {n})"


def test_mobile_bundle_version_bumped_to_at_least_78():
    n = _tail(MOBILE_TS, "MOBILE_BUNDLE_VERSION")
    assert n >= 78, f"MOBILE_BUNDLE_VERSION tail must be >= 78 (got {n})"
