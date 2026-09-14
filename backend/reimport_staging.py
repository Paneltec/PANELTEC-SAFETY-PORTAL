"""v58.13.132gj — Shared staging helper for admin-triggered reimports.

Before this ship, every `POST /api/{module}/reimport` endpoint (9 of
them: list_forms, companies, list_roles, master_risks, cs_incident,
incident_root_causes, hr_employees, completed_training,
plant_maintenance) wrote the incoming `.xlsx` to a fixed pod path
under `backend/scripts/data/<module>_source.xlsx` before handing that
path to the module's `parse_workbook()`. That pattern:

* Left an ephemeral upload artefact on pod disk that survived only
  until the next restart (identical `.132fq` failure mode as the
  worker-cert / induction 410 storm).
* Made every one of these endpoints trip the
  `ephemeral-upload-storage` lint.

`.132gj` swaps that path for:

1. Read the incoming bytes (from `UploadFile` OR `httpx` GET).
2. Persist a copy to GridFS under `module="reimport_archive",
   parts=[<module>, "<iso>.xlsx"]` for audit / retrospective inspection.
3. Write the same bytes to a short-lived
   `tempfile.NamedTemporaryFile(delete=False, suffix=".xlsx")`,
   which callers pass to `parse_workbook(<path>)`. The path is
   unlinked in a `finally` block by the caller (or by us via the
   returned context manager helper `staged_reimport_xlsx`).

The archive copy is small (one row per successful admin reimport),
lets Stephen retrace an "Aug 12 list_forms reimport used which
source spreadsheet?" question at any time, and can be pruned via
the standard `archive_audit` retention job.

Design notes
------------
* Short-lived `NamedTemporaryFile` is the documented exception in
  the `.132gj` plan. It never persists across a pod restart — the
  file is written, parsed, unlinked in a `finally`.
* We do **not** stream directly into `parse_workbook(BytesIO(...))`
  because every existing importer expects a filesystem path. Adding
  a BytesIO parameter would touch 9 importer scripts under
  `backend/scripts/` and is out of scope for this ship; refactor
  is queued as a follow-up.
"""
from __future__ import annotations

import logging
import tempfile
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import httpx
from fastapi import HTTPException, UploadFile

log = logging.getLogger("paneltec.reimport_staging")

REIMPORT_ARCHIVE_SUBDIR = "reimport_archive"


async def _read_source(
    file: Optional[UploadFile], url: Optional[str],
) -> bytes:
    """Return the raw workbook bytes. Callers guarantee exactly one
    of `file` / `url` is set (see `_validate_source`)."""
    if file is not None:
        return await file.read()
    async with httpx.AsyncClient(follow_redirects=True, timeout=60.0) as c:
        r = await c.get(url)  # type: ignore[arg-type]
        r.raise_for_status()
        return r.content


def _validate_source(file: Optional[UploadFile], url: Optional[str]) -> None:
    if bool(file) == bool(url):
        raise HTTPException(400, "supply-exactly-one-of-file-or-url")


async def _archive_to_gridfs(
    module: str, data: bytes, *, org_id: Optional[str],
) -> str:
    """Persist a copy to GridFS for audit. Non-fatal on failure —
    the primary import always wins."""
    try:
        from uploads_storage import save_upload  # noqa: WPS433
        ts = datetime.now(timezone.utc).isoformat().replace(":", "")
        name = f"{ts}.xlsx"
        await save_upload(
            REIMPORT_ARCHIVE_SUBDIR, [module, name], data,
            module="reimport_archive",
            org_id=org_id,
            mime=(
                "application/vnd.openxmlformats-officedocument."
                "spreadsheetml.sheet"
            ),
            orig_filename=name,
        )
        return name
    except Exception as e:
        log.warning(
            "reimport archive write failed module=%s: %s", module, e)
        return ""


@asynccontextmanager
async def staged_reimport_xlsx(
    *, file: Optional[UploadFile], url: Optional[str],
    module: str, user: dict,
):
    """Async context manager. Yields `(bytes_len, tempfile_path)`.

    Usage:
        async with staged_reimport_xlsx(
            file=file, url=url, module="companies", user=user,
        ) as (size, path):
            rows = parse_workbook(path)
            ...

    Always unlinks the temp file on exit — even if the caller
    raises mid-parse.
    """
    _validate_source(file, url)
    data = await _read_source(file, url)
    if not data:
        raise HTTPException(400, "empty-source")

    await _archive_to_gridfs(module, data, org_id=(user or {}).get("org_id"))

    tf = tempfile.NamedTemporaryFile(
        prefix=f"reimport-{module}-", suffix=".xlsx", delete=False,
    )
    try:
        tf.write(data)
        tf.flush()
        tf.close()
        yield len(data), Path(tf.name)
    finally:
        try:
            Path(tf.name).unlink(missing_ok=True)
        except Exception:
            log.warning("temp file cleanup failed: %s", tf.name)
