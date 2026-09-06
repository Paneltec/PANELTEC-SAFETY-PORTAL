# v58.13.131h — Navixy enrichment · dry-run report

Generated: 2026-09-05T08:59:30.429638+00:00

**No writes performed.** Re-run with `--apply` after green-light.

## Overview

- Rows scanned (odo null/0 OR source in {snapshot, unknown}): **124**
- Would enrich as **`navixy_live`** (per-day history, `.131i` path): 0
- Would enrich as **`navixy_snapshot`** (fresh, ≤24h): 0
- Would enrich as **`navixy_snapshot`** (stale, >24h): 0
- Would land as **`unknown`**: 124
  · of which no asset_id (unmatched rows): 48

## First 30 proposed rows

| tx.id | rego | source | conf | → odo | → hrs | reason |
|-------|------|--------|:----:|------:|------:|--------|
| `47b708a2…` | XT16AB | unknown | — | — | — | no navixy_device_id |
| `0af50db0…` | M017HD | unknown | — | — | — | no asset_id (unmatched row) |
| `1ba1264c…` | XT16AB | unknown | — | — | — | no navixy_device_id |
| `1bd55da6…` | M02HZ | unknown | — | — | — | no navixy_device_id |
| `c4b63bea…` | I53TV | unknown | — | — | — | no asset_id (unmatched row) |
| `4d14d149…` | XT16AB | unknown | — | — | — | no navixy_device_id |
| `2fb3d609…` | XT16AB | unknown | — | — | — | no navixy_device_id |
| `b0e3690b…` | K82KU | unknown | — | — | — | no navixy_device_id |
| `e40a5c2f…` | XT16AB | unknown | — | — | — | no navixy_device_id |
| `fad57135…` | I53TV | unknown | — | — | — | no asset_id (unmatched row) |
| `a5ce8bc6…` | XT16AB | unknown | — | — | — | no navixy_device_id |
| `d0a38758…` | C58GA | unknown | — | — | — | no asset_id (unmatched row) |
| `fe7750f0…` | M017HD | unknown | — | — | — | no asset_id (unmatched row) |
| `8f3f9938…` | XT16AB | unknown | — | — | — | no navixy_device_id |
| `17724e70…` | M02HZ | unknown | — | — | — | no navixy_device_id |
| `9dacc391…` | I53TV | unknown | — | — | — | no asset_id (unmatched row) |
| `75c634a0…` | J03QV | unknown | — | — | — | no navixy_device_id |
| `6947e813…` | I56RD | unknown | — | — | — | no asset_id (unmatched row) |
| `744c79f9…` | XT16AB | unknown | — | — | — | no navixy_device_id |
| `ef4b13fe…` | K82KU | unknown | — | — | — | no navixy_device_id |
| `93e175de…` | — | unknown | — | — | — | no asset_id (unmatched row) |
| `0920f057…` | H01PU | unknown | — | — | — | no navixy_device_id |
| `7a186057…` | E34UD | unknown | — | — | — | no navixy_device_id |
| `052f31f9…` | I49HO | unknown | — | — | — | no navixy_device_id |
| `39195c63…` | I49HO | unknown | — | — | — | no navixy_device_id |
| `fb7bb37a…` | XT16AB | unknown | — | — | — | no navixy_device_id |
| `9e8864a6…` | K82KU | unknown | — | — | — | no navixy_device_id |
| `adff277e…` | XT16AB | unknown | — | — | — | no navixy_device_id |
| `0a33888f…` | K82KU | unknown | — | — | — | no navixy_device_id |
| `08a95b94…` | XT16AB | unknown | — | — | — | no navixy_device_id |

_(+ 94 more rows — full log in `apply_log.md`.)_
