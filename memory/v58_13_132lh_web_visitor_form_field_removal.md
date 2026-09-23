# v58.13.132lh — Web visitor sign-in: remove host + rego fields

Shipped: 2026-09-23
Scope: `frontend/src/pages/VisitorSignIn.jsx` + version bumps
Author: agent
Mirror of: mobile `.132lg` (shipped in parallel via Expo specialist)

---

## Change

Removed two form fields from the web visitor sign-in flow at `/scan/site/{token}/visitor`:

- **"Who are you visiting?"** (state key `visiting_person`)
- **"Vehicle rego"** (state key `vehicle_rego`)

Kept: Full name (required), Company, Phone, Purpose dropdown, Safety induction checkbox.

## What was touched

1. `useState({...})` — dropped `visiting_person: ''` and `vehicle_rego: ''` from the initial state.
2. Two `<Field>` blocks in the render tree removed (28 lines).
3. Submit path (`api.post('/public/visitor/site/{token}/signin', form)`) — payload is a spread of `form`, so removing the state keys removes them from the payload. No explicit payload edit needed.

## Backend contract

`/public/visitor/site/{token}/signin` accepts the reduced shape — the two fields were already **optional** on the backend `VisitorSignInPayload` model. Backward-compatible: any older client still sending them will continue to work; new web clients simply omit them.

## Verification

**Curl POST with reduced payload:**

```
POST /api/public/visitor/site/uw5w7qQhdaUD/signin
Content-Type: application/json
Body: {
  "name": "Test Visitor .132lh",
  "company": "Test Co",
  "phone": "0400000000",
  "purpose": "Delivery",
  "induction_acknowledged": true
}

→ 200
{"visitor_id":"2b1ea62d4c7843ada2e21948","site_name":"Paneltec Depot","signed_in_at":"2026-09-23T04:59:11.275171+00:00"}
```

**Playwright DOM assertion** on `/scan/site/uw5w7qQhdaUD/visitor` (incognito, 420×900 phone viewport):

```
REMOVED — visitor-visiting-input: 0   visitor-rego-input: 0
KEPT    — name: 1  company: 1  phone: 1  purpose: 1  induction: 1
```

Screenshot saved to `/tmp/visitor_after_132lh.png` — shows the trimmed form with:
- Header "Welcome to Paneltec Depot" + "19 Connector Park Drive"
- Full name * · Company · Phone · Purpose of visit (Contractor default) · Induction checkbox · Sign in button

## Files touched

```
frontend/src/pages/VisitorSignIn.jsx                   (2 edits — state + JSX)
frontend/src/lib/version.js                            (.132lf → .132lh + ship header)
frontend/public/service-worker.js                      (.132lf → .132lh)
memory/v58_13_132lh_web_visitor_form_field_removal.md  (this memo)
```

## NOT touched

- Backend `VisitorSignInPayload` — unchanged (backward-compat).
- Mobile visitor form — already shipped in `.132lg` (parallel actor).
- `/app/mobile/` — untouched (edit ban).
- `MOBILE_BUNDLE_VERSION` — unchanged.
- No push.

## Version skip

`.132lg` is the mobile-side ship (parallel actor). `.132lh` is the web-side mirror. No `.132lg` frontend commit exists on my branch.
