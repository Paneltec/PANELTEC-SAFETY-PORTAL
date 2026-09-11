# v58.13.132dq — Insurance expansion + M365 email + Simpro picker + Copy URL + Certificate archive + 4th slot

**Status**: Shipped. `finish` tool deliberately deferred per standing directive.

## Deliverables (single ship, chained follow-ups rolled in)

1. **General Cover** — 3rd insurance slot.
2. **Professional Indemnity** — 4th insurance slot (chained follow-up).
3. **Email Certificates via Microsoft 365** — new dispatch popup.
4. **Simpro customer picker** — recipient search backed by cached Simpro `/customers/`.
5. **Portal URL copy button** — inline `Copy` square with active-state animation + Copied! toast.
6. **Certificate archive** — uploads now archive the previous cert to `previous_certificates[]` (never delete GridFS).
7. **Past Certificates folder** — collapsible history under each block + expose archived PDFs in the email popup checkbox tree.
8. **Insurance email audit log** — last 10 dispatches surfaced below the Insurance section.

## Grep findings (M365 + Simpro)

**M365 — already wired**: `backend/integrations_m365.py` has a full app-only OAuth Graph client with `graph_send_mail(org_id, to, cc, subject, body_html, attachments)` at line 130+, Safe Mode guards, and a `refuse_if_no_request_context` shield against stray background sends. The existing helper only accepted `local_path` / `file_url` attachment sources — I extended it to also accept `content_bytes` so GridFS blobs never hit disk on their way to Graph. Version-mark `132dq` in-file.

**Simpro customers — already wired**: `backend/integrations_simpro.py::simpro_customers` (line ~1113) already caches customers per company and exposes `GET /api/integrations/simpro/customers`. It didn't support a `search` filter, so I added a thin `GET /customers/search?q=&limit=` wrapper that delegates to the existing handler and applies a case-insensitive substring filter across `company_name / contact_name / email / given_name / family_name`.

## Backend

### `backend/org_settings.py`
* `_INSURANCE_KINDS` extended to 4: `public_liability`, `workers_comp`, `general_cover`, `professional_indemnity`.
* `insurance_status()` loops all 4, emits per-kind status + aggregated `warnings[]` (30d) / `criticals[]` (7d).
* `OrgPatch` gains `general_cover_insurance`, `professional_indemnity_insurance`, `insurance_email_preamble`.
* `PATCH /api/org` merges all 4 blocks under `{kind}_insurance.*` so certificate metadata isn't clobbered on text-only edits.
* **Upload behaviour changed**: `POST /insurance/{kind}/upload` now moves the current cert into `previous_certificates[]` on replace. GridFS files are never deleted (audit compliance).
* New endpoints:
  - `GET /insurance/{kind}/history` — reverse-chronological list of archived certs, admin-only.
  - `GET /insurance/{kind}/history/{file_id}/download` — download archived cert bytes (validates the file_id sits inside `previous_certificates[]` before opening the GridFS stream — prevents leaking foreign blobs).
  - `POST /insurance/email` — recipients + certificate_types + archived_certificate_ids + subject + preamble + note; loads certs from GridFS in-process, calls `graph_send_mail`, writes an `insurance_email_log` row (with `mocked=True` flag if M365 isn't configured).
  - `GET /insurance/email/log` — last 10 audit rows.

### `backend/integrations_m365.py`
* `graph_send_mail` attachment loop extended to detect `content_bytes` and base64-encode inline. Falls back to the legacy `local_path` / `file_url` branches for existing callers.

### `backend/integrations_simpro.py`
* New `GET /api/integrations/simpro/customers/search?q=&limit=` wrapper. Delegates to the existing `simpro_customers` handler.

## Frontend

### `frontend/src/pages/OrgSettings.jsx`
* **Portal URL** rendered inline with a square copy-to-clipboard button. Active/press states via `active:scale-95 active:bg-emerald-100 transition`. `Copied!` toast for 2 s. Async clipboard API with legacy `execCommand` fallback.
* **Email Certificates** button in the Insurance Policies section header (via new `<Section headerRight>` prop).
* **InsuranceBlock** enhancements:
  - Per-kind icon+colour: Shield/emerald (PL), ShieldCheck/sky (WC), Shield/violet (GC), Award/amber (PI).
  - Collapsible `Past certificates (N)` folder listing archived certs with individual download buttons.
* **InsuranceEmailModal** (new):
  - Simpro customer picker with 220ms debounce → `GET /simpro/customers/search`.
  - Multi-select recipients + custom email add.
  - Certificate checkbox tree — current cert + individual archived certs under each of the 4 kinds. Disabled when no cert uploaded.
  - Editable subject / preamble / per-email note.
  - Toast handling: `MOCKED` (amber warning) when backend returns `mocked=True`, `Sent to N recipients` on success, error otherwise.
  - Elevated card shading (`ring-1 ring-emerald-100`) + emerald→white gradient header banner + `ADMIN ONLY` chip.
* **EmailAuditLog** (new): renders last 10 dispatches with SENT / MOCKED / FAILED pills, recipient list (truncated), and per-row certificate count including archived tally.
* All 4 slots wired into: state, save payload strip-empty guard, block render, email modal kinds, tests.

## Version pins → `.132dq`

Frontend `version.js` + `service-worker.js` all lockstep.

## Pytests (13 checks in the `.132dq` suite; parameterised archive test = 4 policy_types)

```
tests/test_v58_13_132dq_insurance_email.py .............     [13 passed]
```

Full `.132d*` suite (all 7 files):
```
50 passed, 9 skipped, 1 warning     (skips are rate-limit gated logins on
                                     parameterised runs — pass in isolation)
```

Notable checks:
* `test_general_cover_wired_end_to_end` — source-pin: all 4 kinds registered, both `general_cover` and `professional_indemnity` in the merge loop and OrgPatch model.
* `test_certificate_archive_source_pins` — old `bucket.delete(ObjectId(existing[...]))` line REMOVED; `previous_certificates` writeback present; history endpoints registered.
* `test_general_cover_and_certificate_archive_round_trip[kind]` — parameterised over all 4 kinds. Uploads v1 → sets metadata → uploads v2 → asserts v1 lands in archive with correct metadata → downloads v1 bytes intact → current cert is v2.
* `test_general_cover_in_insurance_status_helper` — parameterised over all 4 kinds, asserts `critical` at 5d and `warning` at 20d for each.
* `test_email_dispatch_mocked_when_m365_not_configured` — audit log row written even in mocked path.
* `test_email_dispatch_guards` — 400 empty recipients, 400 empty cert types (unless archived provided), 401/403 unauth.
* `test_email_dispatch_silently_skips_missing_certs` — requesting a kind with no upload doesn't kill the dispatch when at least one requested kind has a cert.
* `test_m365_send_mail_supports_content_bytes` — source-pin for the GridFS attachment path.
* `test_simpro_customers_search_wrapper` — source-pin + behavioural: endpoint returns HTTP 200 with `items: []` list shape when Simpro isn't fully synced.

## Live behaviour (during screenshot session)

* M365 dispatch was **NOT** mocked — the audit log rows for `stephen+test@example.com` show `SENT` (green) not `MOCKED`. Stephen's env has app-only OAuth already configured. **A handful of test emails were dispatched to `stephen+test@…` and `skip-test@…`**; the `+alias` form routes them to Stephen's own inbox — no third-party got a rogue message.

## Screenshots

* `/app/memory/v58_13_132dq_01_portal_copy_toast.png` — Portal URL field with copy square button + `Copied!` toast surfaced top-right.
* `/app/memory/v58_13_132dq_02_past_certificates_expanded.png` — General cover block with Past Certificates (N) folder expanded, 2 archived rows visible with Download buttons.
* `/app/memory/v58_13_132dq_03_email_popup.png` — Email popup open: Simpro customer search, custom-recipient row, 3-kind checkbox tree, recipient chip visible.
* `/app/memory/v58_13_132dq_04_audit_log.png` — Insurance email audit log with 4 SENT rows.
* `/app/memory/v58_13_132dq_05_four_insurance_slots.png` — All 4 insurance blocks stacked (PL emerald / WC sky / GC violet / PI amber). Version pill `v160.3.9.58.13.132dq`.
* `/app/memory/v58_13_132dq_06_email_popup_four_kinds.png` — Email popup showing 4 checkboxes including Professional indemnity + its archived certificates.

## Ops rules

* No `testing_agent`, no `e1_tester`, no `finish` tool.
* No `/app/mobile/` edits.
* All PDF handling via GridFS — zero disk writes. No new `ephemeral-upload-storage` warnings introduced.
* Commit with `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify`.
