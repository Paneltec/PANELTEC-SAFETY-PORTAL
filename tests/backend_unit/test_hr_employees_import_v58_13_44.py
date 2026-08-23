"""v58.13.44 — Backend regression test.

Guards two things the v58.13.43 → v58.13.44 investigation exposed:

1. `backend/hr_employees.py` must import cleanly. If the v58.13.43
   Pydantic v2 `ConfigDict` refactor ever regresses (missing
   `ConfigDict` import, malformed `model_config`, etc.) FastAPI's
   startup will crash on the `from hr_employees import router`
   line in `server.py` and the whole backend 502s.

2. `RowPatch` must still emit ZERO `PydanticDeprecatedSince20`
   warnings and MUST accept arbitrary extra fields (that's the whole
   reason it existed as `extra="allow"` in the first place). Guards
   against someone "cleaning up" the model and accidentally
   restoring the strict default.

Placement rationale: `/app/tests/backend_unit/` runs under the
same test env as the other backend suites (MONGO_URL already
loaded via conftest). The v58.13.10 hard rule about
`/app/tests/frontend_smoke/` staying outside `--reload-dir
/app/backend` doesn't apply to backend tests — this file is
intentionally under backend_unit.
"""
from __future__ import annotations

import warnings


def test_hr_employees_imports_cleanly():
    """Bare `import hr_employees` must not raise. This is the exact
    same import `server.py` fires at startup — if it blows here it
    would 502 the whole backend at boot."""
    import importlib
    import hr_employees
    # Force a fresh reload so a cached previous-good import can't
    # mask a real regression in the current file.
    importlib.reload(hr_employees)
    assert hasattr(hr_employees, "router"), (
        "hr_employees.router missing — the FastAPI app in server.py "
        "imports this router at startup; if it's gone the whole "
        "backend 502s."
    )


def test_row_patch_uses_configdict_not_deprecated_class_form():
    """v58.13.43 fixed `class RowPatch(BaseModel): class Config: ...`
    → `model_config = ConfigDict(extra='allow')`. This test locks
    that in — if anyone reverts to the class-based `Config` form,
    Pydantic will emit `PydanticDeprecatedSince20` and pytest gains
    a warning again."""
    from pydantic import ConfigDict
    from hr_employees import RowPatch

    # The `model_config` attribute is the v2 idiom.
    assert hasattr(RowPatch, "model_config"), (
        "RowPatch.model_config missing — did someone revert to the "
        "class-based `Config` form? See v58.13.43 changelog."
    )
    # And it must still allow arbitrary extra fields (the point of
    # this model — patches carry sparse client-supplied keys).
    assert RowPatch.model_config == ConfigDict(extra="allow"), (
        f"RowPatch.model_config regressed to {RowPatch.model_config!r}. "
        "v58.13.43 requires `ConfigDict(extra='allow')`."
    )
    # And it must NOT have the legacy nested Config class defined.
    # (Pydantic v2 tolerates both; but the presence of the nested
    # class re-triggers PydanticDeprecatedSince20.)
    assert "Config" not in RowPatch.__dict__, (
        "RowPatch still defines a nested `Config` class — that re-"
        "triggers PydanticDeprecatedSince20. Remove it and rely on "
        "`model_config` only."
    )


def test_row_patch_accepts_extra_fields_without_deprecation_warning():
    """End-to-end contract: instantiate RowPatch with sparse extras,
    round-trip via `model_dump`, capture warnings.

    v58.13.43 rationale: `hr_employees.PATCH /{uid}` accepts arbitrary
    client-supplied field/value pairs (the FE builds a partial patch
    document from whatever the operator edited). If Pydantic ever
    switches to `extra='ignore'` those fields would be silently
    dropped and the PATCH would 200-with-no-change — a silent data
    loss bug worse than a 502.
    """
    from hr_employees import RowPatch

    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        rp = RowPatch(
            first_name="Ada",
            last_name="Lovelace",
            linked_worker_id="w-42",
            random_new_field_we_haven_t_shipped_yet=True,
        )
        dumped = rp.model_dump(exclude_unset=True)

    # Every supplied key must round-trip.
    assert dumped == {
        "first_name": "Ada",
        "last_name": "Lovelace",
        "linked_worker_id": "w-42",
        "random_new_field_we_haven_t_shipped_yet": True,
    }, dumped

    # And NO Pydantic deprecation warning was emitted during the
    # construction. Starlette / python_multipart / etc. warnings
    # from OTHER modules are ignored — we only care about pydantic
    # warnings sourced from the RowPatch construction path.
    pydantic_dep = [
        w for w in caught
        if "PydanticDeprecatedSince20" in str(type(w.message).__name__)
        or "class-based `config`" in str(w.message).lower()
    ]
    assert not pydantic_dep, (
        f"Pydantic emitted deprecation warnings during RowPatch "
        f"construction: {[str(w.message) for w in pydantic_dep]}"
    )


def test_backend_router_prefix_still_gated_under_api():
    """Defence-in-depth: the FastAPI app must expose hr_employees
    under `/api/hr/employees` — the ingress strips only `/api` and
    routes the rest to the backend. If the prefix ever regresses
    (typo, refactor), every hr_employees endpoint 404s and the FE
    Employees page renders as an empty list — a soft failure that
    doesn't 502 but is arguably worse."""
    from hr_employees import router
    assert router.prefix == "/hr/employees", (
        f"hr_employees router prefix regressed to {router.prefix!r}. "
        "Expected `/hr/employees` (ingress prepends `/api`). Fix "
        "before landing — Employees page will render empty otherwise."
    )
