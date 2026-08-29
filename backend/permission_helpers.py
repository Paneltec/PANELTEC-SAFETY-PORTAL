"""v58.13.64a — Cache + invalidator extracted from `permissions.py`.

`mobile_modules.py` needs `invalidate_modules_cache` after every
admin PUT / override write, and `permissions.py` needs it as the
backing store for `_load_role_modules`. Previously the invalidator
lived in `permissions.py` and `mobile_modules.py` reached back into
it via a function-local import. Extracting the cache primitives here
(a leaf module with no upstream deps) lets both modules import at
top level without cycling.
"""
from __future__ import annotations

from typing import Dict, Optional


# In-memory cache of the module matrix keyed by `"{org_id}:{role}"`.
# TTL-bounded reads for hot paths; explicit invalidation from the PUT
# path collapses the window to zero for the caller who just changed
# something.
_MODULES_CACHE: Dict[str, "tuple[float, Dict[str, bool]]"] = {}
_MODULES_TTL_SEC = 60.0


def invalidate_modules_cache(org_id: Optional[str] = None) -> None:
    """Clear the in-memory module cache. Called from the PUT handler in
    `mobile_modules.py` after an admin saves a new matrix so subsequent
    calls see the change immediately (without waiting for the TTL)."""
    if org_id is None:
        _MODULES_CACHE.clear()
        return
    dead = [k for k in _MODULES_CACHE if k.startswith(f"{org_id}:")]
    for k in dead:
        _MODULES_CACHE.pop(k, None)
