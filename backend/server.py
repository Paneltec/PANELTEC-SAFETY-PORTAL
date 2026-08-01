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
from ask import router as ask_router  # noqa: E402
from assets import router as assets_router  # noqa: E402
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
from forms_pickers import router as forms_pickers_router  # noqa: E402
from help_routes import router as help_router  # noqa: E402
from auth import get_current_user, router as auth_router  # noqa: E402
from contractors import router as contractors_router  # noqa: E402
from crud import (  # noqa: E402
    diary_router, hazards_router, incidents_router, inspections_router,
    prestarts_router, risk_assessments_router, swms_router,
)
from dashboard import files_router, router as dashboard_router  # noqa: E402
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
from integrations_m365 import router as m365_router  # noqa: E402
from integrations_textmagic import router as textmagic_router  # noqa: E402
from pdf_routes import router as pdf_router  # noqa: E402
from renewals import public_router as renewals_public_router, router as renewals_router  # noqa: E402
from seed import ensure_indexes, seed_all  # noqa: E402
from users import router as users_router  # noqa: E402
from workspaces import router as workspaces_router  # noqa: E402
from org_settings import router as org_router  # noqa: E402
from mobile_modules import router as mobile_modules_router  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(name)s | %(message)s")
log = logging.getLogger("paneltec")

app = FastAPI(title="Paneltec Civil API", version="0.2.0", openapi_url="/api/openapi.json")

# CORS — Bearer auth so allow_credentials isn't required; permit wildcard via env.
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
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
    return {"ok": True}


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


api.include_router(auth_router)
# v160.3.0-adjust-19 — Drag-drop PDF import endpoint.
from imports import router as imports_router  # noqa: E402
api.include_router(imports_router)
api.include_router(ai_router)
api.include_router(dashboard_router)
api.include_router(files_router)
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
from bulk_import_prestarts import (  # noqa: E402
    router as bulk_import_prestarts_router,
    ensure_indexes as bulk_import_ensure_indexes,
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
# v160.1 — Document categorization backend (Phase 1). UI is Phase 2.
from document_categories import router as document_categories_router  # noqa: E402
api.include_router(document_categories_router)
api.include_router(workspaces_router)
app.include_router(org_router)
app.include_router(mobile_modules_router)
api.include_router(email_router)
api.include_router(record_email_router)
api.include_router(comms_safe_mode_router)  # Phase 4.7.3
api.include_router(pdf_router)
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
# Phase 3.21 — Session history audit log (30d retention).
from session_history import router as session_history_router, ensure_indexes as session_history_ensure_indexes  # noqa: E402
api.include_router(session_history_router)
from sites_qr import scan_router as site_scan_router, sites_router  # noqa: E402
from sites_signon_v127 import router as sites_v127_router, me_router as me_v127_router  # noqa: E402
from suppliers_qr import (  # noqa: E402
    scan_router as supplier_scan_router,
    contractors_qr_router,
)
api.include_router(site_scan_router)
api.include_router(sites_router)
api.include_router(sites_v127_router)
api.include_router(me_v127_router)
api.include_router(supplier_scan_router)
api.include_router(contractors_qr_router)
api.include_router(asset_navixy_dashboards_router)
api.include_router(forms_pickers_router)
api.include_router(help_router)
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
    await session_history_ensure_indexes()
    # v160.3.9.12a — Bulk-import Pre-Starts index setup.
    try:
        await bulk_import_ensure_indexes()
    except Exception as e:
        log.warning("bulk_import_prestarts index setup failed: %s", e)
    # v160.3.9.13 — Master Risks index setup.
    try:
        await master_risks_ensure_indexes()
    except Exception as e:
        log.warning("master_risks index setup failed: %s", e)
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
    try:
        await cs_incident_ensure_indexes()
    except Exception as e:
        log.warning("cs_incident index setup failed: %s", e)
    result = await seed_all()
    log.info("Seeded: %s", result["counts"])
    # Daily reminder scan — runs once at startup for now (true cron requires
    # APScheduler in production). Wrapped so a failure here can't take down
    # the rest of the API.
    try:
        from worker_certifications import run_reminder_scan
        stats = await run_reminder_scan()
        log.info("Cert reminder scan: %s", stats)
    except Exception as e:
        log.warning("Cert reminder scan failed at startup: %s", e)

    # v160.3.1 — Simpro cert_kinds + licence_mapping seed load (idempotent).
    try:
        await seed_cert_kinds_on_startup()
    except Exception as e:
        log.warning("Simpro cert_kinds seed failed: %s", e)
    # v160.3.3 — HR docs dedup index.
    try:
        await ensure_hr_dedup_index()
    except Exception as e:
        log.warning("HR dedup index setup failed: %s", e)

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


@app.on_event("shutdown")
async def on_shutdown():
    sched = getattr(app.state, "scheduler", None)
    if sched is not None:
        try:
            sched.shutdown(wait=False)
        except Exception as e:
            log.warning("Scheduler shutdown error: %s", e)
    close_db()
