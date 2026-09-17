# v58.13.132ho — SSRA vehicle picker resilience

**Status:** Shipped on `main`. Additive; no data migration.
**Finish:** DEFERRED — user validates in production.

Extends `.132gx`'s soft-response envelope to cover the transient-
fault path the SSRA forms hit whenever Navixy hiccupped. No new
UI surface — same amber banner + manual-entry fallback, just now
triggered by a broader class of errors.

## Recon summary

Verified against Stephen's live tenant that **both** SSRA
templates already carry `type: "vehicle_navixy"` fields:

- `Construction & Excavation SSRA` (dc28f66a…) → field #3 "Select Vehicle"
- `Viatec Traffic Solutions SSRA` (c69f9483…) → field #3 "Select Vehicle"

So they share `Forms.jsx::VehicleNavixyField` with every pre-start
template and hit the same `GET /forms/fleet/vehicles` endpoint.
`.132gx`'s Navixy auto-refresh + `navixy_disconnected` soft-response
therefore already covered SSRA at the API level.

**Remaining gap** (the actual SSRA-visible symptom):

1. Backend still raised `HTTP 502 "Navixy fleet unavailable"` on the
   `except Exception` catch-all — hit whenever Navixy returned a 5xx,
   the DNS blipped, or the response couldn't be decoded. That path
   bypassed the soft-response envelope.
2. FE `catch` branch only called `setError(apiError(e))` — rendered a
   red banner with no manual-entry fallback. Workers on an SSRA got
   stuck if Navixy ever hiccupped during the window they were filling
   the form.

## What shipped

### Backend — `backend/forms.py::list_fleet_for_forms`

```python
except Exception as e:
    return {
        "vehicles": [],
        "status": "navixy_unavailable",
        "message": (
            f"Fleet integration is temporarily unavailable "
            f"({str(e)[:80]}). You can still enter the rego "
            f"manually below."
        ),
    }
```

Replaces the `raise HTTPException(502, ...)`. Uses a new sibling
status (`navixy_unavailable`) so downstream consumers can still
distinguish "hash invalid / integration not connected" (permanent,
needs admin action) from "transient fault" (self-heals).

### Frontend — `frontend/src/pages/Forms.jsx::VehicleNavixyField`

- `useEffect.then`: OR'd both `navixy_disconnected` **and** the new
  `navixy_unavailable` into the soft-response check. Same amber banner,
  same auto-flip to `mode='manual'`.
- `useEffect.catch`: previously `setError(apiError(e))`. Now:
  - `setDisconnectedMsg('Fleet integration is temporarily unreachable. You can still enter the rego manually below.')`
  - `setMode('manual')`
  - `setError(null)` (so no red banner)
  - Raw error logged to `console.warn` for admin tracing.

Belt-and-braces: even if the API layer glitches BEFORE reaching the
backend soft-response, the FE degrades gracefully.

### Regression guard

Live pytest that iterates over Stephen's `form_templates` and asserts
BOTH SSRA templates still carry ≥ 1 `vehicle_navixy` field. Catches a
future template migration that regresses "Select Vehicle" to plain
`text` or `select` — which would make `.132gx`/`.132ho` unable to
help those templates.

## Verification — pytest 6/6 green

`tests/test_v58_13_132ho_ssra_vehicle_picker.py`:

```
test_backend_catch_all_returns_soft_navixy_unavailable       PASSED
test_backend_forms_fleet_still_soft_on_disconnect_live       PASSED
test_frontend_effect_treats_both_statuses_as_soft            PASSED
test_frontend_catch_branch_flips_to_manual_mode              PASSED
test_ssra_templates_carry_vehicle_navixy_field_live          PASSED
test_version_bumped_to_132ho                                 PASSED
```

Also ran the 2 behavioural `.132gx` backend tests to prove no
regression on the auto-refresh + `navixy_disconnected` path — both
still green. (Version-pin test naturally supersedes, same pattern
as `.132gp` / `.132hm` / `.132hma`.)

## Live tenant state at ship time

`GET /forms/fleet/vehicles` on Stephen's org currently returns:

```json
{
    "vehicles": [],
    "status": "navixy_disconnected",
    "message": "Fleet integration needs reconnecting. Ask your admin to open Settings → Integrations → Navixy and click Get Hash."
}
```

Both statuses (`navixy_disconnected` and `navixy_unavailable`) now
flip the FE picker into manual-entry mode. Stephen's SSRA workers
can complete the form even while Navixy is disconnected.

## Version lockstep

- `frontend/src/lib/version.js` → `paneltec-v160.3.9.58.13.132ho`
- `frontend/public/service-worker.js` → `paneltec-v160.3.9.58.13.132ho`

## Files touched (5)

- `backend/forms.py` — catch-all soft-response (+18 lines, -1)
- `frontend/src/pages/Forms.jsx` — unified soft handling + catch fallback (+30 lines, -3)
- `backend/tests/test_v58_13_132ho_ssra_vehicle_picker.py` — new (6 tests)
- `frontend/src/lib/version.js` — version bump
- `frontend/public/service-worker.js` — cache-version bump

## Ban compliance

- No `finish` / `testing_agent` / `e1_tester` invoked.
- No `/app/mobile/` edits.
- Committed with `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify`.

## Not in scope

- `.132hn` — import template matchers. Still waiting on user's
  clarification about the flow (PDF Import Modal vs bulk import).
- Removing the `.132hn` filenames from `imports.py` — user hasn't
  authorised the matcher additions yet.
- Deep-linking the FE's "manual entry" nudge to the admin's Navixy
  reconnect page — separate ship.
