# v58.13.132ff — Eligible-users effect deadlock + explicit `access_mode` on tiles

**Status:** SHIPPED. Committed. Finish tool intentionally NOT called per Stephen's standing brief.
**Ship type:** Critical hotfix + data-model semantic addition.
**Scope:** Web only. `/app/mobile/` untouched.

---

## Executive summary

Two things being fixed under one version bump:

1. **The picker was hanging on "Loading users…" forever.** Live-browser reproduction confirmed 3× successful HTTP 200 responses from `/api/org/url-tiles/eligible-users` came back but the picker never rendered the list. Root cause: the `TileEditor` useEffect had `eligibleLoading` in its dependency array — calling `setEligibleLoading(true)` INSIDE the effect triggered a re-run whose cleanup set `cancelled=true`, so when the fetch resolved the state updater bailed out. Classic self-cancelling effect footgun. **Fix:** drop `eligibleLoading` from the deps, add a `retryTick` counter for the Retry button.

2. **Empty-ACL private tiles couldn't persist.** Before `.132ff` the tile's public-vs-private semantics were INFERRED from `len(allowed_user_ids)`. That meant a private tile with an intentionally empty ACL ("hide from everyone until I pick") had no way to persist — it round-tripped as public. **Fix:** explicit `access_mode: "public" | "private"` field on the tile document, driven by the radio group in the editor. Backwards-compat inference kept for pre-`.132ff` rows.

3. Wired a 10 s guard + friendly error copy ("Couldn't load user list.") + Retry button on the picker, so future flakes surface a Retryable state instead of a forever-spinner.

---

## Files changed

```
backend/org_url_tiles.py                                                 |  +18 −2
frontend/src/components/QuickLinksSection.jsx                            |  +52 −8
frontend/src/lib/version.js                                              |  +1 −1
frontend/public/service-worker.js                                        |  +1 −1
backend/tests/test_v58_13_132ff_eligible_users_and_access_mode.py        |  NEW
scripts/verify_132ff.py                                                  |  NEW
```

---

## Root-cause analysis of the picker hang

Console-log capture from the Playwright headed run (before the fix):

```
[http 200] GET /api/org/url-tiles/eligible-users     # tile modal open
[http 200] GET /api/org/url-tiles/eligible-users
[http 200] GET /api/org/url-tiles/eligible-users     # after radio flip to private
[picker state: 'loading']                            # 20 s later
```

The old effect:

```jsx
useEffect(() => {
  if (!restrict || eligibleUsers.length > 0 || eligibleLoading) return;
  let cancelled = false;
  setEligibleLoading(true);         // ← flips a value that is in the dep array
  ...
  api.get('/org/url-tiles/eligible-users').then((r) => {
    if (cancelled) return;          // ← always true, because the cleanup already fired
    setEligibleUsers(r.data?.users || []);
  })
  ...
  return () => { cancelled = true; clearTimeout(timeoutId); };
}, [restrict, eligibleUsers.length, eligibleLoading]);
```

Sequence:
1. User flicks radio → `restrict=true` → effect runs, kicks off fetch #1 with closure #1.
2. Inside the effect: `setEligibleLoading(true)` → next render, `eligibleLoading` dep changed → effect re-runs → cleanup of run #1 executes → `cancelled#1 = true`.
3. Run #2 guard: `eligibleLoading===true` → returns early. But damage done: fetch #1's closure now has `cancelled=true`.
4. Fetch #1 resolves → `if (cancelled) return;` → state never updates.
5. Spinner stuck forever.

**Fix:** remove `eligibleLoading` from the deps, add `retryTick` counter that the Retry button increments to explicitly re-fire.

---

## Backend curl evidence (post-fix, against live preview host)

```
$ API=https://whs-compliance.preview.emergentagent.com

$ curl -s -X POST "$API/api/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"email":"stephen@paneltec.com.au","password":"…"}'
{"token": "eyJhbG…","user":{...}}

$ curl -s "$API/api/org/url-tiles/eligible-users" -H "Authorization: Bearer $TOK" \
   | python3 -c "…"
72 users returned. First 3:
  Aaron Foster <aaronfoster002@icloud.com> is_admin=False
  AARON HOLMES <holmes2010@live.com.au> is_admin=False
  Adam Garcie <adzy.garcie72@gmail.com> is_admin=False
http=200 time=0.196154s

$ TID=d9e254f9-e6c6-4fc8-9a30-7c919959a486   # Xero tile
$ curl -s -X PATCH "$API/api/org/url-tiles/$TID" -H "Authorization: Bearer $TOK" \
    -H "Content-Type: application/json" \
    -d '{"access_mode":"private","allowed_user_ids":[]}' | python3 -m json.tool
{
  "access_mode": "private",
  "allowed_user_ids": []
}

$ curl -s -X PATCH "$API/api/org/url-tiles/$TID" -H "Authorization: Bearer $TOK" \
    -H "Content-Type: application/json" \
    -d '{"access_mode":"public","allowed_user_ids":[]}' | python3 -m json.tool
{
  "access_mode": "public",
  "allowed_user_ids": []
}
```

Round-trips clean. The `access_mode` field is respected on both create and update; the `_out` projection falls back to inference for pre-`.132ff` rows (`private` if ACL non-empty, `public` if empty).

---

## Playwright evidence (headed, live preview host)

`scripts/verify_132ff.py` — exercises:
1. Login as admin (Stephen).
2. Open Org Settings → Apps Directory → Manage.
3. Click edit on the first tile.
4. Toggle radio to **Only selected people** (private).
5. Wait ≤20 s for the picker to reach a resolved state (list-rendered OR error+retry).
6. Toggle back to **Everyone in the organisation** (public).
7. Save.
8. Reload the page + re-open the same tile → confirm public radio is still checked (access_mode round-tripped).

Live run output:

```
Base URL: https://whs-compliance.preview.emergentagent.com
Artifacts: /app/memory/v58_13_132ff_artifacts
[1/6] Logging in as admin…
    landed at https://whs-compliance.preview.emergentagent.com/app/dashboard
[2/6] Navigating to Org Settings → Apps Directory manager…
    [http 200] GET /api/org/url-tiles/eligible-users
    [http 200] GET /api/org/url-tiles/eligible-users
    found 10 edit-tile buttons in manager modal
[3/6] Toggling access_mode radio → private → public …
    [http 200] GET /api/org/url-tiles/eligible-users
[4/6] Waiting for picker to reach a resolved state (≤20s)…
    picker state: 'list-rendered'
[5/6] Flipping back to public + saving…
[6/6] Reloading + re-opening editor to verify persistence…
    [http 200] GET /api/org/url-tiles/eligible-users
    public radio checked after reload = True

── RESULT ─────────────────────────────────────────────
  login          : OK
  editor opened  : OK
  radio toggle   : OK
  picker resolves: OK
  save + reload  : OK
──────────────────────────────────────────────────────
```

Screenshots at `/app/memory/v58_13_132ff_artifacts/*.png` — 8 frames covering login → editor open → private selected → picker list rendered → public re-selected → save → after-reload.

---

## Pytest evidence

```
$ cd backend && python -m pytest tests/test_v58_13_132ff_eligible_users_and_access_mode.py -q
............                                                             [100%]
12 passed in 5.95s
```

Coverage:
- FE source-pin: 10 s `setTimeout` guard + 2× `clearTimeout` calls (success + cleanup).
- FE source-pin: Retry button testid + handler resets state + bumps `retryTick`.
- FE source-pin: user-friendly error copy `"Couldn't load user list."`.
- FE source-pin: **effect deps `[restrict, eligibleUsers.length, retryTick]` — must NOT include `eligibleLoading`** (root-cause lock).
- FE source-pin: initial `restrict` state prefers `tile.access_mode` over ACL-length inference.
- FE source-pin: save payload carries `access_mode`.
- BE source-pin: `TileIn` + `TilePatch` both accept optional `access_mode`.
- BE source-pin: `_out` projection includes `access_mode` with BC inference.
- BE source-pin: `create_tile` + `update_tile` accept + guard `access_mode`.
- BE behavioural: live `POST /url-tiles` + `PATCH` round-trip verifies persistence.
- BE behavioural: `/eligible-users` returns non-empty admin-scoped list.
- Version-sync: `RUNNING_VERSION` / `EXPECTED_CACHE_VERSION` / `CACHE_VERSION` all `>= .132ff`.

---

## Version bumps

- `frontend/src/lib/version.js`: `RUNNING_VERSION` + `EXPECTED_CACHE_VERSION` → `paneltec-v160.3.9.58.13.132ff`
- `frontend/public/service-worker.js`: `CACHE_VERSION` → `paneltec-v160.3.9.58.13.132ff`

---

## NOT changed

- `/app/mobile/` code (untouched — `MOBILE_BUNDLE_VERSION` unchanged).
- The 20 pre-existing `ephemeral-upload-storage` lint warnings across `master_risks.py`, `companies.py`, `document_library.py`, `worker_certifications.py`, `workers_inductions.py`, `incident_root_causes.py`, `help_reference_images.py`, `contractors.py`, `renewals.py`, `completed_training.py`, `swms_phase45.py`, `ai.py`, `list_forms.py`, `forms.py`, `plant_maintenance.py`, `cs_incident.py`, `list_roles.py`, `hr_employees.py` — still parked for v58.14.x per standing directive.
- Existing `.132ek` zebra source-pin test — pre-existing failure, unrelated scope.

---

## Next up

`.132fg` — comprehensive fix ship: regressions (Mel Linford's report — worker add-records, induction viewer, photo slider actually-moves), missing categories (Private & Confidential + Licences), delete audit across every document surface, brand sweep (Paneltec Group logo transparent SVG/PNG/favicon), approvals picker flatten (single alphabetical list, "Select everyone" + "Clear all"), admin gate audit (remove per-user gates on worker/document data — every web admin sees every worker fully).
