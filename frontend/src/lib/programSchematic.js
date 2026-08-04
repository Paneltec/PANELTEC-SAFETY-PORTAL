// v160.3.9.47 — Program Schematic topology registry.
//
// Complete rewrite. The Program Schematic is now a static SVG-heavy
// topology diagram (hub-and-spoke), NOT a react-flow canvas. This
// registry exposes:
//
//   • SCHEMATIC_CLUSTERS — the 6 locked clusters (colour + anchor).
//   • SCHEMATIC_NODES    — every node (id, cluster, label, route,
//                          icon key, absolute x/y for the SVG layout).
//   • SCHEMATIC_HUB      — the central "Paneltec Civil" badge.
//   • CANVAS_W / CANVAS_H — poster dimensions used by the SVG viewBox.
//
// Locked palette (approved pre-compaction, do NOT drift):
//   Overview     Sky      #0EA5E9  (4 nodes)
//   Capture      Orange   #F97316  (6 nodes)
//   Compliance   Emerald  #10B981  (5 nodes)
//   Register     Indigo   #6366F1  (4 nodes)
//   Settings     Violet   #8B5CF6  (11 nodes, split Access + Data)
//   Integrations Amber    #F59E0B  (4 nodes)
//
// The old ReactFlow structures (SCHEMATIC_ZONES / SCHEMATIC_EDGES /
// _RAW_EDGES) have been deleted — the topology renders directly in
// `pages/settings/ProgramSchematicPage.jsx` using bezier `<path>`
// elements per (hub → cluster anchor) pair. Nothing else in the app
// consumed those exports (verified via grep).

export const CANVAS_W = 1600;
export const CANVAS_H = 1300;

export const SCHEMATIC_HUB = {
  x: 800,
  y: 650,
  w: 260,
  h: 110,
  label: 'Paneltec Civil',
  sub: 'Control panel',
};

// Cluster anchors are the point each bezier line terminates at (the
// "landing pad" side of the cluster, closest to the hub). This keeps
// lines from crossing icons.
export const SCHEMATIC_CLUSTERS = [
  // `anchor` = terminus point for the bezier spoke from the hub.
  // `labelPos` = fixed (x, y) for the uppercase cluster label chip,
  // deliberately placed outside the icon group so it never overlaps
  // a node. Icons themselves live at the coordinates declared in
  // `SCHEMATIC_NODES` below.
  { key: 'overview',     label: 'Overview',     color: '#0EA5E9', anchor: { x: 800,  y: 245 }, labelPos: { x: 800,  y: 80  } },
  { key: 'capture',      label: 'Capture',      color: '#F97316', anchor: { x: 1200, y: 435 }, labelPos: { x: 1385, y: 240 } },
  { key: 'compliance',   label: 'Compliance',   color: '#10B981', anchor: { x: 1200, y: 895 }, labelPos: { x: 1385, y: 720 } },
  { key: 'register',     label: 'Register',     color: '#6366F1', anchor: { x: 800,  y: 1075 }, labelPos: { x: 800,  y: 1260 } },
  { key: 'settings',     label: 'Settings',     color: '#8B5CF6', anchor: { x: 465,  y: 940 }, labelPos: { x: 220,  y: 680 } },
  { key: 'integrations', label: 'Integrations', color: '#F59E0B', anchor: { x: 400,  y: 395 }, labelPos: { x: 285,  y: 240 } },
];

// Sub-cluster label positions (Settings only — Access + Data & Automation).
export const SCHEMATIC_SUB_CLUSTERS = [
  { key: 'settings-access', parent: 'settings', label: 'Access',             x: 220, y: 720 },
  { key: 'settings-data',   parent: 'settings', label: 'Data & Automation',  x: 220, y: 950 },
];

// Each node: absolute (x, y) is the CENTRE of the icon tile.
// Tile size is standardised at 88 × 88 (drawn in the page component).
// `icon` is a lucide-react component name (import at render time).
// `route` MUST match an actual `<Route path>` under `/app/*` in App.js —
// the smoke-test pytest `test_program_schematic_routes_v47.py` asserts
// this contract at CI time.
export const SCHEMATIC_NODES = [
  // ── OVERVIEW (top centre — 4 nodes in a horizontal row) ────────────
  { id: 'overview-dashboard', cluster: 'overview', label: 'Dashboard',        icon: 'LayoutDashboard', route: '/app/dashboard',        x: 620, y: 155 },
  { id: 'overview-ask',       cluster: 'overview', label: 'Ask Intelligence', icon: 'Sparkles',        route: '/app/ask',              x: 740, y: 155 },
  { id: 'overview-doclib',    cluster: 'overview', label: 'Document Library', icon: 'FolderOpen',      route: '/app/document-library', x: 860, y: 155 },
  { id: 'overview-outbox',    cluster: 'overview', label: 'Outbox',           icon: 'Inbox',           route: '/app/outbox',           x: 980, y: 155 },

  // ── CAPTURE (top-right — 6 nodes 3×2 grid) ─────────────────────────
  { id: 'capture-swms',       cluster: 'capture', label: 'AI SWMS',         icon: 'FileText',        route: '/app/swms',        x: 1265, y: 320 },
  { id: 'capture-prestarts',  cluster: 'capture', label: 'Pre-Starts',      icon: 'CheckCircle2',    route: '/app/pre-starts',  x: 1385, y: 320 },
  { id: 'capture-diary',      cluster: 'capture', label: 'Site Diary',      icon: 'BookOpen',        route: '/app/site-diary',  x: 1505, y: 320 },
  { id: 'capture-hazards',    cluster: 'capture', label: 'Hazards',         icon: 'AlertTriangle',   route: '/app/hazards',     x: 1265, y: 460 },
  { id: 'capture-incidents',  cluster: 'capture', label: 'Incidents',       icon: 'Siren',           route: '/app/incidents',   x: 1385, y: 460 },
  { id: 'capture-inspections',cluster: 'capture', label: 'Inspections',     icon: 'ClipboardCheck',  route: '/app/inspections', x: 1505, y: 460 },

  // ── COMPLIANCE (bottom-right — 5 nodes 3+2) ───────────────────────
  { id: 'compliance-risk',        cluster: 'compliance', label: 'Risk Assess',    icon: 'ShieldAlert',   route: '/app/risk-assessments', x: 1265, y: 800 },
  { id: 'compliance-contractors', cluster: 'compliance', label: 'Contractors',    icon: 'Building2',     route: '/app/contractors',      x: 1385, y: 800 },
  { id: 'compliance-suppliers',   cluster: 'compliance', label: 'Suppliers',      icon: 'Truck',         route: '/app/suppliers',        x: 1505, y: 800 },
  { id: 'compliance-renewals',    cluster: 'compliance', label: 'Renewals',       icon: 'RefreshCw',     route: '/app/renewals',         x: 1325, y: 940 },
  { id: 'compliance-audit',       cluster: 'compliance', label: 'Audit Exports',  icon: 'PackageCheck',  route: '/app/audit-exports',    x: 1445, y: 940 },

  // ── REGISTER (bottom centre — 4 nodes in a horizontal row) ─────────
  { id: 'register-workers',  cluster: 'register', label: 'Workers',   icon: 'HardHat',    route: '/app/settings/workers', x: 620, y: 1180 },
  { id: 'register-vehicles', cluster: 'register', label: 'Vehicles',  icon: 'Car',        route: '/app/vehicles',         x: 740, y: 1180 },
  { id: 'register-sites',    cluster: 'register', label: 'Sites',     icon: 'MapPin',     route: '/app/sites',            x: 860, y: 1180 },
  { id: 'register-forms',    cluster: 'register', label: 'Forms',     icon: 'FilePlus',   route: '/app/forms',            x: 980, y: 1180 },

  // ── SETTINGS · ACCESS (bottom-left upper — 6 nodes 3×2) ────────────
  { id: 'settings-org',       cluster: 'settings', sub: 'settings-access', label: 'Organisation',      icon: 'Building',   route: '/app/settings/org',                x: 90,  y: 780 },
  { id: 'settings-workspaces',cluster: 'settings', sub: 'settings-access', label: 'Workspaces',        icon: 'Layers',     route: '/app/settings/workspaces',         x: 220, y: 780 },
  { id: 'settings-users',     cluster: 'settings', sub: 'settings-access', label: 'Users & Perms',     icon: 'Users',      route: '/app/settings/users',              x: 350, y: 780 },
  { id: 'settings-roles',     cluster: 'settings', sub: 'settings-access', label: 'Roles Admin',       icon: 'UserCog',    route: '/app/settings/roles-admin',        x: 90,  y: 880 },
  { id: 'settings-presets',   cluster: 'settings', sub: 'settings-access', label: 'Perm Presets',      icon: 'KeyRound',   route: '/app/settings/permission-presets', x: 220, y: 880 },
  { id: 'settings-system',    cluster: 'settings', sub: 'settings-access', label: 'System',            icon: 'Server',     route: '/app/settings/system',             x: 350, y: 880 },

  // ── SETTINGS · DATA & AUTOMATION (bottom-left lower — 5 nodes 3+2) ─
  { id: 'settings-certs',     cluster: 'settings', sub: 'settings-data', label: 'Certifications', icon: 'BadgeCheck',   route: '/app/settings/certifications',    x: 90,  y: 1010 },
  { id: 'settings-formasg',   cluster: 'settings', sub: 'settings-data', label: 'Form Assign',    icon: 'ClipboardList',route: '/app/settings/form-assignments',  x: 220, y: 1010 },
  { id: 'settings-swmsasg',   cluster: 'settings', sub: 'settings-data', label: 'SWMS Assign',    icon: 'FileCheck',    route: '/app/settings/swms-assignments',  x: 350, y: 1010 },
  { id: 'settings-backup',    cluster: 'settings', sub: 'settings-data', label: 'Backup',         icon: 'Database',     route: '/app/settings/backup',            x: 155, y: 1110 },
  { id: 'settings-comms',     cluster: 'settings', sub: 'settings-data', label: 'Comms Safe',     icon: 'ShieldOff',    route: '/app/settings/comms-safe-mode',   x: 285, y: 1110 },

  // ── INTEGRATIONS (top-left — 4 nodes 2×2) ──────────────────────────
  { id: 'integrations-simpro',    cluster: 'integrations', label: 'Simpro',        icon: 'Plug',           route: '/app/settings/integrations/simpro',        x: 220, y: 320 },
  { id: 'integrations-navixy',    cluster: 'integrations', label: 'Navixy',        icon: 'Radar',          route: '/app/settings/integrations/navixy',        x: 350, y: 320 },
  { id: 'integrations-m365',      cluster: 'integrations', label: 'Microsoft 365', icon: 'Mail',           route: '/app/settings/integrations/microsoft365',  x: 220, y: 460 },
  { id: 'integrations-textmagic', cluster: 'integrations', label: 'TextMagic',     icon: 'MessageSquare',  route: '/app/settings/integrations/textmagic',     x: 350, y: 460 },
];
