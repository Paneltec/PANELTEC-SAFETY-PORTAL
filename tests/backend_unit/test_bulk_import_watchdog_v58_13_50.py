"""v58.13.50 — Bulk-import vision-stall watchdog cap raised.

Guards two things:
  1. Default cap is 30 minutes (was 15 in v58.5.1..v58.13.49).
     Env override `BULK_IMPORT_VISION_STALL_TIMEOUT_MIN` still works.
  2. Recurring 5-job pattern documented in the changelog — each of
     the 5 failed jobs stalled at the exact same stage, exceeded
     the 15-min cap, and was reaped by the watchdog despite the
     pipeline being otherwise healthy. Raising to 30 min gives
     legitimate Claude latency spikes room to breathe without
     losing the guard-rail for a truly-hung job.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

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


def test_vision_stall_timeout_default_is_thirty_minutes():
    """Reload the module fresh so env-var overrides don't skew the
    default read. We're specifically asserting the CODE default
    (30), not the runtime value."""
    import importlib
    if "bulk_import_prestarts" in sys.modules:
        importlib.reload(sys.modules["bulk_import_prestarts"])
    import bulk_import_prestarts as bip
    # If the env var is set at import time, the module reads that
    # value — so we can only assert the default when it's absent.
    if os.environ.get("BULK_IMPORT_VISION_STALL_TIMEOUT_MIN"):
        return
    assert bip.VISION_STALL_TIMEOUT_MIN == 30, (
        f"Default vision-stall timeout regressed to "
        f"{bip.VISION_STALL_TIMEOUT_MIN} minutes — v58.13.50 set it "
        "to 30 to accommodate legitimate Claude latency spikes on "
        "large imports (29,350-record job hit the 15-min cap)."
    )
