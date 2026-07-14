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
// v160.3.7t — Compact frameless layout: nodes are icon-only 128×128
// illustrations arranged in organic clusters per zone rather than a
// rigid grid. Zone bands are the only large pastel surfaces; the tiles
// themselves are transparent so the illustration reads as the "tile".
// Coordinates recomputed for a 1200 × 1200 canvas.
export const SCHEMATIC_ZONES = [
  { key: 'intelligence', label: 'Intelligence',  color: 'lilac',  x:  460, y:    0, w:  760, h:  190 },
  { key: 'capture',      label: 'Capture',       color: 'butter', x:    0, y:  200, w:  440, h:  790 },
  { key: 'compliance',   label: 'Compliance',    color: 'sky',    x:  460, y:  200, w:  440, h:  520 },
  { key: 'fleet',        label: 'Fleet',         color: 'peach',  x:  920, y:  200, w:  300, h:  310 },
  { key: 'people',       label: 'People',        color: 'sage',   x:  920, y:  530, w:  300, h:  460 },
  { key: 'integrations', label: 'Integrations',  color: 'mint',   x:  460, y:  740, w:  440, h:  250 },
];

/**
 * All schematic nodes. `stat` is a key into the `/api/dashboard/module-stats`
 * `counts` object — chips render `<n>` when present. `route` is the URL
 * that receives a click; must match an actual `<Route path>` in App.js —
 * unknown paths fall through to the catch-all `<Navigate to="/">` and
 * boot the user to the Cover page (that was the v7s crash bug).
 * v160.3.7t — Routes corrected to real App.js paths. `image` (optional)
 * points at `/img/schematic/nodes/{slug}.png`.
 */
const NODE_W = 128;
const NODE_H = 128;

export const SCHEMATIC_NODES = [
  // — Intelligence (top band, 3 horizontally-centred nodes) —
  { id: 'intel-centre',   zone: 'intelligence', label: 'Intelligence Centre', image: 'intelligence_centre',       route: '/app/dashboard', x:  520, y:  35, w: NODE_W, h: NODE_H, hint: 'Live compliance dashboard — headline KPIs across the org.' },
  { id: 'ask-intel',      zone: 'intelligence', label: 'Ask Intelligence',    image: 'ask_intelligence',           route: '/app/ask',       x:  800, y:  35, w: NODE_W, h: NODE_H, hint: 'Natural-language search over every archive with RAG citations.' },
  { id: 'live-dashboard', zone: 'intelligence', label: 'Live Dashboard',      image: 'live_compliance_dashboard',  route: '/app/dashboard', x: 1080, y:  35, w: NODE_W, h: NODE_H, hint: 'Real-time compliance signal with drill-through to source records.' },

  // — Capture (left band, organic 2-column offset cluster) —
  { id: 'ai-swms',        zone: 'capture', label: 'AI SWMS',            image: 'ai_swms',          route: '/app/swms',              x:   40, y: 260, w: NODE_W, h: NODE_H, stat: 'swms',             hint: 'AI-drafted Safe Work Method Statements with peer review.' },
  { id: 'prestarts',      zone: 'capture', label: 'Daily Pre-Starts',   image: 'daily_prestarts',  route: '/app/pre-starts',        x:  240, y: 300, w: NODE_W, h: NODE_H, stat: 'prestarts',        hint: 'Morning fitness-for-work + plant check-in on mobile.' },
  { id: 'site-diary',     zone: 'capture', label: 'Site Diary',         image: 'site_diary',       route: '/app/site-diary',        x:   40, y: 440, w: NODE_W, h: NODE_H, stat: 'diary_entries',    hint: 'Voice/photo daily log; AI summariser rolls up weekly.' },
  { id: 'hazards',        zone: 'capture', label: 'Hazard Reports',     image: 'hazard_reports',   route: '/app/hazards',           x:  240, y: 480, w: NODE_W, h: NODE_H, stat: 'hazards',          hint: 'Snap-and-tag hazards from the field; auto-routes to reviewer.' },
  { id: 'incidents',      zone: 'capture', label: 'Incident Reports',   image: 'incident_reports', route: '/app/incidents',         x:   40, y: 620, w: NODE_W, h: NODE_H, stat: 'incidents',        hint: 'ICAM-aligned incident capture + investigation workflow.' },
  { id: 'inspections',    zone: 'capture', label: 'Inspection Reports', image: 'inspection_reports', route: '/app/inspections',     x:  240, y: 660, w: NODE_W, h: NODE_H, stat: 'inspections',      hint: 'Site-walk inspections with photo evidence and CAPA.' },
  { id: 'risk-assess',    zone: 'capture', label: 'Risk Assessments',   image: 'risk_assessments', route: '/app/risk-assessments',  x:   40, y: 800, w: NODE_W, h: NODE_H, stat: 'risk_assessments', hint: 'JSEA / risk matrices linked to task, site, and SWMS.' },
  { id: 'forms',          zone: 'capture', label: 'Forms',              image: 'forms',            route: '/app/forms',             x:  240, y: 840, w: NODE_W, h: NODE_H, stat: 'form_submissions', hint: 'AI-built forms + submissions from mobile crew.' },
  // Import PDFs has no dedicated route — soft-fallback to forms (that's where imported PDFs land as submissions).
  { id: 'import-pdfs',    zone: 'capture', label: 'Import PDFs',        image: 'import_pdfs',      route: '/app/forms',             x:  140, y: 970, w: NODE_W, h: NODE_H, hint: 'Bulk-ingest legacy PDFs; AI classifies to the right archive.' },

  // — Compliance (centre band, 3×2 mini-grid) —
  { id: 'suppliers',      zone: 'compliance', label: 'Suppliers',        image: 'suppliers',        route: '/app/suppliers',       x:  500, y: 260, w: NODE_W, h: NODE_H, stat: 'contractors',      hint: 'Contractor register with SWMS + insurance + licence tracking.' },
  { id: 'renewal-links',  zone: 'compliance', label: 'Renewal Links',    image: 'renewal_links',    route: '/app/renewals',        x:  720, y: 260, w: NODE_W, h: NODE_H, stat: 'renewals',         hint: 'Public renewal links so subbies self-serve doc uploads.' },
  { id: 'doc-library',    zone: 'compliance', label: 'Document Library', image: 'document_library', route: '/app/document-library', x:  500, y: 420, w: NODE_W, h: NODE_H, stat: 'doc_folders',      hint: 'AI-tagged doc archive grouped by 9 semantic colour groups.' },
  { id: 'audit-exports',  zone: 'compliance', label: 'Audit Exports',    image: 'audit_exports',    route: '/app/audit-exports',   x:  720, y: 420, w: NODE_W, h: NODE_H, hint: 'One-click auditor bundle: PDFs + JSON + evidence chain.' },
  { id: 'certifications', zone: 'compliance', label: 'Certifications',   image: 'certifications',   route: '/app/settings/certifications', x:  500, y: 580, w: NODE_W, h: NODE_H, stat: 'certifications',   hint: 'Worker card matrix — expiring soon, missing types, custody chain.' },
  { id: 'backup',         zone: 'compliance', label: 'Backup & Restore', image: 'backup_restore',   route: '/app/settings/backup',         x:  720, y: 580, w: NODE_W, h: NODE_H, stat: 'bk_snapshots',     hint: '6-hourly snapshots to LAN NAS + Hub. Watchdog auto-recovers cron.' },

  // — Fleet (right upper cluster) —
  { id: 'plant',          zone: 'fleet', label: 'Plant & Vehicles',     image: 'plant_vehicles',   route: '/app/vehicles',          x:  970, y: 250, w: NODE_W, h: NODE_H, stat: 'assets',           hint: 'Rego, services, defects, Navixy telematics live feed.' },
  { id: 'sites',          zone: 'fleet', label: 'Sites',                image: 'sites',            route: '/app/sites',             x: 1130, y: 350, w: NODE_W, h: NODE_H, stat: 'sites',            hint: 'Job sites synced from Simpro; QR check-ins, deleted-log.' },

  // — People (right middle cluster) —
  { id: 'workers',        zone: 'people', label: 'Workers',             image: 'workers',            route: '/app/settings/workers',  x:  970, y: 570, w: NODE_W, h: NODE_H, stat: 'workers',          hint: 'WHS worker directory (Simpro-imported + manual).' },
  { id: 'users-perms',    zone: 'people', label: 'Users & Perms',       image: 'users_permissions',  route: '/app/settings/users',    x: 1130, y: 660, w: NODE_W, h: NODE_H, stat: 'users',            hint: 'App login accounts, roles, permission overrides.' },
  { id: 'sessions',       zone: 'people', label: 'Active Sessions',     image: 'active_sessions',    route: '/app/settings/system',   x:  970, y: 830, w: NODE_W, h: NODE_H, stat: 'active_sessions',  hint: 'Live JWT sessions with per-session delete + inactive purge.' },

  // — Integrations (bottom-centre 2×2 mini-grid) —
  { id: 'simpro',         zone: 'integrations', label: 'Simpro',         image: 'simpro',        route: '/app/settings/integrations/simpro',      x:  490, y: 780, w: NODE_W, h: NODE_H, hint: 'Users, workers, sites, and attachment ZIPs sync from Simpro.' },
  { id: 'navixy',         zone: 'integrations', label: 'Navixy',         image: 'navixy',        route: '/app/settings/integrations/navixy',      x:  730, y: 780, w: NODE_W, h: NODE_H, hint: 'Vehicle GPS, engine hours, trip summaries.' },
  { id: 'm365',           zone: 'integrations', label: 'Microsoft 365',  image: 'microsoft_365', route: '/app/settings/integrations/microsoft365', x:  490, y: 920, w: NODE_W, h: NODE_H, hint: 'Send renewal reminders + reports from your org email.' },
  { id: 'emergent-llm',   zone: 'integrations', label: 'Emergent LLM',   image: 'emergent_llm',  route: '/app/settings/integrations',              x:  730, y: 920, w: NODE_W, h: NODE_H, hint: 'GPT / Claude / Gemini via a single universal key.' },
];

/**
 * Labelled data-flow edges. v160.3.7af rewires the entire connector set
 * around the platform's real operational story so a new admin can trace
 * "worker signs on → capture → analysis → dashboard → audit" without a
 * legend. Story arc:
 *   1. Identity backbone  (labelled)  — users-perms → workers → certs → renewals
 *   2. External sync      (dashed)    — Simpro pulls workers/sites/suppliers,
 *                                       Navixy pulls plant
 *   3. AI funnel          (labelled)  — 6 field-capture surfaces feed
 *                                       Intelligence Centre
 *   4. Intel fanout                    — Intelligence Centre → Ask + Live
 *   5. Governance output               — Live Dashboard → Audit; Intel → DocLib
 *   6. Vendor links                    — Suppliers ↔ Sites + Plant
 *   7. Comms outbound     (labelled)  — Microsoft 365 → Renewal Links
 *   8. AI backend         (dashed)    — Emergent LLM → AI SWMS + Ask
 *   9. Infra sinks        (dashed)    — DocLib / Certs / Audit → Backup
 * Labels reserved for 5 headline edges only (identity, expiry watch, JWT,
 * analysis, reminders) so the visual is dominated by connections rather
 * than text. Every edge carries a black arrowhead on the TARGET end so
 * direction reads at a glance. `smoothstep` routing (set in
 * `ProgramSchematicPage.jsx`) gives the industrial control-board vibe.
 * `animated: true` marks live pipelines; `strokeDasharray` marks
 * dashed reference / infra edges.
 */
const _ARROW = { type: 'arrowclosed', color: '#0f172a', width: 18, height: 18 };
const _DASHED = { strokeDasharray: '4 3' };
const _DASHED_LIVE = { strokeDasharray: '6 4' };

const _RAW_EDGES = [
  // Identity backbone ---------------------------------------------------------
  { id: 'e-users-workers',  source: 'users-perms',    target: 'workers',        label: 'identity' },
  { id: 'e-workers-certs',  source: 'workers',        target: 'certifications', label: 'expiry watch' },
  { id: 'e-certs-renewals', source: 'certifications', target: 'renewal-links' },
  { id: 'e-users-sessions', source: 'users-perms',    target: 'sessions',       label: 'JWT' },

  // External sync (dashed animated) ------------------------------------------
  { id: 'e-simpro-workers',   source: 'simpro', target: 'workers',   animated: true, style: _DASHED_LIVE },
  { id: 'e-simpro-sites',     source: 'simpro', target: 'sites',     animated: true, style: _DASHED_LIVE },
  { id: 'e-simpro-suppliers', source: 'simpro', target: 'suppliers', animated: true, style: _DASHED_LIVE },
  { id: 'e-navixy-plant',     source: 'navixy', target: 'plant',     animated: true, style: _DASHED_LIVE },

  // Capture → Intelligence Centre (the AI funnel) ----------------------------
  { id: 'e-swms-intel',        source: 'ai-swms',     target: 'intel-centre', label: 'analysis' },
  { id: 'e-diary-intel',       source: 'site-diary',  target: 'intel-centre' },
  { id: 'e-hazards-intel',     source: 'hazards',     target: 'intel-centre' },
  { id: 'e-incidents-intel',   source: 'incidents',   target: 'intel-centre' },
  { id: 'e-inspections-intel', source: 'inspections', target: 'intel-centre' },
  { id: 'e-prestarts-intel',   source: 'prestarts',   target: 'intel-centre' },

  // Local capture links ------------------------------------------------------
  { id: 'e-hazards-risk',   source: 'hazards',     target: 'risk-assess' },
  { id: 'e-incidents-risk', source: 'incidents',   target: 'risk-assess' },
  { id: 'e-forms-doclib',   source: 'forms',       target: 'doc-library' },
  { id: 'e-imports-doclib', source: 'import-pdfs', target: 'doc-library' },

  // Intelligence fanout ------------------------------------------------------
  { id: 'e-intel-ask',  source: 'intel-centre', target: 'ask-intel' },
  { id: 'e-intel-live', source: 'intel-centre', target: 'live-dashboard' },

  // Governance / output ------------------------------------------------------
  { id: 'e-live-audit',   source: 'live-dashboard', target: 'audit-exports' },
  { id: 'e-intel-doclib', source: 'intel-centre',   target: 'doc-library' },

  // Vendor links -------------------------------------------------------------
  { id: 'e-suppliers-sites', source: 'suppliers', target: 'sites' },
  { id: 'e-suppliers-plant', source: 'suppliers', target: 'plant' },

  // Comms outbound -----------------------------------------------------------
  { id: 'e-m365-renewals', source: 'm365', target: 'renewal-links', label: 'reminders' },

  // AI backend (dashed) ------------------------------------------------------
  { id: 'e-llm-swms', source: 'emergent-llm', target: 'ai-swms',   style: _DASHED },
  { id: 'e-llm-ask',  source: 'emergent-llm', target: 'ask-intel', style: _DASHED },

  // Infra sinks — Backup (dashed) --------------------------------------------
  { id: 'e-doclib-backup', source: 'doc-library',    target: 'backup', style: _DASHED },
  { id: 'e-certs-backup',  source: 'certifications', target: 'backup', style: _DASHED },
  { id: 'e-audit-backup',  source: 'audit-exports',  target: 'backup', style: _DASHED },
];

export const SCHEMATIC_EDGES = _RAW_EDGES.map((e) => ({ ...e, markerEnd: _ARROW }));
