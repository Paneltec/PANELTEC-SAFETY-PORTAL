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
from worker_certifications import router as worker_certifications_router  # noqa: E402
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


@app.on_event("shutdown")
async def on_shutdown():
    close_db()
