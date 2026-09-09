# v58.13.AUDIT — Full platform truth report

Snapshot taken **2026-09-07** (post `.132s` + `.132t` ship).
Read-only. Evidence = live Mongo counts + code file:line. No
fixes proposed here — this is a facts document. Sort/prioritise
separately.

**Rev 2** — Refreshed after `.132t` shipped:
- Row #13 (fuel data missing cost) now **PROVISIONAL** — all 547
  rows carry `price_source="provisional_static_3.00"` @ $3.00/L.
- Row #16 (Fuel Reports $0.00) now **WORKS-WITH-PROVISIONAL-MARKER**
  — totals reflect L × $3.00, `has_provisional=true` flag exposed,
  amber banner + asterisks rendered.

**Corpus scope:**
- Frontend: **67 top-level page files** in `frontend/src/pages/`, plus
  ~5 nested detail pages (SwmsList/New/Detail, SiteDetail, etc.),
  wired into React Router at `frontend/src/App.js` — ~80 `<Route>` entries.
- Backend: **124 Python modules** in `backend/`, of which **111
  routers** are `include_router`-mounted in `backend/server.py`.
- Database: **131 collections**, 16 orgs, 83 users, 73 workers, 4 roles.

---

## 1 · Module inventory

### Auth & Users
| Frontend | Backend router | Collections | Notes |
|---|---|---|---|
| `/login` (`Login.jsx`) | `auth.py` | `users`, `active_sessions`, `session_history` (2 405) | JWT via `/api/auth/login`, 15-min lockout, `activation_status='pending_activation'` 403 gate |
| `/signup` (`Signup.jsx`) | — | | Signup UI exists; backend `POST /users` is 410 (deprecated). Signup effectively DEAD. |
| `/onboard?token=…` (`Onboard.jsx`) | `auth_invite.py` | `mobile_onboarding_tokens` (57) | Real invite-redemption flow |
| `/reset` (`ResetPasswordPage`) | `auth_invite.py` `/reset-password` | | Works |
| `/app/settings/users` (`UsersManagement.jsx`, 3068 loc) | `users.py`, `permissions.py`, `roles_catalogue.py` | `users`, `roles` (4), `user_permissions` (12), `role_forms` (1) | Set-password, bulk-assign-role, disable, forced-admin unlock |
| `/app/settings/permission-presets` (`PermissionPresetsAdmin.jsx`) | `permission_presets.py` | `permission_presets` (7) | |
| Roles admin tab | `roles_catalogue.py` | `roles`, `role_audit` (433), `role_migration_log` (64) | Post-`.132s` collapsed to 4 target roles |
| `/scan/worker/:token` (`WorkerScanResolver.jsx`) | `workers_qr.py`, `qr_common.py` | `workers` | QR sign-on |

### Fleet, Fuel & Sites
| Frontend | Backend router | Collections | Notes |
|---|---|---|---|
| `/app/fleet` (`FleetRegister.jsx`) | `fleet.py`, `assets.py` | `assets` (131), `asset_meter_history` (5 176), `asset_service_records` (63), `asset_service_schedules` (6) | 131 assets, active |
| `/app/fleet/fuel` (`FuelReporting.jsx`) | `fleet_fuel_reports.py`, `fleet_fuel.py`, `fleet_fuel_enrich.py` | `fuel_transactions` (547), `fuel_import_batches` (3), `fuel_report_emails_sent` (1) | 547 fills; **0 with cost** (`.132t` open) |
| `/app/fleet/fuel/anomalies` (`FuelAnomalyInbox.jsx`) | `fleet_fuel.py` R1–R7 rules | `fuel_transactions.anomaly_flags` | 8 rules active |
| `/app/vehicles-legacy` (`Vehicles.jsx`) | — | `vehicles` (0) | Legacy; empty collection, page redirects to `/app/fleet` |
| `/app/sites` (`SitesAdmin.jsx`) | `sites_qr.py`, `sites_signon_v127.py` | `simpro_sites` (17), `site_signins` (53), `site_signons` (9), `site_visitors` (14), `site_sign_ins` (2 stale) | |
| Site diary | `SiteDiary.jsx` | via `forms.py` `?applies_to=site_diary` | `site_diary_entries` (28) |

### SWMS, Pre-Starts, Hazards, Incidents, Inspections
| Frontend | Backend | Collections | Notes |
|---|---|---|---|
| `/app/swms` (`Swms.jsx` + nested) | `swms_extras.py`, `swms_phase45.py` | `swms` (33), `form_templates` (139, includes SWMS templates) | 33 SWMS docs |
| `/app/pre-starts` (`PreStarts.jsx`) | `bulk_import_prestarts.py`, `forms.py` | `pre_starts` (**16 490**) | Highest-volume module |
| `/app/hazards` (`Hazards.jsx`) | `forms.py` (?applies_to=hazard) | `hazards` (22) — bare + `form_submissions` join | Hazard fields include `ai.py` photo classify |
| `/app/incidents` + `/app/submissions/cs-incidents` | `cs_incident.py` | `incidents` (13), `cs_incident_issues` (254) | |
| `/app/inspections` | `forms.py` | `inspections` (19) | |
| Root-cause / master-risks / list-forms / list-roles / completed-training | tabs | `master_risks` (268), `list_forms` (102), `list_roles` (75), `completed_training` (31), `incident_root_causes` (75) | Reference data + audit trails all populated |

### Forms platform
| Frontend | Backend | Collections | Notes |
|---|---|---|---|
| `/app/forms` (`Forms.jsx`) + `/app/forms/templates/:id/submissions` (`FormSubmissions.jsx`) | `forms.py` (1300+ loc), `forms_pdf.py`, `forms_pickers.py` | `form_templates` (139), `form_submissions` (**16 102**), 6 backup collections | Form platform is the workhorse |
| `/app/settings/form-assignments` (`FormAssignmentsAdmin.jsx`) | `form_assignment_notifier.py`, `forms.py` | `form_assignment_notifications` (186) | |
| `/app/settings/swms-assignments` (`SwmsAssignmentsAdmin.jsx`) | `swms_extras.py` | | |

### Compliance, Documents, Contractors, Suppliers, Workers
| Frontend | Backend | Collections | Notes |
|---|---|---|---|
| `/app/contractors` (`Contractors.jsx`) | `contractors.py` | `contractors` (31), `companies` (64) | |
| `/app/suppliers` (`Suppliers.jsx`) | `suppliers.py`, `supplier_panels.py` | `supplier_members` (3), `supplier_meta` (2), `supplier_notes` (3), `supplier_tasks` (3), `simpro_suppliers` (500) | Sparse — most data upstream in Simpro |
| `/app/settings/workers` (`Workers.jsx`) | `workers.py`, `workers_qr.py`, `workers_inductions.py`, `worker_certifications.py` | `workers` (73), `worker_certifications` (890), `worker_hr_documents` (149), `worker_change_log` (13) | |
| `/app/document-library` (`DocumentLibrary.jsx`) | `document_library.py`, `document_categories.py` | `doc_files` (372), `doc_folders` (113), `document_categories` (2) | |
| `/app/renewals` (`Renewals.jsx`) + `/renew/:token` (`PublicRenewal.jsx`) | `renewals.py` | `renewal_links` (15), `renewal_doc_types` (7), `cert_reminders_sent` (45) | |
| `/app/audit-exports` (`AuditExports.jsx`) | `exports.py` | `audit_exports` (14), `audit_logs` (786) | |

### Ask · AI
| Frontend | Backend | Collections | Notes |
|---|---|---|---|
| `/app/ask` (`Ask.jsx`) | `ask.py` | `ask_history` (6), `ask_suggestions` (13), `ai_usage` (9) | Very low usage (9 calls to date) |
| Hazard photo classify (in-flow) | `ai.py` | `ai_usage` | On hazard submit; uses OpenAI (not Claude) |

### Integrations
| Frontend | Backend | Collections | Live status |
|---|---|---|---|
| `/app/settings/integrations` (`Integrations.jsx`) | `integrations.py` | `integration_configs` (9) | Hub |
| `/app/settings/integrations/simpro` (`SimproAdmin.jsx`) | `integrations_simpro.py`, `integrations_simpro_workers.py`, `simpro_import_users.py`, `simpro_zip_import.py`, `cron_simpro_delta.py` | `simpro_jobs` (500), `simpro_licence_mapping` (242), `simpro_import_audit` (4), `simpro_suppliers` (500), `simpro_sites` (17) | **UP** · last call 70d ago · 466 records cached |
| `/app/settings/integrations/navixy` (`NavixyAdmin.jsx`) | `asset_navixy_sync.py`, `asset_navixy_dashboards.py` | `assets.navixy_*` | **UP** · 72 assets synced · 4m ago |
| `/app/settings/integrations/microsoft365` (`Microsoft365Admin.jsx`) | `integrations_m365.py` | | **DOWN — Disarmed by Comms Safe Mode** |
| `/app/settings/integrations/textmagic` (`TextMagicAdmin.jsx`) | `integrations_textmagic.py` | `pending_sms_dispatches` (0) | **DOWN — Disarmed by Comms Safe Mode** |
| SmartFill (no dedicated admin page) | `integrations_smartfill.py`, `cron_smartfill_auto_sync.py`, `fleet_fuel.py` | | Post-`.132s` auto-sync ON, cursor `2026-09-07` |
| Comms Safe Mode | `/app/settings/comms-safe-mode` (`CommsSafeMode.jsx`) | `comms_safe_mode.py`, `admin_safe_wrapper.py` | `comms_outbox_blocked` (0), `outbound_emails` (269) | ON at org level |

### Comms
| Feature | Backend | Collections | Notes |
|---|---|---|---|
| Email (Microsoft 365 Graph API) | `integrations_m365.py`, `email_outbox.py` | `email_outbox` (0), `outbound_emails` (269) | No Resend/SendGrid — M365 is the mail backend |
| SMS (TextMagic) | `integrations_textmagic.py` | `pending_sms_dispatches` (0) | Queue empty |
| `/app/outbox` (`Outbox.jsx`) | `email_outbox.py` | `email_outbox` | Displays queued mail |

### Admin & Settings
| Frontend | Backend | Notes |
|---|---|---|
| `/app/settings/org` (`OrgSettings.jsx`) | `org_settings.py` | `org_settings` (6), `orgs` (11) |
| `/app/settings/workspaces` (`Workspaces.jsx`) | `workspaces.py` | `workspaces` (16) |
| `/app/settings/backup` (`BackupTab.jsx`) | `backup_service.py` | `bk_agents` (1), `bk_snapshots` (34), `bk_agent_logs` (13 011), `bk_fs.files` (12) |
| `/app/settings/system` (`SystemSettings.jsx`) | `admin_active_sessions.py`, `admin_purge_test_data.py`, `session_timeout.py` | `session_timeout_settings` (2), `active_sessions` (345) |
| `/app/settings/certifications` (`Certifications.jsx`) | `cert_kinds.py` | `cert_kinds` (205) |
| `/app/settings/imports` (`AdminImports.jsx`) | `imports.py`, `bulk_import_prestarts.py`, `simpro_zip_import.py` | `bulk_import_jobs` (13), `bulk_import_pdf_cache` (9 744) |

### Mobile
| Frontend | Backend | Notes |
|---|---|---|
| No mobile-preview iframe in web codebase | `mobile_auth.py`, `mobile_home.py`, `mobile_modules.py`, `mobile_modules_data.py`, `mobile_sites.py`, `mobile_preview.py`, `mobile_daily_jobs.py` | 7 routers back the Expo app at `/app/mobile/` |
| No admin mobile-simulator page | `mobile_preview.py` present | Endpoint exists — used by Expo, not web |

### NOT PRESENT in code (mentioned in user brief but absent)
- **Toolbox / Plaud audio** — zero references. `grep -rlnE "plaud|toolbox|meeting.*transcript|audio.*transcribe"` returns nothing. Feature is undocumented / never built.
- **Resend / SendGrid** — no client. All email goes via Microsoft 365 Graph.
- **Claude / Anthropic Vision** — no references. Only OpenAI used (via `ai.py`, `swms_phase45.py`).
- **`vehicles` collection** — 0 rows; legacy page redirects to `/app/fleet`.

---

## 2 · Per-feature table

Status legend: **WORKS** · **BROKEN** · **MOCKED** · **STUB** · **ORPHANED** · **UNKNOWN**

| # | Feature | Expected | Actual | Status | Evidence | Priority |
|---:|---|---|---|---|---|---|
| 1 | Login (JWT) | Admin logs in, gets JWT, session tracked | End-to-end verified this session | WORKS | `auth.py:400-475`; live curl 200 with token | — |
| 2 | Login blocks pending_activation | Explicit 403 with `activation-pending` header | Verified | WORKS | `auth.py:441-445` | — |
| 3 | Login lockout after failed attempts | 15-min lockout window | Present | WORKS | `auth_lockout.py`, `auth.py:426-430` | — |
| 4 | User activation via admin set-password | Bumps token_version, flips status→active | Verified | WORKS | `users.py:548-587`; used by `.132s` migration | — |
| 5 | Invite email flow (`POST /users/{id}/invite`) | Generates token + emails plaintext link | Token stored; M365 send disarmed by Safe Mode; **plaintext link never surfaced in response** | BROKEN under Safe Mode | `auth_invite.py:188-232` | P1 |
| 6 | Signup page | Public self-signup | UI exists; backend `POST /users` returns 410 | ORPHANED | `Signup.jsx`; `users.py:535-541` | P3 |
| 7 | Must-change-password guard | Non-dismissable modal on first login | Client-side gate exists; verified in `.132s` pytest | WORKS | `frontend/src/components/auth/AuthBundle.jsx:141-157` | — |
| 8 | 4-target role model | Only admin/paneltec_civil/viatec_traffic/external_contractor exist | 4 rows in `roles` | WORKS | `db.roles.count_documents({}) == 4` | — |
| 9 | Simpro sync — create user | New Simpro import lands in one of 4 targets | Flag on; 3 call sites patched | WORKS (post-`.132s`) | `simpro_import_users.py:390-431`; `SIMPRO_POSITION_ROLES_DISABLED=true` | — |
| 10 | Simpro sync — delta position update | Position updates on user; role stays sticky | Verified | WORKS (post-`.132s`) | `simpro_import_users.py:504-528` | — |
| 11 | Simpro ZIP import (worker docs) | Bulk-upload zip → workers + photos | Present, unverified this session | UNKNOWN | `simpro_zip_import.py`; requires runtime probe | — |
| 12 | SmartFill CSV import | CSV upload → `fuel_transactions` rows | Verified — 547 rows landed | WORKS | `fleet_fuel.py:_import_csv`, `.131n` upsert | — |
| 13 | SmartFill CSV cost data | Total Price column populates `total_price` | 547 rows currently @ provisional `$3.00/L` (`price_source="provisional_static_3.00"`) after `.132t` back-fill. Real prices land via CSV re-upload; upsert clears flag. | WORKS (provisional) | `.132t` script executed; `db.fuel_transactions.count_documents({"price_source":"provisional_static_3.00"})==547` | P1 |
| 14 | SmartFill API auto-sync | Cron pulls new transactions daily | Enabled + cron registered; not yet fired since flip | UNKNOWN | `cron_smartfill_auto_sync.py`; `auto_sync_enabled=True`, `cursor=2026-09-07` | P2 |
| 15 | SmartFill manual sync endpoint | `POST /fleet/fuel/sync-smartfill` fetches Transactions:Read | Endpoint exists; last run inserted 0 of 1 rows | BROKEN | `fleet_fuel.py:1308+`; `last_batch_summary.rows_inserted=0` | P1 |
| 16 | Fuel Reports (per-vehicle) | Table of L, $, $/L per vehicle | Renders correctly with provisional data: `total_price=134508.18`, `dpl=$3.000*` (asterisked). Amber banner shown. `has_provisional=true` in API totals. | WORKS (provisional) | `curl` verified live; `AssetFuelTab.jsx` per-row $/L column added `.132t` F-A | P1 |
| 17 | Fuel anomaly inbox | R1–R7 rules flag suspicious fills | Rules run at ingest; inbox displays flags | WORKS | `fleet_fuel.py`; `fuel_transactions.anomaly_flags` populated | — |
| 18 | Fuel card → attribution | Card mapped to vehicle or worker | 91% auto (rego match); 8 orphan cards | PARTIAL | See `.132u` discovery memo | P2 |
| 19 | Fleet register | 131 assets; edit, view maintenance | Loaded | WORKS | `assets.py`; `db.assets.count()==131` | — |
| 20 | Navixy GPS sync | Vehicles get live position | 72 synced, last sync 4m ago | WORKS | `/api/health/integrations` | — |
| 21 | Navixy trip summary | Per-asset trip aggregation | Present | WORKS | `asset_trip_summary.py` | — |
| 22 | Asset meter history | 5 176 meter readings tracked | Populated | WORKS | `asset_meter_history` collection | — |
| 23 | SWMS list + view | Show 33 SWMS docs | Present | WORKS | `swms` collection (33) | — |
| 24 | SWMS acknowledgement / seen-at trail | Server-side tracking | Not implemented (per earlier session notes) | STUB | Search: no `swms_ack*` or `swms_seen*` collection | P2 |
| 25 | SWMS PDF generation | Render SWMS to PDF | Present, verified indirectly (font warnings absent) | UNKNOWN | `pdf_renderer.py`, `swms_phase45.py:391` | — |
| 26 | Pre-starts bulk import | Upload CSV → 16 490 rows | Very high volume — working | WORKS | `pre_starts` (16 490) | — |
| 27 | Pre-starts submission UI | Web form for pre-start | Present | WORKS | `PreStarts.jsx` | — |
| 28 | Hazards list + submit | Report a hazard | 22 rows; UI present | WORKS | `hazards` (22) | — |
| 29 | Hazard photo AI classify | OpenAI vision on hazard photo | `ai.py` present; 9 `ai_usage` total | WORKS (rare) | `ai.py`, `ai_usage` count 9 | — |
| 30 | Incidents (CS incidents) | 13 open incidents | Present, active | WORKS | `incidents` (13), `cs_incident_issues` (254) | — |
| 31 | Inspection reports | 19 inspections | Present | WORKS | `inspections` (19) | — |
| 32 | Forms platform — templates | 139 form templates | Present | WORKS | `form_templates` (139) | — |
| 33 | Forms platform — submissions | 16 102 submissions | Highest-volume table | WORKS | `form_submissions` (16 102) | — |
| 34 | Site sign-on QR | Worker scans QR → sign-in row | 53 signins live | WORKS | `sites_qr.py`, `site_signins` (53) | — |
| 35 | Visitor sign-in (public) | `/scan/site/:token/visitor` route | 14 visitors captured | WORKS | `visitor_signins.py`, `site_visitors` (14) | — |
| 36 | Contractors register | 31 contractors, 64 companies | Present | WORKS | `contractors` (31) | — |
| 37 | Suppliers register | Read from Simpro | 500 suppliers cached; 3 local members | PARTIAL | `suppliers.py`, `simpro_suppliers` (500) | P3 |
| 38 | Renewals + public renew | Cert renewal links | 15 links, 45 reminder sends | WORKS | `renewal_links` (15) | — |
| 39 | Renewal reminder email | Auto-email on cert expiry | Blocked by Safe Mode ON | BROKEN (deliberate) | `worker_certifications.py`, safe mode gate | — |
| 40 | Document library | Doc upload + folder tree | 372 files, 113 folders | WORKS | `doc_files` (372) | — |
| 41 | Document library storage | Files stored where? | Local disk (`uploads/document_library`) | BROKEN for prod deploy | `document_library.py:423`; ephemeral-storage lint warning parked for v58.14.x | P2 |
| 42 | Audit exports | Generate compliance export packs | 14 exports run | WORKS | `audit_exports` (14) | — |
| 43 | Ask AI | Natural-language query over compliance data | 6 questions asked total | WORKS (low usage) | `ask.py`, `ask_history` (6) | — |
| 44 | Comms Safe Mode toggle | Org-level flag, admin can flip | Verified via `/api/health/integrations` | WORKS | `comms_safe_mode.py`; org setting `on` | — |
| 45 | Email outbox display | Show queued mail | 0 queued; 269 sent historic | WORKS | `outbound_emails` (269), `email_outbox` (0) | — |
| 46 | Microsoft 365 send | Graph API sendMail | Disarmed by Safe Mode | BROKEN (deliberate) | `integrations_m365.py`; health integ status `down/disarmed` | — |
| 47 | TextMagic SMS send | HTTP API + STOP webhook | Disarmed by Safe Mode; STOP handler not built | STUB (STOP) | `integrations_textmagic.py`; queue empty | P1 |
| 48 | pending_sms_dispatches drainer | Web admin can send/reject queued SMS | Collection exists but empty; UI not built | STUB | Search: no drainer UI/route found | P2 |
| 49 | Toolbox / Plaud audio | Meeting → transcript → action items | **Zero code refs** | ORPHANED (never built) | grep for `plaud|toolbox` returns 0 | P3 |
| 50 | Mobile onboarding token | Worker QR → set-password | 57 tokens issued | WORKS | `mobile_onboarding_tokens` (57), `Onboard.jsx` | — |
| 51 | Mobile preview iframe | Web admin previews Expo experience | Route `/api/mobile/preview` exists; **no web page hosts it** | ORPHANED | `mobile_preview.py` present; no frontend iframe consumer | P3 |
| 52 | Mobile modules (worker/supervisor/contractor) | Per-role module allow-list | Persisted per org | WORKS | `org_settings.mobile_modules` | — |
| 53 | Category-first form flow | Mobile form nav by category | UNKNOWN — Expo-side | UNKNOWN | Requires Expo runtime probe | — |
| 54 | Review-before-submit | Mobile confirms before POST | UNKNOWN — Expo-side | UNKNOWN | Requires Expo runtime probe | — |
| 55 | Backup service (mongodump agent) | Nightly bson snapshot | 34 snapshots on file; 13 011 agent logs | WORKS | `backup_service.py`; `bk_snapshots` (34) | — |
| 56 | Session history | Per-session audit trail | 2 405 rows | WORKS | `session_history` (2 405) | — |
| 57 | Permission presets | Named permission bundles | 7 presets | WORKS | `permission_presets` (7) | — |
| 58 | Bulk-permissions edit | Apply preset to many users | Present | WORKS | `bulk_permissions.py` | — |
| 59 | Legacy `vehicles` collection | Predecessor to `assets` | 0 rows; redirect in place | ORPHANED | `db.vehicles.count()==0`; `App.js:318 LegacyVehiclesRedirect` | P3 |
| 60 | Legacy `contractors-legacy` route | Same target as `/app/contractors` | Both routes → `ContractorsList` | ORPHANED (route) | `App.js:288` | P3 |
| 61 | 7 `form_templates_backup_*` collections | Historic backups from prior migrations | 27–48 docs each | ORPHANED (data) | 7 collections × ~40 rows; never read at runtime | P3 |
| 62 | `sites_signon_v127.py` vs `sites_qr.py` | Overlap? | Both mounted; separate concerns (visitor vs worker) | WORKS | | — |
| 63 | `dashboard.py` + `dashboards.py` | Are these duplicates? | Two distinct files: `dashboard.py` = file serving; `dashboards.py` = Phase 4.17 module-dashboards aggregator | WORKS | `dashboards.py` docstring `Phase 4.17 v134.x` | — |
| 64 | 30 backend `.py` files not referenced in `server.py` | Are they orphans? | Most are helpers imported by other backend files; only 5 are true orphans (see §4) | PARTIAL | See §4 | — |
| 65 | `_civil_health_probe` collection (0 rows) | Health-check dummy? | Never written | ORPHANED (data) | Collection exists empty | P3 |
| 66 | `audit_log` (singular, 0 rows) vs `audit_logs` (plural, 786 rows) | Collision? | Legacy singular is unused | ORPHANED (data) | `audit_log` (0) vs `audit_logs` (786) | P3 |
| 67 | `daily_job_assignments` (0 rows) | Feature never went live? | Backend router `mobile_daily_jobs.py` exists | ORPHANED (data) | Collection empty despite router mounted | P2 |
| 68 | `bulk_import_dryrun` (0 rows) | Feature abandoned? | Never populated | ORPHANED (data) | | P3 |
| 69 | `worker_import_snapshots` (25) | Simpro ZIP snapshot history | Populated, actively growing | WORKS | | — |
| 70 | `worker_unmatched_documents` (26) | Simpro ZIP orphan doc queue | Populated | WORKS | | — |

---

## 3 · Top 10 fires

**Rev 2 note:** Post `.132t`, prior #1 and #2 (fuel cost 0) are now
provisional-but-visible (P1). New P0/P1 ranking below.

| # | Row | One-line fix | Effort |
|---:|---|---|---|
| 1 | **#13** Fuel data at provisional $3.00 (all 547) | User re-exports SmartFill CSV with Total Price column enabled; upsert-merge clears provisional flag automatically | **S** (user action) |
| 2 | **#15** SmartFill API sync inserts 0/1 rows | Investigate the single-row rejection (likely header-mapping or timestamp parse) | **M** |
| 3 | **#5** Invite endpoint dead-ends under Safe Mode (token stored but link never surfaced) | Add `?dry_run=true` mode that returns the plaintext link for admin copy-paste | **S** |
| 4 | **#47** TextMagic STOP webhook not built | Add `POST /api/integrations/textmagic/webhook` handler + audit + opt-out flag on user | **M** |
| 5 | **#41** Document library uploads land on ephemeral pod disk | Migrate to Emergent object storage (parked for v58.14.x — 20 lint warnings) | **L** |
| 6 | **#48** `pending_sms_dispatches` drainer UI missing | Add admin screen at `/app/settings/comms/sms-queue`; endpoint already exists | **M** |
| 7 | **#24** SWMS acknowledgement server-side trail | New `swms_acks` collection + endpoint + audit; frontend already sends viewed events | **M** |
| 8 | **#6** Signup page is dead (backend 410, UI still linked) | Remove `/signup` route + Login link OR restore endpoint behind flag | **S** |
| 9 | **#18** Fuel card → attribution (8 orphan cards, 48 fills) | Ship `.132u` phased plan (see memo) | **M** |
| 10 | **#16 followup** Fuel supplier confirmation | Confirm with supplier whether $3.000/L is real or a Pricing Module stale-config; convert provisional flag if real | **S** (user action) |

---

## 4 · Orphan report

### Frontend orphans (routes not in nav or nav-hidden)

- `/signup` — component present, backend deprecates its endpoint (410). **P3.**
- `/app/vehicles` + `/app/vehicles/*` — LegacyVehiclesRedirect, 0-row underlying collection. **P3.**
- `/app/contractors-legacy` — aliased to `ContractorsList`. **P3.**
- `Stub.jsx` — literal placeholder page. **P3.**
- `MyApps.jsx` (`/app/settings/my-apps`) — page exists; not in main nav; unclear if intentionally hidden. **UNKNOWN.**

### Backend orphans (routers not imported by `server.py` AND not imported anywhere else)

Confirmed true orphans (0 inbound imports):

- `reset_stephen_pw.py` — one-off admin script; safe to move to `scripts/`.
- `seed_stephen.py` — one-off seeder.
- `wipe_seed_workspaces.py` — one-off destructive cleanup.
- `bulk_import_template_inference.py` — advertised helper for pre-start bulk import; never wired in.
- `migrate_seed_form_applies_to.py` — one-off migration; already run.

Helpers-not-orphans (referenced by other backend modules; NOT in `server.py` but that's fine):
`admin_safe_wrapper`, `auth_helpers`, `auth_lockout`, `permissions_scope`, `permission_helpers`, `pdf_brand`, `pdf_card_template`, `pdf_chrome`, `pdf_renderer`, `pdf_template`, `qr_common`, `name_matching`, `send_context`, `session_history`, `settings_nav_registry`, `mobile_modules_data`, `fleet_fuel_enrich`, `fleet_date_schedule`, `fleet_service_schedules`, `fleet_service_sheet_pdf`, `fleet_service_sheet_templates`, `form_assignment_notifier`, `gps_map_composer`, `integrations_smartfill` (called by `fleet_fuel.py`), `asset_taxonomy`.

### DB orphans (collections with no reads/writes in current code — 0 rows + collection exists)

- `_civil_health_probe` (0) — dummy.
- `asset_reminders_sent` (0) — feature never activated.
- `audit_log` (0, singular) — legacy stub; live one is `audit_logs`.
- `bulk_import_dryrun` (0) — feature abandoned mid-build.
- `comms_outbox_blocked` (0) — safe-mode audit slot; populated only when a blocked send happens.
- `daily_job_assignments` (0) — mobile router exists but never received writes.
- `document_library_folders` (0) — legacy; folders now live in `doc_folders` (113).

### Historic backup collections (safe to purge)

- `form_templates_backup_v160_1_6` (27)
- `form_templates_backup_v160_2_2/2_3/2_6cat/3_0/3_0_apply/3_0_ungate_incidents` (43 · 43 · 43 · 45 · 48 · 45)
- `user_permissions_backup_v160_2_7` (4)
- `worker_certifications_backup_v160_2_6cleanup` (212)

Total historic backup rows: ~510 across 8 collections. Never read at runtime.

---

## 5 · Mocked / hardcoded surface

Rows where a real user sees fabricated or placeholder data. Distinct
from "no data yet" — this is code that intentionally serves fake
values to production users.

| File | Line | What's fake | Why |
|---|---:|---|---|
| `backend/dashboards.py` | early | `todo` marker returned for un-implemented module aggregators | Placeholder per Phase 4.17 spec |
| `backend/fleet_fuel_reports.py` | multi | Zero-cost rows aggregate to `total_price: 0.0`, `dpl: null` | Not mocked but appears fake — actual data absent (issue #13) |
| `frontend/src/pages/Stub.jsx` | whole file | Static placeholder text | Named as such |
| `frontend/src/pages/Cover.jsx` | (landing page) | Marketing copy about "AI-assisted construction safety" | Marketing, not data — not mock in the audit sense |
| `frontend/src/pages/FuelReporting.jsx` | 282-295 | Existing "Total Price not present" banner triggers when totals.total_price==0 (before the new red banner from `.132s`) | Intentional coverage indicator |

**Zero live-user endpoints found returning obviously fake data** —
i.e. no `return {"count": 42}` type placeholders on wired routes. The
"blank" areas are all upstream data gaps (SmartFill cost, SMS
webhook, SWMS acks), not mock endpoints.

---

## Still-to-audit (30-min budget hit)

- Individual Simpro flows (worker sync details, licence mapping,
  ZIP import). All three exist; correctness not spot-checked this pass.
- Mobile (Expo) — flagged UNKNOWN for category-first + review-before-submit.
- SWMS PDF pipeline (renderers exist; not runtime-verified).
- Form-templates PDF export path (`forms_pdf.py`).
- Backup restore path (only forward-catch tested).
- Session-timeout enforcement (settings exist; runtime path not verified).
- `dashboards.py` module aggregators — how many "todo" placeholders vs real?
- Rate-limit middleware coverage (`rate_limit.py`).
- Full asset service scheduling cron (`cron_asset_service_generate.py`).

---

## Anything shocking?

1. **All 547 fuel transactions now carry a provisional $3.00/L price
   marker** (`price_source="provisional_static_3.00"` after `.132t`).
   Real prices will supersede on next CSV re-upload via the `.131n`
   upsert-merge path; upsert clears the marker automatically.
   The blocking-banner + row asterisks make the provisional state
   visually obvious in both `FuelReporting.jsx` and `AssetFuelTab.jsx`.
2. **"Toolbox / Plaud" feature was mentioned by the user in the audit
   brief but is not built.** Zero code references. This isn't broken
   — it never existed.
3. **Comms are effectively muted org-wide** (Safe Mode ON + no Resend
   key + M365 disarmed + TextMagic disarmed). Every "we'll email the
   admin"/"we'll SMS the worker" affordance in the app is a no-op
   until Safe Mode is lifted.
4. **The `vehicles` collection is empty** — the "fleet" data lives
   in `assets`. Any code path or docs still saying "vehicles" is
   pointing at a dead well.
5. **8 historic form-template backup collections retain ~350 rows**
   and are never read. Cheap cleanup target if the DB size ever matters.

No writes performed.
