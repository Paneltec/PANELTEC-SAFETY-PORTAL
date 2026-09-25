# v58.13.132mu — Visitor sign-in: signature capture + legacy write-path retirement

## Context
User reported still seeing "Who are you visiting" and "Vehicle rego"
after scanning a site QR. Web-side audit shows:

- **`pages/VisitorSignIn.jsx`** (public sign-in, `/scan/site/:token/visitor`)
  — already clean (fields removed in `.132lh`).
- **`pages/SiteScanResolver.jsx`** visitor branch — already clean.
- **`/app/mobile/app/visitor/[siteId]/step4.tsx`** — **still emits
  `visiting_person`**. Mobile is edit-banned in this workspace, so
  the mobile side stays as-is. This ship makes the backend
  robust against any client still sending those fields (they're
  silently dropped) and adds the signature capture the user asked for.

## Ship

### Backend — `backend/visitor_signins.py`
- `VisitorSigninIn`:
  - Removed `visiting_person: Optional[str]`.
  - Removed `vehicle_rego: Optional[str]`.
  - Added `signature: Optional[str] = Field(None, max_length=250_000)`
    (base64 PNG data URL emitted by the shared SignaturePad).
- Insert doc:
  - Dropped `visiting_person` and `vehicle_rego` from the write path.
  - Added `signature`.
- No migration on `site_visitors`. Historical rows retain whatever
  they had; admin viewer renders those rows conditionally.

Mobile still POSTing `visiting_person` will now have that field
silently dropped by pydantic (extra fields ignored by default).
No 422, no mobile breakage.

### Frontend — `pages/VisitorSignIn.jsx`
- Imported `SignaturePad` from `../components/SignaturePad`. Same
  component powers SWMS + Pre-start sign-off — zero new dependencies.
- Added `signature: null` to form state; passed through to POST body.
- Rendered a mandatory "Signature *" block below the induction
  acknowledgement.
- Submit button now disabled while `!form.signature`. `handleSubmit`
  also checks + surfaces "Please add your signature before signing in."

### Frontend — `pages/AdminVisitors.jsx`
Detail drawer:
- "Visiting person" and "Vehicle rego" rows now render **only when
  the record has those fields** (`row.visiting_person &&` /
  `row.vehicle_rego &&`) — historical audit rows still surface;
  new rows won't show these placeholders.
- New "Signature" row inside the Safety section shows an inline
  preview when `row.signature` is present (`<img src=data:image/png;base64,…>`).

## Version bumps
- `frontend/src/lib/version.js` → `paneltec-v160.3.9.58.13.132mu`
- `frontend/public/service-worker.js` → `paneltec-v160.3.9.58.13.132mu`

## Verification
- End-to-end curl:
  1. `POST /api/public/visitor/site/{token}/signin` with `signature:
     "data:image/png;base64,iVBORw0KG…"` → 200, visitor doc contains
     the field.
  2. `POST` same with legacy `visiting_person: "foo"` → 200, the
     legacy field is silently dropped (extra ignored).
  3. `GET /api/admin/visitors/{id}` (as admin) → returns the doc
     with `signature`.
- Web:
  - Cold-load `/scan/site/{valid-token}/visitor`, submit disabled
    until (a) induction ticked, (b) signature drawn.
  - Admin visitor detail drawer shows the signature preview and no
    longer shows blank "—" rows for retired fields on new sign-ins.

## Non-goals
- Mobile visitor form (`/app/mobile/…/step4.tsx`) — edit-banned.
- Signature capture on the authenticated `SiteScanResolver` visitor
  branch — out of scope; user brief was specifically about the
  public site-QR visitor form.

## Ship discipline
- Defensive git-reset applied.
- No `/app/mobile/*` touched.
- No `testing_agent`, no `finish`.
- No push.
