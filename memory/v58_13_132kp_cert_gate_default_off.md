# v58.13.132kp — Cert gate default OFF + per-form toggle + White Card seed

## User directive
"Remove access for all forms for all users" — full removal. Every
worker can open every form. Add a per-form toggle for future
re-enablement, auto-grant White Card to all existing workers as a
one-time seed, and expose a visible WHS reminder.

## What shipped

### 1. Global feature flag + per-form toggle
`backend/forms.py`:

- `_global_cert_gate_enabled()` — reads env `FORM_CERT_GATE_ENABLED`
  (accepts `1`/`true`/`yes`/`on`, case-insensitive). Default **OFF**.
- `TemplateIn.certification_gate_enabled: bool = False`
- `TemplatePatch.certification_gate_enabled: Optional[bool] = None`
- `template_access_check` short-circuits to `mode="no_gate"` unless
  BOTH the global env AND the per-template flag are truthy.
- `required_certifications` is preserved in the schema regardless of
  gate state — data survives for future re-enablement.
- Response payload adds `gate_config` block so the FE preview can
  show WHAT would be required if the gate were on.

Combined logic:

| Global env | Template flag | Result |
|:---:|:---:|:---|
| off (default) | anything | `no_gate` (open) |
| on | off | `no_gate` (open) |
| on | on + `required_certifications=[]` | `no_gate` (open) |
| on | on + `required_certifications=[...]` | `gated` (enforced) |

### 2. White Card auto-seed (`backend/white_card_seed.py`)
Runs on every startup. For each org:
1. Pre-fetch every worker_id that already has ANY White-Card-flavoured
   cert (regex: `white[\s_-]*card|construction[\s_-]*induction`, active
   or archived).
2. Iterate `workers` (non-deleted); skip if in the pre-fetch set.
3. Insert placeholder `worker_certifications` row:
   - `name: "White Card (Construction Induction)"`
   - `issue_date: null`, `expiry_date: null`
   - `status: "seeded"` (distinct from `active`/`expired` so admin UI
     can flag placeholders for review)
   - `seeded_via_migration: true`
   - `notes: "Auto-seeded on 2026-09-22 (v.132kp). Admin should verify and update issued/expiry dates. See ship memo v58_13_132kp_cert_gate_default_off.md."`
   - `created_by: "system:migrate:.132kp"`
4. Log per-org line + summary.

**Idempotent.** Second boot skips every worker that got a placeholder
from the first boot (they now have a matching name in the pre-fetch
set).

### 3. Admin toggle (web)
`frontend/src/components/forms/TemplateBuilder.jsx`:
- New `Access control` section above the qualification requirements
  picker.
- Checkbox: *"Require certifications to open this form"* — default
  OFF. Sub-copy: *"OFF by default. Takes effect only when both this
  toggle and the global cert-gate feature flag are enabled."*
- When OFF, the qualification picker is greyed (`opacity-60`) but
  still editable — admins can stage the gate list ahead of a future
  global re-enable.
- Saves via existing PATCH `/api/forms/templates/{id}` with the new
  `certification_gate_enabled` field.

### 4. Amber WHS reminder banner (web Forms page)
`frontend/src/pages/Forms.jsx` — new `WhsReminderBanner` component:
- Renders above the Form Templates toolbar.
- Amber-tinted (`bg-amber-50` + `border-amber-200`), warning-triangle
  glyph, headline "Australian WHS Reminder", body copy explaining the
  White Card requirement + how to re-enable in-app enforcement.
- Dismissible per-user via localStorage
  (`whs_reminder_dismissed_at`). Reappears after 7 days so new
  workers still see it.
- Rendered for both admins and workers — awareness is the point.

### 5. Mobile home banner — SKIPPED
Per the brief's escape clause ("If it requires deeper mobile
navigation changes, SKIP this and note it as a follow-up for the
Expo specialist"). Mobile Docs / Forms tabs live under the strict
`/app/mobile/` edit ban. Follow-up recorded below.

## Verification

### Migration report
```
[migrate-white-card] org=3116f250-a4eb-43f3-98a5-2a3656d6cb63 seeded=44 skipped_existing=25
[migrate-white-card] summary: orgs=1 seeded=44 skipped_existing=25
```
Second boot (idempotence check):
```
[migrate-white-card] org=3116f250-a4eb-43f3-98a5-2a3656d6cb63 seeded=0 skipped_existing=69
[migrate-white-card] summary: orgs=1 seeded=0 skipped_existing=69
```
44 + 25 = 69 = every worker in Paneltec Civil now has a White Card
record (25 already had a real one; 44 got a placeholder).

### Gate paths (curl vs preview worker JWT)
Test template `5be3bfbc-955c-4ab0-be95-e1306ec19ce5` seeded with
`required_certifications=["white_card"]`.

| Case | Template toggle | Global env | Result |
|---|---|---|---|
| A | off | unset (default) | `{"ok": true, "mode": "no_gate", "gate_config": {"global_enabled": false, "template_enabled": false, "required_certifications": ["white_card"]}}` |
| B | on | unset (default) | `{"ok": true, "mode": "no_gate", "gate_config": {"global_enabled": false, "template_enabled": true, "required_certifications": ["white_card"]}}` |
| C | on | `FORM_CERT_GATE_ENABLED=1` | `{"ok": false, "mode": "gated", "required": [{"slug":"white_card","status":"missing","expiry_date":null}]}` |

Case A + B confirm the "default OFF" posture regardless of
per-template flag. Case C confirms the toggle works when the global
env is flipped — enforcement path is intact for future re-enable.
Cleanup applied at end of test (env removed from `.env`, template
reverted).

### Non-regression — user profile / certifications UI
White Card placeholder rows carry the same schema shape as real
records (id, org_id, worker_id, name, issue_date, expiry_date,
notes, created_at, updated_at, deleted_at=None) plus two extra
sentinel fields (`status: "seeded"`, `seeded_via_migration: true`).
Any admin surface that renders `worker_certifications` will show
these rows with the placeholder label — no separate UX work needed
for the ship memo.

## Files touched
- `backend/forms.py`
  - Added `import os` at the top (needed by `_global_cert_gate_enabled`).
  - Added `_global_cert_gate_enabled()` helper.
  - Extended `TemplateIn` with `certification_gate_enabled: bool = False`.
  - Extended `TemplatePatch` with `certification_gate_enabled: Optional[bool] = None`.
  - `template_access_check`: short-circuits when either flag off; emits `gate_config` in the payload.
  - `create_template`: persists the new flag.
  - `update_template`: honours PATCH of the new flag.
- `backend/white_card_seed.py` (new). Idempotent seed, per-org + summary log lines.
- `backend/server.py`: startup hook calls `seed_white_card_on_startup()` (best-effort, non-fatal).
- `frontend/src/components/forms/TemplateBuilder.jsx`: new `Access control` toggle above the cert picker; picker greys when toggle is off; save payload includes the flag.
- `frontend/src/pages/Forms.jsx`: added `WhsReminderBanner` component + rendered above the templates toolbar.
- `frontend/src/lib/version.js` — `RUNNING_VERSION` + `EXPECTED_CACHE_VERSION` bumped `.132kn → .132kp`.
- `frontend/public/service-worker.js` — `CACHE_VERSION` bumped `.132kn → .132kp`.

## NOT changed
- `/app/mobile/` — untouched. The mobile client already calls
  `/access-check` before opening a form; since the endpoint now
  returns `mode: "no_gate"` by default, existing mobile UI paths
  route straight to the form runner. No mobile code needs a change
  for the disable to take effect.
- `GATE_BYPASS_ROLES` (`admin`, `hseq_lead`) — unchanged.
- `cert_kinds.py`, `worker_certifications` schema, `permissions.py` —
  no touches.
- No new indexes on `worker_certifications` (the seed uses the
  existing `org_id + name + worker_id` query shape).

## Legal note — AU WHS Regulation 316A
> "A person conducting a business or undertaking must ensure that any
> worker who is to carry out construction work at a workplace has
> been provided with general construction induction training…"
> — Model WHS Regulations, Reg 316A (General construction induction training).

The user directive to disable in-app cert gating is a UX decision,
NOT a compliance opt-out. Workers must still hold current
certifications before undertaking regulated work; the app trusts the
supervisor process for that verification. The amber banner + seeded
placeholders keep the compliance audit trail visible.

## Re-enabling the gate (runbook)
1. **Global switch:** add `FORM_CERT_GATE_ENABLED=1` to
   `/app/backend/.env`, restart backend (`sudo supervisorctl restart backend`).
2. **Per-form switch:** admin opens the template in TemplateBuilder →
   ticks "Require certifications to open this form" under
   `Access control` → picks slugs in the qualification requirements
   picker → Save.
3. Forms without either flag stay open. Forms with both flags PLUS a
   non-empty `required_certifications` array enforce the gate.

## Follow-up candidates
1. **Mobile home / Forms tab banner** — mirror the amber WHS
   reminder on the mobile client. Blocked on `/app/mobile/` edit
   ban lift; likely lands with the specialist's next mobile ship.
2. **Admin dashboard: cert-status audit widget** — surface the
   count of workers whose White Card is `status: "seeded"` (i.e.
   admin has NOT yet filled in real dates). Actionable list ordering
   for supervisors.
3. **Bulk admin action** — "Import White Cards from CSV" so a
   supervisor with a spreadsheet can fill 44 placeholders in one go
   instead of clicking through each worker.
4. **Automatic status transition** — a worker whose seeded White
   Card is later updated with real `issue_date` should have
   `seeded_via_migration` flipped to False and `status` recomputed
   by the standard cert lifecycle. Currently done on save via the
   worker cert PATCH; verify parity.

## Diagnostic recipe
1. Worker reports "form asks for certifications on open" →
   check env: `grep FORM_CERT_GATE_ENABLED /app/backend/.env`.
   If present and truthy, the global switch is on.
2. Admin toggled a per-form flag ON but forms still open freely →
   confirm global env matches step 1.
3. Curl the endpoint to inspect the raw decision:
   `curl -H "Authorization: Bearer $TOK" $URL/api/forms/templates/<id>/access-check`.
   `mode: "gated"` means enforcement fired; `mode: "no_gate"` with
   `gate_config.global_enabled: false` means the global env is
   still off.
