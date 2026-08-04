---
title: Workers, Users & Permissions
slug: workers-users-permissions
order: 9
tags: []
last_updated: 2026-08-04
---

## 7. Workers, Users & Permissions

![Worker onboarding & access](/api/help/schematics/paneltec_workers_access.png)

_Fig. Worker onboarding & access._

### Adding a worker
Sidebar → **Workers** (under Settings) → **+ Add worker**. Fill name, mobile, email, role, induction status. If your Simpro integration is connected, workers sync automatically — manual adds are for crew not in Simpro.

### Sending an invite
Workers list → row action menu → **Send invite**. Choose the channel (email or SMS) — both deliver a one-time PIN + a redeem link. The pill on the worker row updates: `Invite pending` → `Active` once they redeem.

### Bulk invite (paste-a-list)
Users list → **Bulk invite** (top-right, next to **Invite user**). Paste any number of emails — commas, spaces, semicolons and newlines all count as separators. Hit **Parse** to see a preview table splitting the list into three columns:

- **New** — email is validly formatted and not already in your org. These are the only rows that will actually get sent.
- **Already exists** — matched an existing user by email (case-insensitive). Skipped silently on submit.
- **Invalid** — didn't parse as `x@y.z`. Skipped.

Pick a default **Role** (worker / manager / admin) and a **Channel** (Auto / Email / SMS), then **Send N invites**. A progress bar walks each row through the standard `POST /users` endpoint one at a time; per-row ✓ sent / ✗ failed appears live in the table. A summary toast fires at the end. All messages respect Comms Safe Mode — blocked deliveries land in the outbox instead of hitting the network.

### Generating a one-time PIN
Same menu → **Generate PIN** if email/SMS isn't appropriate. You'll see a 6-digit PIN and a copyable redeem URL — share via your usual secure channel.

### Resetting a password / unlocking a locked account
Sidebar → **Users & Permissions** → find the user → row action menu → **Reset password** or **Unlock**. Reset sends a one-time link; unlock clears the 15-minute lockout flag.

### Per-role permission matrix
Sidebar → **Users & Permissions** → click any user → **Permissions** tab. You'll see a checkbox grid of every resource (SWMS, hazards, incidents, etc.) crossed with view/create/edit/delete. Admin role has everything; operator and viewer roles are pre-set; you can flip individual cells per user.

### Mobile App Modules per role
Same Permissions tab → **Mobile Modules** section. Each module (Daily Pre-Start, Hazard Capture, Site Diary, etc.) has a per-role toggle. Disabling a module hides it from that role's mobile home screen — pull-to-refresh updates the config without a re-sign-in.

### Roles are canonical in Simpro
Sidebar → **Roles Admin**. This is the master list of every role your org uses. You cannot create custom roles here anymore — press **Sync from Simpro** (blue button, top-right) to pull every unique Simpro employee position and mirror it here. Each imported role starts with zero permission tokens; open its matrix to grant tokens per-resource. System roles (Admin, Manager, HSEQ Lead, Auditor, Supervisor, Worker) remain read-only. If a Simpro position no longer matches a user's locked role, an orange drift banner surfaces at the top of Roles Admin so you can unlock or override per user.

---
