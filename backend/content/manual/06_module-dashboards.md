---
title: Module dashboards
slug: module-dashboards
order: 6
tags: []
last_updated: 2026-08-04
---

## 4. Module dashboards

Every major module (SWMS, Hazards, Incidents, Inspections, Sites, Plant & Vehicles, Workers, Certifications, Audit Exports) opens onto its own **Dashboard tab** — an at-a-glance analytics view tuned to that module's data. It's the default landing tab; the familiar list you're used to sits one click away under **List**.

**What you get on every module dashboard**

- **Hero band** — dark-navy header with the module name, tagline, live refresh timestamp, and the module schematic on the right for context.
- **KPI tiles** — 4–5 slate-900 tiles with the numbers that matter for that module (e.g. Total SWMS · Drafts · Approved · AI-parsed for SWMS; Open · Closed this week · High-severity for Hazards). Where a KPI doesn't yet have a data source, the tile shows `0` with a small "Coming soon" tooltip instead of a fabricated number.
- **Charts** — one or two recharts visualisations (bar / line / donut) driven by real aggregation off the same collections that back the list. Every module gets a 12-month trend (or 30-day, where appropriate) plus a status/type breakdown donut.
- **Records needing attention** — top 5 rows from that module that need someone's eyes right now (e.g. SWMS awaiting sign-off, high-severity open hazards, overdue inspections). Click any row to jump into the record.
- **Quick actions** — the primary "Create X" and "View list" buttons in the module's accent colour.

**Live refresh**

Dashboards fetch `GET /api/dashboards/{module}` on mount and re-poll every 60 seconds. A 60-second per-org cache sits behind the endpoint so multiple simultaneous viewers don't hammer MongoDB — the hero band shows a small "cache hit · 60 s window" chip when you're inside that window. If nothing has changed you'll still see the tiles update to the latest generated_at.

**Where to find each module's dashboard**

- SWMS → Sidebar → SWMS → Dashboard tab
- Hazards → Sidebar → Hazards → Dashboard tab
- Incidents → Sidebar → Incidents → Dashboard tab
- Inspections → Sidebar → Inspections → Dashboard tab
- Sites → Sidebar → Sites → Dashboard tab
- Plant & Vehicles → Sidebar → Vehicles → Dashboard tab
- Workers → Sidebar → Users & Workers → Dashboard tab
- Certifications → Sidebar → Certifications → Dashboard tab
- Audit Exports → Sidebar → Audit Exports → Dashboard tab

These are separate from the org-wide **Live Compliance Dashboard** (Section 3); that stays as your one-page rollup across every module.

---
