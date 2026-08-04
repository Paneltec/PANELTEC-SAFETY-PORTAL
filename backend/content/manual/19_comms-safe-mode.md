---
title: Comms Safe Mode
slug: comms-safe-mode
order: 19
tags: []
last_updated: 2026-08-04
---

## 17. Comms Safe Mode

![Comms Safe Mode kill switch flow](/api/help/schematics/paneltec_comms_safe_mode.png)

_Fig. Comms Safe Mode kill switch flow._

### What it is
Comms Safe Mode is a kill switch that intercepts every outbound email (Microsoft 365) and SMS (TextMagic) at the org level. When `on`, no real worker or contractor receives any communication — messages are logged to the **blocked outbox** with the full payload preserved for inspection.

### When it's on
You'll see an orange **COMMS SAFE MODE** chip in the top-right of every page when it's active. It's intentionally enabled during onboarding and testing to prevent accidental mass-emails to real recipients.

**Top-bar API pill behaviour** — while Safe Mode is on, the **Microsoft 365** and **TextMagic** rows in the integrations popover show **red** with a small `🛡 disarmed` chip next to the name and the detail _"Disarmed by Comms Safe Mode"_. That's expected. The lights answer the question _"will this integration actually fire outbound traffic right now?"_ — and the answer is no, because you've deliberately disarmed it. A yellow banner at the bottom of the popover reminds you of this. The moment you lift Safe Mode both lights re-arm on the next 60 s refresh (or immediately if you close and re-open the popover; the cache key includes the safe-mode flag).

**Idle green is normal for on-demand integrations** — the **Simpro** row shows **🟢 Ready** even if you haven't clicked _Import from Simpro_ in days. Simpro is called on demand (when you fetch a worker, vendor, site, or job) rather than on a continuous sync schedule, so an idle green light is the correct state. It only flips amber if a recent call errored, and only flips red if credentials are missing or errors have persisted for more than 24h. The **Navixy** row, by contrast, IS a continuous-sync integration — its green state means an asset has synced within the last 60 minutes, and it will flip amber if the sync loop stalls.

**Click any row to jump to its config** — every integration row in the popover (except MongoDB, which is infrastructure) is a deep link into its admin page under **Settings → Integrations → &lt;provider&gt;**. Hover reveals an orange left-edge accent stripe and a right-chevron. The popover closes on navigation.

### Viewing blocked messages
Sidebar → **Settings → Comms Safe Mode**. The table shows every blocked message with timestamp, channel, recipient, subject and reason. Useful for verifying your invite/renewal flow is sending the right content before going live.

### Turning it off when going live
Edit `/app/backend/.env`, set `COMMS_SAFE_MODE=off`, then `sudo supervisorctl restart backend`. The orange chip disappears and outbound comms resume.

---
