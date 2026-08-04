// v160.3.9.56 — Program Schematic topology registry (grid-only).
//
// The SVG topology in `pages/settings/ProgramSchematicPage.jsx` was
// retired in v56 in favour of a responsive CSS grid. The `anchor`,
// `labelPos`, and per-node `x` / `y` fields below are legacy geometry
// no longer read by any renderer — they remain in the file only so
// the historical schematic diff is legible and so downstream tests
// (`test_program_schematic_routes_v47.py`) that already tolerate the
// fields keep passing. If you need to reintroduce an SVG topology
// later, everything you need is still here.
//
// Layout enlarged (v47.1): viewBox 1800×1500 (was 1600×1300), tile
// diameter 128 (was 88), icon 56 (was 34), node label 16 (was 11),
// cluster label 20 (was 12), hub 320×140 with title 30 (was 22). All
// node / anchor / label coordinates recomputed for the new canvas so
// nothing overlaps.
//
// Cluster palette is UNCHANGED — locked per Stephen's approval:
//   Overview     Sky      #0EA5E9  (4 nodes)
//   Capture      Orange   #F97316  (6 nodes)
//   Compliance   Emerald  #10B981  (5 nodes)
//   Register     Indigo   #6366F1  (4 nodes)
//   Settings     Violet   #8B5CF6  (11 nodes, split Access + Data)
//   Integrations Amber    #F59E0B  (4 nodes)

// v53 — Locked spacing per user feedback: v50's curved labels caused
// visual overlap at the outer arc edge. Two mitigations landed in
// this file's SCHEMATIC_NODES tuning: (1) reduce arc radius in the
// render component from `TILE/2 + 12` to `TILE/2 + 4` so labels
// sit tighter against the halo. (2) node positions themselves stay
// as-is since the arc-radius shrink alone reclaims ~16 px of
// vertical clearance per row.
export const CANVAS_W = 1800;
export const CANVAS_H = 1500;

export const SCHEMATIC_HUB = {
  x: 790,
  y: 690,
  w: 320,
  h: 140,
  label: 'Paneltec Civil',
  sub: 'Control panel',
};

export const SCHEMATIC_CLUSTERS = [
  // v53 — labelPos y-values relaxed by ~30 units so cluster label
  // chips clear the top-arc curved labels of the first-row nodes
  // below them (top-arc letters extend up to y = node.y - 76 - 16).
  { key: 'overview',     label: 'Overview',     color: '#0EA5E9', anchor: { x: 950,  y: 305 },  labelPos: { x: 950,  y: 60   } },
  { key: 'capture',      label: 'Capture',      color: '#F97316', anchor: { x: 1400, y: 495 },  labelPos: { x: 1610, y: 235  } },
  { key: 'compliance',   label: 'Compliance',   color: '#10B981', anchor: { x: 1400, y: 1050 }, labelPos: { x: 1610, y: 790  } },
  { key: 'register',     label: 'Register',     color: '#6366F1', anchor: { x: 950,  y: 1265 }, labelPos: { x: 950,  y: 1490 } },
  { key: 'settings',     label: 'Settings',     color: '#8B5CF6', anchor: { x: 525,  y: 900 },  labelPos: { x: 380,  y: 475  } },
  { key: 'integrations', label: 'Integrations', color: '#F59E0B', anchor: { x: 450,  y: 470 },  labelPos: { x: 230,  y: 90   } },
];

export const SCHEMATIC_SUB_CLUSTERS = [
  // v55.3 — Full Settings geometry recompute after 360px bbox test.
  // Row-to-row vertical spacing now 200 SVG (was 150), giving ~50
  // SVG (30 client px @ 360vw) of clean gap between adjacent
  // circle-arc labels. Sub-chips sit in matching 100+SVG gaps.
  //   SETTINGS cluster chip:  y=475
  //   ACCESS chip:            y=560 (85 gap under cluster)
  //   Access row 1:           y=680 (120 gap under ACCESS chip)
  //   Access row 2:           y=880 (200 gap)
  //   DATA & AUTOMATION chip: y=990 (110 gap under row 2)
  //   Data row 1:             y=1120 (130 gap under DATA chip)
  //   Data row 2:             y=1300 (180 gap)
  { key: 'settings-access', parent: 'settings', label: 'Access',            x: 380, y: 560  },
  { key: 'settings-data',   parent: 'settings', label: 'Data & Automation', x: 380, y: 990 },
];

// (x, y) is the CENTRE of each 128×128 icon tile.
export const SCHEMATIC_NODES = [
  // ── OVERVIEW (top centre — 4 nodes in a horizontal row) ────────────
  { id: 'overview-dashboard', cluster: 'overview', label: 'Dashboard',        icon: 'LayoutDashboard', route: '/app/dashboard',        x: 720,  y: 200 },
  { id: 'overview-ask',       cluster: 'overview', label: 'Ask Intelligence', icon: 'Sparkles',        route: '/app/ask',              x: 875,  y: 200 },
  { id: 'overview-doclib',    cluster: 'overview', label: 'Document Library', icon: 'FolderOpen',      route: '/app/document-library', x: 1030, y: 200 },
  { id: 'overview-outbox',    cluster: 'overview', label: 'Outbox',           icon: 'Inbox',           route: '/app/outbox',           x: 1185, y: 200 },

  // ── CAPTURE (top-right — 6 nodes 3×2 grid) ─────────────────────────
  { id: 'capture-swms',        cluster: 'capture', label: 'AI SWMS',      icon: 'FileText',       route: '/app/swms',        x: 1300, y: 395 },
  { id: 'capture-prestarts',   cluster: 'capture', label: 'Pre-Starts',   icon: 'CheckCircle2',   route: '/app/pre-starts',  x: 1455, y: 395 },
  { id: 'capture-diary',       cluster: 'capture', label: 'Site Diary',   icon: 'BookOpen',       route: '/app/site-diary',  x: 1610, y: 395 },
  { id: 'capture-hazards',     cluster: 'capture', label: 'Hazards',      icon: 'AlertTriangle',  route: '/app/hazards',     x: 1300, y: 570 },
  { id: 'capture-incidents',   cluster: 'capture', label: 'Incidents',    icon: 'Siren',          route: '/app/incidents',   x: 1455, y: 570 },
  { id: 'capture-inspections', cluster: 'capture', label: 'Inspections',  icon: 'ClipboardCheck', route: '/app/inspections', x: 1610, y: 570 },

  // ── COMPLIANCE (right-middle — 5 nodes 3+2) ────────────────────────
  { id: 'compliance-risk',        cluster: 'compliance', label: 'Risk Assess',    icon: 'ShieldAlert',  route: '/app/risk-assessments', x: 1300, y: 930  },
  { id: 'compliance-contractors', cluster: 'compliance', label: 'Contractors',    icon: 'Building2',    route: '/app/contractors',      x: 1455, y: 930  },
  { id: 'compliance-suppliers',   cluster: 'compliance', label: 'Suppliers',      icon: 'Truck',        route: '/app/suppliers',        x: 1610, y: 930  },
  { id: 'compliance-renewals',    cluster: 'compliance', label: 'Renewals',       icon: 'RefreshCw',    route: '/app/renewals',         x: 1377, y: 1105 },
  { id: 'compliance-audit',       cluster: 'compliance', label: 'Audit Exports',  icon: 'PackageCheck', route: '/app/audit-exports',    x: 1532, y: 1105 },

  // ── REGISTER (bottom centre — 4 nodes in a horizontal row) ─────────
  { id: 'register-workers',  cluster: 'register', label: 'Workers',  icon: 'HardHat',  route: '/app/settings/workers', x: 720,  y: 1355 },
  { id: 'register-vehicles', cluster: 'register', label: 'Vehicles', icon: 'Car',      route: '/app/vehicles',         x: 875,  y: 1355 },
  { id: 'register-sites',    cluster: 'register', label: 'Sites',    icon: 'MapPin',   route: '/app/sites',            x: 1030, y: 1355 },
  { id: 'register-forms',    cluster: 'register', label: 'Forms',    icon: 'FilePlus', route: '/app/forms',            x: 1185, y: 1355 },

  // ── SETTINGS · ACCESS (Settings cluster lifted UP + widened per
  //    user's third feedback. Row centres now y=750/900, node x-
  //    centres 130/380/630 — a 50-unit widening from v54's 130/330/530.
  //    This gives 250-unit horizontal centre-to-centre spacing
  //    (edge-to-edge circle gap ≈ 126 SVG units) — very generous
  //    breathing room at every viewport width. Vertical spacing
  //    between rows 150 SVG units (circle edge gap ≈ 26). ─────────
  { id: 'settings-org',        cluster: 'settings', sub: 'settings-access', label: 'Organisation',  icon: 'Building',  route: '/app/settings/org',                x: 130, y: 750 },
  { id: 'settings-workspaces', cluster: 'settings', sub: 'settings-access', label: 'Workspaces',    icon: 'Layers',    route: '/app/settings/workspaces',         x: 380, y: 750 },
  { id: 'settings-users',      cluster: 'settings', sub: 'settings-access', label: 'Users & Perms', icon: 'Users',     route: '/app/settings/users',              x: 630, y: 750 },
  { id: 'settings-roles',      cluster: 'settings', sub: 'settings-access', label: 'Roles Admin',   icon: 'UserCog',   route: '/app/settings/roles-admin',        x: 130, y: 900 },
  { id: 'settings-presets',    cluster: 'settings', sub: 'settings-access', label: 'Perm Presets',  icon: 'KeyRound',  route: '/app/settings/permission-presets', x: 380, y: 900 },
  { id: 'settings-system',     cluster: 'settings', sub: 'settings-access', label: 'System',        icon: 'Server',    route: '/app/settings/system',             x: 630, y: 900 },

  // ── SETTINGS · DATA & AUTOMATION — Data row 1 at y=1120 (with
  //    ~150 SVG gap under Access row 2 for the sub-cluster chip),
  //    Data row 2 at y=1270. Bottom-most Settings tile at y=1270+62
  //    = 1332 — 168 SVG units of clean canvas below before the
  //    Register row at y=1355. ────────────────────────────────────
  { id: 'settings-certs',   cluster: 'settings', sub: 'settings-data', label: 'Certifications', icon: 'BadgeCheck',    route: '/app/settings/certifications',   x: 130, y: 1120 },
  { id: 'settings-formasg', cluster: 'settings', sub: 'settings-data', label: 'Form Assign',    icon: 'ClipboardList', route: '/app/settings/form-assignments', x: 380, y: 1120 },
  { id: 'settings-swmsasg', cluster: 'settings', sub: 'settings-data', label: 'SWMS Assign',    icon: 'FileCheck',     route: '/app/settings/swms-assignments', x: 630, y: 1120 },
  { id: 'settings-backup',  cluster: 'settings', sub: 'settings-data', label: 'Backup',         icon: 'Database',      route: '/app/settings/backup',           x: 255, y: 1300 },
  { id: 'settings-comms',   cluster: 'settings', sub: 'settings-data', label: 'Comms Safe',     icon: 'ShieldOff',     route: '/app/settings/comms-safe-mode',  x: 505, y: 1300 },

  // ── INTEGRATIONS (v54 — moved UP-LEFT into the top-left canvas
  //    corner per user's own layout suggestion: gives Settings room to
  //    breathe and creates a dedicated integrations band). ────────────
  { id: 'integrations-simpro',    cluster: 'integrations', label: 'Simpro',        icon: 'Plug',          route: '/app/settings/integrations/simpro',        x: 130, y: 200 },
  { id: 'integrations-navixy',    cluster: 'integrations', label: 'Navixy',        icon: 'Radar',         route: '/app/settings/integrations/navixy',        x: 330, y: 200 },
  { id: 'integrations-m365',      cluster: 'integrations', label: 'Microsoft 365', icon: 'Mail',          route: '/app/settings/integrations/microsoft365',  x: 130, y: 400 },
  { id: 'integrations-textmagic', cluster: 'integrations', label: 'TextMagic',     icon: 'MessageSquare', route: '/app/settings/integrations/textmagic',     x: 330, y: 400 },
];
