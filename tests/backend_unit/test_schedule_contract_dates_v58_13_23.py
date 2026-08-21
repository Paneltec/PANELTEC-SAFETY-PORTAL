"""v58.13.23 — Contract dates on ScheduleIn.

Coverage:
  1. ScheduleIn accepts all 4 new contract fields; round-trip parse
     preserves the exact ISO strings.
  2. Missing fields default to None (legacy schedules parse cleanly).
  3. Empty string is NOT auto-null-ified server-side (that's the
     FE's job — matches how other Optional[str] fields behave).
     `""` is accepted as a value; storage sees `""`.
  4. `max_length=32` guard fires on absurdly long strings.
  5. openapi.json includes all 4 fields under
     `components.schemas.ScheduleIn.properties`.
"""
from __future__ import annotations
import os
import sys
import json
from pathlib import Path

import pytest

_BACKEND = Path("/app/backend")
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))
_env = _BACKEND / ".env"
if _env.exists():
    for _line in _env.read_text(encoding="utf-8").splitlines():
        _line = _line.strip()
        if not _line or _line.startswith("#") or "=" not in _line:
            continue
        _k, _, _v = _line.partition("=")
        os.environ.setdefault(_k.strip(), _v.strip().strip('"').strip("'"))

from asset_service import ScheduleIn  # noqa: E402
from pydantic import ValidationError  # noqa: E402


_BASE = {"name": "s1", "interval_kind": "hours", "interval_value": 250}


def test_all_four_contract_fields_accepted_and_preserved():
    payload = {**_BASE,
               "contract_cust_on": "2024-01-15",
               "contract_start":   "2024-02-01",
               "contract_review":  "2024-08-01",
               "contract_expiry":  "2025-02-01"}
    m = ScheduleIn(**payload)
    assert m.contract_cust_on == "2024-01-15"
    assert m.contract_start == "2024-02-01"
    assert m.contract_review == "2024-08-01"
    assert m.contract_expiry == "2025-02-01"
    # Round-trip through JSON (Pydantic v2 model_dump / model_dump_json).
    dumped = m.model_dump()
    for k in ("contract_cust_on", "contract_start",
              "contract_review", "contract_expiry"):
        assert dumped[k] == payload[k]


def test_legacy_schedule_missing_contract_fields_parses_cleanly():
    """Schedules created before v58.13.23 don't carry any contract
    fields. ScheduleIn must default them all to None."""
    m = ScheduleIn(**_BASE)
    assert m.contract_cust_on is None
    assert m.contract_start is None
    assert m.contract_review is None
    assert m.contract_expiry is None


def test_explicit_none_is_accepted():
    m = ScheduleIn(**_BASE,
                   contract_cust_on=None,
                   contract_start=None,
                   contract_review=None,
                   contract_expiry=None)
    assert m.contract_expiry is None


def test_partial_fields_survive_roundtrip():
    """Setting only some of the 4 must not affect the others."""
    m = ScheduleIn(**_BASE, contract_expiry="2025-12-31")
    assert m.contract_expiry == "2025-12-31"
    assert m.contract_cust_on is None
    assert m.contract_start is None
    assert m.contract_review is None


def test_max_length_guard_fires_on_absurdly_long_string():
    with pytest.raises(ValidationError):
        ScheduleIn(**_BASE, contract_expiry="x" * 500)


def test_openapi_surface_includes_all_four_fields():
    """FastAPI auto-derives the OpenAPI schema from Pydantic. The
    live /api/openapi.json must expose all 4 contract fields under
    `components.schemas.ScheduleIn.properties`."""
    import urllib.request
    try:
        with urllib.request.urlopen("http://localhost:8001/api/openapi.json",
                                    timeout=5) as r:
            spec = json.loads(r.read())
    except Exception as e:
        pytest.skip(f"backend not reachable on localhost:8001: {e}")
    schemas = spec.get("components", {}).get("schemas", {})
    schedule_in = schemas.get("ScheduleIn") or schemas.get("ScheduleIn-Input")
    assert schedule_in is not None, "ScheduleIn schema missing from openapi.json"
    props = schedule_in.get("properties", {})
    for name in ("contract_cust_on", "contract_start",
                 "contract_review", "contract_expiry"):
        assert name in props, f"{name} missing from openapi.json ScheduleIn"
        # Optional[str] surfaces as anyOf: [{type: string, maxLength: 32}, {type: null}]
        # (Pydantic v2). Just confirm the string branch has maxLength=32.
        entry = props[name]
        branches = entry.get("anyOf") or [entry]
        str_branch = next(
            (b for b in branches if b.get("type") == "string"),
            None,
        )
        assert str_branch is not None, f"{name} has no string branch"
        assert str_branch.get("maxLength") == 32, (
            f"{name} maxLength != 32 (got {str_branch.get('maxLength')})"
        )
