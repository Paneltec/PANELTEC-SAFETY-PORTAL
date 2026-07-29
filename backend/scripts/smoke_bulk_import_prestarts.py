"""v160.3.9.12a — Local smoke test for the Bulk-Import Pre-Starts pipeline.

Purpose: prove the pipeline runs end-to-end on ONE local fixture PDF. Not
a correctness test of Claude parsing on a synthetic input — just proves
the code path pdftoppm → PNG → Claude classify → Claude extract → fuzzy
match doesn't blow up.

Usage:
    cd /app/backend && python -m scripts.smoke_bulk_import_prestarts

Explicit non-goals:
    · NO live 8.6 GB Dropbox fetch. NO batch Claude spend.
    · NO test of the HTTP endpoints — we call the module helpers directly.
    · NO assertion on Claude's answer quality on a synthetic PDF.

The script prints the observed pipeline stages and exits non-zero if any
stage blows up. Skips Claude when EMERGENT_LLM_KEY is unset (local dev).
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

# Bootstrap sys.path so `import ai` works when run as a script.
BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))

from dotenv import load_dotenv
load_dotenv(BACKEND_ROOT / ".env")

from db import db  # noqa: E402
from bulk_import_prestarts import (  # noqa: E402
    _pdf_first_page_png_b64,
    _claude_classify,
    _claude_extract,
    _match_worker,
    _match_site,
    _TEMPLATE_HINTS,
    ensure_indexes,
)

FIXTURE_PATH = BACKEND_ROOT / "test_fixtures" / "prestart_sample.pdf"


def _ok(msg: str) -> None:
    print(f"  ✔ {msg}")


def _fail(msg: str) -> None:
    print(f"  ✘ {msg}")


async def main() -> int:
    print(f"[smoke] v160.3.9.12a bulk-import pipeline · fixture={FIXTURE_PATH}")
    if not FIXTURE_PATH.exists():
        print(f"[smoke] fixture missing — run: python -m scripts.make_prestart_fixture")
        return 2

    exit_code = 0

    # 0. Index setup.
    print("[stage 0] ensure_indexes()")
    await ensure_indexes()
    _ok("indexes ensured on bulk_import_jobs / bulk_import_dryrun")

    # 1. Read PDF bytes.
    pdf_bytes = FIXTURE_PATH.read_bytes()
    print(f"[stage 1] read fixture — {len(pdf_bytes)} bytes")

    # 2. pdftoppm → PNG → base64.
    print("[stage 2] pdftoppm → PNG → base64")
    png_b64 = await asyncio.to_thread(_pdf_first_page_png_b64, pdf_bytes)
    if not png_b64:
        _fail("pdftoppm returned None — POPPLER not installed or fixture unreadable")
        return 3
    _ok(f"got PNG base64 · {len(png_b64)} chars")

    # 3. Load pre-start templates from Mongo.
    print("[stage 3] load pre-start templates from Mongo")
    templates_by_id: dict = {}
    async for t in db.form_templates.find(
        {"deleted_at": None, "category": "pre_start"}, {"_id": 0}
    ):
        templates_by_id[t["id"]] = t
    if not templates_by_id:
        _fail("no pre_start templates found in db — seed the org first")
        return 4
    _ok(f"loaded {len(templates_by_id)} templates: "
        f"{[t.get('name') for t in templates_by_id.values()]}")
    if "536805af-e397-451f-94f0-30296d8f3a97" not in templates_by_id:
        _fail("Daily Pre-Start template (default classification target) missing")
        exit_code = 5

    # 4. Fuzzy matchers — pick an org that actually has workers.
    print("[stage 4] fuzzy match helpers")
    # Prefer the paneltec org if it has data; otherwise fall back to any org.
    org_id = None
    async for w in db.workers.find({"deleted_at": None},
                                    {"_id": 0, "org_id": 1}).limit(1):
        org_id = w["org_id"]
    if not org_id:
        _fail("no workers in db — skipping fuzzy match test")
    else:
        wid, wconf = await _match_worker("Stephen McGuinness", org_id)
        _ok(f"_match_worker('Stephen McGuinness', {org_id[:8]}…) "
            f"→ id={wid}, confidence={wconf}")
        sid = await _match_site("Chullora Depot", org_id)
        _ok(f"_match_site('Chullora Depot', …) → id={sid}")

    # 5. Claude classify + extract on ONE PDF.
    if not os.environ.get("EMERGENT_LLM_KEY"):
        print("[stage 5] EMERGENT_LLM_KEY unset — skipping Claude calls")
    else:
        print("[stage 5] Claude classify + extract (1 call each)")
        try:
            cls = await _claude_classify(png_b64)
            print(f"    classifier response: {json.dumps(cls)[:300]}")
            _ok("classifier returned JSON")
        except Exception as e:
            _fail(f"classifier blew up: {e}")
            return 6
        # Pick the template Claude suggested (fallback to Daily Pre-Start).
        tpl_name = (cls or {}).get("template_name") or "Daily Pre-Start"
        tpl_id = next((k for k, v in _TEMPLATE_HINTS.items() if v == tpl_name),
                      "536805af-e397-451f-94f0-30296d8f3a97")
        template = templates_by_id.get(tpl_id) or {}
        try:
            ext = await _claude_extract(png_b64, template)
            print(f"    extractor response: {json.dumps(ext)[:400]}…")
            _ok("extractor returned JSON")
        except Exception as e:
            _fail(f"extractor blew up: {e}")
            return 7

    print("[smoke] PASS · pipeline reachable end-to-end")
    return exit_code


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
