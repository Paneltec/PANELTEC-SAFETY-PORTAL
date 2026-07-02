# Phase 4.17 — Module dashboards (paneltec-v134)

Status at start: **Not started.** Code + service worker still at v133 (v133 shipped end of previous session; see PROJECT_STATE.md).

Break the brief into **three self-contained passes**, each finishable in a fresh context window. Each pass ships a working `paneltec-v134.x` — no half-mounted modules on `main` between passes.

---

## Phased split

### v134.0 — Shared infrastructure + SWMS reference mount
- Backend: `/app/backend/dashboards.py`
  - Per-module aggregator registry (`AGGREGATORS = {"swms": ..., "hazards": ...}`)
  - Real implementations for: **SWMS, Hazards, Incidents, Sites**
  - `GET /api/dashboards/{module}` router with 60 s per-(org, module) in-process cache
  - Log line per call: `dashboard.query module=X org=Y ms=Z`
  - Register in `server.py` (lazy import pattern, same as `health_extras`)
- Frontend: shared `<ModuleDashboard />` component at `/app/frontend/src/components/dashboards/ModuleDashboard.jsx`
- Reference mount on **SWMS** using the `<Tabs defaultValue="dashboard">` pattern
- `<HowThisWorks schematicSlug="swms" />` moves INSIDE the Dashboard tab
- Manual: add "Module dashboards" section + **fix section-numbering issue** (Phase 4.16 "Your account" was inserted as `## 12` — should be renumbered to the next contiguous position and the whole trailing section list re-sequenced)
- Service worker bump `paneltec-v133` → `paneltec-v134`

### v134.1 — 4 more mounts + aggregators
Real aggregators + Dashboard-tab mounts for: **Inspections, Plant & Vehicles, Workers, Certifications**

### v134.2 — Final 4 mounts + polish
Real aggregators + Dashboard-tab mounts for: **Sites (already in v134.0 aggregator, needs the mount), Audit Exports** + final polish sweep. Also verify `<HowThisWorks />` is present inside the Dashboard tab of every one of the 9 modules.

---

## Shared component contract

### `<ModuleDashboard />` prop shape
```jsx
<ModuleDashboard
  module="swms"                    // slug matching GET /api/dashboards/{module}
  title="SWMS"                     // page H1
  tagline="Draft, parse, approve." // subhead under H1
  schematicSlug="swms"             // for the hero-band image (from v131 schematics)
  moduleColour="orange"            // tailwind colour name for KPI/chart accents
  quickActions={[
    { label: "New SWMS", route: "/app/swms/new", icon: <Plus /> },
    { label: "View list", route: "?tab=list",     icon: <List /> },
  ]}
/>
```

Behaviour:
- Fetches `GET /api/dashboards/{module}` on mount, refreshes every 60 s
- Renders (top-to-bottom):
  1. **Hero band** — dark-navy full-width card, schematic image on the right, uppercase eyebrow + big H1 + tagline on the left
  2. **KPI tile row** — slate-900 cards with big number, small label, optional trend delta (↑ 12%) and accent icon in `moduleColour`
  3. **Charts row** — 1–2 recharts (LineChart / BarChart / Donut) driven by the response `charts` array
  4. **"Records needing attention"** — 5-row table from response `attention[]`
  5. **Quick actions row** — buttons from `quickActions` prop
- Dark navy + orange to match the Phase 4.16 tech aesthetic
- All labels UPPERCASE `tracking-wider`, green LED dots for status pills

### `GET /api/dashboards/{module}` response schema
```json
{
  "module": "swms",
  "kpis": [
    { "key": "total", "label": "Total SWMS", "value": 142, "trend": 0.12, "unit": null }
  ],
  "charts": [
    { "type": "bar",   "title": "Created per month (12mo)", "data": [{"x": "Jan", "y": 12}, ...] },
    { "type": "donut", "title": "By status",                "data": [{"label": "Draft", "value": 8}, ...] }
  ],
  "attention": [
    { "id": "swms-abc", "label": "SWMS-001 awaiting sign-off", "timestamp": "2026-…", "severity": "amber", "route": "/app/swms/abc" }
  ],
  "generated_at": "2026-…"
}
```

Cache: 60 s per (org_id, module) via a simple in-process dict keyed `(org, module) → (payload, expires_at)`. No redis needed at this scale.

If a KPI has no data source in the collections today, return `value: 0` and add `"placeholder": true, "coming_soon": true` on the KPI item so `<ModuleDashboard />` can render a "coming soon" tooltip instead of faking numbers.

### Module mount wrapper pattern
```jsx
// Existing page becomes:
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import ModuleDashboard from '@/components/dashboards/ModuleDashboard';
import HowThisWorks from '@/components/help/HowThisWorks';

export default function SwmsList() {
  return (
    <Tabs defaultValue="dashboard" className="…">
      <TabsList>
        <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
        <TabsTrigger value="list">List</TabsTrigger>
      </TabsList>
      <TabsContent value="dashboard">
        <HowThisWorks schematicSlug="swms" />
        <ModuleDashboard module="swms" title="SWMS" … />
      </TabsContent>
      <TabsContent value="list">
        {/* existing list JSX, unchanged */}
      </TabsContent>
    </Tabs>
  );
}
```

The `<HowThisWorks />` currently sitting above the list JSX (added in v131) MOVES into the Dashboard tab so it stays discoverable and doesn't get duplicated across tabs.

---

## Per-module KPIs + charts (verbatim from v134 brief)

| Module | Route | KPIs | Charts |
|---|---|---|---|
| **SWMS** | `/app/swms` | Total SWMS · Drafts · Approved · AI-parsed count · Awaiting acknowledgement | Bar: SWMS created per month (12mo) · Donut: by status |
| **Hazards** | `/app/hazards` | Open · Closed this week · High-severity open · Avg time-to-close (days) | Line: hazards captured/closed per week · Donut: by severity |
| **Incidents** | `/app/incidents` | This month · YTD · Days since last · Open investigations | Bar: incidents per month (12mo) · Donut: by type |
| **Inspections** | `/app/inspections` | Completed this month · Overdue · Pass rate · Avg score | Line: pass rate over 12mo · Bar: by inspection type |
| **Sites** | `/app/sites` | Active sites · Currently on site (live) · Sign-ons today · GPS anomalies (>250m) this week | Bar: sign-ons per day (30d) · Donut: sign-ons by site |
| **Plant & Vehicles** | `/app/vehicles` | Active assets · Total engine hours (fleet) · Km driven this week · Assets needing manual reading | Line: fleet engine hours per day (30d) · Bar: top 5 assets by weekly km |
| **Workers** | `/app/settings/users` | Total users · Active this month · Invite pending · Locked · Never logged in | Donut: by role · Bar: sign-ins per day (7d) |
| **Certifications** | `/app/certifications` (or wherever) | Total certs · Expiring in 30d · Expired · Renewals in progress | Bar: expirations upcoming per month (6mo out) · Donut: by cert type |
| **Audit Exports** | `/app/settings/audit-exports` (actual route is `/app/audit-exports`) | Packs generated this year · Last export · Coverage % · Sites included | Line: packs per month (12mo) · Bar: packs by contents type |

---

## Explicit call-outs for the next agent

1. **Fix the section-numbering issue in `user_manual.md`** — Phase 4.16 inserted the "Your account" section as `## 12. Your account` in front of `## 1. Getting started`, so the numbering is currently non-contiguous (12 → 1 → 2 → … → 11 → then the new "Module dashboards" section). Renumber the whole section list to be contiguous, put "Your account" and "Module dashboards" in sensible positions (probably right after Getting started + before the module sections), and update any internal cross-refs / anchor links that broke.

2. **Do NOT touch the crane login** (Cover.jsx / PaneltecHero.jsx / Login.jsx) — that is the single sign-in surface post-v129 and has been re-confirmed correct three times now.

3. **Brand rules unchanged** — orange `#F97316` + slate `#1E293B`. No blue Tailwind classes on new UI.

4. **COMMS_SAFE_MODE=on** stays env-locked. Do not remove.

5. **Cache bumping** — every v134.x pass MUST bump the service worker `CACHE_VERSION` in `/app/frontend/public/service-worker.js` with a changelog block. Don't ship v134.1 without a bump; users get stuck on stale bundles otherwise.

6. **Log noise pressure** — the supervisor log-tail dump on every backend edit is currently costing 5–8 KB per tool call. Consider fetching only `backend.out.log` tail (not `backend.err.log` + `mobile.*.log` + `mongodb.*.log`) if the CLI supports it, or accept the noise and plan for fewer, larger batched edits per pass.

7. **Where to resume** — start at v134.0 (shared infra + SWMS reference mount). Do NOT try to do all 9 modules in one session even with a fresh 200 K budget; the three-pass split is deliberate to keep each landing green.
