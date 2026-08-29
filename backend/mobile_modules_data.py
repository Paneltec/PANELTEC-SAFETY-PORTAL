"""v58.13.64a — Mobile-modules pure-data module extracted from
`mobile_modules.py`.

`permissions.py` needs `_load_matrix`, `DEFAULTS`, `ROLE_KEYS` to
evaluate `require_module(...)` dependencies. `mobile_modules.py`
imports `get_current_user` from `auth` at top level, and `auth`
imports things from `permissions` at top level → so `permissions`
couldn't import from `mobile_modules` at top level without cycling.

By pulling the data table + matrix reader down into this leaf
module (depends only on `db` + `models`), both `permissions.py` and
`mobile_modules.py` can import at top level with zero cycles.

`mobile_modules.py` re-exports the moved names so external callers
(none today, but future admin tooling might reach for `MODULE_KEYS`
etc.) don't have to know about this split.
"""
from __future__ import annotations

from typing import Dict

from db import db
from models import now_iso


# ──────────────────────────────────────────────────────────────────────
# Module catalogue. Keep keys in sync with the friendly labels used by
# the web admin UI and the Expo mobile navigation.
# ──────────────────────────────────────────────────────────────────────
MODULE_KEYS = [
    "pre_start", "site_diary", "hazard", "incident", "inspection",
    "swms", "inductions", "plant_vehicles",
    "certifications", "ask_intel", "sign_on", "profile",
    # v158 — 5 new mobile modules exposed to admins in the allocator.
    # `service_maintenance` was retired (rolled into `plant_vehicles`) —
    # `_normalise` silently drops any legacy value stored under that key.
    "forms", "document_library", "contractors", "suppliers", "workers",
    # v159.1 — Users Directory tile (admin-only by default).
    "users_directory",
    # v160.0.2 — Compliance Snapshot chip row on phone Home.
    # Aggregated org counts (SWMS / Pre-starts / Site diary / Hazards /
    # Incidents / Inspections). Belt-and-braces gate on top of the
    # existing `attention_band='hidden'` server signal — either can hide.
    "compliance_snapshot",
]
ROLE_KEYS = ["worker", "supervisor", "contractor", "admin"]

# v158 — Keys we accept on read but never write. Any existing docs in
# `org_settings.mobile_modules` that were saved before v158 may still
# carry `service_maintenance`; `_normalise` will drop it silently.
_RETIRED_MODULE_KEYS = {"service_maintenance"}

# Default matrix. Workers / supervisors get the full operational kit.
# Contractors are deliberately minimal — they only need to sign-on, see
# their SWMS, complete inductions, and view their own profile.
DEFAULTS: Dict[str, Dict[str, bool]] = {
    "worker": {
        "pre_start": True, "site_diary": True, "hazard": True, "incident": True,
        "inspection": True, "swms": True, "inductions": True,
        # v159.0 hardening — worker no longer sees Plant & Vehicles module by
        # default. Reserved for supervisor+ per the audit §3 matrix.
        "plant_vehicles": False,
        "certifications": True, "ask_intel": False,
        "sign_on": True, "profile": True,
        # v159.0 — Document Library flipped OFF by default. Worker retrieves
        # own induction docs via the induction flow, not the library.
        # Contractors / suppliers / workers directory stay OFF.
        "forms": True, "document_library": False,
        "contractors": False, "suppliers": False, "workers": False,
        # v159.1 — workers never see the Users tile; admin only.
        "users_directory": False,
        # v160.0.2 — workers never see org-wide aggregate counts.
        "compliance_snapshot": False,
    },
    "supervisor": {k: True for k in MODULE_KEYS if k != "users_directory"} | {"users_directory": False},
    "contractor": {
        # v159.0 — contractors need to see hazards + incidents that pertain
        # to their crew, so hazard/incident flipped ON by default per audit §3.
        "pre_start": False, "site_diary": False, "hazard": True, "incident": True,
        "inspection": False, "swms": True, "inductions": True,
        "plant_vehicles": False,
        "certifications": False, "ask_intel": False,
        "sign_on": True, "profile": True,
        # v158 defaults per user brief.
        "forms": True, "document_library": True,
        "contractors": True, "suppliers": False, "workers": False,
        "users_directory": False,
        # v160.0.2 — contractors don't need org-wide compliance aggregates.
        "compliance_snapshot": False,
    },
    # Admin column is always-on in the UI and persisted as such so the
    # mobile app can ungate every module if an admin ever signs in there.
    "admin": {k: True for k in MODULE_KEYS},
}

# v159.1 — bump this string whenever DEFAULTS shift so we can nudge admins
# to review the new hardened matrix. Persisted alongside the stored doc as
# `defaults_version`; when missing/older, the GET /settings/mobile-modules
# response includes `needs_migration_review: true` so the admin UI can show
# a "New defaults available — review and save" banner.
DEFAULTS_VERSION = "v160.0.2"


def _normalise(matrix: Dict[str, Dict[str, bool]]) -> Dict[str, Dict[str, bool]]:
    """Coerce an incoming payload into the canonical shape. Unknown keys
    are dropped, missing keys fall back to the defaults, and the admin
    row is force-set to all-true so the UI lock can never be bypassed
    by a hand-crafted PUT.

    v158 — retired module keys (see `_RETIRED_MODULE_KEYS`) are silently
    dropped on read so pre-v158 documents don't leak stale toggles into
    the response payload."""
    out: Dict[str, Dict[str, bool]] = {}
    for role in ROLE_KEYS:
        row_in = (matrix or {}).get(role) or {}
        # Strip retired keys before we even look at them.
        row_in = {k: v for k, v in row_in.items() if k not in _RETIRED_MODULE_KEYS}
        row = {}
        for mod in MODULE_KEYS:
            if role == "admin":
                row[mod] = True
            elif mod in row_in:
                row[mod] = bool(row_in[mod])
            else:
                row[mod] = bool(DEFAULTS[role].get(mod, False))
        out[role] = row
    return out


async def _load_matrix(org_id: str) -> Dict[str, Dict[str, bool]]:
    """Read-with-seed. If `org_settings.mobile_modules` is missing for
    the org, we persist the defaults so subsequent reads + audit diffs
    have a stable baseline to compare against."""
    doc = await db.org_settings.find_one({"org_id": org_id})
    if doc and isinstance(doc.get("mobile_modules"), dict):
        return _normalise(doc["mobile_modules"])
    seeded = _normalise({})
    await db.org_settings.update_one(
        {"org_id": org_id},
        {"$set": {"mobile_modules": seeded, "updated_at": now_iso()},
         "$setOnInsert": {"org_id": org_id, "created_at": now_iso()}},
        upsert=True,
    )
    return seeded
