---
title: Backup & Restore
slug: backup-restore
order: 12
tags: []
last_updated: 2026-08-04
---

## 10. Backup & Restore

Sidebar → **Backup & Restore** (Settings). Real MongoDB snapshots to GridFS + optional LAN mirror.

### Snapshot cadence
Two APScheduler cron jobs run automatically:
- **Every 6 hours** — rolling backup, retained per the schedule below.
- **Mon–Fri 17:00 Sydney** — daily close-of-business snapshot.

The **Schedule** card on the page introspects the running scheduler and shows the exact cron + next-run for each job — no editable UI here, cadence is fixed.

### Retention
Every snapshot is retained per this rolling policy: `7d keep-all`, then `30d daily`, then `26w weekly`, then `forever monthly`. Older snapshots are hard-deleted automatically.

### LAN destinations
Add SMB shares under **Destinations** with `{host, share, username, password}`. Passwords are encrypted at rest with Fernet (AES-128-CBC + HMAC, keyed by `BACKUP_DEST_ENC_KEY`) — the plaintext never touches disk after write. For agents that run inside the NAS itself (no SMB round-trip), set `kind: "local_agent"` — the agent's LAN report unlocks a "DELIVERED (LOCAL MOUNT)" state instead of expecting SMB.

### Backup pill in the top nav
The green **Backup** LED in the header polls `/api/health/backup` every 60s and shows: last snapshot age, size, and destination count. Click it for the popover with the same detail. Grey means no snapshots yet.

### Restore semantics
The Restore panel carries a yellow banner: MongoDB `_id` fields regenerate on restore, but Paneltec Civil's UUID `id` fields are preserved — so foreign-key references (`worker_id`, `swms_id`, etc.) survive a restore intact.

---
