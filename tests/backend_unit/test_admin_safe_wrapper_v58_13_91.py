"""v58.13.91 — /api/admin/* mutation endpoints are wrapped with
`@safe_admin_endpoint`. Guards against CF 520 (origin sent invalid
response) by ensuring every unhandled exception surfaces as a
well-formed JSON `500 {detail:"internal_error", error_ref:<uuid>}`.

Two-part coverage:
  1. Source-scan: every mutation endpoint in the listed modules has
     the decorator (checked by iterating the AST).
  2. Behaviour: decorator itself catches non-HTTPException and
     returns clean JSON; HTTPException passes through unchanged.
"""
from __future__ import annotations
import ast
import asyncio
import re
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
MOBILE = ROOT / "mobile"

sys.path.insert(0, str(BACKEND))
from admin_safe_wrapper import safe_admin_endpoint  # noqa: E402

VERSION_JS = (FRONTEND / "src" / "lib" / "version.js").read_text(encoding="utf-8")
SW_JS = (FRONTEND / "public" / "service-worker.js").read_text(encoding="utf-8")
MOBILE_TS = (MOBILE / "src" / "lib" / "version.ts").read_text(encoding="utf-8")

# (file, expected mutation-endpoint count) — matches the ship report
# 23 = 3 + 1 + 2 + 7 + 3 + 3 + 4.
WRAPPED_MODULES = [
    ("admin_active_sessions.py", 3),
    ("admin_purge_test_data.py", 1),
    ("comms_safe_mode.py", 2),
    ("roles_catalogue.py", 7),
    ("session_timeout.py", 3),
    ("simpro_import_users.py", 3),
    ("swms_extras.py", 4),
]

MUTATION_VERBS = {"post", "put", "patch", "delete"}


def _mutation_endpoints_in(path: Path) -> list[tuple[str, list[str]]]:
    """Return list of (function_name, decorator_source_lines) for every
    async function decorated with @router.<verb>(...) or
    @admin_router.<verb>(...) where verb is a mutation verb."""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    src_lines = path.read_text(encoding="utf-8").splitlines()
    out: list[tuple[str, list[str]]] = []
    for node in ast.walk(tree):
        if not isinstance(node, (ast.AsyncFunctionDef, ast.FunctionDef)):
            continue
        deco_sources: list[str] = []
        is_mutation = False
        for dec in node.decorator_list:
            src = ast.get_source_segment(path.read_text(encoding="utf-8"), dec) or ""
            deco_sources.append(src)
            # Matches @router.post(...), @admin_router.patch(...), etc.
            m = re.match(
                r"@?(?:router|admin_router)\.(post|put|patch|delete)\b",
                src,
            )
            if m:
                is_mutation = True
        if is_mutation:
            out.append((node.name, deco_sources))
    return out


@pytest.mark.parametrize("filename,expected_count", WRAPPED_MODULES)
def test_all_admin_mutation_endpoints_are_wrapped(filename, expected_count):
    """Every mutation endpoint under /api/admin/* must carry the
    @safe_admin_endpoint decorator. Also verifies the ship-report
    endpoint count matches reality per file."""
    path = BACKEND / filename
    endpoints = _mutation_endpoints_in(path)
    assert len(endpoints) == expected_count, (
        f"{filename}: expected {expected_count} mutation endpoints, "
        f"found {len(endpoints)}: {[e[0] for e in endpoints]}"
    )
    for fn_name, decos in endpoints:
        deco_names = [re.sub(r"[\(\s].*$", "", d.lstrip("@")) for d in decos]
        assert any(d == "safe_admin_endpoint" for d in deco_names), (
            f"{filename}::{fn_name} is a mutation endpoint but lacks "
            f"@safe_admin_endpoint. Decorators: {deco_names}"
        )


def test_wrapper_module_present_and_importable():
    """Sanity check: the wrapper module is where the ship report says
    it is and exports `safe_admin_endpoint`."""
    p = BACKEND / "admin_safe_wrapper.py"
    assert p.exists()
    assert callable(safe_admin_endpoint)


# ── Behaviour ──

def test_wrapper_catches_random_exception_and_returns_clean_json():
    @safe_admin_endpoint
    async def crasher():
        raise ValueError("test crash")

    result = asyncio.get_event_loop().run_until_complete(crasher())
    import json
    body = json.loads(result.body.decode())
    assert result.status_code == 500
    assert body["detail"] == "internal_error"
    assert re.match(r"^[0-9a-f]{12}$", body["error_ref"])
    assert body["error_ref"] in body["hint"]


def test_wrapper_passes_http_exception_through_untouched():
    @safe_admin_endpoint
    async def bad_request():
        raise HTTPException(status_code=423, detail="env locked")

    with pytest.raises(HTTPException) as excinfo:
        asyncio.get_event_loop().run_until_complete(bad_request())
    assert excinfo.value.status_code == 423
    assert excinfo.value.detail == "env locked"


def test_wrapper_preserves_wrapped_signature_and_annotations():
    """FastAPI's `get_typed_signature()` must see the ORIGINAL
    function's parameters (not `*args, **kwargs`) so it can register
    body/query/dep params correctly. This guards against the
    `body: Model` → Query fallback bug that turned every wrapped
    endpoint into a 422 in the first .91 spike."""
    import inspect

    async def _endpoint(a: int, b: str = "default") -> dict:
        return {"a": a, "b": b}

    wrapped = safe_admin_endpoint(_endpoint)
    sig = inspect.signature(wrapped)
    assert list(sig.parameters) == ["a", "b"], (
        f"wrapper hid the original signature: got {list(sig.parameters)}"
    )
    # Under PEP 563 (this test module has `from __future__ import
    # annotations`) the annotation is the STRING 'int'; without it,
    # it's the `int` type. Both prove the wrapper propagated it.
    assert sig.parameters["a"].annotation in (int, "int")
    assert sig.parameters["b"].default == "default"
    assert wrapped.__wrapped__ is _endpoint


# ── Version-sync forward-safe pin >= 91 ─────────────────────────

def _tail(text: str, name: str) -> int:
    m = re.search(rf"{name}\s*=\s*['\"]paneltec-v[\d.]+\.(\d+)['\"]", text)
    assert m, f"{name} not found"
    return int(m.group(1))


def test_running_version_gte_91():
    assert _tail(VERSION_JS, "RUNNING_VERSION") >= 91


def test_cache_version_gte_91():
    assert _tail(SW_JS, "CACHE_VERSION") >= 91


def test_mobile_bundle_version_gte_91():
    assert _tail(MOBILE_TS, "MOBILE_BUNDLE_VERSION") >= 91
