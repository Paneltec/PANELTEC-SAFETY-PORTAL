// v160.3.7q — Program Schematic node + edge registry.
//
// Static description of every module rendered on `/settings/schematic`.
// Nodes are grouped into zones (each zone is a soft pastel band); each
// node declares its own {icon, label, route, stat-key, description}.
// Edges declare labelled Bezier connectors between zones.
//
// Layout coordinates are hand-tuned once and then honoured by react-flow.
// If you rearrange zones, remember to update both the node `x`/`y` AND
// the enclosing zone rectangle in `SCHEMATIC_ZONES` below.

/**
 * Zone → semantic Doc Library colour group. Reuses v7p taxonomy so the
 * whole app tells one visual story: "the same pastel = the same concept
 * class".
 *   Intelligence   → lilac    (Legal & Procedures — reads as "strategic")
 *   Capture        → butter   (Policies & Incidents — reads as "operational")
 *   Compliance     → sky      (Health & Hazards — reads as "core WHS")
 *   Fleet          → peach    (Audits & Manuals — reads as "assets")
 *   People         → sage     (Quality & Site Ops — reads as "team")
 *   Integrations   → mint     (Environmental & Risk — reads as "external")
 */
export const SCHEMATIC_ZONES = [
  { key: 'intelligence', label: 'Intelligence',  color: 'lilac',  x:  520, y:    0, w:  700, h:  150 },
  { key: 'capture',      label: 'Capture',       color: 'butter', x:    0, y:  180, w:  480, h:  620 },
  { key: 'compliance',   label: 'Compliance',    color: 'sky',    x:  520, y:  180, w:  460, h:  400 },
  { key: 'fleet',        label: 'Fleet',         color: 'peach',  x: 1020, y:  180, w:  260, h:  240 },
  { key: 'people',       label: 'People',        color: 'sage',   x: 1020, y:  450, w:  260, h:  240 },
  { key: 'integrations', label: 'Integrations',  color: 'mint',   x:  520, y:  620, w:  760, h:  180 },
];

/**
 * All schematic nodes. `stat` is a key into the `/api/dashboard/module-stats`
 * `counts` object — chips render `<n>` when present. `route` is the URL
 * that receives a click; omit to make the node non-navigable (rare).
 */
export const SCHEMATIC_NODES = [
  // — Intelligence —
  { id: 'intel-centre',   zone: 'intelligence', label: 'Intelligence Centre',  route: '/app/dashboard',           x:  550, y:   40, w: 200, hint: 'Live compliance dashboard — headline KPIs across the org.' },
  { id: 'ask-intel',      zone: 'intelligence', label: 'Ask Intelligence',     route: '/app/ask',                 x:  790, y:   40, w: 200, hint: 'Natural-language search over every archive with RAG citations.' },
  { id: 'live-dashboard', zone: 'intelligence', label: 'Live Compliance Dashboard', route: '/app/dashboard',       x: 1030, y:   40, w: 200, hint: 'Real-time compliance signal with drill-through to source records.' },

  // — Capture —
  { id: 'ai-swms',        zone: 'capture', label: 'AI SWMS',              route: '/app/capture/ai-swms',           x:   30, y:  220, w: 200, stat: 'swms',             hint: 'AI-drafted Safe Work Method Statements with peer review.' },
  { id: 'prestarts',      zone: 'capture', label: 'Daily Pre-Starts',     route: '/app/capture/prestarts',         x:  260, y:  220, w: 200, stat: 'prestarts',        hint: 'Morning fitness-for-work + plant check-in on mobile.' },
  { id: 'site-diary',     zone: 'capture', label: 'Site Diary',           route: '/app/capture/site-diary',        x:   30, y:  310, w: 200, stat: 'diary_entries',    hint: 'Voice/photo daily log; AI summariser rolls up weekly.' },
  { id: 'hazards',        zone: 'capture', label: 'Hazard Reports',       route: '/app/capture/hazards',           x:  260, y:  310, w: 200, stat: 'hazards',          hint: 'Snap-and-tag hazards from the field; auto-routes to reviewer.' },
  { id: 'incidents',      zone: 'capture', label: 'Incident Reports',     route: '/app/capture/incidents',         x:   30, y:  400, w: 200, stat: 'incidents',        hint: 'ICAM-aligned incident capture + investigation workflow.' },
  { id: 'inspections',    zone: 'capture', label: 'Inspection Reports',   route: '/app/capture/inspections',       x:  260, y:  400, w: 200, stat: 'inspections',      hint: 'Site-walk inspections with photo evidence and CAPA.' },
  { id: 'risk-assess',    zone: 'capture', label: 'Risk Assessments',     route: '/app/capture/risk-assessments',  x:   30, y:  490, w: 200, stat: 'risk_assessments', hint: 'JSEA / risk matrices linked to task, site, and SWMS.' },
  { id: 'forms',          zone: 'capture', label: 'Forms',                route: '/app/capture/forms',             x:  260, y:  490, w: 200, stat: 'form_submissions', hint: 'AI-built forms + submissions from mobile crew.' },
  { id: 'import-pdfs',    zone: 'capture', label: 'Import PDFs',          route: '/app/import-pdfs',               x:   30, y:  580, w: 430, hint: 'Bulk-ingest legacy PDFs; AI classifies to the right archive.' },

  // — Compliance —
  { id: 'suppliers',      zone: 'compliance', label: 'Suppliers',         route: '/app/compliance/suppliers',      x:  540, y:  220, w: 210, stat: 'contractors',      hint: 'Contractor register with SWMS + insurance + licence tracking.' },
  { id: 'renewal-links',  zone: 'compliance', label: 'Renewal Links',     route: '/app/compliance/renewals',       x:  770, y:  220, w: 210, stat: 'renewals',         hint: 'Public renewal links so subbies self-serve doc uploads.' },
  { id: 'doc-library',    zone: 'compliance', label: 'Document Library',  route: '/app/document-library',          x:  540, y:  310, w: 210, stat: 'doc_folders',      hint: 'AI-tagged doc archive grouped by 9 semantic colour groups.' },
  { id: 'audit-exports',  zone: 'compliance', label: 'Audit Exports',     route: '/app/compliance/audit-exports',  x:  770, y:  310, w: 210, hint: 'One-click auditor bundle: PDFs + JSON + evidence chain.' },
  { id: 'certifications', zone: 'compliance', label: 'Certifications',    route: '/app/settings/certifications',   x:  540, y:  400, w: 210, stat: 'certifications',   hint: 'Worker card matrix — expiring soon, missing types, custody chain.' },
  { id: 'backup',         zone: 'compliance', label: 'Backup & Restore',  route: '/app/settings/backup',           x:  770, y:  400, w: 210, stat: 'bk_snapshots',     hint: '6-hourly snapshots to LAN NAS + Hub. Watchdog auto-recovers cron.' },

  // — Fleet —
  { id: 'plant',          zone: 'fleet', label: 'Plant & Vehicles',       route: '/app/plant',                     x: 1030, y:  220, w: 240, stat: 'assets',           hint: 'Rego, services, defects, Navixy telematics live feed.' },
  { id: 'sites',          zone: 'fleet', label: 'Sites',                  route: '/app/compliance/sites',          x: 1030, y:  310, w: 240, stat: 'sites',            hint: 'Job sites synced from Simpro; QR check-ins, deleted-log.' },

  // — People —
  { id: 'workers',        zone: 'people', label: 'Workers',               route: '/app/settings/workers',          x: 1030, y:  490, w: 240, stat: 'workers',          hint: 'WHS worker directory (Simpro-imported + manual).' },
  { id: 'users-perms',    zone: 'people', label: 'Users & Permissions',   route: '/app/settings/users',            x: 1030, y:  580, w: 240, stat: 'users',            hint: 'App login accounts, roles, permission overrides.' },
  { id: 'sessions',       zone: 'people', label: 'Active Sessions',       route: '/app/settings/system',           x: 1030, y:  640, w: 240, stat: 'active_sessions',  hint: 'Live JWT sessions with per-session delete + inactive purge.' },

  // — Integrations —
  { id: 'simpro',         zone: 'integrations', label: 'Simpro',          route: '/app/settings/integrations',     x:  540, y:  660, w: 170, hint: 'Users, workers, sites, and attachment ZIPs sync from Simpro.' },
  { id: 'navixy',         zone: 'integrations', label: 'Navixy',          route: '/app/settings/integrations',     x:  720, y:  660, w: 170, hint: 'Vehicle GPS, engine hours, trip summaries.' },
  { id: 'm365',           zone: 'integrations', label: 'Microsoft 365',   route: '/app/settings/integrations',     x:  900, y:  660, w: 170, hint: 'Send renewal reminders + reports from your org email.' },
  { id: 'emergent-llm',   zone: 'integrations', label: 'Emergent LLM',    route: '/app/settings/integrations',     x: 1080, y:  660, w: 170, hint: 'GPT / Claude / Gemini via a single universal key.' },
];

/**
 * Labelled Bezier edges — describe the data-flow story of the app so a
 * new admin can trace how a hazard photo becomes an auditor-ready PDF.
 * `animated: true` for the "live pipeline" flows (Simpro import, mobile
 * capture, backup); static for reference lookups (RAG, evidence chain).
 */
export const SCHEMATIC_EDGES = [
  // Simpro import
  { id: 'e-simpro-workers',    source: 'simpro',    target: 'workers',        label: 'import',   animated: true },
  { id: 'e-simpro-sites',      source: 'simpro',    target: 'sites',          label: 'import',   animated: true },
  { id: 'e-simpro-certs',      source: 'simpro',    target: 'certifications', label: 'ZIP → cards', animated: true },
  // Mobile capture → archive
  { id: 'e-forms-doclib',      source: 'forms',       target: 'doc-library',  label: 'submissions', animated: true },
  { id: 'e-prestarts-doclib',  source: 'prestarts',   target: 'doc-library',  label: 'archive',   animated: true },
  { id: 'e-hazards-incidents', source: 'hazards',     target: 'incidents',    label: 'escalate' },
  { id: 'e-inspections-audit', source: 'inspections', target: 'audit-exports', label: 'evidence' },
  { id: 'e-swms-suppliers',    source: 'ai-swms',     target: 'suppliers',    label: 'attach' },
  // Compliance → audit
  { id: 'e-doclib-audit',      source: 'doc-library',    target: 'audit-exports', label: 'bundle' },
  { id: 'e-certs-audit',       source: 'certifications', target: 'audit-exports', label: 'evidence' },
  // Ask Intelligence RAG
  { id: 'e-ask-doclib',        source: 'ask-intel', target: 'doc-library',   label: 'RAG', style: { strokeDasharray: '4 3' } },
  { id: 'e-ask-incidents',     source: 'ask-intel', target: 'incidents',     label: 'RAG', style: { strokeDasharray: '4 3' } },
  { id: 'e-ask-hazards',       source: 'ask-intel', target: 'hazards',       label: 'RAG', style: { strokeDasharray: '4 3' } },
  // Fleet telematics
  { id: 'e-navixy-plant',      source: 'navixy',    target: 'plant',         label: 'GPS + engine hrs', animated: true },
  // People / access
  { id: 'e-users-sessions',    source: 'users-perms', target: 'sessions',    label: 'issues JWT' },
  { id: 'e-workers-users',     source: 'workers',   target: 'users-perms',   label: 'link' },
  // Backup
  { id: 'e-doclib-backup',     source: 'doc-library',  target: 'backup',     label: 'nightly snapshot', animated: true },
  { id: 'e-certs-backup',      source: 'certifications', target: 'backup',   label: 'nightly snapshot', animated: true },
  // Email outbound
  { id: 'e-m365-renewals',     source: 'm365',      target: 'renewal-links', label: 'send reminders' },
  // LLM
  { id: 'e-llm-swms',          source: 'emergent-llm', target: 'ai-swms',    label: 'drafts', style: { strokeDasharray: '4 3' } },
  { id: 'e-llm-ask',           source: 'emergent-llm', target: 'ask-intel',  label: 'answers', style: { strokeDasharray: '4 3' } },
  { id: 'e-llm-diary',         source: 'emergent-llm', target: 'site-diary', label: 'summarises', style: { strokeDasharray: '4 3' } },
];
