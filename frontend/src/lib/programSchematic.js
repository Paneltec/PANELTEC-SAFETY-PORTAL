// v160.3.9.56 — Program Schematic topology registry (grid-only).
// v58.13.132cx — Mobile App section rebuilt from live Mongo snapshot
//   after `.132cw` filter-repo incident. Represents `.132cr` overlay
//   layer + `.132cs/ct/cu` real-runtime contents consolidated as a
//   single ship. See `/app/memory/v58_13_132cx_...md`.
//
// The SVG topology in `pages/settings/ProgramSchematicPage.jsx` was
// retired in v56 in favour of a responsive CSS grid. The `anchor`,
// `labelPos`, and per-node `x` / `y` fields below are legacy geometry
// no longer read by any renderer — they remain in the file only so
// the historical schematic diff is legible.
//
// Cluster palette:
//   Overview     Sky      #0EA5E9  (4 nodes)
//   Capture      Orange   #F97316  (6 nodes)
//   Compliance   Emerald  #10B981  (5 nodes)
//   Register     Indigo   #6366F1  (4 nodes)
//   Settings     Violet   #8B5CF6  (11 nodes)
//   Integrations Sky      #0EA5E9  (4 nodes)
//   Mobile App   (20 sub-clusters, 81 nodes — see below)

export const SCHEMATIC_CLUSTERS = [
  { key: 'integrations', label: 'Integrations', color: '#0EA5E9', anchor: { x: 200,  y: 200 },  labelPos: { x: 200,  y: 60   } },
  { key: 'overview',     label: 'Overview',     color: '#0EA5E9', anchor: { x: 950,  y: 305 },  labelPos: { x: 950,  y: 60   } },
  { key: 'capture',      label: 'Capture',      color: '#F97316', anchor: { x: 1400, y: 495 },  labelPos: { x: 1610, y: 235  } },
  { key: 'compliance',   label: 'Compliance',   color: '#10B981', anchor: { x: 1400, y: 1050 }, labelPos: { x: 1610, y: 790  } },
  { key: 'register',     label: 'Register',     color: '#6366F1', anchor: { x: 950,  y: 1265 }, labelPos: { x: 950,  y: 1490 } },
  { key: 'settings',     label: 'Settings',     color: '#8B5CF6', anchor: { x: 525,  y: 900 },  labelPos: { x: 380,  y: 475  } },

  // v58.13.132cx — Mobile App section (grouped below top-level clusters).
  // 20 sub-clusters carrying `parent_section: 'mobile'`.
  { key: 'mobile_before_login',    label: 'Before Login',                             color: '#14B8A6', parent_section: 'mobile', anchor: { x: 0, y: 0 }, labelPos: { x: 0, y: 0 } },
  { key: 'mobile_home_admin',      label: 'Home · Admin',                             color: '#0D9488', parent_section: 'mobile', anchor: { x: 0, y: 0 }, labelPos: { x: 0, y: 0 } },
  { key: 'mobile_home_paneltec',   label: 'Home · Paneltec Civil',                    color: '#0D9488', parent_section: 'mobile', anchor: { x: 0, y: 0 }, labelPos: { x: 0, y: 0 } },
  { key: 'mobile_home_viatec',     label: 'Home · Viatec Traffic',                    color: '#0D9488', parent_section: 'mobile', anchor: { x: 0, y: 0 }, labelPos: { x: 0, y: 0 } },
  { key: 'mobile_home_contractor', label: 'Home · External Contractor',               color: '#0D9488', parent_section: 'mobile', anchor: { x: 0, y: 0 }, labelPos: { x: 0, y: 0 } },
  { key: 'mobile_forms_general',    label: 'Tab · Forms · General',                   color: '#06B6D4', parent_section: 'mobile', anchor: { x: 0, y: 0 }, labelPos: { x: 0, y: 0 } },
  { key: 'mobile_forms_swms',       label: 'Tab · Forms · SWMS',                      color: '#0284C7', parent_section: 'mobile', anchor: { x: 0, y: 0 }, labelPos: { x: 0, y: 0 } },
  { key: 'mobile_forms_prestart',   label: 'Tab · Forms · Pre-Start',                 color: '#0891B2', parent_section: 'mobile', anchor: { x: 0, y: 0 }, labelPos: { x: 0, y: 0 } },
  { key: 'mobile_forms_inspection', label: 'Tab · Forms · Inspection',                color: '#6366F1', parent_section: 'mobile', anchor: { x: 0, y: 0 }, labelPos: { x: 0, y: 0 } },
  { key: 'mobile_forms_nearmiss',   label: 'Tab · Forms · Near Miss',                 color: '#F59E0B', parent_section: 'mobile', anchor: { x: 0, y: 0 }, labelPos: { x: 0, y: 0 } },
  { key: 'mobile_forms_incident',   label: 'Tab · Forms · Incident',                  color: '#F43F5E', parent_section: 'mobile', anchor: { x: 0, y: 0 }, labelPos: { x: 0, y: 0 } },
  { key: 'mobile_forms_toolbox',    label: 'Tab · Forms · Toolbox',                   color: '#14B8A6', parent_section: 'mobile', anchor: { x: 0, y: 0 }, labelPos: { x: 0, y: 0 } },
  { key: 'mobile_forms_admin',      label: 'Tab · Forms · Admin (hidden)',            color: '#64748B', parent_section: 'mobile', anchor: { x: 0, y: 0 }, labelPos: { x: 0, y: 0 } },
  { key: 'mobile_forms_hazard',     label: 'Tab · Forms · Hazard (hidden)',           color: '#F59E0B', parent_section: 'mobile', anchor: { x: 0, y: 0 }, labelPos: { x: 0, y: 0 } },
  { key: 'mobile_forms_risk',       label: 'Tab · Forms · Risk Assessment (hidden)',  color: '#8B5CF6', parent_section: 'mobile', anchor: { x: 0, y: 0 }, labelPos: { x: 0, y: 0 } },
  { key: 'mobile_forms_sitediary',  label: 'Tab · Forms · Site Diary (hidden)',       color: '#818CF8', parent_section: 'mobile', anchor: { x: 0, y: 0 }, labelPos: { x: 0, y: 0 } },
  { key: 'mobile_profile',         label: 'Tab · Profile',                            color: '#0891B2', parent_section: 'mobile', anchor: { x: 0, y: 0 }, labelPos: { x: 0, y: 0 } },
  { key: 'mobile_toolbox',         label: 'Tab · Toolbox Meetings',                   color: '#0284C7', parent_section: 'mobile', anchor: { x: 0, y: 0 }, labelPos: { x: 0, y: 0 } },
  { key: 'mobile_modals',          label: 'Site Sign-In / Out',                       color: '#64748B', parent_section: 'mobile', anchor: { x: 0, y: 0 }, labelPos: { x: 0, y: 0 } },
  { key: 'mobile_visitor',         label: 'Visitor Wizard',                           color: '#818CF8', parent_section: 'mobile', anchor: { x: 0, y: 0 }, labelPos: { x: 0, y: 0 } },
];

export const SCHEMATIC_SUB_CLUSTERS = [
  // Settings has two sub-headers to prevent the 11-tile block from feeling flat.
  { key: 'settings-access', parent: 'settings', label: 'Access',            x: 380, y: 560  },
  { key: 'settings-data',   parent: 'settings', label: 'Data & Automation', x: 380, y: 990 },
];

export const SCHEMATIC_NODES = [
  // ── OVERVIEW ──
  { id: 'overview-dash', cluster: 'overview', label: 'Dashboard',       icon: 'LayoutDashboard', route: '/app/dashboard',              x: 810,  y: 355 },
  { id: 'overview-ai',   cluster: 'overview', label: 'Ask Intelligence',icon: 'Sparkles',        route: '/app/ask',                    x: 940,  y: 355 },
  { id: 'overview-docs', cluster: 'overview', label: 'Document Library',icon: 'FolderOpen',      route: '/app/documents',              x: 1070, y: 355 },
  { id: 'overview-out',  cluster: 'overview', label: 'Outbox',          icon: 'Mail',            route: '/app/outbox',                 x: 1195, y: 355 },

  // ── CAPTURE ──
  { id: 'capture-ai-swms',    cluster: 'capture', label: 'AI SWMS',     icon: 'FileText',       route: '/app/capture/ai-swms',           x: 1400, y: 575 },
  { id: 'capture-prestarts',  cluster: 'capture', label: 'Pre-Starts',  icon: 'CheckSquare',    route: '/app/capture/pre-starts',        x: 1400, y: 645 },
  { id: 'capture-site-diary', cluster: 'capture', label: 'Site Diary',  icon: 'BookOpen',       route: '/app/capture/site-diary',        x: 1400, y: 715 },
  { id: 'capture-hazards',    cluster: 'capture', label: 'Hazards',     icon: 'AlertTriangle',  route: '/app/capture/hazards',           x: 1400, y: 785 },
  { id: 'capture-incidents',  cluster: 'capture', label: 'Incidents',   icon: 'Siren',          route: '/app/capture/incidents',         x: 1400, y: 855 },
  { id: 'capture-inspections',cluster: 'capture', label: 'Inspections', icon: 'ClipboardList',  route: '/app/capture/inspections',       x: 1400, y: 925 },

  // ── COMPLIANCE ──
  { id: 'compliance-suppliers', cluster: 'compliance', label: 'Suppliers',       icon: 'Users',       route: '/app/compliance/suppliers',        x: 1400, y: 1050 },
  { id: 'compliance-renewals',  cluster: 'compliance', label: 'Renewal Links',   icon: 'Link2',       route: '/app/compliance/renewals',         x: 1400, y: 1120 },
  { id: 'compliance-library',   cluster: 'compliance', label: 'Document Library',icon: 'FolderOpen',  route: '/app/compliance/library',          x: 1400, y: 1190 },
  { id: 'compliance-audits',    cluster: 'compliance', label: 'Audit Exports',   icon: 'FileDown',    route: '/app/compliance/audits',           x: 1400, y: 1260 },
  { id: 'compliance-inductions',cluster: 'compliance', label: 'Inductions',      icon: 'GraduationCap',route: '/app/compliance/inductions',      x: 1400, y: 1330 },

  // ── REGISTER ──
  { id: 'register-workers',  cluster: 'register', label: 'Workers',   icon: 'Users',      route: '/app/register/workers',   x: 810,  y: 1360 },
  { id: 'register-vehicles', cluster: 'register', label: 'Vehicles',  icon: 'Truck',      route: '/app/register/vehicles',  x: 940,  y: 1360 },
  { id: 'register-sites',    cluster: 'register', label: 'Sites',     icon: 'MapPin',     route: '/app/register/sites',     x: 1070, y: 1360 },
  { id: 'register-forms',    cluster: 'register', label: 'Forms',     icon: 'FileText',   route: '/app/register/forms',     x: 1195, y: 1360 },

  // ── SETTINGS · ACCESS ──
  { id: 'settings-org',     cluster: 'settings', sub: 'settings-access', label: 'Organisation',    icon: 'Building2',   route: '/app/settings/org',              x: 130, y: 640 },
  { id: 'settings-ws',      cluster: 'settings', sub: 'settings-access', label: 'Workspaces',      icon: 'Layers',      route: '/app/settings/workspaces',       x: 380, y: 640 },
  { id: 'settings-users',   cluster: 'settings', sub: 'settings-access', label: 'Users & Perms',   icon: 'UserCog',     route: '/app/settings/users',            x: 630, y: 640 },
  { id: 'settings-roles',   cluster: 'settings', sub: 'settings-access', label: 'Roles Admin',     icon: 'ShieldCog',   route: '/app/settings/roles',            x: 880, y: 640 },
  { id: 'settings-presets', cluster: 'settings', sub: 'settings-access', label: 'Perm Presets',    icon: 'KeyRound',    route: '/app/settings/permission-presets', x: 255, y: 820 },
  { id: 'settings-system',  cluster: 'settings', sub: 'settings-access', label: 'System',          icon: 'Server',      route: '/app/settings/system',           x: 505, y: 820 },

  // ── SETTINGS · DATA & AUTOMATION ──
  { id: 'settings-certs',   cluster: 'settings', sub: 'settings-data', label: 'Certifications', icon: 'BadgeCheck',    route: '/app/settings/certifications',   x: 130, y: 1120 },
  { id: 'settings-formasg', cluster: 'settings', sub: 'settings-data', label: 'Form Assign',    icon: 'ClipboardList', route: '/app/settings/form-assignments', x: 380, y: 1120 },
  { id: 'settings-swmsasg', cluster: 'settings', sub: 'settings-data', label: 'SWMS Assign',    icon: 'FileCheck',     route: '/app/settings/swms-assignments', x: 630, y: 1120 },
  { id: 'settings-backup',  cluster: 'settings', sub: 'settings-data', label: 'Backup',         icon: 'Database',      route: '/app/settings/backup',           x: 255, y: 1300 },
  { id: 'settings-comms',   cluster: 'settings', sub: 'settings-data', label: 'Comms Safe',     icon: 'ShieldOff',     route: '/app/settings/comms-safe-mode',  x: 505, y: 1300 },

  // ── INTEGRATIONS ──
  { id: 'integrations-simpro',    cluster: 'integrations', label: 'Simpro',        icon: 'Plug',          route: '/app/settings/integrations/simpro',        x: 130, y: 200 },
  { id: 'integrations-navixy',    cluster: 'integrations', label: 'Navixy',        icon: 'Radar',         route: '/app/settings/integrations/navixy',        x: 330, y: 200 },
  { id: 'integrations-m365',      cluster: 'integrations', label: 'Microsoft 365', icon: 'Mail',          route: '/app/settings/integrations/microsoft365',  x: 130, y: 400 },
  { id: 'integrations-textmagic', cluster: 'integrations', label: 'TextMagic',     icon: 'MessageSquare', route: '/app/settings/integrations/textmagic',     x: 330, y: 400 },

  // ═══════════════════════ MOBILE APP ═══════════════════════

  // Before Login (3 nodes)
  { id: 'mobile-splash',           cluster: 'mobile_before_login', label: 'Auth / Splash / Router',            icon: 'Rocket',   route: null, desc: 'app/index.tsx — decides between welcome / pin-entry / home based on device_id + session.', x: 0, y: 0 },
  { id: 'mobile-welcome-qr',       cluster: 'mobile_before_login', label: 'Auth / Welcome / QR Scan',          icon: 'QrCode',   route: null, desc: 'app/(auth)/welcome.tsx — first-launch QR device provisioning + manual device_id fallback.', x: 0, y: 0 },
  { id: 'mobile-pin-entry',        cluster: 'mobile_before_login', label: 'Auth / PIN Entry / Welcome Back',   icon: 'KeyRound', route: null, desc: 'app/(auth)/pin-entry.tsx — 4-digit PIN pad; fetches device-hint for "Welcome back {name}" greeting.', x: 0, y: 0 },

  // Home · Admin (8 tiles — grid only, dynamic Daily Job tile omitted per Stephen's .132cu decision)
  { id: 'mobile-home-admin-forms',    cluster: 'mobile_home_admin', label: 'Home / Admin / Forms Library', icon: 'FileText',    route: null, desc: 'ADMIN_MODULES.forms → routes to /(tabs)/forms.', x: 0, y: 0 },
  { id: 'mobile-home-admin-workers',  cluster: 'mobile_home_admin', label: 'Home / Admin / Workers',       icon: 'Users',       route: null, desc: 'ADMIN_MODULES.workers — stub tile.', x: 0, y: 0 },
  { id: 'mobile-home-admin-sites',    cluster: 'mobile_home_admin', label: 'Home / Admin / Sites',         icon: 'MapPin',      route: null, desc: 'ADMIN_MODULES.sites — stub tile.', x: 0, y: 0 },
  { id: 'mobile-home-admin-swms',     cluster: 'mobile_home_admin', label: 'Home / Admin / SWMS',          icon: 'ShieldCheck', route: null, desc: 'ADMIN_MODULES.swms — stub tile.', x: 0, y: 0 },
  { id: 'mobile-home-admin-fleet',    cluster: 'mobile_home_admin', label: 'Home / Admin / Fleet',         icon: 'Truck',       route: null, desc: 'ADMIN_MODULES.fleet — stub tile.', x: 0, y: 0 },
  { id: 'mobile-home-admin-reports',  cluster: 'mobile_home_admin', label: 'Home / Admin / Reports',       icon: 'BarChart',    route: null, desc: 'ADMIN_MODULES.reports — stub tile.', x: 0, y: 0 },
  { id: 'mobile-home-admin-settings', cluster: 'mobile_home_admin', label: 'Home / Admin / Settings',      icon: 'Settings',    route: null, desc: 'ADMIN_MODULES.settings — stub tile.', x: 0, y: 0 },
  { id: 'mobile-home-admin-audit',    cluster: 'mobile_home_admin', label: 'Home / Admin / Audit Log',     icon: 'List',        route: null, desc: 'ADMIN_MODULES.audit — stub tile.', x: 0, y: 0 },

  // Home · Paneltec Civil (6 tiles)
  { id: 'mobile-home-paneltec-forms',      cluster: 'mobile_home_paneltec', label: 'Home / Paneltec Civil / Forms',      icon: 'FileText',      route: null, desc: 'CIVIL_MODULES.forms → routes to /(tabs)/forms.', x: 0, y: 0 },
  { id: 'mobile-home-paneltec-prestarts',  cluster: 'mobile_home_paneltec', label: 'Home / Paneltec Civil / Pre-Starts', icon: 'CheckSquare',   route: null, desc: 'CIVIL_MODULES.prestarts — stub tile.', x: 0, y: 0 },
  { id: 'mobile-home-paneltec-swms',       cluster: 'mobile_home_paneltec', label: 'Home / Paneltec Civil / My SWMS',    icon: 'ShieldCheck',   route: null, desc: 'CIVIL_MODULES.swms — stub tile.', x: 0, y: 0 },
  { id: 'mobile-home-paneltec-timesheets', cluster: 'mobile_home_paneltec', label: 'Home / Paneltec Civil / Timesheets', icon: 'Clock',         route: null, desc: 'CIVIL_MODULES.timesheets — stub tile.', x: 0, y: 0 },
  { id: 'mobile-home-paneltec-hazards',    cluster: 'mobile_home_paneltec', label: 'Home / Paneltec Civil / Hazards',    icon: 'AlertTriangle', route: null, desc: 'CIVIL_MODULES.hazards — stub tile.', x: 0, y: 0 },
  { id: 'mobile-home-paneltec-incidents',  cluster: 'mobile_home_paneltec', label: 'Home / Paneltec Civil / Incidents',  icon: 'AlertCircle',   route: null, desc: 'CIVIL_MODULES.incidents — stub tile.', x: 0, y: 0 },

  // Home · Viatec Traffic (6 tiles)
  { id: 'mobile-home-viatec-forms',      cluster: 'mobile_home_viatec', label: 'Home / Viatec Traffic / Forms',           icon: 'FileText',     route: null, desc: 'VIATEC_MODULES.forms → routes to /(tabs)/forms.', x: 0, y: 0 },
  { id: 'mobile-home-viatec-sitescan',   cluster: 'mobile_home_viatec', label: 'Home / Viatec Traffic / Site Scan',       icon: 'ScanLine',     route: null, desc: 'VIATEC_MODULES.sitescan — stub tile.', x: 0, y: 0 },
  { id: 'mobile-home-viatec-prestarts',  cluster: 'mobile_home_viatec', label: 'Home / Viatec Traffic / Pre-Starts',      icon: 'CheckSquare',  route: null, desc: 'VIATEC_MODULES.prestarts — stub tile.', x: 0, y: 0 },
  { id: 'mobile-home-viatec-incidents',  cluster: 'mobile_home_viatec', label: 'Home / Viatec Traffic / Incident Report', icon: 'AlertCircle',  route: null, desc: 'VIATEC_MODULES.incidents — stub tile.', x: 0, y: 0 },
  { id: 'mobile-home-viatec-swms',       cluster: 'mobile_home_viatec', label: 'Home / Viatec Traffic / My SWMS',         icon: 'ShieldCheck',  route: null, desc: 'VIATEC_MODULES.swms — stub tile.', x: 0, y: 0 },
  { id: 'mobile-home-viatec-timesheets', cluster: 'mobile_home_viatec', label: 'Home / Viatec Traffic / Timesheets',      icon: 'Clock',        route: null, desc: 'VIATEC_MODULES.timesheets — stub tile.', x: 0, y: 0 },

  // Home · External Contractor (2 tiles)
  { id: 'mobile-home-contractor-swms', cluster: 'mobile_home_contractor', label: 'Home / External Contractor / Assigned SWMS',    icon: 'ShieldCheck', route: null, desc: 'CONTRACTOR_MODULES.swms — stub tile.', x: 0, y: 0 },
  { id: 'mobile-home-contractor-ack',  cluster: 'mobile_home_contractor', label: 'Home / External Contractor / Acknowledgements', icon: 'CheckCircle2',route: null, desc: 'CONTRACTOR_MODULES.ack — stub tile.', x: 0, y: 0 },

  // Tab · Forms · General (12 templates)
  { id: 'mobile-form-general-asbestos',         cluster: 'mobile_forms_general', label: 'Home / Forms / General / Asbestos Awareness / Class B Removal', icon: 'FileText', route: null, desc: 'db.form_templates category=general.', x: 0, y: 0 },
  { id: 'mobile-form-general-byda',             cluster: 'mobile_forms_general', label: 'Home / Forms / General / BYDA / Utility Awareness',             icon: 'FileText', route: null, desc: 'db.form_templates category=general.', x: 0, y: 0 },
  { id: 'mobile-form-general-confined-space',   cluster: 'mobile_forms_general', label: 'Home / Forms / General / Confined Space Entry Permit',          icon: 'FileText', route: null, desc: 'db.form_templates category=general.', x: 0, y: 0 },
  { id: 'mobile-form-general-crane-lift',       cluster: 'mobile_forms_general', label: 'Home / Forms / General / Crane Lift / Rigging Plan',            icon: 'FileText', route: null, desc: 'db.form_templates category=general.', x: 0, y: 0 },
  { id: 'mobile-form-general-excavation',       cluster: 'mobile_forms_general', label: 'Home / Forms / General / Excavation / Trench Permit',           icon: 'FileText', route: null, desc: 'db.form_templates category=general.', x: 0, y: 0 },
  { id: 'mobile-form-general-hazard-reporting', cluster: 'mobile_forms_general', label: 'Home / Forms / General / Hazard Reporting Form',                icon: 'FileText', route: null, desc: 'db.form_templates category=general.', x: 0, y: 0 },
  { id: 'mobile-form-general-hot-work',         cluster: 'mobile_forms_general', label: 'Home / Forms / General / Hot Work Permit',                      icon: 'FileText', route: null, desc: 'db.form_templates category=general.', x: 0, y: 0 },
  { id: 'mobile-form-general-jsea',             cluster: 'mobile_forms_general', label: 'Home / Forms / General / JSEA — Job Safety & Environmental Analysis', icon: 'FileText', route: null, desc: 'db.form_templates category=general.', x: 0, y: 0 },
  { id: 'mobile-form-general-swms-signon',      cluster: 'mobile_forms_general', label: 'Home / Forms / General / SWMS Sign-On',                         icon: 'FileText', route: null, desc: 'db.form_templates category=general.', x: 0, y: 0 },
  { id: 'mobile-form-general-visitor-register', cluster: 'mobile_forms_general', label: 'Home / Forms / General / Site Sign-In / Visitor Register',      icon: 'FileText', route: null, desc: 'db.form_templates category=general.', x: 0, y: 0 },
  { id: 'mobile-form-general-working-heights',  cluster: 'mobile_forms_general', label: 'Home / Forms / General / Working at Heights Permit',            icon: 'FileText', route: null, desc: 'db.form_templates category=general.', x: 0, y: 0 },
  { id: 'mobile-form-general-safety-checklist', cluster: 'mobile_forms_general', label: 'Home / Forms / General / Site-Safety-Checklist',                icon: 'FileText', route: null, desc: 'db.form_templates category=general.', x: 0, y: 0 },

  // Tab · Forms · SWMS (4 — bridged from db.swms)
  { id: 'mobile-form-swms-concrete-cutting',   cluster: 'mobile_forms_swms', label: 'Home / Forms / SWMS / Concrete or Asphalt Cutting',                icon: 'ShieldCheck', route: null, desc: 'db.swms status=approved.', x: 0, y: 0 },
  { id: 'mobile-form-swms-confined-space',     cluster: 'mobile_forms_swms', label: 'Home / Forms / SWMS / Confined Space Entry — Culvert C7',          icon: 'ShieldCheck', route: null, desc: 'db.swms status=draft.', x: 0, y: 0 },
  { id: 'mobile-form-swms-material-lift',      cluster: 'mobile_forms_swms', label: 'Home / Forms / SWMS / Material Lift — Precast Panels Delivery',   icon: 'ShieldCheck', route: null, desc: 'db.swms status=changes_requested.', x: 0, y: 0 },
  { id: 'mobile-form-swms-traffic-management', cluster: 'mobile_forms_swms', label: 'Home / Forms / SWMS / Traffic Management — Erskineville Turnout', icon: 'ShieldCheck', route: null, desc: 'db.swms status=approved.', x: 0, y: 0 },

  // Tab · Forms · Pre-Start (10)
  { id: 'mobile-form-prestart-cvt',              cluster: 'mobile_forms_prestart', label: 'Home / Forms / Pre-Start / CVT Daily Pre-Start',               icon: 'CheckSquare', route: null, desc: 'db.form_templates category=pre_start.', x: 0, y: 0 },
  { id: 'mobile-form-prestart-heavy-eq',         cluster: 'mobile_forms_prestart', label: 'Home / Forms / Pre-Start / Construction Heavy Equipment Pre-Op Checklist', icon: 'CheckSquare', route: null, desc: 'db.form_templates category=pre_start.', x: 0, y: 0 },
  { id: 'mobile-form-prestart-daily',            cluster: 'mobile_forms_prestart', label: 'Home / Forms / Pre-Start / Daily Pre-Start',                   icon: 'CheckSquare', route: null, desc: 'db.form_templates category=pre_start.', x: 0, y: 0 },
  { id: 'mobile-form-prestart-equipment-preuse', cluster: 'mobile_forms_prestart', label: 'Home / Forms / Pre-Start / Equipment Pre-Use Checklist',       icon: 'CheckSquare', route: null, desc: 'db.form_templates category=pre_start.', x: 0, y: 0 },
  { id: 'mobile-form-prestart-heavy-vehicle',    cluster: 'mobile_forms_prestart', label: 'Home / Forms / Pre-Start / Heavy Vehicle Daily Check',         icon: 'CheckSquare', route: null, desc: 'db.form_templates category=pre_start.', x: 0, y: 0 },
  { id: 'mobile-form-prestart-plant-checklist',  cluster: 'mobile_forms_prestart', label: 'Home / Forms / Pre-Start / Plant Pre-Start Checklist (Heavy Equipment)', icon: 'CheckSquare', route: null, desc: 'db.form_templates category=pre_start.', x: 0, y: 0 },
  { id: 'mobile-form-prestart-tip-truck',        cluster: 'mobile_forms_prestart', label: 'Home / Forms / Pre-Start / Tip Truck Daily Pre-Start',         icon: 'CheckSquare', route: null, desc: 'db.form_templates category=pre_start.', x: 0, y: 0 },
  { id: 'mobile-form-prestart-vacuum-truck',     cluster: 'mobile_forms_prestart', label: 'Home / Forms / Pre-Start / Vacuum Truck (VT) Daily Pre-Start', icon: 'CheckSquare', route: null, desc: 'db.form_templates category=pre_start.', x: 0, y: 0 },
  { id: 'mobile-form-prestart-vehicle-preuse',   cluster: 'mobile_forms_prestart', label: 'Home / Forms / Pre-Start / Vehicle Pre-Use Inspection',        icon: 'CheckSquare', route: null, desc: 'db.form_templates category=pre_start.', x: 0, y: 0 },
  { id: 'mobile-form-prestart-weekly',           cluster: 'mobile_forms_prestart', label: 'Home / Forms / Pre-Start / Weekly Pre-Start',                  icon: 'CheckSquare', route: null, desc: 'db.form_templates category=pre_start.', x: 0, y: 0 },

  // Tab · Forms · Inspection (5)
  { id: 'mobile-form-inspection-27-point',   cluster: 'mobile_forms_inspection', label: 'Home / Forms / Inspection / 27 Point Visual Inspection', icon: 'Search', route: null, desc: 'db.form_templates category=inspection.', x: 0, y: 0 },
  { id: 'mobile-form-inspection-scaffold',   cluster: 'mobile_forms_inspection', label: 'Home / Forms / Inspection / Daily Scaffold Inspection',  icon: 'Search', route: null, desc: 'db.form_templates category=inspection.', x: 0, y: 0 },
  { id: 'mobile-form-inspection-daily-site', cluster: 'mobile_forms_inspection', label: 'Home / Forms / Inspection / Daily Site Inspection',      icon: 'Search', route: null, desc: 'db.form_templates category=inspection.', x: 0, y: 0 },
  { id: 'mobile-form-inspection-end-of-day', cluster: 'mobile_forms_inspection', label: 'Home / Forms / Inspection / End of Day Site Sign-Off',   icon: 'Search', route: null, desc: 'db.form_templates category=inspection.', x: 0, y: 0 },
  { id: 'mobile-form-inspection-vehicle',    cluster: 'mobile_forms_inspection', label: 'Home / Forms / Inspection / Vehicle Inspection Report',  icon: 'Search', route: null, desc: 'db.form_templates category=inspection.', x: 0, y: 0 },

  // Tab · Forms · Near Miss (1)
  { id: 'mobile-form-nearmiss-report', cluster: 'mobile_forms_nearmiss', label: 'Home / Forms / Near Miss / Near Miss Report', icon: 'AlertTriangle', route: null, desc: 'db.form_templates category=near_miss.', x: 0, y: 0 },

  // Tab · Forms · Incident (2)
  { id: 'mobile-form-incident-report',        cluster: 'mobile_forms_incident', label: 'Home / Forms / Incident / Incident Report',        icon: 'AlertCircle', route: null, desc: 'db.form_templates category=incident.', x: 0, y: 0 },
  { id: 'mobile-form-incident-test-hot-work', cluster: 'mobile_forms_incident', label: 'Home / Forms / Incident / Test Hot Work Permit',   icon: 'AlertCircle', route: null, desc: 'db.form_templates category=incident.', x: 0, y: 0 },

  // Tab · Forms · Toolbox (2)
  { id: 'mobile-form-toolbox-talk',       cluster: 'mobile_forms_toolbox', label: 'Home / Forms / Toolbox / Toolbox Talk',            icon: 'Users', route: null, desc: 'db.form_templates category=toolbox.', x: 0, y: 0 },
  { id: 'mobile-form-toolbox-attendance', cluster: 'mobile_forms_toolbox', label: 'Home / Forms / Toolbox / Toolbox Talk Attendance', icon: 'Users', route: null, desc: 'db.form_templates category=toolbox.', x: 0, y: 0 },

  // HIDDEN clusters — API returns them, mobile UI drops them.
  { id: 'mobile-form-admin-drug-alcohol',       cluster: 'mobile_forms_admin',     label: 'Home / Forms / Admin / Drug & Alcohol Test Record', icon: 'Lock', route: null, desc: 'STUB — hidden from mobile UI. CATEGORY_ORDER admin-gate trips because getStoredUser().role is undefined for PIN-login sessions. Fix routed to a follow-up Expo ship.', x: 0, y: 0 },
  { id: 'mobile-form-hazard-construction-ssra', cluster: 'mobile_forms_hazard',    label: 'Home / Forms / Hazard / Construction & Excavation SSRA', icon: 'AlertTriangle', route: null, desc: 'STUB — hidden from mobile UI. db.form_templates category=hazard is outside CATEGORY_ORDER so groupByCategory drops it.', x: 0, y: 0 },
  { id: 'mobile-form-hazard-viatec-ssra',       cluster: 'mobile_forms_hazard',    label: 'Home / Forms / Hazard / Viatec Traffic Solutions SSRA',  icon: 'AlertTriangle', route: null, desc: 'STUB — hidden from mobile UI. db.form_templates category=hazard is outside CATEGORY_ORDER so groupByCategory drops it.', x: 0, y: 0 },
  { id: 'mobile-form-risk-ttm',                 cluster: 'mobile_forms_risk',      label: 'Home / Forms / Risk Assessment / TTM Risk Assessment & Treatment Register', icon: 'Scale', route: null, desc: 'STUB — hidden from mobile UI. db.form_templates category=risk_assessment is outside CATEGORY_ORDER so groupByCategory drops it.', x: 0, y: 0 },
  { id: 'mobile-form-sitediary-vts',            cluster: 'mobile_forms_sitediary', label: 'Home / Forms / Site Diary / VTS Tight Site Audit',       icon: 'BookOpen', route: null, desc: 'STUB — hidden from mobile UI. db.form_templates category=site_diary is outside CATEGORY_ORDER so groupByCategory drops it.', x: 0, y: 0 },

  // Tab · Profile (8 — 7 NavRows + 1 cert-detail sub-screen. Payroll is a disabled STUB in the mobile UI.)
  { id: 'mobile-profile-personal',    cluster: 'mobile_profile', label: 'Home / Profile / Personal Information',    icon: 'IdCard',        route: null, desc: 'app/profile/personal.tsx — contact, address, emergency contacts.', x: 0, y: 0 },
  { id: 'mobile-profile-certs',       cluster: 'mobile_profile', label: 'Home / Profile / My Certifications',       icon: 'BadgeCheck',    route: null, desc: 'app/profile/certifications.tsx.', x: 0, y: 0 },
  { id: 'mobile-profile-cert-detail', cluster: 'mobile_profile', label: 'Home / Profile / Certification Detail',    icon: 'FileBadge',     route: null, desc: 'app/profile/certifications/[id].tsx — sub-screen.', x: 0, y: 0 },
  { id: 'mobile-profile-inductions',  cluster: 'mobile_profile', label: 'Home / Profile / My Inductions',           icon: 'GraduationCap', route: null, desc: 'app/profile/inductions.tsx.', x: 0, y: 0 },
  { id: 'mobile-profile-id-card',     cluster: 'mobile_profile', label: 'Home / Profile / Digital ID Card',         icon: 'CreditCard',    route: null, desc: 'app/profile/id-card.tsx — worker QR + photo digital ID.', x: 0, y: 0 },
  { id: 'mobile-profile-fleet',       cluster: 'mobile_profile', label: 'Home / Profile / My Fleet',                icon: 'Truck',         route: null, desc: 'app/profile/fleet/[id].tsx.', x: 0, y: 0 },
  { id: 'mobile-profile-swms',        cluster: 'mobile_profile', label: 'Home / Profile / My SWMS Viewer',          icon: 'ShieldCheck',   route: null, desc: 'app/profile/swms/[id].tsx.', x: 0, y: 0 },
  { id: 'mobile-profile-payroll',     cluster: 'mobile_profile', label: 'Home / Profile / Payroll',                 icon: 'Wallet',        route: null, desc: 'STUB — Disabled ("coming soon") in mobile UI. app/(tabs)/profile.tsx renders a disabled NavRow with badge="STUB".', x: 0, y: 0 },

  // Tab · Toolbox Meetings (1)
  { id: 'mobile-tab-toolbox',   cluster: 'mobile_toolbox', label: 'Tab / Toolbox Meetings',  icon: 'Users',  route: null, desc: 'app/(tabs)/toolbox.tsx — empty-state placeholder, Plaud recorder pending.', x: 0, y: 0 },

  // Site Sign-In / Out Modals (2)
  { id: 'mobile-modal-signin',  cluster: 'mobile_modals', label: 'Modal / Site Sign-In',  icon: 'LogIn',  route: null, desc: 'src/components/SignInModal.tsx.', x: 0, y: 0 },
  { id: 'mobile-modal-signout', cluster: 'mobile_modals', label: 'Modal / Site Sign-Out', icon: 'LogOut', route: null, desc: 'src/components/SignOutModal.tsx.', x: 0, y: 0 },

  // Visitor Wizard (4 steps)
  { id: 'mobile-visitor-step1', cluster: 'mobile_visitor', label: 'Visitor / Step 1 · Photo',      icon: 'Camera',      route: null, desc: 'app/visitor/[siteId]/step1.tsx.', x: 0, y: 0 },
  { id: 'mobile-visitor-step2', cluster: 'mobile_visitor', label: 'Visitor / Step 2 · Induction',  icon: 'PlayCircle',  route: null, desc: 'app/visitor/[siteId]/step2.tsx.', x: 0, y: 0 },
  { id: 'mobile-visitor-step3', cluster: 'mobile_visitor', label: 'Visitor / Step 3 · PPE',        icon: 'HardHat',     route: null, desc: 'app/visitor/[siteId]/step3.tsx.', x: 0, y: 0 },
  { id: 'mobile-visitor-step4', cluster: 'mobile_visitor', label: 'Visitor / Step 4 · Complete',   icon: 'CheckCircle', route: null, desc: 'app/visitor/[siteId]/step4.tsx.', x: 0, y: 0 },
];
