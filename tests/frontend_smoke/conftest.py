"""v58.13.109b — Auto-skip hook for tests that source-pin the now-
deleted `frontend/src/pages/SiteSigninList.jsx`.

The legacy /app/site-signin flow was retired in v58.13.109b (user
confirmed the flow was functionally the same as the .106 public
visitor register; data migrated via
`backend/scripts/migrate_legacy_signins_v58_13_109b.py`). Rather
than editing 7 legacy test files that carry per-page source pins on
the deleted component, this hook auto-skips any test node whose id
or referenced module string carries the `site_signin` /
`SiteSigninList` fingerprint.

Only kicks in when the underlying file is genuinely missing, so a
future ship that restores the flow re-enables the tests
automatically.
"""
from __future__ import annotations
from pathlib import Path

import pytest

_SITE_SIGNIN_SRC = Path("/app/frontend/src/pages/SiteSigninList.jsx")


def pytest_collection_modifyitems(config, items):
    if _SITE_SIGNIN_SRC.exists():
        return  # legacy component present — run every test as usual.
    marker = pytest.mark.skip(
        reason="v58.13.109b: SiteSigninList.jsx retired; legacy source-pin skipped"
    )
    fingerprints = ("site_signin", "sitesignin", "site-signin")
    for it in items:
        nodeid_l = it.nodeid.lower()
        name_l = (getattr(it, "name", "") or "").lower()
        if any(fp in nodeid_l or fp in name_l for fp in fingerprints):
            it.add_marker(marker)
