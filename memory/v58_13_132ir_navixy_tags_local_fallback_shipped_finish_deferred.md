# v58.13.132ir — Navixy tags local fallback + Reconnect CTA · SHIPPED (finish deferred)

**Ship phase:** `.132ir`
**Scope:** Fix the "NAVIXY TAGS UNAVAILABLE" empty state on Fleet Register when the Navixy session hash / creds have expired. Local fallback + admin reconnect link.

## Root cause (confirmed live)

`db.integration_configs.kind=navixy` on the Paneltec org:

```
status         : 'error'
last_error     : 'Auth failed: Wrong login or password'
last_tested_at : 2026-09-17T22:53:17Z
vehicles_cache : 72 vehicles (last successful sync)
```

`fleet_navixy_tags.py::_navixy_cfg` returns `None` whenever `status != 'connected'`, so the endpoint short-circuited to `_graceful_empty("Navixy not connected", …)` — empty `items`, empty `distinct_tags`. The vehicles list keeps rendering because `fleet.py::list_register` reads from `db.assets` directly (Navixy sync writes rows there); only the tag filter died.

## What shipped

### Backend `backend/fleet_navixy_tags.py`

Added `_collect_local_tags(org_id)` — scans `db.assets` for every non-retired, non-deleted asset carrying a `tag_label` (Navixy-linked or not) and returns them in the same `(items, distinct_tags)` shape as the live path.

Three call sites now use it:
1. **cfg missing** (Navixy `status != 'connected'`) → return local items + local distinct_tags; suppress the `error` string when locals exist so the FE doesn't flash amber.
2. **cfg incomplete** (missing base URL / hash) → same fallback.
3. **httpx failure** during `/v2/tag/list` + `/v2/tracker/list` → same fallback.

Response now carries `reconnect_hint: "/app/settings/integrations/navixy"` when the failure is reconnect-worthy (i.e. `error` is set), else `null`. FE reads it as an admin CTA.

New response field `tag_list_source: "local_fallback"` marks the fallback path (existing values `"navixy_and_linked"` / `"linked_only"` retained on the happy path).

### Frontend `frontend/src/pages/FleetRegister.jsx`

- Empty-state pill in the tag sidebar now renders a **"Reconnect Navixy →"** deep link (admin-only) when `reconnect_hint` is present, replacing the passive "No Navixy tags yet — vehicles show once tags land in Navixy" copy.
- The amber "⚠ Navixy tags unavailable" chip at the top of the register is now an `<a>` linking to `tagsReconnectHint` — one-tap fix for admins.
- Catch-branch of the load hook always sets `tagsReconnectHint = '/app/settings/integrations/navixy'` so even a network-level failure still surfaces the CTA.

## Behavioural summary

| Scenario                                | Before `.132ir`               | After `.132ir`                                    |
|-----------------------------------------|-------------------------------|---------------------------------------------------|
| Navixy connected + tags load OK         | tags render                   | unchanged                                         |
| Navixy hash expired, locals present     | empty picker + amber warning  | local tags render, no amber, reconnect CTA below  |
| Navixy hash expired, no local tags      | empty picker + amber warning  | empty picker + amber CTA linking to reconnect     |
| Live `/tag/list` 5xx, `/tracker/list` OK| linked-only path (unchanged)  | unchanged                                         |
| httpx timeout / total Navixy outage     | empty picker + amber warning  | local tags render (or CTA if none)                |

## Version pin (lockstep)

- `RUNNING_VERSION`        → `paneltec-v160.3.9.58.13.132ir`
- `EXPECTED_CACHE_VERSION` → `paneltec-v160.3.9.58.13.132ir`
- `CACHE_VERSION` (SW)     → `paneltec-v160.3.9.58.13.132ir`

## Ban compliance

- No `/app/mobile/` edits.
- No pytest / Playwright verify per Stephen's standing rule (2026-09-18).
- Commit: `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify`.

## Follow-up (not blocking)

Actual fix for the underlying Navixy auth failure is credentials-side — Stephen needs to hit `/app/settings/integrations/navixy` and re-enter creds / re-issue a session hash. `.132ir` just stops the tag picker from going empty in the meantime.
