"""v58.13.104 — Unified public-URL resolver for QR-code generators.

Prior to this ship, `assets.py::_public_base()` and
`workers_qr.py::_public_app_url()` each rolled their own env-var lookup
with DIFFERENT precedences and DIFFERENT fallbacks. On preview, the two
paths disagreed:
  · `assets.py` picked `FRONTEND_PUBLIC_URL` first → landed on a stale
    UUID preview host that no longer routes.
  · `workers_qr.py` (used by sites, workers, suppliers) picked
    `REACT_APP_BACKEND_URL` first → both env vars were unset on preview
    → returned "" → site/worker QRs encoded a scheme-less
    `/scan/site/{token}` URL. Phones couldn't open it.

This module unifies both to a single resolver with a stable, documented
precedence — and emits a WARNING log when every candidate is empty, so
the failure surfaces in logs at QR-generation time rather than
mysteriously later when a phone can't reach the QR target.
"""
from __future__ import annotations
import logging
import os

logger = logging.getLogger("qr_common")

# Precedence, most-specific → least-specific:
#   1. REACT_APP_BACKEND_URL  — canonical frontend URL, matches what the
#      React SPA itself uses. On Emergent-deployed prod this is the
#      customer-facing host (e.g. https://whs-compliance.emergent.host).
#   2. PUBLIC_APP_URL         — explicit override for edge cases (e.g. a
#      custom domain fronting the SPA).
#   3. FRONTEND_PUBLIC_URL    — legacy env var used by assets.py before
#      unification. Kept last so any existing prod deploys that only
#      have this variable set continue to work.
#
# Order chosen deliberately: `REACT_APP_BACKEND_URL` is the value the
# React SPA is compiled against, so a QR that encodes the same host will
# always land on the same SPA that a normal user is running. The other
# two are lower-priority fallbacks so a stale/legacy variable can't
# override a fresh canonical one.
_CANDIDATE_ENV_VARS = (
    "REACT_APP_BACKEND_URL",
    "PUBLIC_APP_URL",
    "FRONTEND_PUBLIC_URL",
)


def resolve_public_base() -> str:
    """Return the trimmed, no-trailing-slash public host for QR URLs.

    Empty string if none of the env vars are set. Callers should treat
    an empty return as a hard error — a QR encoding a scheme-less URL
    is not scannable by a phone camera.
    """
    for name in _CANDIDATE_ENV_VARS:
        value = (os.environ.get(name) or "").strip().rstrip("/")
        if value:
            return value
    # Fail loud — every 4-6 weeks someone forgets to set this in a new
    # environment. A silent empty return produces broken QRs that only
    # get noticed when a customer scans one on a phone and reports
    # "won't open" (as happened at .103 ship-time).
    logger.warning(
        "resolve_public_base(): all candidate env vars empty "
        "(REACT_APP_BACKEND_URL / PUBLIC_APP_URL / FRONTEND_PUBLIC_URL). "
        "QR codes generated in this state will encode SCHEME-LESS URLs "
        "and will NOT be openable from a phone camera. Set at least "
        "one of these on the backend pod."
    )
    return ""
