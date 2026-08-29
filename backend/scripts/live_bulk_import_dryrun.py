"""v160.3.9.12a-live — Live bulk-import dry-run driver.

Talks to the running backend on localhost:8001 with Stephen's admin
credentials. Runs the full HTTP flow:

    login → /init → /start → poll /status → /report

Prints structured progress and dumps the final report to a JSON file at
`/app/backend/scripts/reports/bulk_import_live_<job_id>.json` for the
main-agent report-formatter to consume.

Explicit non-goals:
    · Does NOT call /approve — dry-run only.
    · Does NOT modify form_submissions.
    · Does NOT retry failed jobs.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
from pathlib import Path

import httpx

BACKEND = os.environ.get("PANELTEC_BACKEND", "http://localhost:8001")
# v58.13.62 — Test credentials moved to env. Fails loud on omission.
EMAIL = os.getenv("PANELTEC_TEST_EMAIL")
PASSWORD = os.getenv("PANELTEC_TEST_PASSWORD")
if not EMAIL or not PASSWORD:
    raise SystemExit(
        "PANELTEC_TEST_EMAIL and PANELTEC_TEST_PASSWORD env vars required"
    )

DROPBOX_URL = (
    "https://www.dropbox.com/scl/fi/k7oz7z06mwbbita7wernt/A-Barbari-2.zip"
    "?rlkey=np2jp2d01ramx44489mjk8z47&st=oih1277q&dl=1"
)

REPORT_DIR = Path(__file__).resolve().parent / "reports"
REPORT_DIR.mkdir(parents=True, exist_ok=True)


async def _login(c: httpx.AsyncClient) -> str:
    r = await c.post(f"{BACKEND}/api/auth/login",
                     json={"email": EMAIL, "password": PASSWORD})
    r.raise_for_status()
    return r.json()["access_token"]


async def _init_job(c: httpx.AsyncClient, headers: dict, url: str) -> dict:
    r = await c.post(f"{BACKEND}/api/pre-starts/bulk-import/init",
                     json={"source": "url", "url": url}, headers=headers)
    r.raise_for_status()
    return r.json()


async def _start(c: httpx.AsyncClient, headers: dict, job_id: str) -> dict:
    r = await c.post(f"{BACKEND}/api/pre-starts/bulk-import/{job_id}/start",
                     headers=headers)
    r.raise_for_status()
    return r.json()


async def _status(c: httpx.AsyncClient, headers: dict, job_id: str) -> dict:
    r = await c.get(f"{BACKEND}/api/pre-starts/bulk-import/{job_id}/status",
                    headers=headers)
    r.raise_for_status()
    return r.json()


async def _report(c: httpx.AsyncClient, headers: dict, job_id: str) -> dict:
    r = await c.get(f"{BACKEND}/api/pre-starts/bulk-import/{job_id}/report",
                    headers=headers)
    r.raise_for_status()
    return r.json()


async def main(args) -> int:
    async with httpx.AsyncClient(timeout=60.0) as c:
        print("[live] logging in as", EMAIL)
        token = await _login(c)
        headers = {"Authorization": f"Bearer {token}"}

        print("[live] init job")
        init = await _init_job(c, headers, args.url)
        job_id = init["job_id"]
        print(f"  job_id={job_id}")
        print(f"  size_bytes={init.get('size_bytes')}")
        print(f"  url_final={(init.get('url_final') or '')[:80]}…")

        print("[live] start job (dry-run mode)")
        started = await _start(c, headers, job_id)
        print(f"  mode={started.get('mode')}")

        # Poll every 5s.
        t0 = time.time()
        last_state, last_processed = None, -1
        terminal = {"awaiting_approval", "complete", "failed", "cancelled"}
        while True:
            elapsed = int(time.time() - t0)
            if elapsed > args.timeout:
                print(f"[live] TIMEOUT after {elapsed}s — job still in state "
                      f"{last_state}, processed={last_processed}")
                return 2
            st = await _status(c, headers, job_id)
            state = st.get("state")
            proc = st.get("processed") or 0
            total = st.get("total")
            if state != last_state or proc != last_processed:
                print(f"[live] +{elapsed:>4}s  state={state}  processed={proc}/{total}")
                last_state, last_processed = state, proc
            if state in terminal:
                break
            await asyncio.sleep(5)

        print("[live] fetching report")
        report = await _report(c, headers, job_id)

        out_path = REPORT_DIR / f"bulk_import_live_{job_id}.json"
        out_path.write_text(json.dumps(report, indent=2, default=str))
        print(f"[live] wrote report to {out_path}")

        # Quick summary printed to stdout for the main agent to consume.
        job = report.get("job") or {}
        dryrun = report.get("dryrun_results") or []
        print("[live] === SUMMARY ===")
        print(f"  final state:   {job.get('state')}")
        print(f"  processed:     {job.get('processed')} / {job.get('total')}")
        print(f"  failed count:  {job.get('failed')}")
        print(f"  dryrun rows:   {len(dryrun)}")
        print(f"  started_at:    {job.get('started_at')}")
        print(f"  finished_at:   {job.get('finished_at')}")
        if job.get("error"):
            print(f"  error:         {job.get('error')}")
        return 0 if job.get("state") == "awaiting_approval" else 3


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--url", default=DROPBOX_URL)
    p.add_argument("--timeout", type=int, default=900,
                   help="Max seconds to wait (default 15 min)")
    sys.exit(asyncio.run(main(p.parse_args())))
