"""FastAPI app entrypoint — mounts all routers under /api."""
import logging
import os
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
from asset_navixy_dashboards import router as asset_navixy_dashboards_router  # noqa: E402
from forms_pickers import router as forms_pickers_router  # noqa: E402
from auth import get_current_user, router as auth_router  # noqa: E402
from contractors import router as contractors_router  # noqa: E402
from crud import (  # noqa: E402
    diary_router, hazards_router, incidents_router, inspections_router,
    prestarts_router, swms_router,
)
from dashboard import files_router, router as dashboard_router  # noqa: E402
from db import close as close_db  # noqa: E402
from document_library import (  # noqa: E402
    router as document_library_router,
    supplier_folders_router,
)
from suppliers import router as suppliers_router  # noqa: E402
from supplier_panels import router as supplier_panels_router  # noqa: E402
from workers import router as workers_router  # noqa: E402
from workers_qr import router as workers_qr_router, scan_router as worker_scan_router, backfill_scan_tokens  # noqa: E402
from worker_certifications import router as worker_certifications_router  # noqa: E402
from forms import router as forms_router  # noqa: E402
from email_outbox import record_router as record_email_router, router as email_router  # noqa: E402
from exports import router as exports_router  # noqa: E402
from integrations import router as integrations_router  # noqa: E402
from integrations_simpro import router as simpro_router  # noqa: E402
from integrations_m365 import router as m365_router  # noqa: E402
from integrations_textmagic import router as textmagic_router  # noqa: E402
from pdf_routes import router as pdf_router  # noqa: E402
from renewals import public_router as renewals_public_router, router as renewals_router  # noqa: E402
from seed import ensure_indexes, seed_all  # noqa: E402
from users import router as users_router  # noqa: E402
from workspaces import router as workspaces_router  # noqa: E402
from org_settings import router as org_router  # noqa: E402

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


@api.get("/whoami")
async def whoami(user: dict = Depends(get_current_user)):
    return {"id": user["id"], "email": user["email"], "role": user["role"]}


# mount routers
api.include_router(auth_router)
api.include_router(ai_router)
api.include_router(dashboard_router)
api.include_router(files_router)
api.include_router(swms_router)
api.include_router(prestarts_router)
api.include_router(diary_router)
api.include_router(hazards_router)
api.include_router(incidents_router)
api.include_router(inspections_router)
api.include_router(contractors_router)
api.include_router(renewals_router)
api.include_router(renewals_public_router)
api.include_router(exports_router)
api.include_router(integrations_router)
api.include_router(simpro_router)
api.include_router(m365_router)
api.include_router(textmagic_router)
api.include_router(ask_router)
api.include_router(users_router)
api.include_router(workspaces_router)
app.include_router(org_router)
api.include_router(email_router)
api.include_router(record_email_router)
api.include_router(pdf_router)
api.include_router(document_library_router)
api.include_router(supplier_folders_router)
api.include_router(suppliers_router)
api.include_router(supplier_panels_router)
api.include_router(worker_certifications_router)
api.include_router(workers_router)
api.include_router(workers_qr_router)
api.include_router(worker_scan_router)
api.include_router(forms_router)
api.include_router(assets_router)
api.include_router(asset_service_router)
api.include_router(asset_scan_router)
api.include_router(form_assignments_router)
api.include_router(asset_navixy_sync_router)

from swms_extras import router as swms_extras_router  # noqa: E402
api.include_router(swms_extras_router)

from file_pdf import router as file_pdf_router  # noqa: E402
api.include_router(file_pdf_router)

from workers_inductions import router as workers_inductions_router  # noqa: E402
api.include_router(workers_inductions_router)
api.include_router(asset_navixy_dashboards_router)
api.include_router(forms_pickers_router)

app.include_router(api)


@app.on_event("startup")
async def on_startup():
    await ensure_indexes()
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
        scheduler.start()
        app.state.scheduler = scheduler
        # Kick off a sync immediately so day-one rollout doesn't have to wait 15 min.
        import asyncio as _asyncio
        _asyncio.create_task(sync_navixy_counters())
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
