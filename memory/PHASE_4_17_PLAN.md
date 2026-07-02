# Phase 4.17 — Module dashboards (paneltec-v135)

**Status:** v134.0 shipped + v134.1 partial (4/9 mounts). Backend aggregators are 100% complete. Frontend still needs Tab mounts on **Sites, Plant & Vehicles, Workers, Certifications, Audit Exports**.

## What shipped in this session

### Backend (100% complete — all 9 aggregators live)
- `/app/backend/dashboards.py` with `AGGREGATORS = { swms, hazards, incidents, inspections, sites, vehicles, workers, certifications, audit_exports }`
- `GET /api/dashboards/{module}` — 60s per-(org, module) in-process cache, structured `dashboards.query` logs, wired into `server.py`
- Each aggregator returns KPIs + charts (bar/line/donut) + attention[] real data straight from MongoDB
- Placeholder KPIs (`placeholder: true, coming_soon: true`) used where a data source is missing — no fake numbers
- Smoke-tested: `curl` returns 200 with real payloads for all 9 modules

### Frontend
- Shared `<ModuleDashboard />` at `/app/frontend/src/components/dashboards/ModuleDashboard.jsx` — dark navy + orange tech aesthetic, recharts, hero band + KPI tiles + charts row + attention table + quick actions
- Tab mounts DONE for: **SWMS, Hazards, Incidents, Inspections** — Dashboard is the default tab, List keeps every pre-v134 affordance intact
- Tab mounts NOT yet done: **Sites, Plant & Vehicles, Workers, Certifications, Audit Exports** — these still render their pre-v134 UI. Backend endpoints for these are already returning real data, so the mount is purely a frontend Tab wrapper.
- Service worker bumped `paneltec-v133` → `paneltec-v135`

### Docs
- `/app/backend/content/user_manual.md` — new "## 4. Module dashboards" section
- Full renumber to fix the v133 drift: sections are now contiguous 1–15
- "Your account" moved to §2 (was inserted as `## 12` in front of §1 in v133)

## Next agent: finish v134.2

Follow the SAME pattern used on `Hazards.jsx`, `Incidents.jsx`, `Inspections.jsx` in v134.1:

1. `import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';`
2. `import ModuleDashboard from '../components/dashboards/ModuleDashboard';`
3. Wrap the content right AFTER `<PageHeader ... />` up to the last closing `</div>` in:
   ```jsx
   <Tabs defaultValue="dashboard" ...>
     <TabsList><TabsTrigger value="dashboard">Dashboard</TabsTrigger><TabsTrigger value="list">List</TabsTrigger></TabsList>
     <TabsContent value="dashboard"><ModuleDashboard module="…" title="…" tagline="…" moduleColour="…" quickActions={[…]} /></TabsContent>
     <TabsContent value="list">{existing list JSX}</TabsContent>
   </Tabs>
   ```
4. Where a `<HowThisWorks schematicSlug="…" />` already exists (SitesAdmin, UsersManagement, AuditExports), MOVE it INSIDE `<TabsContent value="dashboard">` above `<ModuleDashboard>`. Available schematic slugs: `swms`, `sites_qr`, `plant_vehicles`, `workers_access`, `audit_exports`, `architecture`, `user_journey`, `comms_safe_mode`. Do NOT pass `schematicSlug="hazards"` etc. — those schematics don't exist and will 404.

### Files to edit (v134.2)
| Module | Page | Slug | Schematic (if any) | Colour |
|---|---|---|---|---|
| Sites | `SitesAdmin.jsx` | `sites` | `sites_qr` | `orange` |
| Plant & Vehicles | `Vehicles.jsx` | `vehicles` | `plant_vehicles` | `emerald` |
| Workers | `UsersManagement.jsx` | `workers` | `workers_access` | `violet` |
| Certifications | `Certifications.jsx` | `certifications` | (none) | `amber` |
| Audit Exports | `AuditExports.jsx` | `audit_exports` | `audit_exports` | `orange` |

### After all 5 pages are mounted
- Bump SW cache to `paneltec-v136` in `/app/frontend/public/service-worker.js` with a v136 changelog block
- Verify no console errors on any of the 5 pages
- Smoke-test each page loads with Dashboard as the default tab and switching to List still renders the existing UI

## Constraints (unchanged)
- Brand: orange #F97316 + slate — no Tailwind blue on new UI
- `COMMS_SAFE_MODE=on` stays env-locked
- Don't touch Cover.jsx / PaneltecHero.jsx / Login.jsx
- List tabs must render the pre-v134 UI unchanged
