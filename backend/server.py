"""FastAPI app entrypoint — mounts all routers under /api."""
import logging
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).parent
load_dotenv(ROOT / ".env")  # MUST run before importing anything that reads env

from fastapi import APIRouter, Depends, FastAPI  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402

from ai import router as ai_router  # noqa: E402
from ask import router as ask_router, ensure_indexes as ask_ensure_indexes  # noqa: E402
from assets import router as assets_router  # noqa: E402
# v58.13.120b — Fleet & Service Register (Phase 2). Endpoints gated
# by `FLEET_REGISTER_ENABLED` env flag; default off means every
# /api/fleet/* route returns 404.
from fleet import router as fleet_router  # noqa: E402
from asset_service import router as asset_service_router, scan_router as asset_scan_router, assignments_router as form_assignments_router  # noqa: E402
from asset_navixy_sync import router as asset_navixy_sync_router, sync_navixy_counters  # noqa: E402
# Phase 4.8 — Asset meter trends (daily snapshots + week/month deltas).
from asset_meter_history import (  # noqa: E402
    router as asset_meter_history_router,
    meter_history_daily_snapshot,
    backfill_30d as meter_history_backfill_30d,
    ensure_indexes as meter_history_ensure_indexes,
)
from asset_navixy_dashboards import router as asset_navixy_dashboards_router  # noqa: E402
from fleet_navixy_tags import router as fleet_navixy_tags_router  # noqa: E402
from forms_pickers import router as forms_pickers_router  # noqa: E402
from help_routes import router as help_router  # noqa: E402
from notifications import router as notifications_router  # noqa: E402 — v57
from auth import get_current_user, router as auth_router  # noqa: E402
from contractors import router as contractors_router  # noqa: E402
from crud import (  # noqa: E402
    diary_router, hazards_router, incidents_router, inspections_router,
    prestarts_router, risk_assessments_router, swms_router,
)
from dashboard import files_router, router as dashboard_router  # noqa: E402
from visitor_signins import (  # noqa: E402  — v58.13.106 public visitor sign-in
    public_router as visitor_public_router,
    public_flat as visitor_public_flat_router,
    admin_router as visitor_admin_router,
)
# v58.13.107 — mobile_sites.py was here, REMOVED in v58.13.132d (reconciled to existing endpoints).
# v58.13.132d — mobile_sites.py REMOVED (reconciled: mobile now uses existing sites_qr + sites_signon_v127 endpoints)
# v58.13.132a — Mobile onboarding + PIN auth.
from mobile_auth import router as mobile_auth_router  # noqa: E402
from mobile_home import router as mobile_home_router  # noqa: E402
from mobile_daily_jobs import router as mobile_daily_jobs_router  # noqa: E402
# v58.13.132ab — admin daily-jobs + BOM weather + Nominatim geocode.
from mobile_daily_jobs_admin import (  # noqa: E402
    router as mobile_daily_jobs_admin_router,
    ensure_indexes as _mobile_daily_jobs_ensure_indexes,
)
# v58.13.132ad — Onboarding cards PDF.
from mobile_onboarding_cards import router as mobile_onboarding_cards_router  # noqa: E402
# v58.13.132af — Android APK direct-install downloads.
from mobile_downloads import router as mobile_downloads_router  # noqa: E402
from mobile_preview import router as mobile_preview_router  # noqa: E402
from db import close as close_db  # noqa: E402
from document_library import (  # noqa: E402
    router as document_library_router,
    supplier_folders_router,
)
from suppliers import router as suppliers_router  # noqa: E402
from supplier_panels import router as supplier_panels_router  # noqa: E402
from workers import router as workers_router, me_router as workers_me_router  # noqa: E402
from workers_qr import router as workers_qr_router, scan_router as worker_scan_router, backfill_scan_tokens  # noqa: E402
from worker_certifications import router as worker_certifications_router, certs_router as certs_bulk_router  # noqa: E402
from forms import router as forms_router  # noqa: E402
from email_outbox import record_router as record_email_router, router as email_router  # noqa: E402
from comms_safe_mode import router as comms_safe_mode_router  # noqa: E402 — Phase 4.7.3
# v58.13.88 — rate limiting.
from rate_limit import limiter, user_limiter, _429_response  # noqa: E402
from slowapi.errors import RateLimitExceeded  # noqa: E402
from exports import router as exports_router  # noqa: E402
from integrations import router as integrations_router  # noqa: E402
from integrations_simpro import router as simpro_router  # noqa: E402
from integrations_simpro_workers import (  # noqa: E402
    router as simpro_workers_router,
    seed_cert_kinds_on_startup,
    ensure_hr_dedup_index,
)
from simpro_zip_import import (  # noqa: E402
    router as simpro_zip_router,
    bulk_router as simpro_zip_bulk_router,
)
from cron_simpro_delta import register_simpro_cron  # noqa: E402
from cron_asset_service_generate import register_asset_service_generate_cron  # noqa: E402
from cron_smartfill_auto_sync import register_smartfill_auto_sync_cron  # noqa: E402
from integrations_m365 import router as m365_router  # noqa: E402
from integrations_textmagic import router as textmagic_router  # noqa: E402
from pdf_routes import router as pdf_router  # noqa: E402
from metrics_routes import (  # noqa: E402
    router as metrics_router,
    ensure_indexes as metrics_ensure_indexes,
)
from renewals import public_router as renewals_public_router, router as renewals_router  # noqa: E402
from seed import ensure_indexes, seed_all  # noqa: E402
from users import router as users_router  # noqa: E402
from workspaces import router as workspaces_router  # noqa: E402
# v58.13.132cb — Sites admin router (Phase A of workspaces/sites merge).
# Lives at /api/sites/admin so it doesn't collide with the pre-existing
# public site scan router at /api/sites (Phase 4.12, sites_qr.py). Phase B
# (.132cb-b) will absorb the FK rename + retire /api/workspaces.
from sites_admin import router as sites_admin_router  # noqa: E402
from org_settings import router as org_router  # noqa: E402
from mobile_modules import router as mobile_modules_router  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(name)s | %(message)s")
log = logging.getLogger("paneltec")

app = FastAPI(
    title="Paneltec Civil API",
    version="0.2.0",
    # v58.13.84 — B7: openapi/docs/redoc all disabled at the framework
    # level. Admin-gated custom routes below (see `/api/openapi.json`,
    # `/api/docs`, `/api/redoc`) restore access for admins only.
    openapi_url=None,
    docs_url=None,
    redoc_url=None,
)

# CORS — v58.13.132cp / .132cx wildcard.
#
# The mobile Expo web preview + native app hits this backend from a
# random `*.emergentagent.com` / `exp://` origin per session, which
# a strict allow-list can't keep up with. Bearer tokens are still
# required for every route (JWT via Authorization header), so
# widening the origin list here does not weaken auth — it just lets
# preflight succeed. `allow_credentials` STAYS off because we never
# rely on browser cookies for auth.
#
# `CORS_ORIGINS` env var still overrides when narrower prod-only
# origins are needed.
_CORS_SAFE_DEFAULT = ["*"]
_cors_env_raw = os.environ.get("CORS_ORIGINS", "").strip()
if _cors_env_raw and _cors_env_raw != "*":
    _cors_origins = [o.strip() for o in _cors_env_raw.split(",") if o.strip()]
    _cors_allow_regex = None
else:
    _cors_origins = ["*"]
    _cors_allow_regex = None
if os.environ.get("ENV", "").lower() in ("dev", "development", "local"):
    if "*" not in _cors_origins:
        _cors_origins.append("http://localhost:3000")
log.info("CORS: allow_origins=%s", _cors_origins)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Requested-With", "Accept", "Origin", "X-Client-Version"],
    expose_headers=["Content-Disposition"],
    max_age=600,
)

api = APIRouter(prefix="/api")


# Permission enforcement middleware — runs before route deps.
from permissions_middleware import PermissionsMiddleware  # noqa: E402
app.add_middleware(PermissionsMiddleware)


# NOTE — A `Clear-Site-Data` middleware was briefly enabled here to force
# stuck-SW visitors to wipe stale caches. It was REVERTED on 2026-06-29
# because `"storage"` also wiped freshly-stored JWTs on the next /api/*
# call when the version-marker cookie didn't survive the round trip,
# causing an endless login-flash-and-redirect loop.
#
# The SW activate handler in `service-worker.js` already hard-purges every
# cache that doesn't carry the current `paneltec-v70+` prefix and broadcasts
# a one-time reload to all open clients — that's sufficient. Don't reinstate
# Clear-Site-Data on /api/* responses without a per-request opt-in.


@api.get("/")
async def root():
    return {"service": "paneltec-civil", "version": "0.2.0"}


@api.get("/health")
async def health():
    """v58.13.83 — real dependency probes.

    Critical deps (mongo, disk) failing → 503 so K8s / Cloudflare load
    balancer can pull the pod out of rotation. Soft deps (libreoffice,
    tesseract, poppler) missing → 200 with the missing name added to
    `degraded` so the top-bar health pill and admin UI can show a warning
    without triggering a health-check failover. 2-second aggregate cap
    prevents this endpoint from being a DoS vector (health probes are
    unauthenticated by design)."""
    import asyncio, shutil, time as _time
    from db import db as _db

    checks: dict = {}
    degraded: list = []
    critical_fail = False

    # 1. MongoDB ping — critical.
    t0 = _time.perf_counter()
    try:
        await asyncio.wait_for(_db.command("ping"), timeout=1.0)
        checks["mongo"] = {"ok": True, "ms": int((_time.perf_counter() - t0) * 1000)}
    except Exception as exc:  # noqa: BLE001
        checks["mongo"] = {"ok": False, "error": str(exc)[:120]}
        critical_fail = True

    # 2. GridFS reachable — critical (backup + user file uploads depend on it).
    try:
        # `fs.files` is the default GridFS bucket; count is O(1) with the auto index.
        await asyncio.wait_for(_db["fs.files"].estimated_document_count(), timeout=0.5)
        checks["gridfs"] = {"ok": True}
    except Exception as exc:  # noqa: BLE001
        checks["gridfs"] = {"ok": False, "error": str(exc)[:120]}
        critical_fail = True

    # 3. Disk headroom — critical if < 500 MB, warn below 2 GB.
    #    Probes BOTH `/` (the container-shared 95GB volume) and `/app`
    #    (the 10GB per-pod volume where the login-outage on 2026-02-19
    #    hit 100%). `.132hma` — health returns `disk_low_app` in the
    #    `degraded` list when `/app` free-pct < 15%, observability only,
    #    does NOT flip the endpoint to 503.
    try:
        usage = shutil.disk_usage("/")
        free_gb = round(usage.free / (1024**3), 2)
        crit = free_gb < 0.5
        checks["disk"] = {
            "ok": not crit,
            "free_gb": free_gb,
            "total_gb": round(usage.total / (1024**3), 2),
            "warn_below_gb": 2.0,
        }
        if crit:
            critical_fail = True
        elif free_gb < 2.0:
            degraded.append("disk_low")
    except Exception as exc:  # noqa: BLE001
        checks["disk"] = {"ok": False, "error": str(exc)[:120]}
        # Don't flip critical_fail — a disk_usage() failure is rare and
        # unlikely to be a real outage signal.

    # 3b. /app volume — added `.132hma` after the disk-full outage.
    #     Same disk_usage() call, different mount. Observability warn
    #     at <15% free (never critical here — the / volume above owns
    #     the 503 gate).
    try:
        u_app = shutil.disk_usage("/app")
        app_free_gb = round(u_app.free / (1024**3), 2)
        app_total_gb = round(u_app.total / (1024**3), 2)
        app_free_pct = round((u_app.free / u_app.total) * 100, 1) if u_app.total else 0.0
        checks["disk_app"] = {
            "ok": True,
            "free_gb": app_free_gb,
            "total_gb": app_total_gb,
            "free_pct": app_free_pct,
            "warn_below_pct": 15.0,
        }
        if app_free_pct < 15.0:
            degraded.append("disk_low_app")
    except Exception as exc:  # noqa: BLE001
        checks["disk_app"] = {"ok": False, "error": str(exc)[:120]}

    # 4-6. Soft deps — presence check only (cheap).
    for name, cmd in (("libreoffice", "soffice"), ("tesseract", "tesseract"), ("poppler", "pdftotext")):
        path = shutil.which(cmd)
        if path:
            checks[name] = {"ok": True, "path": path}
        else:
            checks[name] = {"ok": False, "reason": f"{cmd} not on PATH"}
            degraded.append(name)

    body = {
        "ok": not critical_fail,
        "checks": checks,
        "degraded": degraded,
    }
    if critical_fail:
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=503, content=body)
    return body


# v96.2 — Cache-version probe. Frontend AppShell queries the controlling
# Service Worker via postMessage and compares its `CACHE_VERSION` against
# the value returned here. On mismatch the page self-heals (purge caches,
# unregister SW, hard reload) so stuck-SW browsers never get stranded on a
# stale bundle. Source of truth: /app/frontend/public/service-worker.js.
_CACHE_VERSION_CACHE: dict = {"value": None, "stat": None}


def _read_sw_cache_version() -> str:
    import os, re
    sw_path = os.path.join(os.path.dirname(__file__), "..", "frontend", "public", "service-worker.js")
    sw_path = os.path.abspath(sw_path)
    try:
        st = os.stat(sw_path)
        stat_key = (st.st_mtime_ns, st.st_size)
        if _CACHE_VERSION_CACHE["stat"] == stat_key and _CACHE_VERSION_CACHE["value"]:
            return _CACHE_VERSION_CACHE["value"]
        with open(sw_path, "r", encoding="utf-8") as f:
            text = f.read()
        m = re.search(r"const\s+CACHE_VERSION\s*=\s*['\"]([^'\"]+)['\"]", text)
        version = m.group(1) if m else "unknown"
        _CACHE_VERSION_CACHE["value"] = version
        _CACHE_VERSION_CACHE["stat"] = stat_key
        return version
    except Exception:
        return "unknown"


@api.get("/health/version")
async def health_version():
    return {"cache_version": _read_sw_cache_version()}


# v58.13.84 — B7: admin-gated OpenAPI spec + Swagger UI + ReDoc.
# The framework-level `openapi_url` / `docs_url` / `redoc_url` are
# disabled on the FastAPI() init above so we can require an admin
# bearer for every access. Non-admin requests (anon or worker/HSEQ/
# supervisor) get 401/403 — no route map leaked to the internet.
def _require_admin_role(user: dict = Depends(get_current_user)) -> dict:
    if (user or {}).get("role") != "admin":
        from fastapi import HTTPException
        raise HTTPException(status_code=403, detail="Admin role required")
    return user


@api.get("/openapi.json", include_in_schema=False)
async def _admin_openapi(_admin: dict = Depends(_require_admin_role)):
    # Lazily generate the schema — FastAPI caches it internally after
    # the first call, so subsequent calls are effectively free.
    return app.openapi()


@api.get("/docs", include_in_schema=False)
async def _admin_swagger_ui(_admin: dict = Depends(_require_admin_role)):
    from fastapi.openapi.docs import get_swagger_ui_html
    return get_swagger_ui_html(openapi_url="/api/openapi.json", title=app.title + " · Swagger UI")


@api.get("/redoc", include_in_schema=False)
async def _admin_redoc(_admin: dict = Depends(_require_admin_role)):
    from fastapi.openapi.docs import get_redoc_html
    return get_redoc_html(openapi_url="/api/openapi.json", title=app.title + " · ReDoc")


@api.get("/whoami")
async def whoami(user: dict = Depends(get_current_user)):
    return {"id": user["id"], "email": user["email"], "role": user["role"]}


# mount routers
# v160.3.0-adjust-16e — Static-map proxy for GPS fields. Serves the
# OSM-composed PNG from disk cache; composes on demand if not yet cached.
# Public (no auth) because `<img>` in a browser can't forward Bearer
# headers; the image is a public map — no PII beyond the coords passed
# in the query string (which the caller already knows). Cached
# permanently on disk keyed by rounded lat/lng.
from fastapi.responses import FileResponse, Response  # noqa: E402
from forms_pdf import _fetch_static_map  # noqa: E402


@api.get("/gps-map")
async def gps_map_proxy(lat: float, lng: float,
                        w: int = 500, h: int = 300, z: int = 16):
    # Clamp to sane bounds so this endpoint can't be used to
    # gigabyte-scan tiles.
    w = max(64, min(w, 800))
    h = max(64, min(h, 600))
    z = max(1, min(z, 18))
    path = _fetch_static_map(lat, lng, width=w, height=h, zoom=z)
    if not path or not path.exists():
        return Response(status_code=502, content=b"map unavailable")
    return FileResponse(
        str(path),
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=604800"},
    )


from admin_console_pin import router as admin_console_pin_router  # noqa: E402
from admin_console_pin import users_admin_router as admin_console_users_router  # noqa: E402
from docs_manual import router as docs_manual_router  # noqa: E402  # v58.13.132gd
# v58.13.132ci — mobile PIN → session-token onboarding endpoint.
from auth_mobile_pin import router as auth_mobile_pin_router  # noqa: E402
# v58.13.132cr / .132cx — Program Schematic overlays (admin edits).
from program_schematic_overlays import router as program_schematic_overlays_router  # noqa: E402
# v58.13.132db — mobile data endpoints (records/mine, ai/briefing,
# prestart/submit, sites/sign-on|off, ai/ask).
from mobile_data import router as mobile_data_router  # noqa: E402
api.include_router(program_schematic_overlays_router, prefix="/program-schematic")
api.include_router(mobile_data_router)
api.include_router(admin_console_pin_router)
api.include_router(docs_manual_router)  # v58.13.132gd — /api/docs/manual.docx
api.include_router(auth_mobile_pin_router)
api.include_router(admin_console_users_router)
api.include_router(auth_router)
# v160.3.0-adjust-19 — Drag-drop PDF import endpoint.
from imports import router as imports_router  # noqa: E402
api.include_router(imports_router)
api.include_router(ai_router)
api.include_router(dashboard_router)
api.include_router(files_router)
# v58.13.106 — public visitor sign-in flow (public + admin routers).
api.include_router(visitor_public_router)
api.include_router(visitor_public_flat_router)
# v58.13.132eg — Register category-count endpoints BEFORE the routers
# whose `/{item_id}` catch-alls would otherwise swallow the sub-path
# (`/admin/visitors/{id}` shadows `/admin/visitors/category-counts`,
# `/pre-starts/{id}` shadows `/pre-starts/category-counts`, etc.).
from category_counts import router as category_counts_router  # noqa: E402
api.include_router(category_counts_router)
api.include_router(visitor_admin_router)
# v58.13.132d — mobile_sites_router REMOVED (reconciled to existing sites endpoints).
# v58.13.132a — mobile onboarding + PIN auth.
api.include_router(mobile_auth_router)
# v58.13.132b — mobile home dashboard.
api.include_router(mobile_home_router)
api.include_router(mobile_daily_jobs_router)
# v58.13.132ab — admin daily-jobs surface + weather/geocode proxies.
api.include_router(mobile_daily_jobs_admin_router)
# v58.13.132ad — printable onboarding cards.
api.include_router(mobile_onboarding_cards_router)
# v58.13.132af — Android APK direct-install downloads.
api.include_router(mobile_downloads_router)
# v58.13.132j — mobile preview (Live Preview iframe on Permission Presets).
api.include_router(mobile_preview_router)
# Phase 4.1 — extras MUST mount before swms_router so static sub-paths
# like /swms/assignments and /swms/{id}/history aren't shadowed by the
# generic /swms/{item_id} GET route.
from swms_extras import router as swms_extras_router, admin_router as swms_admin_router  # noqa: E402
from swms_phase45 import router as swms_phase45_router  # noqa: E402
from auth_invite import router as auth_invite_router  # noqa: E402
api.include_router(auth_invite_router)
api.include_router(swms_extras_router)
api.include_router(swms_admin_router)
api.include_router(swms_phase45_router)
api.include_router(swms_router)
api.include_router(prestarts_router)
# v160.3.9.12a — Bulk-import legacy pre-start PDFs (URL/zip → Claude Vision).
# v160.3.9.58 — imports extended with `watchdog_tick` + `retention_cleanup`
# for the APScheduler hooks registered further down in on_startup.
from bulk_import_prestarts import (  # noqa: E402
    router as bulk_import_prestarts_router,
    ensure_indexes as bulk_import_ensure_indexes,
    watchdog_tick as bulk_import_watchdog_tick,
    retention_cleanup as bulk_import_retention_cleanup,
    auto_resume_orphaned_jobs as bulk_import_auto_resume,
)
api.include_router(bulk_import_prestarts_router)
# v160.3.9.13 — Master Risks reference library.
from master_risks import (  # noqa: E402
    router as master_risks_router,
    ensure_indexes as master_risks_ensure_indexes,
)
api.include_router(master_risks_router)
# v160.3.9.14 — List Forms reference library.
from list_forms import (  # noqa: E402
    router as list_forms_router,
    ensure_indexes as list_forms_ensure_indexes,
)
api.include_router(list_forms_router)
# v160.3.9.15 — Incident Root Causes reference library.
from incident_root_causes import (  # noqa: E402
    router as incident_root_causes_router,
    ensure_indexes as incident_root_causes_ensure_indexes,
)
api.include_router(incident_root_causes_router)
# v160.3.9.16 — CS Incident reference library.
from cs_incident import (  # noqa: E402
    router as cs_incident_router,
    ensure_indexes as cs_incident_ensure_indexes,
)
api.include_router(cs_incident_router)
# v58.13.132ed — Auto-archive rules admin + APScheduler-fed job.
from org_archive_rules import router as org_archive_rules_router  # noqa: E402
api.include_router(org_archive_rules_router)
# v58.13.132eo — Admin-managed URL tiles (Quick Links) on Org Settings.
from org_url_tiles import router as org_url_tiles_router  # noqa: E402
api.include_router(org_url_tiles_router)
# v58.13.132ev — Per-admin tile credential vault.
from tile_credentials import router as tile_credentials_router  # noqa: E402
api.include_router(tile_credentials_router)
# v160.3.9.17 — List Roles reference library.
from list_roles import (  # noqa: E402
    router as list_roles_router,
    ensure_indexes as list_roles_ensure_indexes,
)
api.include_router(list_roles_router)
# v160.3.9.18 — My Completed Training reference library.
from completed_training import (  # noqa: E402
    router as completed_training_router,
    ensure_indexes as completed_training_ensure_indexes,
)
api.include_router(completed_training_router)
# v160.3.9.19 — Companies reference library.
from companies import (  # noqa: E402
    router as companies_router,
    ensure_indexes as companies_ensure_indexes,
)
api.include_router(companies_router)
# v160.3.9.20 — Plant Maintenance reference library (joins on rego).
from plant_maintenance import (  # noqa: E402
    router as plant_maintenance_router,
    plant_scoped_router as plant_maintenance_scoped_router,
    ensure_indexes as plant_maintenance_ensure_indexes,
)
api.include_router(plant_maintenance_router)
api.include_router(plant_maintenance_scoped_router)
# v160.3.9.48 — HR Employees register (Active + Archived, PII-gated).
from hr_employees import (  # noqa: E402
    router as hr_employees_router,
    ensure_indexes as hr_employees_ensure_indexes,
)
api.include_router(hr_employees_router)
api.include_router(diary_router)
api.include_router(hazards_router)
api.include_router(incidents_router)
api.include_router(inspections_router)
# v160.3.0-adjust-13 — new Capture bucket, sibling of inspections.
api.include_router(risk_assessments_router)
api.include_router(contractors_router)
api.include_router(renewals_router)
api.include_router(renewals_public_router)
api.include_router(exports_router)
api.include_router(integrations_router)
api.include_router(simpro_router)
api.include_router(simpro_workers_router)
api.include_router(simpro_zip_router)
api.include_router(simpro_zip_bulk_router)
api.include_router(m365_router)
api.include_router(textmagic_router)
api.include_router(ask_router)
api.include_router(users_router)
from permission_presets import router as preset_router, apply_router as preset_apply_router  # noqa: E402
api.include_router(preset_router)
api.include_router(preset_apply_router)
from bulk_permissions import router as bulk_permissions_router  # noqa: E402
api.include_router(bulk_permissions_router)
# v160.3.9.26 — Phase 2: roles catalogue + Simpro user import + user prefs
from roles_catalogue import router as roles_catalogue_router  # noqa: E402
api.include_router(roles_catalogue_router)
from simpro_import_users import router as simpro_import_users_router  # noqa: E402
api.include_router(simpro_import_users_router)
from user_prefs import router as user_prefs_router, section_order_router as user_prefs_section_order_router  # noqa: E402
api.include_router(user_prefs_router)
api.include_router(user_prefs_section_order_router)
# v160.1 — Document categorization backend (Phase 1). UI is Phase 2.
from document_categories import router as document_categories_router  # noqa: E402
api.include_router(document_categories_router)
api.include_router(workspaces_router)
# v58.13.132cb — /api/sites/admin (Phase A). Kept adjacent to
# workspaces_router so the .132cb-b retire is a one-line drop.
api.include_router(sites_admin_router)
app.include_router(org_router)
app.include_router(mobile_modules_router)
api.include_router(email_router)
api.include_router(record_email_router)
api.include_router(comms_safe_mode_router)  # Phase 4.7.3

# v58.13.88 — Rate limit registrations. Two limiter instances share
# state through the module (in-memory dict per process; safe for a
# single-pod deployment).
app.state.limiter = limiter
app.state.user_limiter = user_limiter
app.add_exception_handler(RateLimitExceeded, _429_response)
api.include_router(pdf_router)
# v160.3.9.58.13.47 — Capture-density telemetry endpoint.
api.include_router(metrics_router)
api.include_router(document_library_router)
api.include_router(supplier_folders_router)
api.include_router(suppliers_router)
api.include_router(supplier_panels_router)
api.include_router(worker_certifications_router)
api.include_router(certs_bulk_router)  # v160.3.7ai — /certifications bulk ops
from settings_nav import router as settings_nav_router  # noqa: E402
api.include_router(settings_nav_router)  # v160.3.8.1 — /settings/nav-layout
api.include_router(workers_router)
api.include_router(workers_me_router)  # v160.2.2 — /me/worker-profile
api.include_router(workers_qr_router)
api.include_router(worker_scan_router)
api.include_router(forms_router)
api.include_router(assets_router)
api.include_router(fleet_router)
# v58.13.131b — Fuel usage (CSV importer + summary/anomaly).
from fleet_fuel import (  # noqa: E402
    router as fleet_fuel_router,
    asset_router as fleet_fuel_asset_router,
    ensure_indexes as fleet_fuel_ensure_indexes,
)
api.include_router(fleet_fuel_router)
api.include_router(fleet_fuel_asset_router)
# v58.13.131d — Fuel Reporting endpoints (read-only aggregations +
# on-demand email snapshot). Mounted BEFORE the fleet_fuel router in
# path order via its own `/fleet/fuel/reports` prefix.
from fleet_fuel_reports import (  # noqa: E402
    router as fleet_fuel_reports_router,
    ensure_indexes as fleet_fuel_reports_ensure_indexes,)
api.include_router(fleet_fuel_reports_router)
# v58.13.132de — admin-editable fuel-price settings + audit history.
from fuel_price_settings import router as fuel_price_settings_router  # noqa: E402
api.include_router(fuel_price_settings_router)
api.include_router(asset_service_router)
api.include_router(asset_scan_router)
api.include_router(form_assignments_router)
api.include_router(asset_navixy_sync_router)
api.include_router(asset_meter_history_router)  # Phase 4.8
# Phase 4.9 — Today / Week / Month trip aggregations from Navixy track/list.
from asset_trip_summary import router as asset_trip_summary_router  # noqa: E402
api.include_router(asset_trip_summary_router)

from swms_extras import router as swms_extras_router, admin_router as swms_admin_router  # noqa: E402
api.include_router(swms_extras_router)
api.include_router(swms_admin_router)

# v160.3.6u — Admin-uploaded reference screenshots for in-app help guides
# (e.g. the Simpro ZIP staff guide on /app/settings/users).
from help_reference_images import router as help_reference_images_router  # noqa: E402
api.include_router(help_reference_images_router)

from file_pdf import router as file_pdf_router  # noqa: E402
api.include_router(file_pdf_router)

# v58.13.132hj — Universal PDF-preview registry (worker HR docs,
# equipment attachments, submission attachments, SWMS source .docx,
# insurance certs, etc). Bridges the DocLib pipeline to every other
# file surface via a signed-token flow.
from preview_sources import router as preview_sources_router  # noqa: E402
api.include_router(preview_sources_router)

from workers_inductions import router as workers_inductions_router  # noqa: E402
from workers_inductions import card_router as workers_inductions_card_router  # noqa: E402
api.include_router(workers_inductions_router)
api.include_router(workers_inductions_card_router)
from induction_columns import router as induction_columns_router  # noqa: E402
api.include_router(induction_columns_router)
# Phase 3.16 — Session Timeout (admin-configurable).
from session_timeout import router as session_timeout_router, admin_router as session_timeout_admin_router  # noqa: E402
api.include_router(session_timeout_router)
api.include_router(session_timeout_admin_router)
from admin_active_sessions import router as admin_active_sessions_router  # noqa: E402
api.include_router(admin_active_sessions_router)
# v58.13.81 — admin-only test-data purge endpoint.
from admin_purge_test_data import router as admin_purge_router  # noqa: E402
api.include_router(admin_purge_router)
# v58.13.132gh — admin surface for byte-less file records (Stephen's
# 410s). Read-only scan + hard-remove for cleanup after the
# GridFS sweep in `scripts/migrate_ephemeral_to_gridfs.py`.
from admin_missing_files import router as admin_missing_files_router  # noqa: E402
api.include_router(admin_missing_files_router)
# v58.13.132gl-b — Equipment Register admin CRUD.
# v58.13.132gs Phase 1 — categories_router MUST mount before the
# main equipment_register_router so `/equipment/categories` isn't
# swallowed by the `/{eid}` catch-all.
from equipment_register import (  # noqa: E402
    router as equipment_register_router,
    categories_router as equipment_categories_router,
)
api.include_router(equipment_categories_router)
api.include_router(equipment_register_router)

# v58.13.132gv Phase 3 — Editable induction-type dropdown CRUD.
from induction_types import router as induction_types_router  # noqa: E402
api.include_router(induction_types_router)
# Phase 3.21 — Session history audit log (30d retention).
from session_history import router as session_history_router, ensure_indexes as session_history_ensure_indexes  # noqa: E402
api.include_router(session_history_router)
from sites_qr import scan_router as site_scan_router, sites_router  # noqa: E402
from sites_qr_v132dk import (  # noqa: E402
    sites_router as sites_qr_v132dk_router,
    public_router as sign_on_public_router,
)
from sites_signon_v127 import router as sites_v127_router, me_router as me_v127_router  # noqa: E402
from suppliers_qr import (  # noqa: E402
    scan_router as supplier_scan_router,
    contractors_qr_router,
)
api.include_router(site_scan_router)
api.include_router(sites_router)
api.include_router(sites_qr_v132dk_router)
api.include_router(sign_on_public_router)
api.include_router(sites_v127_router)
api.include_router(me_v127_router)
api.include_router(supplier_scan_router)
api.include_router(contractors_qr_router)
api.include_router(asset_navixy_dashboards_router)
api.include_router(fleet_navixy_tags_router)
api.include_router(forms_pickers_router)
api.include_router(help_router)
api.include_router(notifications_router)  # v57 — header bell + read tracking
# Phase 4.16 (v133) — top-bar API-health / backup pills + per-user
# suspicious-login alert prefs.
from health_extras import router as health_extras_router  # noqa: E402
api.include_router(health_extras_router)

# Phase 4.17 v134.0 — Per-module analytics dashboards (SWMS live, other 8
# modules return `todo: true` skeletons until v134.1/2 wire them up).
from dashboards import router as dashboards_router  # noqa: E402
api.include_router(dashboards_router)

app.include_router(api)

# Phase 4.19 (v143) — Real MongoDB backup grafted from Paneltec Portal.
# Mount admin-gated via Civil's existing `require_roles("admin")`. The
# bundle's router carries its own `/api/backup` prefix so it mounts on the
# FastAPI app directly, not on the `api` sub-router.
from db import db as _mongo_db  # noqa: E402
from auth import require_roles  # noqa: E402
from backup_service import install as install_backup  # noqa: E402
install_backup(app, _mongo_db, require_roles("admin"))


@app.on_event("startup")
async def on_startup():
    await ensure_indexes()
    # v58.13.132hf — Boot-trigger the doc_files extracted_text
    # backfill 5 minutes after startup. Admin can cancel via
    # POST /api/document-library/admin/backfill-extracted-text/cancel.
    try:
        from document_library import (
            schedule_boot_backfill as _dl_backfill_boot,
        )
        import asyncio as _asyncio
        _asyncio.create_task(_dl_backfill_boot(delay_seconds=300))
        # Also add the Mongo text index (idempotent) so `.132hg`
        # search doesn't wait on index build.
        try:
            await _mongo_db.doc_files.create_index(
                [("extracted_text", "text"),
                 ("filename", "text"),
                 ("ai_tags", "text")],
                name="doc_files_fulltext",
                default_language="english",
                weights={"filename": 10, "ai_tags": 5, "extracted_text": 1},
            )
        except Exception as _ei:
            log.warning("doc_files text index create failed: %s", _ei)
    except Exception as e:  # noqa: BLE001
        log.warning("doc_files extracted_text backfill boot failed: %s", e)
    await session_history_ensure_indexes()
    # v58.13.132ab — daily_job_assignments (org_id, worker_id, date) compound.
    try:
        await _mobile_daily_jobs_ensure_indexes()
    except Exception as e:
        log.warning("mobile_daily_jobs_admin index setup failed: %s", e)
    # v58.13.131b — Fuel-transactions + import-runs indexes.
    try:
        await fleet_fuel_ensure_indexes()
    except Exception as e:
        log.warning("fleet_fuel index setup failed: %s", e)
    # v58.13.131d — Fuel report email audit indexes.
    try:
        await fleet_fuel_reports_ensure_indexes()
    except Exception as e:
        log.warning("fleet_fuel_reports index setup failed: %s", e)
    # v58.13.90 — Idempotent seed of the `comms_safe_mode.edit` override
    # for Stephen Guy. Runs on every backend restart; a no-op after the
    # first apply. Failure is logged but never blocks startup because
    # Stephen can always toggle via the DB one-liner in the ship report
    # if this hook silently fails on some future schema drift.
    try:
        from comms_safe_mode import ensure_stephen_can_toggle
        _res = await ensure_stephen_can_toggle()
        log.info("comms_safe_mode.startup_seed: %s", _res)
    except Exception as e:  # noqa: BLE001
        log.warning("comms_safe_mode startup seed failed: %s", e)
    # v160.3.9.58.13.47 — TTL + query indexes for capture-density
    # telemetry. Best-effort, silent on failure (idempotent).
    try:
        await metrics_ensure_indexes()
    except Exception:  # noqa: BLE001
        pass
    # v160.3.9.12a — Bulk-import Pre-Starts index setup.
    try:
        await bulk_import_ensure_indexes()
    except Exception as e:
        log.warning("bulk_import_prestarts index setup failed: %s", e)
    # v58.8 — Auto-resume any bulk-import jobs that were mid-flight
    # when the previous backend process died. Runs AFTER indexes so
    # `_run_job`'s cache/write path finds its expected indexes ready.
    # Best-effort — a failure here must never block startup.
    try:
        _res = await bulk_import_auto_resume()
        if _res.get("resumed"):
            log.info("bulk_import: auto-resumed %d orphaned job(s) on startup: %s",
                     _res["resumed"], _res["job_ids"])
    except Exception as e:  # pragma: no cover
        log.warning("bulk_import auto-resume failed: %s", e)
    # v160.3.9.13 — Master Risks index setup.
    try:
        await master_risks_ensure_indexes()
    except Exception as e:
        log.warning("master_risks index setup failed: %s", e)
    # v58.13.114 — Ask Intelligence retrieval indexes (form_submissions,
    # pre_starts, site_diary_entries, site_visitors, workers, audit_log).
    try:
        await ask_ensure_indexes()
    except Exception as e:
        log.warning("ask index setup failed: %s", e)
    # v160.3.9.14 — List Forms index setup.
    try:
        await list_forms_ensure_indexes()
    except Exception as e:
        log.warning("list_forms index setup failed: %s", e)
    # v160.3.9.15 — Incident Root Causes index setup.
    try:
        await incident_root_causes_ensure_indexes()
    except Exception as e:
        log.warning("incident_root_causes index setup failed: %s", e)
    # v160.3.9.16 — CS Incident index setup.
    # v58.13.132dz — Endpoints are 410-gated but the source collection
    # stays read-only for one release cycle; keep indexes fresh so a
    # rollback works cleanly.
    try:
        await cs_incident_ensure_indexes()
    except Exception as e:
        log.warning("cs_incident index setup failed: %s", e)
    # v58.13.132dz — Form routing rules (SSRA → risk_assessment).
    try:
        from form_routing import ensure_form_routing_rules
        await ensure_form_routing_rules()
    except Exception as e:
        log.warning("form_routing_rules index/seed failed: %s", e)
    # v160.3.9.17 — List Roles index setup.
    try:
        await list_roles_ensure_indexes()
    except Exception as e:
        log.warning("list_roles index setup failed: %s", e)
    # v160.3.9.18 — Completed Training index setup.
    try:
        await completed_training_ensure_indexes()
    except Exception as e:
        log.warning("completed_training index setup failed: %s", e)
    # v160.3.9.19 — Companies index setup.
    try:
        await companies_ensure_indexes()
    except Exception as e:
        log.warning("companies index setup failed: %s", e)
    # v160.3.9.20 — Plant Maintenance index setup.
    try:
        await plant_maintenance_ensure_indexes()
    except Exception as e:
        log.warning("plant_maintenance index setup failed: %s", e)
    # v160.3.9.26 — Phase 2: role catalogue + permission-model migrations.
    try:
        from roles_catalogue import ensure_roles_indexes, seed_system_roles
        await ensure_roles_indexes()
        seed_res = await seed_system_roles()
        log.info("v26 role seed: %s", seed_res)
    except Exception as e:
        log.warning("v26 role seed failed: %s", e)
    # v160.3.9.33 — Phase 4d startup auto-sync of Simpro position roles.
    # Creates any MISSING `custom_<slug>` role doc for positions present
    # on live users. Never mutates users on startup — role assignment
    # remains admin-triggered via bulk-assign / sync-linked endpoints.
    # Non-blocking: failures are logged and boot continues.
    try:
        from db import db as _db_ref
        from roles_catalogue import create_role_from_position
        distinct_pipeline = [
            {"$match": {"simpro_position": {"$exists": True, "$nin": [None, ""]},
                        "is_archived": {"$ne": True}}},
            {"$group": {"_id": "$simpro_position"}},
        ]
        rows = await _db_ref.users.aggregate(distinct_pipeline).to_list(500)
        created_count = 0
        skipped_count = 0
        sys_actor = {"id": None, "email": "startup-auto-sync",
                     "role": "system"}
        for row in rows:
            pos = (row.get("_id") or "").strip()
            if not pos:
                continue
            res = await create_role_from_position(position=pos, actor=sys_actor)
            if res["created"]:
                created_count += 1
            else:
                skipped_count += 1
        log.info("[startup] Simpro position roles: %d created, %d skipped.",
                 created_count, skipped_count)
    except Exception as e:
        log.warning("[startup] Simpro position-role auto-sync failed "
                    "(non-blocking): %s", e)

    # v58.13.98 — Defer heavy startup work so /api/health answers
    # before the pod OOMs on tier boot. Emergent Support attributed
    # the prod startup crash to the synchronous batch of migrations
    # + Simpro/Navixy syncs + meter_history backfill + backup
    # catch-up all landing in the same on_startup slot. This inner
    # coroutine runs those exact tasks AFTER the app enters the
    # serving state, via asyncio.create_task(). Every individual
    # step below is already wrapped in its own try/except so a
    # failure in one step doesn't abort the rest.
    async def _deferred_startup_work():
        import time as _dsw_time
        _t0 = _dsw_time.monotonic()
        log.info('[startup] deferred_startup_work: begin')
        try:
            from permission_v26_migrations import run_all as run_v26_migrations
            migs = await run_v26_migrations()
            log.info("v26 migrations: %s", migs)
        except Exception as e:
            log.warning("v26 migrations failed: %s", e)
        try:
            from user_prefs import ensure_user_prefs_indexes
            await ensure_user_prefs_indexes()
        except Exception as e:
            log.warning("user_prefs index setup failed: %s", e)
        try:
            from simpro_import_users import ensure_simpro_import_audit_indexes
            await ensure_simpro_import_audit_indexes()
        except Exception as e:
            log.warning("simpro_import_audit index setup failed: %s", e)

        # v160.3.9.40 (SEC-003) — Encrypt any plaintext integration secrets
        # in place. Idempotent + marker-guarded, mirrors the v38 backup
        # destination migration. Non-blocking: failures are logged and boot
        # continues. Manual re-run via
        # POST /api/admin/migrate-integration-secrets.
        try:
            from integrations import _migrate_plaintext_integration_secrets, _FERNET
            from db import db as _db_ref
            marker = await _db_ref.bk_migrations.find_one(
                {"id": "v160_3_9_40_integrations_encryption"},
                {"_id": 0, "id": 1, "completed_at": 1},
            )
            if not (marker and marker.get("completed_at")):
                if _FERNET:
                    summary = await _migrate_plaintext_integration_secrets(_db_ref)
                    await _db_ref.bk_migrations.update_one(
                        {"id": "v160_3_9_40_integrations_encryption"},
                        {"$set": {"completed_at": datetime.now(timezone.utc).isoformat(),
                                  **summary}},
                        upsert=True,
                    )
                    log.info("[v40] integrations secrets encryption migration: %s", summary)
                else:
                    log.warning("[v40] Skipped integrations secrets migration — "
                                "INTEGRATIONS_ENC_KEY not configured.")
        except Exception as e:
            log.warning("[v40] integrations secrets migration failed at startup: %s", e)

        # v160.3.9.43.1 — Fernet key ↔ encrypted-fields mismatch self-check.
        # Scan `integration_configs` for docs that carry any `<field>_encrypted`
        # secret. If we find any while `_FERNET` is unloaded (or fails a
        # decrypt smoke-test on one of them), log a high-visibility WARNING
        # naming each affected `kind`. Non-fatal — boot continues — but the
        # log line makes a botched `INTEGRATIONS_ENC_KEY` rotation impossible
        # to miss. Reason it matters: without this, the first production
        # call for any impacted integration would 500 with an opaque
        # `KeyError` or `InvalidToken` and no operator-facing breadcrumb.
        try:
            from integrations import _FERNET as _FERNET_LIVE, _decrypt_integration_secret
            from db import db as _db_ref
            encrypted_field_suffix = "_encrypted"
            secret_kinds_with_ciphertext: dict[str, int] = {}
            smoke_test_failed_kinds: set[str] = set()
            async for row in _db_ref.integration_configs.find(
                {}, {"_id": 0, "kind": 1, "config": 1},
            ):
                conf = row.get("config") or {}
                ciphertexts = [(k, v) for k, v in conf.items()
                               if k.endswith(encrypted_field_suffix)
                               and isinstance(v, str) and v]
                if not ciphertexts:
                    continue
                kind = row.get("kind") or "unknown"
                secret_kinds_with_ciphertext[kind] = (
                    secret_kinds_with_ciphertext.get(kind, 0) + 1
                )
                if _FERNET_LIVE is not None:
                    # Smoke-test: decrypt ONE ciphertext per kind. If it
                    # raises we know the key doesn't match the ciphertext
                    # (rotation drift).
                    if kind not in smoke_test_failed_kinds:
                        _field, _ct = ciphertexts[0]
                        try:
                            _decrypt_integration_secret(_ct)
                        except Exception:
                            smoke_test_failed_kinds.add(kind)
            if secret_kinds_with_ciphertext and _FERNET_LIVE is None:
                # Case A: encrypted data exists but Fernet is not loaded.
                # Every real API call for these kinds will 500.
                log.error(
                    "[v43.1 SEC-003 SELF-CHECK] INTEGRATIONS_ENC_KEY is NOT "
                    "loaded but %d integration_configs docs carry ciphertext. "
                    "Every API call for the following kinds will fail: %s. "
                    "Rotate the key back or re-run the v40 migration.",
                    sum(secret_kinds_with_ciphertext.values()),
                    sorted(secret_kinds_with_ciphertext.keys()),
                )
            elif smoke_test_failed_kinds:
                # Case B: Fernet is loaded but doesn't match the ciphertext
                # (a NEW key was rotated in without re-encrypting the docs).
                log.error(
                    "[v43.1 SEC-003 SELF-CHECK] INTEGRATIONS_ENC_KEY is "
                    "loaded but FAILED to decrypt ciphertext for kinds: %s. "
                    "The key was likely rotated without re-encrypting the "
                    "existing docs. Rotate the key back or re-run the v40 "
                    "migration.",
                    sorted(smoke_test_failed_kinds),
                )
            else:
                log.info(
                    "[v43.1 SEC-003 SELF-CHECK] OK — %d integration kinds "
                    "carry ciphertext, all decrypt cleanly.",
                    len(secret_kinds_with_ciphertext),
                )
        except Exception as e:
            # Never let the self-check block boot. Log the failure so the
            # absence of a positive OK line is itself a signal to check.
            log.warning("[v43.1 SEC-003 self-check skipped due to error: %s]", e)

        # v160.3.9.45 — Idempotent one-shot backfill of the 11 empty Simpro
        # `custom_*` UUID roles + Traffic Controller expansion + Cleaner
        # role insert. Marker-guarded, so a subsequent boot is a no-op.
        try:
            from migrations.v45_custom_role_token_backfill import run_v45_migration
            from db import db as _v45_db
            result = await run_v45_migration(_v45_db)
            if result.get("skipped"):
                log.info("[v45] custom-role token backfill: no-op (marker present)")
            else:
                log.info("[v45] backfill applied: %d updates + %d insert(s)",
                         len(result.get("updates", [])), len(result.get("inserts", [])))
        except Exception as e:
            log.warning("[v45] custom-role token backfill failed: %s", e)

        # v160.3.9.46 — Role hygiene: general_user trim, HSEQ Creator forms.edit,
        # ephemeral fixture role sweep, empty user_permissions cleanup +
        # permissions-resolution INFO summary.
        try:
            from migrations.v46_role_hygiene import (
                run_v46_migration, report_permissions_resolution)
            from db import db as _v46_db
            r = await run_v46_migration(_v46_db)
            if r.get("skipped"):
                log.info("[v46] role hygiene: no-op (marker present)")
            await report_permissions_resolution(_v46_db)
        except Exception as e:
            log.warning("[v46] role hygiene failed: %s", e)

        # v160.3.9.40 (SEC-002) — Retro-sanitize any historical email_outbox
        # rows whose `body_html` contains dangerous markup. Idempotent —
        # bleach is a no-op on already-safe HTML. Marker-guarded so we don't
        # re-scan the whole outbox every boot.
        try:
            from email_outbox import sanitize_email_body_html
            from db import db as _db_ref
            marker = await _db_ref.bk_migrations.find_one(
                {"id": "v160_3_9_40_email_outbox_sanitize_backfill"},
                {"_id": 0, "id": 1, "completed_at": 1},
            )
            if not (marker and marker.get("completed_at")):
                scanned = 0
                rewritten = 0
                cursor = _db_ref.outbound_emails.find({}, {"_id": 0, "id": 1, "body_html": 1})
                async for row in cursor:
                    scanned += 1
                    raw = row.get("body_html") or ""
                    sanitized = sanitize_email_body_html(raw)
                    if sanitized != raw:
                        await _db_ref.outbound_emails.update_one(
                            {"id": row["id"]},
                            {"$set": {"body_html": sanitized}},
                        )
                        rewritten += 1
                await _db_ref.bk_migrations.update_one(
                    {"id": "v160_3_9_40_email_outbox_sanitize_backfill"},
                    {"$set": {"completed_at": datetime.now(timezone.utc).isoformat(),
                              "scanned": scanned, "rewritten": rewritten}},
                    upsert=True,
                )
                log.info("[v40] email_outbox sanitize backfill: scanned=%d rewritten=%d",
                         scanned, rewritten)
        except Exception as e:
            log.warning("[v40] email_outbox sanitize backfill failed at startup: %s", e)

        result = await seed_all()
        log.info("Seeded: %s", result["counts"])
        # v58.13.86 — Path A (startup cert reminder scan) deleted per user
        # directive "I don't want anything sent automatically". The scan
        # function itself is kept in `worker_certifications.py` behind the
        # admin-only `POST /worker-certifications/reminders/scan` endpoint
        # so an admin can still fire it manually when desired.
        # No auto-invocation. See ship notes for v58.13.86.

        # v160.3.1 — Simpro cert_kinds + licence_mapping seed load (idempotent).
        try:
            await seed_cert_kinds_on_startup()
        except Exception as e:
            log.warning("Simpro cert_kinds seed failed: %s", e)
        # v58.13.132hn — Seed the 3 filename-matcher target templates
        # (Drain Cleaning SSRA / Trailer Pre-start / Excavator Pre-start)
        # by cloning from sibling templates. Idempotent no-op after
        # first successful run on each org.
        try:
            from imports import seed_import_matcher_templates_on_startup
            await seed_import_matcher_templates_on_startup()
        except Exception as e:
            log.warning("Import matcher template seed failed: %s", e)
        # v160.3.3 — HR docs dedup index.
        try:
            await ensure_hr_dedup_index()
        except Exception as e:
            log.warning("HR dedup index setup failed: %s", e)

        # v160.3.9.48 — HR Employees register: indexes + one-shot ingest +
        # role-token backfill. Marker: `bk_migrations.v160_3_9_48_hr_employees_ingest`.
        try:
            await hr_employees_ensure_indexes()
            marker = await _mongo_db.bk_migrations.find_one(
                {"_id": "v160_3_9_48_hr_employees_ingest"})
            if not marker:
                live_total = await _mongo_db.hr_employees.count_documents(
                    {"deleted_at": None})
                ingest_stats = {"inserted": 0, "updated": 0,
                                "unchanged": 0, "security_flags": 0}
                if live_total == 0:
                    from pathlib import Path as _P
                    src = (_P(__file__).resolve().parent / "scripts" / "data"
                           / "hr_employees_source.xlsx")
                    if src.exists():
                        from scripts.import_hr_employees import (
                            parse_workbook, upsert_rows,
                            ensure_indexes as _hr_idx,
                        )
                        await _hr_idx()
                        rows, security_flags = parse_workbook(src)
                        ingest_stats = await upsert_rows(
                            rows, actor_id="v160_3_9_48_ingest_migration",
                            security_flags=security_flags)
                        live_total = await _mongo_db.hr_employees.count_documents(
                            {"deleted_at": None})
                        log.info(
                            "[v160.3.9.48] hr_employees ingest: "
                            "parsed=%d inserted=%d updated=%d unchanged=%d "
                            "security_flags=%d live_total=%d",
                            len(rows), ingest_stats["inserted"],
                            ingest_stats["updated"], ingest_stats["unchanged"],
                            ingest_stats["security_flags"], live_total,
                        )
                    else:
                        log.warning(
                            "[v160.3.9.48] hr_employees xlsx missing at %s "
                            "— ingest skipped, marker still recorded", src)
                else:
                    log.info(
                        "[v160.3.9.48] hr_employees already populated "
                        "(%d rows) — ingest skipped, backfilling role tokens only",
                        live_total,
                    )

                # Role-token backfill. Admin gets EVERY hr_employees token via
                # `_all_tokens()` (which iterates ACTIONS × RESOURCES now that
                # both are extended). hseq_manager gets view+open. Legacy
                # `auditor` doesn't have a DB doc — it falls back to the
                # hardcoded ROLE_DEFAULTS which was extended in v48.
                from roles_catalogue import _tokens_admin, _tokens_hseq_manager
                admin_tokens = _tokens_admin()
                hseq_tokens = list(set(_tokens_hseq_manager()) | {
                    "hr_employees.open", "hr_employees.view",
                })
                role_updates = {}
                r_admin = await _mongo_db.roles.update_one(
                    {"role_id": "admin"},
                    {"$set": {"permission_tokens": sorted(set(admin_tokens))}},
                )
                role_updates["admin_matched"] = r_admin.matched_count
                r_hseq = await _mongo_db.roles.update_one(
                    {"role_id": "hseq_manager"},
                    {"$set": {"permission_tokens": sorted(hseq_tokens)}},
                )
                role_updates["hseq_manager_matched"] = r_hseq.matched_count

                # Invalidate the in-memory _role_tokens cache so the new
                # tokens are picked up without a boot restart.
                try:
                    from permissions import _bust_role_cache
                    _bust_role_cache()
                except Exception:
                    pass

                await _mongo_db.bk_migrations.insert_one({
                    "_id": "v160_3_9_48_hr_employees_ingest",
                    "at": datetime.now(timezone.utc).isoformat(),
                    "ingest_stats": ingest_stats,
                    "live_total": live_total,
                    "role_updates": role_updates,
                })
                log.info(
                    "[v160.3.9.48] role-token backfill complete: %s",
                    role_updates,
                )
            else:
                log.info(
                    "[v160.3.9.48] hr_employees ingest marker present "
                    "— skip (was: inserted=%s security_flags=%s)",
                    (marker.get("ingest_stats") or {}).get("inserted"),
                    (marker.get("ingest_stats") or {}).get("security_flags"),
                )
        except Exception as e:
            log.warning("[v160.3.9.48] hr_employees migration failed: %s", e)

        # v160.3.8.4 — Reconcile every org's saved Settings-nav layout
        # against the current registry. Any doc that predates a new nav
        # item gets it appended to the root here so operators see it on
        # next page load without a manual fix. Idempotent.
        try:
            from settings_nav import reconcile_all_orgs
            r = await reconcile_all_orgs()
            if r["reconciled"]:
                log.info(
                    "Settings-nav reconcile: %d/%d org(s) updated. Diff: %s",
                    r["reconciled"], r["inspected"], r["per_org"],
                )
            else:
                log.info("Settings-nav reconcile: %d org(s) already complete.", r["inspected"])
        except Exception as e:
            log.warning("Settings-nav reconcile skipped at startup: %s", e)

        # v151.1 — auto-install server tools (LibreOffice / Tesseract / Poppler)
        # if the container overlay has wiped them. See file_pdf.py for the full
        # rationale. Fire-and-forget: apt runs in a background asyncio task,
        # backend boot is not blocked, and a failure here never kills startup.
        try:
            from file_pdf import ensure_server_tools_or_install_bg
            status = ensure_server_tools_or_install_bg()
            if status["action"] == "noop":
                log.info("Server tools OK — libreoffice/tesseract/poppler all present")
            elif status["action"] == "queued":
                log.info(
                    "Server tools missing (%s) — triggering async reinstall (job_id=%s)",
                    ", ".join(status["missing"]), status["job_id"],
                )
            else:
                log.info("Server tools check: %s", status)
        except Exception as e:
            log.warning("Server tools auto-install skipped at startup: %s", e)

        # Phase 3.7 — one-shot migration of seeded select fields → dynamic pickers.
        try:
            from migrate_form_pickers import migrate_form_pickers
            mig = await migrate_form_pickers()
            log.info("Form pickers migration: %s", mig)
        except Exception as e:
            log.warning("Form pickers migration failed: %s", e)

        # Phase 3.7 v3 — strip misplaced pickers from HR-style templates (D&A,
        # Fatigue, Leave, Behavioural). Idempotent.
        try:
            from migrate_strip_misplaced import migrate_strip_misplaced_pickers
            mig3 = await migrate_strip_misplaced_pickers()
            log.info("Misplaced pickers v3: %s", mig3)
        except Exception as e:
            log.warning("Misplaced pickers v3 migration failed: %s", e)

        # Phase 4.x — seed the SWMS-06 Concrete/Asphalt Cutting V12.0 record
        # exactly once per org. Idempotent — re-running is a no-op.
        try:
            from swms_extras import seed_swms_06
            r = await seed_swms_06()
            log.info("SWMS-06 seed: %s", r)
        except Exception as e:
            log.warning("SWMS-06 seed failed: %s", e)

        # Phase 3.5 — APScheduler for Navixy counter ingestion (15-min cadence).
        try:
            from apscheduler.schedulers.asyncio import AsyncIOScheduler
            scheduler = AsyncIOScheduler(timezone="UTC")
            scheduler.add_job(sync_navixy_counters, "interval", minutes=15,
                              id="navixy_sync_counters", max_instances=1,
                              coalesce=True, replace_existing=True)
            # Phase 3.14 — Simpro suppliers sync, 12h cadence. Imported here to
            # keep server.py independent of the integrations module's import order.
            try:
                from integrations_simpro import sync_simpro_suppliers_all_orgs
                scheduler.add_job(sync_simpro_suppliers_all_orgs, "interval", hours=12,
                                  id="simpro_sync_suppliers", max_instances=1,
                                  coalesce=True, replace_existing=True)
                log.info("APScheduler job registered — simpro_sync_suppliers every 12 h")
            except Exception as e:
                log.warning("simpro_sync_suppliers scheduler hook failed: %s", e)
            # Phase 4.5 — daily hard-delete of expired SWMS soft-deletes (03:15 UTC).
            try:
                from swms_phase45 import purge_expired_swms
                scheduler.add_job(purge_expired_swms, "cron", hour=3, minute=15,
                                  id="swms_purge_expired", max_instances=1,
                                  coalesce=True, replace_existing=True)
                log.info("APScheduler job registered — swms_purge_expired daily at 03:15 UTC")
            except Exception as e:
                log.warning("swms_purge_expired scheduler hook failed: %s", e)
            # v58.13.132ed — Nightly auto-archive across the 7 CAPTURE
            # modules. 03:30 UTC — 15 min after SWMS purge so the two
            # don't contend on the same tenant. Idempotent — a re-run
            # finds already-archived rows and no-ops.
            try:
                from org_archive_rules import apply_org_archive_rules
                scheduler.add_job(apply_org_archive_rules, "cron",
                                  hour=3, minute=30,
                                  id="org_archive_rules_daily",
                                  max_instances=1, coalesce=True,
                                  replace_existing=True)
                log.info("APScheduler job registered — org_archive_rules_daily at 03:30 UTC")
            except Exception as e:
                log.warning("org_archive_rules scheduler hook failed: %s", e)
            # Phase 4.8 — daily snapshot of engine_hours_total + odometer_km_total
            # for every Navixy-synced asset. 01:00 UTC keeps it ahead of the
            # working-day boundary in AU.
            try:
                scheduler.add_job(meter_history_daily_snapshot, "cron",
                                  hour=1, minute=0,
                                  id="meter_history_daily_snapshot", max_instances=1,
                                  coalesce=True, replace_existing=True)
                log.info("APScheduler job registered — meter_history_daily_snapshot daily at 01:00 UTC")
            except Exception as e:
                log.warning("meter_history_daily_snapshot scheduler hook failed: %s", e)
            # v160.3.9.58 — Bulk-import Pre-Starts watchdog + retention.
            # Watchdog runs every 60 s and fails jobs stuck in
            # downloading/extracting past `BULK_IMPORT_DOWNLOAD_TIMEOUT_MIN`.
            # Retention runs nightly at 03:00 Sydney and purges
            # `bulk_import_jobs` (+ their `bulk_import_dryrun` rows) older
            # than `BULK_IMPORT_RETENTION_DAYS` (default 30).
            try:
                scheduler.add_job(
                    bulk_import_watchdog_tick, "interval", seconds=60,
                    id="bulk_import_watchdog", max_instances=1,
                    coalesce=True, replace_existing=True,
                )
                scheduler.add_job(
                    bulk_import_retention_cleanup, "cron",
                    hour=3, minute=0, timezone="Australia/Sydney",
                    id="bulk_import_retention", max_instances=1,
                    coalesce=True, replace_existing=True,
                    misfire_grace_time=6 * 3600,
                )
                log.info("APScheduler jobs registered — bulk_import_watchdog "
                         "every 60s + bulk_import_retention daily 03:00 Sydney")
            except Exception as e:
                log.warning("bulk_import scheduler hooks failed: %s", e)
            # Phase 4.19 (v143) — MongoDB backup snapshots.
            # Cadence per user brief: every 6h + a Sydney COB (17:00 mon-fri).
            # Both wrap `_do_snapshot` (defined in backup_service.install()) which
            # was stashed on app.state during router mount just above.
            # v160.3.6r — Added `misfire_grace_time=3h` because the pod restarts
            # frequently for hot-reloads. APScheduler's default 1-second grace
            # meant that if the pod was down at 00:00 Sydney, that whole slot was
            # skipped forever and the daily snapshot silently stopped happening.
            # Also fires a catch-up run at startup if the last snapshot is >25h
            # old so a restart storm can't leave the org without a fresh backup.
            try:
                _do_snap = getattr(app.state, "bk_do_snapshot", None)
                if _do_snap is None:
                    raise RuntimeError("bk_do_snapshot not attached — install_backup() must run first")
                scheduler.add_job(_do_snap, "cron",
                                  hour="*/6", minute=0,
                                  timezone="Australia/Sydney",
                                  id="backup_snapshot_6h", max_instances=1,
                                  coalesce=True, replace_existing=True,
                                  misfire_grace_time=3 * 3600)
                scheduler.add_job(_do_snap, "cron",
                                  day_of_week="mon-fri", hour=17, minute=0,
                                  timezone="Australia/Sydney",
                                  id="backup_snapshot_cob", max_instances=1,
                                  coalesce=True, replace_existing=True,
                                  misfire_grace_time=3 * 3600)
                log.info("APScheduler jobs registered — backup_snapshot_6h (every 6h) + backup_snapshot_cob (mon-fri 17:00 Sydney) · grace=3h")
                # v160.3.6r — catch-up: if the most recent snapshot is >25h old,
                # kick one immediately. Runs 60 s after startup so the rest of
                # the app is fully up before we start dumping Mongo.
                async def _backup_catchup():
                    try:
                        latest = await _mongo_db.bk_snapshots.find_one(
                            {"status": "ready"}, sort=[("created_at", -1)])
                        hrs = None
                        if latest and latest.get("created_at"):
                            raw = latest["created_at"]
                            # created_at can be a datetime or an ISO string.
                            if isinstance(raw, str):
                                try:
                                    raw = datetime.fromisoformat(raw.replace("Z", "+00:00"))
                                except Exception:
                                    raw = None
                            if isinstance(raw, datetime):
                                if raw.tzinfo is None:
                                    raw = raw.replace(tzinfo=timezone.utc)
                                hrs = (datetime.now(timezone.utc) - raw).total_seconds() / 3600
                        if hrs is None or hrs > 25:
                            log.warning("backup catch-up: last snapshot age=%s hours — kicking now", hrs)
                            await _do_snap()
                            log.info("backup catch-up: snapshot completed")
                        else:
                            log.info("backup catch-up: last snapshot %.1fh old — no catch-up needed", hrs)
                    except Exception as ce:
                        log.warning("backup catch-up failed: %s", ce)
                scheduler.add_job(_backup_catchup, "date",
                                  run_date=datetime.now(timezone.utc) + timedelta(seconds=60),
                                  id="backup_snapshot_catchup", replace_existing=True)
                # v160.3.7j — belt-and-braces watchdog. Every hour, verify the
                # `backup_snapshot_6h` cron job is still registered on the
                # scheduler. If APScheduler ever loses the job (e.g. an
                # unhandled exception blew the trigger away, or a
                # rare `replace_existing=True` race between two boots),
                # re-register it AND kick a catch-up if the last snapshot is
                # more than 25 h old. Runs quietly — never raises.
                async def _backup_watchdog():
                    try:
                        sched = getattr(app.state, "scheduler", None)
                        if sched is None:
                            return
                        reregistered = []
                        if sched.get_job("backup_snapshot_6h") is None:
                            sched.add_job(
                                _do_snap, "cron",
                                hour="*/6", minute=0,
                                timezone="Australia/Sydney",
                                id="backup_snapshot_6h", max_instances=1,
                                coalesce=True, replace_existing=True,
                                misfire_grace_time=3 * 3600,
                            )
                            reregistered.append("backup_snapshot_6h")
                        if sched.get_job("backup_snapshot_cob") is None:
                            sched.add_job(
                                _do_snap, "cron",
                                day_of_week="mon-fri", hour=17, minute=0,
                                timezone="Australia/Sydney",
                                id="backup_snapshot_cob", max_instances=1,
                                coalesce=True, replace_existing=True,
                                misfire_grace_time=3 * 3600,
                            )
                            reregistered.append("backup_snapshot_cob")
                        if reregistered:
                            log.warning(
                                "backup watchdog: re-registered missing job(s): %s",
                                ", ".join(reregistered),
                            )
                            # Kick a catch-up too — if the job vanished for
                            # >25 h we want a snapshot right now, not at the
                            # next natural cron slot.
                            try:
                                latest = await _mongo_db.bk_snapshots.find_one(
                                    {"status": "ready"}, sort=[("created_at", -1)])
                                hrs = None
                                if latest and latest.get("created_at"):
                                    raw = latest["created_at"]
                                    if isinstance(raw, str):
                                        try:
                                            raw = datetime.fromisoformat(raw.replace("Z", "+00:00"))
                                        except Exception:
                                            raw = None
                                    if isinstance(raw, datetime):
                                        if raw.tzinfo is None:
                                            raw = raw.replace(tzinfo=timezone.utc)
                                        hrs = (datetime.now(timezone.utc) - raw).total_seconds() / 3600
                                if hrs is None or hrs > 25:
                                    log.warning(
                                        "backup watchdog: snapshot age=%s h — kicking catch-up",
                                        hrs,
                                    )
                                    await _do_snap()
                            except Exception as ce:
                                log.warning("backup watchdog catch-up failed: %s", ce)
                    except Exception as we:
                        log.warning("backup watchdog failed: %s", we)
                scheduler.add_job(_backup_watchdog, "interval", hours=1,
                                  id="backup_snapshot_watchdog", max_instances=1,
                                  coalesce=True, replace_existing=True)
            except Exception as e:
                log.warning("backup_snapshot scheduler hook failed: %s", e)
            # v160.3.2 — Optional Simpro delta cron (opt-in via env).
            try:
                register_simpro_cron(scheduler)
            except Exception as e:
                log.warning("simpro_delta_cron scheduler hook failed: %s", e)
            scheduler.start()
            app.state.scheduler = scheduler
            # v58.13.17 — Asset-service overnight generation cron.
            # Env-gated OFF by default (ASSET_SERVICE_GENERATE_CRON=1 to
            # enable). Registers only if the env var is set to "1".
            try:
                register_asset_service_generate_cron(scheduler)
            except Exception as e:
                log.warning("asset_service_generate cron registration failed: %s", e)
            # v58.13.131m — Optional SmartFill auto-sync cron (opt-in
            # via env AND per-org toggle). See
            # /app/backend/cron_smartfill_auto_sync.py.
            try:
                register_smartfill_auto_sync_cron(scheduler)
            except Exception as e:
                log.warning("smartfill_auto_sync cron registration failed: %s", e)
            # Kick off a sync immediately so day-one rollout doesn't have to wait 15 min.
            import asyncio as _asyncio
            _asyncio.create_task(sync_navixy_counters())
            # Phase 4.8 — one-time 30-day backfill of `asset_meter_history`. Idempotent
            # — relies on the unique (asset_id, snapshot_date) index. Runs in the
            # background so app startup isn't blocked.
            async def _meter_history_first_run():
                try:
                    await meter_history_ensure_indexes()
                    await meter_history_backfill_30d()
                except Exception as e:
                    log.warning("meter_history first-run backfill failed: %s", e)
            _asyncio.create_task(_meter_history_first_run())
            log.info("APScheduler started — navixy_sync_counters every 15 min")
        except Exception as e:
            log.warning("APScheduler failed to start: %s", e)
        # v58.13.124 — Visibility guard for TEST-v58.13.* pollution.
        # These seed rows have snuck back into `assets` post-.116,
        # post-.120a and now post-.123a; the `.124` purge cleaned
        # 90 of them but any future re-appearance should be visible
        # in the boot log so an operator can trigger the standalone
        # purge script. Warning-only — no auto-purge.
        try:
            from db import db as _db_test_guard
            _n_test = await _db_test_guard.assets.count_documents({
                "name": {"$regex": r"^TEST-v58\.", "$options": "i"},
            })
            if _n_test:
                log.warning(
                    "[v124] test-seed pollution guard: %d assets match "
                    "^TEST-v58.* — run "
                    "`python /app/backend/scripts/"
                    "purge_test_v58_13_all_leftovers_v58_13_124.py --commit`",
                    _n_test,
                )
            else:
                log.info("[v124] test-seed pollution guard: 0 rows (clean)")
        except Exception as e:  # pragma: no cover
            log.warning("[v124] test-seed pollution guard failed: %s", e)

        log.info('[startup] deferred_startup_work: done in %.2fs', _dsw_time.monotonic() - _t0)

    import asyncio as _dsw_asyncio
    _dsw_asyncio.create_task(_deferred_startup_work())
    log.info('[startup] fast bootstrap complete — deferred work kicked off')



@app.on_event("shutdown")
async def on_shutdown():
    # v58.13.15 — Cancel any in-flight bulk_import background tasks
    # with a bounded drain budget BEFORE the loop tears down. Without
    # this the untracked `_run_job` tasks would hold `loop.close()` open
    # for 10+ minutes waiting on `asyncio.to_thread` OS threads (which
    # can't be cancelled). Watchdog auto-resumes anything that didn't
    # unwind cleanly on the next boot.
    try:
        from bulk_import_prestarts import shutdown_bulk_import_jobs
        await shutdown_bulk_import_jobs()
    except Exception as e:  # non-fatal — server must still shut down
        log.warning("bulk_import shutdown handler failed: %s", e)
    sched = getattr(app.state, "scheduler", None)
    if sched is not None:
        try:
            sched.shutdown(wait=False)
        except Exception as e:
            log.warning("Scheduler shutdown error: %s", e)
    close_db()
