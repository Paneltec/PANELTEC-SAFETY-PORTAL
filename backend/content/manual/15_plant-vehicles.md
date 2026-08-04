---
title: Plant & Vehicles
slug: plant-vehicles
order: 15
tags: []
last_updated: 2026-08-04
---

## 13. Plant & Vehicles

![Plant & Vehicles telemetry sources](/api/help/schematics/paneltec_plant_vehicles.png)

_Fig. Plant & Vehicles telemetry sources._

### Asset list and QR codes
Sidebar → **Plant & Vehicles**. Each asset has a QR menu on the row:

- **Print** — generates a printable card with the QR.
- **Copy scan link** — copies the public URL to clipboard.
- **Download PNG** — saves the QR as a PNG.

### Live Counters
Each asset has a **Live Counters** panel with two tabs:

- **Total** — lifetime engine hours and odometer.
- **This Week** / **Last Month** — sparkline deltas with daily resolution (Recharts).

Below the live counters is the **Today's Trip** card with three tabs (Today / Week / Month). Each shows distance, drive time, idle time, max speed, and a km-per-day sparkline. Data comes from Navixy's `/v2/track/list` and is cached for 60 seconds.

### Adding a historical meter reading manually
Every asset's **Live Counters** card has a **"…"** overflow trigger in the top-right (right next to Refresh now on Navixy-tracked assets, or next to the panel title on manual-only assets). Click it to open **Add historical reading**:

1. Pick a **Date** (defaults to today; max = today, past dates always allowed).
2. Enter **Engine hours (total, cumulative)** and / or **Odometer (total, cumulative km)** — you can submit one or both, whichever you have.
3. Client-side check: if there's a snapshot already on file for a later date, we won't let you save a bigger value against an earlier date (that would break the delta chain). Same-day corrections are allowed — the backend upserts.
4. **Save reading**. A toast confirms, the asset auto-refreshes, and the source pill on the affected metric flips to **Manually entered** on the next render.

The old inline "+ Add a historical reading" button on the unreliable-odometer card still works too — it's kept as a shortcut for the specific case where a Navixy device returns an empty counter set (Kroll Recycler XT04CS pattern).

### Understanding source pills
Each metric carries a small label explaining where the number came from:

- **Synced from Navixy · panel counter** — authoritative, from the device's onboard odometer.
- **Synced from Navixy · mileage report** — derived from Navixy's report API (rare on this plan).
- **Estimated · sum of all trips since first sync** — lifetime tracks aggregation (fallback).
- **GPS-derived (no panel counter)** — rolling track-window estimate (least accurate).
- **Manually entered** — admin-keyed snapshot.

---
