# v58.13.132dp — Organisation Settings expansion (5 items)

**Status**: Shipped. `finish` tool deliberately deferred per standing directive.

## USER PAIN

Stephen's request to promote the Organisation Settings page from a
plain identity form into the WHS compliance "vital signs" hub:

1. Editable slug (was: auto-generated & read-only) + ripple audit + a
   confirm dialog listing every surface the slug is used in.
2. Portal URL rendered on every PDF report footer (audit trail for
   PDF recipients).
3. Seven additional org fields (trading name, emergency contact,
   after-hours contact, website, PL insurance, WC insurance, logo).
4. Insurance expiry warnings: 30-day banner + 7-day critical modal.
5. Visual polish — elevated card + IMPORTANT chip + emphasis banner.

## Slug ripple grep (Item 1 findings)

```
grep -rn "org\.slug\|orgs\.find_one.*slug\|slug.*audit\|slug.*filename" \
  /app/backend/*.py
```

Actual live surfaces that reference `org.slug`:

| File / line | Surface | Notes |
|---|---|---|
| `backend/seed.py:46` + `seed_stephen.py:31` | Dev bootstrap | Hard-coded lookup `db.orgs.find_one({"slug": "paneltec-civil"})` — dev fixture, no user surface. |
| `backend/auth.py:397` | New-org bootstrap | Set once at signup as `org_id[:8]`. Not human-friendly; now editable. |
| **NEW** `backend/org_settings.py` `previous_slugs` | Backward-compat lookup | Preserves every prior slug so old audit exports / renewal links still resolve. |

Audit exports (`backend/exports.py:225,252,393`) use **UUID filenames**
(`{export_id}.pdf`) — NOT org.slug. So renaming the slug doesn't
break any existing audit-export URL. The confirm dialog surfaces
this reality:

- PDF report filenames (org-scoped audit exports)  ← future usage
- Public mobile deep-link handles (`paneltec://o/<slug>/…`)
- Renewal email portal-link paths (`/o/<slug>/renew/…`)
- Historical audit exports (keep old filenames — no rename)
- Backward-compat lookup via `previous_slugs` (auto-preserved)

## Backend

### `backend/org_settings.py`

* `OrgPatch` extended with 8 new fields: `trading_name`,
  `emergency_contact_phone`, `after_hours_contact_name`,
  `after_hours_contact_phone`, `website_url`, `portal_url`,
  `public_liability_insurance`, `workers_comp_insurance`.
* `slug` field added to `OrgPatch` with strict validation
  (`^[a-z0-9]+(-[a-z0-9]+)*$`, 3-40 chars). PATCH auto-preserves
  the old slug into `previous_slugs[]` on change. Uniqueness check
  looks at BOTH `slug` and `previous_slugs` on other orgs so the
  backward-compat window doesn't create a collision.
* `insurance_status(org)` helper: computes per-policy status
  (`ok` / `warning` / `critical`) + aggregates
  `warnings[]` (30 days) and `criticals[]` (7 days or expired).
  Exposed on the GET response as `insurance_status`.
* Portal URL default: `os.environ.get("PUBLIC_APP_URL")` or the
  preview-domain fallback. Auto-populated on GET so orgs that never
  touch settings still have a valid PDF footer link.
* Four new endpoints (Admin-only):
  - `POST /api/org/logo/upload` — GridFS-backed logo (PNG/JPG/WebP).
  - `GET  /api/org/logo/{gridfs_id}` — cache-friendly serve.
  - `POST /api/org/insurance/{policy_type}/upload` — PDF certificate
    (`public_liability` | `workers_comp`).
  - `GET  /api/org/insurance/{policy_type}/download` — cert download.
  - Zero disk writes; all bytes in GridFS metadata-tagged with
    `org_id` + `kind` + `content_type`.

### `backend/pdf_chrome.py`

* `BrandedCanvas._render_chrome` now draws `Portal: <url>` on the
  centre-below of the footer line. Sources `org.portal_url` first,
  falls back to `PUBLIC_APP_URL` env, then the preview-domain
  default — so PDFs rendered by code paths that don't load the org
  doc still carry a valid link. Ripples to every non-form-submission
  PDF (SWMS + pre-start + site-diary + incident + inspection +
  hazard + audit-exports).

## Frontend

### `frontend/src/pages/OrgSettings.jsx` — full rewrite

* **Section 1 — Identity**: name, trading_name, ABN, editable slug
  (with previous_slugs chips visible below), timezone. Slug field
  fires a modal confirm dialog on change (`SLUG_RE` regex checked
  client-side too).
* **Section 2 — Registered address**: unchanged.
* **Section 3 — Contact & emergency**: primary contact + email +
  phone + `emergency_contact_phone` (24/7 safety line) +
  `after_hours_contact_name` + `after_hours_contact_phone` +
  `website_url`.
* **Section 4 — PDF report branding**: `portal_url` (new) + legacy
  `website` + Company logo uploader.
* **Section 5 — Insurance policies**: two blocks (`InsuranceBlock`
  sub-component) with policy_number + expiry_date + PDF upload/
  download button + inline status pill (`ok` / `warning` /
  `critical`).
* **Top-of-page banners** — driven by
  `doc.insurance_status.{warnings, criticals}`. Red banner for
  critical (`org-insurance-critical-*`), amber for warning
  (`org-insurance-warning-*`).
* **Emphasis banner + IMPORTANT chip** —
  `data-testid="org-importance-banner"` /
  `data-testid="org-importance-chip"`. Emerald tint, `Info` icon,
  concise policy statement.
* **Slug confirm dialog** —
  `data-testid="org-slug-confirm-modal"`, ul of affected surfaces
  (`org-slug-surfaces`), Cancel + Continue buttons. Save is blocked
  until the admin explicitly confirms.
* **Elevated cards** — every section uses
  `ring-1 ring-emerald-50/60` + `shadow-sm` for the raised feel.

### `frontend/src/components/InsuranceCriticalModal.jsx` — NEW

* Mounted once inside `AppShell`. Admin-only (silent for other
  roles). Fires when `insurance_status.criticals[]` is non-empty AND
  the current session has not yet acknowledged.
* Session-scoped ack via `sessionStorage`
  (`paneltec_insurance_ack_<org_id>` key) so re-logging in on a
  different org still fires.
* Two dismiss paths: "Remind me later this session" or "Review
  policies" (routes to `/app/settings/org`).
* Non-blocking — doesn't gate any UI, just surfaces the alert.

### `frontend/src/components/layout/AppShell.jsx`

* One line: `<InsuranceCriticalModal />` after the session-timeout
  modal.

## Version pins (lockstep to `.132dp`)

* `frontend/src/lib/version.js` — `RUNNING_VERSION`,
  `EXPECTED_CACHE_VERSION` → `paneltec-v160.3.9.58.13.132dp`.
* `frontend/public/service-worker.js` — `CACHE_VERSION` →
  `paneltec-v160.3.9.58.13.132dp`.
* Mobile untouched. `MOBILE_VERSION_SYNC_OPTIONAL=true git commit
  --no-verify`.

## Pytests

New file: `backend/tests/test_v58_13_132dp_org_settings_expansion.py`
(12 checks, all green):

1. `test_org_settings_source_pins` — endpoints registered,
   GridFS-only, no `UPLOAD_DIR`, all new fields on the model,
   `insurance_status` helper defined.
2. `test_pdf_chrome_footer_renders_portal_url` — `Portal:` line
   present in the source + `PUBLIC_APP_URL` fallback.
3. `test_frontend_org_page_new_shape` — all testids + new field
   keys + `org-field-${f.key}` template.
4. `test_appshell_mounts_insurance_critical_modal` — mount site +
   admin gating + `sessionStorage` ack.
5. `test_three_way_version_sync_at_132dp`.
6. `test_insurance_status_levels` — behavioural: critical at 5d,
   warning at 20d, ok at 180d, ok when no policy.
7. `test_org_patch_new_fields_round_trip` — live PATCH/GET of all
   7 new text fields.
8. `test_slug_edit_validation_and_backward_compat` — uppercase and
   special-char rejected (400); happy-path change persists
   `previous_slugs`; restore round-trip works; cleanup deletes
   `pytest-slug-*` entries to prevent unbounded growth.
9. `test_logo_upload_and_serve_via_gridfs` — round-trip against
   the real backend.
10. `test_insurance_certificate_upload_and_download_gridfs` —
    round-trip for BOTH policy_types with byte-perfect equality.
11. `test_admin_only_guards_on_new_endpoints` — 401/403 without
    auth on PATCH + logo upload + insurance upload.
12. `test_pdf_footer_carries_portal_url` — instruments
    `BrandedCanvas.drawCentredString` and asserts one of the
    captured strings is exactly `Portal: <url>` when a distinctive
    URL is fed into `org.portal_url`.

### Pytest summary — full `.132d*` suite
```
tests/test_v58_13_132dj_navixy_tags_and_txn_reprice.py     [10 passed]
tests/test_v58_13_132dm_navixy_tags_completeness.py        [ 5 passed]
tests/test_v58_13_132dn_local_asset_tag.py                 [ 5 pass, 1 skip]
tests/test_v58_13_132dn_tag_count_consistency.py           [ 6 passed]
tests/test_v58_13_132do_portal_unit_price_policy.py        [ 7 passed]
tests/test_v58_13_132dp_org_settings_expansion.py          [12 passed]
Overall: 44 passed, 2 skipped
```

## Screenshots (verified live)

* `/app/memory/v58_13_132dp_01_critical_modal.png` — Insurance
  action required modal firing on `/app/settings/org` load (PL
  4-day countdown). Red header stripe, list of affected policies,
  "Remind me later this session" + "Review policies" buttons.
* `/app/memory/v58_13_132dp_02_org_settings_page.png` — Full page
  screenshot: red 4-day critical banner, amber 24-day warning
  banner, emerald IMPORTANT chip + emphasis banner, Identity
  section with editable slug + previous_slugs chips, Trading name
  populated, save button visible. Version pill reads
  `v160.3.9.58.13.132dp`.
* `/app/memory/v58_13_132dp_03_slug_confirm_dialog.png` — Slug
  confirm modal open: "Renaming pytest-slug-941f3e →
  paneltec-civil-new-2026 will affect:" followed by 5 bullet points
  covering PDF filenames, mobile deep links, renewal emails,
  historical exports (no-rename), and backward-compat via
  `previous_slugs`. Cancel + Continue buttons.

## NOT changed

* `/api/org` GET response shape — backward-compat for existing
  callers. New fields ADDED; nothing removed.
* Legacy `website` field retained on the model — old form templates
  still consume it.
* Slug auto-generation at signup (`auth.py:397`) — untouched. New
  orgs still get `org_id[:8]`; admins can rename anytime.
* Audit-export filenames — remain UUID-based. Slug rename doesn't
  break any historical URL.
* `/app/mobile/` — untouched. Mobile bundle version unchanged.
* Existing PDF templates — all inherit the Portal footer for free
  via `BrandedCanvas`. No per-template touch required.

## Ops rules

* No `testing_agent`, no `e1_tester`, no `finish` tool.
* No `/app/mobile/` edits.
* All uploads via GridFS — zero disk writes. No new
  `ephemeral-upload-storage` warnings introduced.
* Commit with `MOBILE_VERSION_SYNC_OPTIONAL=true git commit
  --no-verify`.
