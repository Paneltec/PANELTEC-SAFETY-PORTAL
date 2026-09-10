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

  // v58.13.132dd — Mobile App section fully re-baked after `.132cz`
  // replaced the 26-screen legacy UI with the new 8-screen mockup +
  // 7-tab bar. Read-only audit of `mobile/app/**/*.tsx` on `.132dc`.
  // 10 sub-clusters carrying `parent_section: 'mobile'`.
  { key: 'mobile_auth',     label: 'Auth',                       color: '#14B8A6', parent_section: 'mobile', anchor: { x: 0, y: 0 }, labelPos: { x: 0, y: 0 } },
  { key: 'mobile_tabs',     label: 'Tab Bar',                    color: '#0D9488', parent_section: 'mobile', anchor: { x: 0, y: 0 }, labelPos: { x: 0, y: 0 } },
  { key: 'mobile_home',     label: 'Tab · Home',                 color: '#06B6D4', parent_section: 'mobile', anchor: { x: 0, y: 0 }, labelPos: { x: 0, y: 0 } },
  { key: 'mobile_records',  label: 'Tab · My Work · Records',    color: '#0284C7', parent_section: 'mobile', anchor: { x: 0, y: 0 }, labelPos: { x: 0, y: 0 } },
  { key: 'mobile_job',      label: 'Home · Job Detail / Signed On', color: '#0891B2', parent_section: 'mobile', anchor: { x: 0, y: 0 }, labelPos: { x: 0, y: 0 } },
  { key: 'mobile_prestart', label: 'Tab · QR Scan · Pre-Start',  color: '#6366F1', parent_section: 'mobile', anchor: { x: 0, y: 0 }, labelPos: { x: 0, y: 0 } },
  { key: 'mobile_profile',  label: 'Tab · Profile',              color: '#0891B2', parent_section: 'mobile', anchor: { x: 0, y: 0 }, labelPos: { x: 0, y: 0 } },
  { key: 'mobile_askai',    label: 'Tab · Ask AI',               color: '#8B5CF6', parent_section: 'mobile', anchor: { x: 0, y: 0 }, labelPos: { x: 0, y: 0 } },
  { key: 'mobile_stub',     label: 'Placeholder Tabs (STUB)',    color: '#64748B', parent_section: 'mobile', anchor: { x: 0, y: 0 }, labelPos: { x: 0, y: 0 } },
  { key: 'mobile_visitor',  label: 'Visitor Wizard',             color: '#818CF8', parent_section: 'mobile', anchor: { x: 0, y: 0 }, labelPos: { x: 0, y: 0 } },
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
  //
  // v58.13.132dd — Re-baked after `.132cz` replaced the 26-screen
  // legacy UI. Enumeration source: read-only audit of `mobile/app/
  // **/*.tsx` on `.132dc`. 10 sub-clusters, 43 nodes. Screens with
  // `testID=` attributes from the mobile source are noted so the
  // Expo specialist can pair schematic cards to component testIDs.

  // Auth (3)
  { id: 'mobile-splash',       cluster: 'mobile_auth', label: 'Auth / Splash / Router',           icon: 'Rocket',   route: null, desc: 'app/index.tsx — routes user to (auth) or (tabs) based on device_id + session.', x: 0, y: 0 },
  { id: 'mobile-auth-welcome', cluster: 'mobile_auth', label: 'Auth / Welcome / QR Provisioning', icon: 'QrCode',   route: null, desc: 'app/(auth)/welcome.tsx — first-launch QR device bind + manual device_id fallback.', x: 0, y: 0 },
  { id: 'mobile-auth-pin',     cluster: 'mobile_auth', label: 'Auth / PIN Entry (Welcome-Back)',  icon: 'KeyRound', route: null, desc: 'app/(auth)/pin-entry.tsx — 4-digit PIN pad + "Welcome back {name}" greeting from device-hint.', x: 0, y: 0 },

  // Tab Bar (7 — ordered per (tabs)/_layout.tsx)
  { id: 'mobile-tab-home',     cluster: 'mobile_tabs', label: 'Tab / Home',      icon: 'Home',         route: null, desc: '(tabs)/_layout.tsx tab 1 — Home tab entry.', x: 0, y: 0 },
  { id: 'mobile-tab-qrscan',   cluster: 'mobile_tabs', label: 'Tab / QR Scan',   icon: 'QrCode',       route: null, desc: '(tabs)/_layout.tsx tab 2 — QR Scan tab entry.', x: 0, y: 0 },
  { id: 'mobile-tab-outbox',   cluster: 'mobile_tabs', label: 'Tab / Outbox',    icon: 'CloudUpload',  route: null, desc: '(tabs)/_layout.tsx tab 3 — Outbox tab entry (placeholder — see Placeholder Tabs).', x: 0, y: 0 },
  { id: 'mobile-tab-fleet',    cluster: 'mobile_tabs', label: 'Tab / Fleet',     icon: 'Car',          route: null, desc: '(tabs)/_layout.tsx tab 4 — Fleet tab entry (placeholder — see Placeholder Tabs).', x: 0, y: 0 },
  { id: 'mobile-tab-mywork',   cluster: 'mobile_tabs', label: 'Tab / My Work',   icon: 'Briefcase',    route: null, desc: '(tabs)/_layout.tsx tab 5 — My Work tab entry.', x: 0, y: 0 },
  { id: 'mobile-tab-profile',  cluster: 'mobile_tabs', label: 'Tab / Profile',   icon: 'User',         route: null, desc: '(tabs)/_layout.tsx tab 6 — Profile tab entry.', x: 0, y: 0 },
  { id: 'mobile-tab-askai',    cluster: 'mobile_tabs', label: 'Tab / Ask AI',    icon: 'Sparkles',     route: null, desc: '(tabs)/_layout.tsx tab 7 — Ask AI tab entry.', x: 0, y: 0 },

  // Home (8) — home.tsx default viewMode + surface elements
  { id: 'mobile-home-view',          cluster: 'mobile_home', label: 'Home / Screen (default)',           icon: 'Home',         route: null, desc: 'app/(tabs)/home.tsx viewMode=home — testID=home-screen.', x: 0, y: 0 },
  { id: 'mobile-home-briefing',      cluster: 'mobile_home', label: 'Home / Intelligence Briefing Card', icon: 'Sparkles',     route: null, desc: 'testID=home-briefing-card — pulls from GET /api/mobile/ai/briefing.', x: 0, y: 0 },
  { id: 'mobile-home-compliance',    cluster: 'mobile_home', label: 'Home / Today\'s Compliance List',   icon: 'ClipboardCheck', route: null, desc: 'testID=home-compliance-title — daily compliance items.', x: 0, y: 0 },
  { id: 'mobile-home-notif-banner',  cluster: 'mobile_home', label: 'Home / Notification Banner',        icon: 'Bell',         route: null, desc: 'testID=home-notification-banner — opens Job Detail (viewMode=job_detail).', x: 0, y: 0 },
  { id: 'mobile-home-signon-banner', cluster: 'mobile_home', label: 'Home / Signed-On Banner',           icon: 'MapPin',       route: null, desc: 'testID=home-signed-on-banner — opens Signed-On view (viewMode=signed_on).', x: 0, y: 0 },
  { id: 'mobile-home-action-prestart', cluster: 'mobile_home', label: 'Home / Action · Start Pre-Start',  icon: 'CheckSquare',  route: null, desc: 'testID=home-action-prestart — routes to /(tabs)/qr-scan for pre-start QR bind.', x: 0, y: 0 },
  { id: 'mobile-home-action-signon',   cluster: 'mobile_home', label: 'Home / Action · Sign On to Site',   icon: 'LogIn',        route: null, desc: 'testID=home-action-signon — opens Signed-On view for site sign-on.', x: 0, y: 0 },
  { id: 'mobile-home-action-hazard',   cluster: 'mobile_home', label: 'Home / Action · Report Hazard',      icon: 'AlertTriangle',route: null, desc: 'testID=home-action-hazard — hazard-report entry point (STUB — no handler yet).', x: 0, y: 0 },

  // Home · Job Detail / Signed-On (2 — home.tsx view modes)
  { id: 'mobile-home-job-detail', cluster: 'mobile_job', label: 'Home / Ad-hoc Job Detail',  icon: 'ClipboardList', route: null, desc: 'app/(tabs)/home.tsx viewMode=job_detail — testID=home-job-detail — surfaces the active daily_job_assignment.', x: 0, y: 0 },
  { id: 'mobile-home-signed-on',  cluster: 'mobile_job', label: 'Home / Signed-On Screen',   icon: 'MapCheck',      route: null, desc: 'app/(tabs)/home.tsx viewMode=signed_on — testID=home-signed-on — site attendance + sign-off button.', x: 0, y: 0 },

  // QR Scan / Pre-Start (2)
  { id: 'mobile-qrscan',       cluster: 'mobile_prestart', label: 'Tab / QR Scan · Screen',   icon: 'QrCode',      route: null, desc: 'app/(tabs)/qr-scan.tsx — barcode scanner for vehicle/site bind + pre-start entry.', x: 0, y: 0 },
  { id: 'mobile-prestart-form', cluster: 'mobile_prestart', label: 'Tab / QR Scan · Pre-Start Form', icon: 'FileText', route: null, desc: 'Post-scan pre-start form — POSTs to /api/mobile/prestart/submit.', x: 0, y: 0 },

  // My Work · Records (6 — from CATEGORY_ICONS in my-work.tsx, matching GET /api/mobile/records/mine groups)
  { id: 'mobile-records-prestart',   cluster: 'mobile_records', label: 'Home / My Work / Pre-Starts',   icon: 'CheckSquare',   route: null, desc: 'my-work.tsx record-group pre_start — testID=record-group-pre_start.', x: 0, y: 0 },
  { id: 'mobile-records-toolbox',    cluster: 'mobile_records', label: 'Home / My Work / Toolbox Talks', icon: 'Users',        route: null, desc: 'my-work.tsx record-group toolbox — testID=record-group-toolbox.', x: 0, y: 0 },
  { id: 'mobile-records-incident',   cluster: 'mobile_records', label: 'Home / My Work / Incidents',    icon: 'AlertCircle',   route: null, desc: 'my-work.tsx record-group incident — testID=record-group-incident.', x: 0, y: 0 },
  { id: 'mobile-records-inspection', cluster: 'mobile_records', label: 'Home / My Work / Inspections',  icon: 'Search',        route: null, desc: 'my-work.tsx record-group inspection — testID=record-group-inspection.', x: 0, y: 0 },
  { id: 'mobile-records-general',    cluster: 'mobile_records', label: 'Home / My Work / General',      icon: 'FileText',      route: null, desc: 'my-work.tsx record-group general — testID=record-group-general.', x: 0, y: 0 },
  { id: 'mobile-records-nearmiss',   cluster: 'mobile_records', label: 'Home / My Work / Near Miss',    icon: 'AlertTriangle', route: null, desc: 'my-work.tsx record-group near_miss — testID=record-group-near_miss.', x: 0, y: 0 },

  // Profile (8 — NavRows + Sign Out from profile.tsx)
  { id: 'mobile-profile-personal',   cluster: 'mobile_profile', label: 'Home / Profile / Personal Information', icon: 'IdCard',        route: null, desc: 'testID=profile-nav-personal — Personal Information NavRow.', x: 0, y: 0 },
  { id: 'mobile-profile-certs',      cluster: 'mobile_profile', label: 'Home / Profile / My Certifications',    icon: 'BadgeCheck',    route: null, desc: 'testID=profile-nav-certs — Certifications NavRow.', x: 0, y: 0 },
  { id: 'mobile-profile-inductions', cluster: 'mobile_profile', label: 'Home / Profile / My Inductions',        icon: 'GraduationCap', route: null, desc: 'testID=profile-nav-inductions — Inductions NavRow.', x: 0, y: 0 },
  { id: 'mobile-profile-id-card',    cluster: 'mobile_profile', label: 'Home / Profile / Digital ID Card',      icon: 'CreditCard',    route: null, desc: 'testID=profile-nav-idcard — Digital ID Card NavRow.', x: 0, y: 0 },
  { id: 'mobile-profile-fleet',      cluster: 'mobile_profile', label: 'Home / Profile / My Fleet',             icon: 'Truck',         route: null, desc: 'testID=profile-nav-fleet — My Fleet NavRow.', x: 0, y: 0 },
  { id: 'mobile-profile-swms',       cluster: 'mobile_profile', label: 'Home / Profile / My SWMS',              icon: 'ShieldCheck',   route: null, desc: 'testID=profile-nav-swms — My SWMS NavRow.', x: 0, y: 0 },
  { id: 'mobile-profile-settings',   cluster: 'mobile_profile', label: 'Home / Profile / Settings',             icon: 'Settings',      route: null, desc: 'testID=profile-nav-settings — Settings (session timeout, fingerprint, change password, admin links).', x: 0, y: 0 },
  { id: 'mobile-profile-signout',    cluster: 'mobile_profile', label: 'Home / Profile / Sign Out',             icon: 'LogOut',        route: null, desc: 'testID=profile-logout-btn — clears session + returns to (auth)/welcome.', x: 0, y: 0 },

  // Ask AI (1)
  { id: 'mobile-askai', cluster: 'mobile_askai', label: 'Tab / Ask AI · Screen', icon: 'Sparkles', route: null, desc: 'app/(tabs)/ask-ai.tsx — LLM chat via POST /api/mobile/ai/ask, role-scoped.', x: 0, y: 0 },

  // Placeholder Tabs (2 — STUB screens)
  { id: 'mobile-stub-outbox', cluster: 'mobile_stub', label: 'Tab / Outbox (STUB)', icon: 'CloudUpload', route: null, desc: 'STUB — app/(tabs)/outbox.tsx renders "All caught up" empty state. Real offline-queue UI pending.', x: 0, y: 0 },
  { id: 'mobile-stub-fleet',  cluster: 'mobile_stub', label: 'Tab / Fleet (STUB)',  icon: 'Car',         route: null, desc: 'STUB — app/(tabs)/fleet.tsx renders "Coming soon" empty state. Vehicle tracking / Navixy pending.', x: 0, y: 0 },



  // Visitor Wizard (4 steps)
  { id: 'mobile-visitor-step1', cluster: 'mobile_visitor', label: 'Visitor / Step 1 · Photo',      icon: 'Camera',      route: null, desc: 'app/visitor/[siteId]/step1.tsx.', x: 0, y: 0 },
  { id: 'mobile-visitor-step2', cluster: 'mobile_visitor', label: 'Visitor / Step 2 · Induction',  icon: 'PlayCircle',  route: null, desc: 'app/visitor/[siteId]/step2.tsx.', x: 0, y: 0 },
  { id: 'mobile-visitor-step3', cluster: 'mobile_visitor', label: 'Visitor / Step 3 · PPE',        icon: 'HardHat',     route: null, desc: 'app/visitor/[siteId]/step3.tsx.', x: 0, y: 0 },
  { id: 'mobile-visitor-step4', cluster: 'mobile_visitor', label: 'Visitor / Step 4 · Complete',   icon: 'CheckCircle', route: null, desc: 'app/visitor/[siteId]/step4.tsx.', x: 0, y: 0 },
];
