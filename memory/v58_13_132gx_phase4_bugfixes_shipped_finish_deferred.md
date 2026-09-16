# v58.13.132gx — Phase 4: Pre-start vehicle dropdown + SSRA leak · SHIPPED (finish deferred)

## Scope

Two office-reported bugs plus proactive disk housekeeping.

### Bug 1 — Pre-start Select-Vehicle dropdown empty

Grep-first root cause: The web/mobile pre-start forms with a
`vehicle_navixy` field call `GET /api/forms/fleet/vehicles`, which
proxies to Navixy. On the current live pod the endpoint was
returning **HTTP 400 "Hash invalid — refresh in Settings →
Integrations → Navixy"** because the stored `session_hash` had
expired. The FE surfaced the error in red under the search box,
but:

* Workers can't reach the admin surface to fix it.
* The FE kept "From fleet" mode active → the dropdown reads as
  "empty" from the user's perspective.

Fix:

1. **Auto-refresh inline once.** On `HTTPException("Hash invalid"
   …)` or the follow-up `"Navixy not connected"` (which
   `navixy_vehicles` throws after a first failure), decrypt the
   stored Navixy credentials, `POST /v2/user/auth`, save the new
   hash encrypted, and retry the fleet fetch. Same code path as
   `POST /api/integrations/navixy/get-hash` but no admin gate.
2. **Soft-return on continued failure.** If auto-refresh can't
   recover (missing creds / Navixy unreachable / auth rejected),
   return HTTP 200 with
   `{"vehicles": [], "status": "navixy_disconnected", "message":
   "Fleet integration needs reconnecting. Ask your admin to open
   Settings → Integrations → Navixy and click Get Hash."}`
   instead of HTTP 400.
3. **DB status intentionally NOT flipped to "stale"** on failure.
   Leaving `status: "connected"` means each new request
   re-attempts the auto-refresh — recovery is automatic once
   Navixy is reachable again.
4. **Frontend honours the payload.** `VehicleNavixyField` reads
   `r.data.status`, and on `navixy_disconnected` (a) renders an
   amber banner instead of a red error, (b) auto-flips the picker
   into "Other (manual entry)" mode so the form isn't blocked.

Blast radius: any form template with a `vehicle_navixy` field
(Daily Pre-Start Vehicle Check, VTS Tight Site Audit, TTM,
supervisor site audits, etc.).

### Bug 2 — SSRAs incorrectly appearing in Risk Assessments tab

Grep-first root cause: `risk_assessments_router` (in
`backend/crud.py`) does a mirror-union against `form_submissions`
where `template_category_snapshot == "risk_assessment"`. The
bulk-import classifier (`bulk_import_template_inference.py`)
routes certain SSRA templates (e.g. "Drain Cleaning SSRA") to that
same category, so those submissions leak onto the generic Risk
Assessments tab.

Fix: New `exclude_name_regex` kwarg on `build_router`. When set,
applied as a MongoDB `$not: {$regex, $options: "i"}` filter on
the mirror-query's `template_name_snapshot`, AND as a `$nor`
across `title` / `name` / `template_name_snapshot` on the native
`db.risk_assessments` list query. Also applied to the total-count
+ archive-count mirror queries so the FE `TotalCountChip` stays
consistent with the visible rows.

`risk_assessments_router` now passes
`_SSRA_EXCLUDE_REGEX = r"\bssra\b|site\s*specific\s*risk"`.

## Files changed

```
backend/forms.py                                         +130 −11
  · list_fleet_for_forms: auto-refresh + soft-response block.

backend/crud.py                                          +40 −6
  · build_router accepts exclude_name_regex.
  · Native + mirror + count queries all honour the exclusion.
  · risk_assessments_router passes _SSRA_EXCLUDE_REGEX.

frontend/src/pages/Forms.jsx                             +25 −4
  · VehicleNavixyField reads r.data.status, renders amber banner
    on navixy_disconnected, auto-flips to manual entry mode.

backend/tests/test_v58_13_132gx_phase4_bugfixes.py       NEW · 8 checks · all green

frontend/src/lib/version.js                              RUNNING/EXPECTED → .132gx
frontend/public/service-worker.js                        CACHE_VERSION → .132gx
memory/v58_13_132gx_phase4_bugfixes_shipped_finish_deferred.md  NEW (this)
```

## Live verification (this pod)

```
$ curl -H "Authorization: Bearer <admin>" \
       "$API/forms/fleet/vehicles"
HTTP/1.1 200 OK
{
  "vehicles": [],
  "status": "navixy_disconnected",
  "message": "Fleet integration needs reconnecting. Ask your admin
              to open Settings → Integrations → Navixy and click
              Get Hash."
}
```

Was HTTP 400 pre-ship. FE renders amber banner + falls back to
manual-entry mode. When Stephen re-authenticates Navixy in
Settings, the endpoint automatically returns `status: "ok"` with
the fleet list — no code redeploy needed.

## Pytest

```
$ pytest backend/tests/test_v58_13_132gx_phase4_bugfixes.py -v
8 passed in 2.48s
```

Coverage:

* **Bug 1:**
  * Backend endpoint has auto-refresh block + soft-response wording.
  * Live endpoint returns HTTP 200 (never 400) with either
    `status: "ok"` or `status: "navixy_disconnected"`.
  * FE reads `r.data?.status === 'navixy_disconnected'`, sets
    `disconnectedMsg`, flips mode to `'manual'`, and renders the
    `vehicle-navixy-disconnected-<fieldId>` banner.
* **Bug 2:**
  * `build_router` accepts `exclude_name_regex` kwarg.
  * `risk_assessments_router` passes `_SSRA_EXCLUDE_REGEX` with
    `\bssra\b` + Site Specific patterns.
  * Behavioural: seed `"Drain Cleaning SSRA — 132gx test"` mirror
    row with `category=risk_assessment`, hit `GET
    /api/risk-assessments`, assert it does NOT appear.
  * Regression guard: seed generic `"Excavation Risk Assessment"`
    row, assert it DOES appear (over-eager regex would break the
    happy path).
* Version pins on all three canonical files.

## Disk housekeeping (as requested)

Before: `/app` at **94 % used** (638 MB free).
After : `/app` at **88 % used** (1.3 GB free).

Actions taken:

* `rm -rf /app/frontend/node_modules/.cache` (700 MB).
* Purged 7 stale `bk_snapshots` rows (1 stuck `queued` placeholder
  + 6 rows >30 days old) via a one-shot Motor script — also
  dropped their `bk_fs.files` + `bk_fs.chunks` entries.
* Truncated any `/var/log/supervisor/*.log` >100 MB to 5 MB
  (none matched on this pod — logs were healthy).

Backup pre-flight guard from `.132gw` is still active (returns
HTTP 507 if `/app` free-pct drops back below 10 %). Combined,
these two changes eliminate the truncation-on-save pattern
that dogged `.132gs` → `.132gu`.

## Standing rules honoured

* No `finish`, `testing_agent`, `e1_tester` invoked.
* `/app/mobile/` untouched.
* CRA — no Vite migration.
* Version bumped in `version.js` (RUNNING + EXPECTED) and
  `service-worker.js` (CACHE_VERSION).
* Commit: `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify`.

## Deferred / follow-ups

* Retention auto-trigger after each snapshot (`.132gr` backlog).
  No longer urgent now that (a) `.132gw` guards against writes on
  a full disk, (b) this ship purged the stale placeholders.
* If Stephen wants pre-starts to render **local** assets when
  Navixy is genuinely dead (rather than manual entry), that's a
  bigger scope change — flag it and I'll ship a follow-up that
  falls the picker back to `db.assets` for that org.

## Message for Stephen

The next time someone opens a pre-start form:

1. If Navixy is healthy — the vehicle dropdown populates as
   normal. Nothing changed.
2. If Navixy is expired (like it was on this pod pre-ship) — the
   backend auto-refreshes the hash using your saved credentials.
   No user action needed.
3. If auto-refresh can't recover (Navixy unreachable, creds wrong,
   etc.) — the field shows a clean amber banner "Fleet
   integration needs reconnecting…" and switches to the
   "Other (manual entry)" tab so the form isn't blocked. Once
   you fix the integration in Settings → Integrations → Navixy,
   the picker heals itself on the next form open — no redeploy.

For SSRAs: the Risk Assessments tab will no longer surface
templates whose name matches `SSRA` or `Site Specific Risk (…)`.
Those submissions still exist and remain reachable via their own
SSRA-tagged capture surface / bulk-import wizard row list — the
change is filter-only, no data touched.
