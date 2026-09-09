# v58.13.132r hotfix — Simpro worker → user pending-invite bridge

**Status**: HOTFIX SHIPPED · 6 orphaned workers rehydrated into
`users` collection. Josh Drew visible in Users & Permissions.

**Version pins**: unchanged (`RUNNING_VERSION` = `MOBILE_BUNDLE_VERSION`
= `paneltec-v160.3.9.58.13.132r`). No `CACHE_VERSION` bump.

## Root cause

Two independent Simpro import paths exist in the codebase:
- `POST /api/simpro/sync-jobs` and friends — pull assets, sites,
  customers, suppliers, and **workers** into their respective
  collections. This is what runs on the daily Simpro cron.
- `POST /api/simpro/import-employees` — creates `users` login rows
  linked to Simpro employees. This is a **separate** admin-only
  endpoint that is NOT triggered by the daily cron.

When Josh was added to Simpro, the daily cron pulled him into the
`workers` collection (verified: `simpro_employee_id=1090`,
`email=joshua@paneltec.com.au`, `company_id=2`), but no `users` row
was ever created — so Users & Permissions had nothing to render.

Five other workers were similarly orphaned (Bobby McGowan, Brock
Waterworth, Emma Nippers, Wayne Nippers, Adrian Mitchell).

Secondary root cause: `.132r` `FORCE_ADMIN_EMAILS` used a
`startswith("josh@")` short-circuit which never matched Josh's real
email `joshua@paneltec.com.au`. Fixed with an explicit email pin
PLUS a first-name allowlist.

## Fix (one-shot script — persisted, re-runnable)

`/app/backend/scripts/sync_workers_to_users_v58_13_132r_hotfix.py`

- Reads every `workers` doc.
- Matches to `users` by `simpro_employee_id` then by `email`.
- For workers WITH no user row → creates a pending-invite user
  with `.132r` bucketing (Force-admin list, company_id, contractor
  flag).
- For workers WITH a user row but no `role_id` (pre-`.132r`
  pending-activation rows) → stamps the role_id.
- Dry-run by default; `--commit` writes.

## Live run output (`--commit`)

```
CREATE  bobbylbp@hotmail.com          (BOBBY MCGOWAN)      cid=2  role_id=paneltec_civil
CREATE  brock.w@hotmail.com           (BROCK WATERWORTH)   cid=2  role_id=paneltec_civil
CREATE  emmanippers04@gmail.com       (EMMA NIPPERS)       cid=3  role_id=viatec_traffic
CREATE  912  (WAYNE NIPPERS)                               cid=3  role_id=viatec_traffic
CREATE  adrianmitchell283@gmail.com   (ADRIAN MITCHELL)    cid=2  role_id=paneltec_civil
CREATE  joshua@paneltec.com.au        (JOSHUA DREW)        cid=2  role_id=admin

Summary: created=6  updated=0  skipped=65
```

Wayne Nippers had no email on his worker record so the fallback used
his simpro_employee_id (912) as the primary key. When his email
gets set in Simpro, a re-run will merge cleanly by
`simpro_employee_id`.

## Post-hotfix state — Users & Permissions role distribution

```
paneltec_civil       32   (was 29 · +3 from Bobby, Brock, Adrian)
viatec_traffic       28   (was 26 · +2 from Emma, Wayne)
admin                16   (was 15 · +1 from Josh)
external_contractor   1
                     ────
                      77
```

**Josh Drew visible in the API response:**
```
joshua@paneltec.com.au  ·  JOSHUA DREW  ·  role_id=admin  ·  status=pending_activation
```

Once he installs the mobile app + completes QR onboarding
(`.132n`), his status flips to `active` and his `mobile_pin_hash`
gets set.

## What's queued for a follow-up ship

- **UI button** on Users & Permissions ("Import from Simpro") that
  invokes the same logic via an API endpoint. Deferred because the
  existing `POST /api/simpro/import-employees` covers 80% of this
  need; the missing 10% (auto-bucket via `.132r` rules) is the
  addition. Wire that endpoint's `--commit` path with the
  `bucket()` helper from the hotfix script.
- **Cron integration**: extend `register_simpro_cron` to
  auto-run this rehydration at the same 06:00 tick, so orphaned
  workers never linger overnight.

## Guardrails
- ✅ No `CACHE_VERSION` bump.
- ✅ No `e1_tester` invocations.
- ✅ Zero pytest regressions (162 tests still green).
- ✅ Script persisted at `/app/backend/scripts/` (survives pod
  restarts).
- ✅ Josh's account created with `activation_status=pending_activation`
  so no login access until he goes through QR onboarding.

## Rollback
```
python -c "
import asyncio, sys; sys.path.insert(0,'/app/backend')
from dotenv import load_dotenv; load_dotenv('/app/backend/.env')
from db import db
async def r():
    n = await db.users.delete_many({'_created_by_hotfix':'v58.13.132r_workers_to_users'})
    print('deleted', n.deleted_count)
asyncio.run(r())
"
```
