"""Shared auth helpers used by multiple backend modules.

Breaking out into its own module so that helpers like
:func:`verify_bearer_token` can be imported eagerly by
``backup_service.py`` without re-creating the ``server.py``
↔ ``backup_service.py`` circular import the codebase used
to work around with lazy in-function imports.
"""
from __future__ import annotations

import os
from typing import Any, Optional, Tuple


async def verify_bearer_token(db: Any, authorization: Optional[str]) -> Tuple[bool, Optional[dict]]:
    """Decode a Civil Bearer JWT and look up the matching user.

    Returns ``(ok, user_doc_without_id)``. Never raises — designed for
    fallback auth paths (e.g. ``?token=`` query param on a plain
    ``<a href>`` download link) where we want to fall through to a
    secondary credential check rather than emit a 401.

    Parameters
    ----------
    db:
        The motor (async Mongo) database handle that owns the ``users``
        collection. Passed in so this helper has no module-level db
        coupling — both ``server.py`` and ``backup_service.py`` can
        share it without a circular import.
    authorization:
        The raw ``Authorization`` HTTP header value
        (``Bearer <jwt>``). ``None`` / empty / malformed → returns
        ``(False, None)``.
    """
    if not authorization or not authorization.lower().startswith("bearer "):
        return False, None
    token = authorization.split(" ", 1)[1].strip()
    try:
        import jwt as _jwt  # local import keeps cold-start cheap
        payload = _jwt.decode(
            token,
            os.environ["JWT_SECRET"],
            algorithms=["HS256"],
        )
        u = await db.users.find_one(
            {"id": payload["sub"]},
            {"_id": 0},
        )
        return bool(u), u
    except Exception:
        return False, None
