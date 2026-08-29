"""v58.13.64a — Circular import guard.

Freezes the invariant established by the structural refactor:

  · `auth ↔ auth_invite ↔ email_outbox` — the lockout logical cycle
    was broken by extracting `is_locked` / `record_login_attempt` to
    `auth_lockout.py`. Both `auth.py` and `auth_invite.py` now import
    from `auth_lockout` at TOP LEVEL. No function-local
    `from auth_invite import is_locked, record_login_attempt` inside
    `auth.py` anymore.

  · `permissions ↔ mobile_modules` — the module-cache logical cycle
    was broken by extracting `_MODULES_CACHE`, `_MODULES_TTL_SEC`,
    and `invalidate_modules_cache` to `permission_helpers.py`, and
    by moving `DEFAULTS`, `ROLE_KEYS`, `MODULE_KEYS`, `_normalise`,
    `_load_matrix` to `mobile_modules_data.py`. Both `permissions.py`
    and `mobile_modules.py` now import from those two leaf modules at
    TOP LEVEL. No function-local
    `from mobile_modules import DEFAULTS` inside `permissions.py` and
    no function-local `from permissions import invalidate_modules_cache`
    inside `mobile_modules.py` anymore.

  · Global — zero top-level cycles in the entire `backend/` package.
    (The wider codebase still has ~21 function-local logical cycles
    elsewhere, but those are out of scope for this ship — flagged as
    v58.13.65+ follow-up.)

Static AST scan only — the test does NOT import backend modules
directly (that would drag in the FastAPI + Motor world for a purely
structural check).
"""
from __future__ import annotations

import ast
from pathlib import Path
from typing import Iterable

_BACKEND = Path("/app/backend")


def _iter_backend_modules() -> Iterable[Path]:
    for p in _BACKEND.glob("*.py"):
        # Skip generated / experimental / scripts-y modules.
        if p.name.startswith("_"):
            continue
        yield p


def _top_level_imports(path: Path) -> set[str]:
    """Return top-level module names imported by `path`."""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    out: set[str] = set()
    for node in tree.body:
        if isinstance(node, ast.Import):
            for a in node.names:
                out.add(a.name.split(".")[0])
        elif isinstance(node, ast.ImportFrom):
            if node.level == 0 and node.module:
                out.add(node.module.split(".")[0])
    return out


def _all_imports(path: Path) -> set[str]:
    """Return every module name imported by `path`, including those
    inside function/class bodies (`ast.walk`, not just `tree.body`)."""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    out: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for a in node.names:
                out.add(a.name.split(".")[0])
        elif isinstance(node, ast.ImportFrom):
            if node.level == 0 and node.module:
                out.add(node.module.split(".")[0])
    return out


def _build_graph(top_only: bool = True) -> dict[str, set[str]]:
    g: dict[str, set[str]] = {}
    for p in _iter_backend_modules():
        g[p.stem] = _top_level_imports(p) if top_only else _all_imports(p)
    return g


def _find_cycles(g: dict[str, set[str]]) -> list[list[str]]:
    """DFS every node, collecting simple cycles up to length 6."""
    cycles: list[list[str]] = []
    for start in g:
        stack: list[tuple[str, list[str]]] = [(start, [start])]
        while stack:
            node, path = stack.pop()
            for nxt in g.get(node, set()):
                if nxt not in g:
                    continue
                if nxt == start and len(path) > 1:
                    cycles.append(path + [nxt])
                elif nxt not in path and len(path) < 6:
                    stack.append((nxt, path + [nxt]))
    # Deduplicate on the sorted set of members.
    seen: set[tuple[str, ...]] = set()
    uniq: list[list[str]] = []
    for c in cycles:
        key = tuple(sorted(c[:-1]))
        if key not in seen:
            seen.add(key)
            uniq.append(c)
    return uniq


# ── Global invariant ────────────────────────────────────────────────


def test_no_top_level_import_cycles_in_backend():
    cycles = _find_cycles(_build_graph(top_only=True))
    assert not cycles, (
        "The `backend/` package contains at least one top-level "
        "circular import — Python may still import successfully "
        "because of the ordering, but the coupling is unsafe and one "
        f"more edge will break startup. Cycles:\n"
        + "\n".join("  " + " → ".join(c) for c in cycles)
    )


# ── Target-cycle guards (frozen by v58.13.64a) ──────────────────────


def test_auth_does_not_have_function_local_lockout_import():
    """`auth.login` used to carry
    `from auth_invite import is_locked, record_login_attempt` inside
    its body. v58.13.64a moved the helpers to `auth_lockout.py` and
    the import is now top-level. Freeze that."""
    src = (_BACKEND / "auth.py").read_text(encoding="utf-8")
    # Extract only actual `from X import Y` lines (not comments).
    from_lines = [
        line for line in src.splitlines()
        if line.lstrip().startswith("from auth_invite import")
    ]
    lockout_names = {"is_locked", "record_login_attempt"}
    for ln in from_lines:
        for name in lockout_names:
            assert name not in ln, (
                f"`auth.py` still imports `{name}` from `auth_invite`: "
                f"{ln.strip()!r}. Move the callsite to `auth_lockout`."
            )
    assert "from auth_lockout import is_locked, record_login_attempt" in src, (
        "`auth.py` must import the lockout helpers from `auth_lockout` "
        "at top level"
    )


def test_permissions_does_not_have_function_local_mobile_modules_import():
    """`permissions._load_role_modules` and the module gate used to
    carry function-local `from mobile_modules import …`. v58.13.64a
    moved the data table to `mobile_modules_data`."""
    src = (_BACKEND / "permissions.py").read_text(encoding="utf-8")
    # No function-local import of the moved names.
    assert "from mobile_modules import" not in src, (
        "`permissions.py` still imports from `mobile_modules` "
        "(likely function-local). Use `mobile_modules_data` instead."
    )
    assert "from mobile_modules_data import" in src, (
        "`permissions.py` must import DEFAULTS/ROLE_KEYS/_load_matrix "
        "from `mobile_modules_data` at top level"
    )


def test_mobile_modules_does_not_have_function_local_permissions_import():
    """`mobile_modules.put_mobile_modules` used to carry
    `from permissions import invalidate_modules_cache` inside three
    handler bodies. v58.13.64a moved the invalidator to
    `permission_helpers.py`."""
    src = (_BACKEND / "mobile_modules.py").read_text(encoding="utf-8")
    assert "from permissions import" not in src, (
        "`mobile_modules.py` still imports from `permissions` "
        "(likely function-local). Use `permission_helpers` instead."
    )
    assert "from permission_helpers import invalidate_modules_cache" in src, (
        "`mobile_modules.py` must import the cache invalidator from "
        "`permission_helpers` at top level"
    )


# ── Leaf-module invariants ─────────────────────────────────────────


def test_auth_lockout_is_a_leaf():
    """`auth_lockout` must not import from `auth`, `auth_invite`,
    `permissions`, `mobile_modules`, or `email_outbox` — otherwise the
    cycle-break is illusory."""
    top = _top_level_imports(_BACKEND / "auth_lockout.py")
    forbidden = {"auth", "auth_invite", "permissions", "mobile_modules",
                 "email_outbox", "permission_helpers", "mobile_modules_data"}
    dirty = top & forbidden
    assert not dirty, (
        f"`auth_lockout` must be a leaf but imports: {dirty!r}"
    )


def test_permission_helpers_is_a_leaf():
    top = _top_level_imports(_BACKEND / "permission_helpers.py")
    forbidden = {"auth", "auth_invite", "auth_lockout",
                 "permissions", "mobile_modules", "email_outbox"}
    dirty = top & forbidden
    assert not dirty, (
        f"`permission_helpers` must be a leaf but imports: {dirty!r}"
    )


def test_mobile_modules_data_is_a_leaf():
    top = _top_level_imports(_BACKEND / "mobile_modules_data.py")
    forbidden = {"auth", "auth_invite", "auth_lockout",
                 "permissions", "mobile_modules", "email_outbox",
                 "permission_helpers"}
    dirty = top & forbidden
    assert not dirty, (
        f"`mobile_modules_data` must be a leaf but imports: {dirty!r}"
    )


# ── Version-sync (forward-safe) ─────────────────────────────────────


def test_version_sync_moved_past_v58_13_63():
    v_js = Path("/app/frontend/src/lib/version.js").read_text(encoding="utf-8")
    m_ts = Path("/app/mobile/src/lib/version.ts").read_text(encoding="utf-8")
    sw_js = Path(
        "/app/frontend/public/service-worker.js"
    ).read_text(encoding="utf-8")
    assert "RUNNING_VERSION = 'paneltec-v160.3.9.58.13.63'" not in v_js
    assert "'paneltec-v160.3.9.58.13.63'" not in m_ts
    assert "'paneltec-v160.3.9.58.13.63'" not in sw_js
    assert "v160.3.9.58.13.64" in v_js
