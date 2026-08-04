---
title: Simpro integration
slug: simpro-integration
order: 13
tags: []
last_updated: 2026-08-04
---

## 11. Simpro integration

Simpro is the source of truth for staff, positions/roles, vendors, and jobs. Paneltec Civil consumes Simpro on-demand:

### The five Simpro sync buttons
All are styled in Simpro-brand blue (`#0093D0`) with white text so they're impossible to miss:
- **Users & Permissions → Refresh from Simpro** — pulls the latest employee list, updates linked user rows, refreshes photos.
- **Roles Admin → Sync from Simpro** — pulls every unique Simpro employee position and mirrors it as a role here (this replaces the old "+ Create custom role" button, which has been removed — roles are canonical in Simpro).
- **Certifications → Refresh from Simpro** — pulls both Paneltec + Viatec worker certifications in one call via `POST /workers/sync-from-simpro` with `company: 'both'`.
- **HR Employees → Refresh from Simpro** — re-parses the on-disk XLSX source (see §8).
- **Workers → Sync from Simpro** (split button in the toolbar), **Suppliers → Sync from Simpro** (toolbar + empty-state) — company-scoped pulls.

Each button shows a spinner + "Refreshing…" state with a 500 ms minimum-visible floor so a fast round-trip still registers as a click.

### Integration health
The top-nav **API · N/5** pill polls `/api/health/integrations` every 60s. Click it for a popover with per-integration LED dots: green = live traffic possible, amber = degraded, red = down. Rows are clickable — they deep-link to the corresponding admin config page under `/app/settings/integrations/*`.

Simpro is an **on-demand** integration, so a green "Ready" state is normal even if the last actual call was hours or days ago — that's not "stale", that's idle.

### Simpro secrets at rest
All Simpro API tokens are Fernet-encrypted (`INTEGRATIONS_ENC_KEY`) on the `integration_configs` doc — the plaintext is only rehydrated in memory when a request is about to fire.

---
