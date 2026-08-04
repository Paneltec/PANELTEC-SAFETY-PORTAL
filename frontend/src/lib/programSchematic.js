// v160.3.9.47.1 — Program Schematic topology registry.
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
  { key: 'overview',     label: 'Overview',     color: '#0EA5E9', anchor: { x: 950,  y: 305 },  labelPos: { x: 950,  y: 100  } },
  { key: 'capture',      label: 'Capture',      color: '#F97316', anchor: { x: 1400, y: 495 },  labelPos: { x: 1610, y: 275  } },
  { key: 'compliance',   label: 'Compliance',   color: '#10B981', anchor: { x: 1400, y: 1050 }, labelPos: { x: 1610, y: 830  } },
  { key: 'register',     label: 'Register',     color: '#6366F1', anchor: { x: 950,  y: 1265 }, labelPos: { x: 950,  y: 1470 } },
  { key: 'settings',     label: 'Settings',     color: '#8B5CF6', anchor: { x: 525,  y: 1105 }, labelPos: { x: 255,  y: 760  } },
  { key: 'integrations', label: 'Integrations', color: '#F59E0B', anchor: { x: 450,  y: 470 },  labelPos: { x: 335,  y: 275  } },
];

export const SCHEMATIC_SUB_CLUSTERS = [
  { key: 'settings-access', parent: 'settings', label: 'Access',            x: 95, y: 810 },
  { key: 'settings-data',   parent: 'settings', label: 'Data & Automation', x: 95, y: 1090 },
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

  // ── COMPLIANCE (bottom-right — 5 nodes 3+2) ───────────────────────
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

  // ── SETTINGS · ACCESS (left-lower upper — 6 nodes 3×2) ─────────────
  { id: 'settings-org',        cluster: 'settings', sub: 'settings-access', label: 'Organisation',  icon: 'Building',  route: '/app/settings/org',                x: 100, y: 890  },
  { id: 'settings-workspaces', cluster: 'settings', sub: 'settings-access', label: 'Workspaces',    icon: 'Layers',    route: '/app/settings/workspaces',         x: 255, y: 890  },
  { id: 'settings-users',      cluster: 'settings', sub: 'settings-access', label: 'Users & Perms', icon: 'Users',     route: '/app/settings/users',              x: 410, y: 890  },
  { id: 'settings-roles',      cluster: 'settings', sub: 'settings-access', label: 'Roles Admin',   icon: 'UserCog',   route: '/app/settings/roles-admin',        x: 100, y: 1010 },
  { id: 'settings-presets',    cluster: 'settings', sub: 'settings-access', label: 'Perm Presets',  icon: 'KeyRound',  route: '/app/settings/permission-presets', x: 255, y: 1010 },
  { id: 'settings-system',     cluster: 'settings', sub: 'settings-access', label: 'System',        icon: 'Server',    route: '/app/settings/system',             x: 410, y: 1010 },

  // ── SETTINGS · DATA & AUTOMATION (left-lower lower — 5 nodes 3+2) ──
  { id: 'settings-certs',   cluster: 'settings', sub: 'settings-data', label: 'Certifications', icon: 'BadgeCheck',    route: '/app/settings/certifications',   x: 100, y: 1170 },
  { id: 'settings-formasg', cluster: 'settings', sub: 'settings-data', label: 'Form Assign',    icon: 'ClipboardList', route: '/app/settings/form-assignments', x: 255, y: 1170 },
  { id: 'settings-swmsasg', cluster: 'settings', sub: 'settings-data', label: 'SWMS Assign',    icon: 'FileCheck',     route: '/app/settings/swms-assignments', x: 410, y: 1170 },
  { id: 'settings-backup',  cluster: 'settings', sub: 'settings-data', label: 'Backup',         icon: 'Database',      route: '/app/settings/backup',           x: 178, y: 1290 },
  { id: 'settings-comms',   cluster: 'settings', sub: 'settings-data', label: 'Comms Safe',     icon: 'ShieldOff',     route: '/app/settings/comms-safe-mode',  x: 333, y: 1290 },

  // ── INTEGRATIONS (top-left — 4 nodes 2×2) ──────────────────────────
  { id: 'integrations-simpro',    cluster: 'integrations', label: 'Simpro',        icon: 'Plug',          route: '/app/settings/integrations/simpro',        x: 260, y: 395 },
  { id: 'integrations-navixy',    cluster: 'integrations', label: 'Navixy',        icon: 'Radar',         route: '/app/settings/integrations/navixy',        x: 415, y: 395 },
  { id: 'integrations-m365',      cluster: 'integrations', label: 'Microsoft 365', icon: 'Mail',          route: '/app/settings/integrations/microsoft365',  x: 260, y: 570 },
  { id: 'integrations-textmagic', cluster: 'integrations', label: 'TextMagic',     icon: 'MessageSquare', route: '/app/settings/integrations/textmagic',     x: 415, y: 570 },
];
