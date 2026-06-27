// MOCKED: All dashboard data on this file is seed/static. Replace with API responses in Phase 2.

export const CAPTURE_TOOLS = [
  {
    key: 'swms',
    title: 'AI SWMS Generator',
    desc: 'Draft Safe Work Method Statements from a job brief in minutes.',
    icon: 'FileText',
    route: '/app/swms',
  },
  {
    key: 'pre-starts',
    title: 'Daily Pre-Starts',
    desc: 'Crew pre-start checks captured on mobile, signed at the gate.',
    icon: 'ClipboardCheck',
    route: '/app/pre-starts',
  },
  {
    key: 'site-diary',
    title: 'Site Diary AI',
    desc: 'Auto-summarise voice notes and photos into a daily site diary.',
    icon: 'NotebookPen',
    route: '/app/site-diary',
  },
  {
    key: 'forms',
    title: 'Forms Library',
    desc: 'Inspection, incident, toolbox and permit templates — fillable on phone.',
    icon: 'ClipboardList',
    route: '/app/forms',
  },
  {
    key: 'generate-ai',
    title: 'Generate Form (AI)',
    desc: 'Describe a checklist in plain English — AI drafts the template.',
    icon: 'Sparkles',
    route: '/app/forms?builder=ai',
  },
  {
    key: 'hazards',
    title: 'Hazard Reports from Photos',
    desc: 'Snap a hazard — AI classifies risk and drafts the report.',
    icon: 'TriangleAlert',
    route: '/app/hazards',
  },
  {
    key: 'incidents',
    title: 'Incident Reports',
    desc: 'Structured incident capture with witness statements and evidence.',
    icon: 'Siren',
    route: '/app/incidents',
  },
  {
    key: 'inspections',
    title: 'Inspection Reports',
    desc: 'Plant, scaffold and site walk inspections with pass/fail items.',
    icon: 'ShieldCheck',
    route: '/app/inspections',
  },
];

// MOCKED: this-quarter compliance metrics
export const COMPLIANCE_METRICS = [
  { key: 'swms', label: 'AI SWMS', value: 142, icon: 'FileText' },
  { key: 'pre-starts', label: 'Pre-starts', value: 486, icon: 'ClipboardCheck' },
  { key: 'site-diary', label: 'Site diary', value: 368, icon: 'NotebookPen' },
  { key: 'hazards', label: 'Hazards', value: 94, icon: 'TriangleAlert' },
  { key: 'incidents', label: 'Incidents', value: 24, icon: 'Siren' },
  { key: 'inspections', label: 'Inspections', value: 212, icon: 'ShieldCheck' },
];

// MOCKED: organisation-wide compliance attention score
export const ATTENTION_SCORE = {
  band: 'Strong',
  score: 100,
  outOf: 100,
  blurb:
    'Compliance signal is strong across every workspace. No registers are flagged for management escalation.',
  scopeLine: 'No registers escalated · 2 records pending sign-off.',
};

export const MONITORING_FACTS = {
  scope: 'Organisation wide',
  workspaces: 'All allowed workspaces',
  registers: 26,
  needsAttention: 2,
};

// MOCKED: Ask Intelligence sample exchange
export const ASK_BRIEFING = {
  question:
    'What needs management attention now, what should we do, and what evidence proves it?',
  confidence: 'high',
  title: 'Recurring incident category: near miss',
  body:
    'Near-miss reports are trending up 18% across Sydney Metro. Two of the last three involve work-at-heights tasks during material pass-up. Recommend a targeted toolbox talk this week and a temporary edge-protection inspection across active panels.',
  citations: [
    { kind: 'Proof', label: '12 preserved source records · Incidents' },
    { kind: 'Proof', label: 'Near miss at scaffold edge during material pass-up' },
    { kind: 'Proof', label: 'Electrical near miss during isolation verification' },
  ],
};

// MOCKED: connected workflow cards for landing page
export const CONNECTED_WORKFLOWS = [
  { title: 'SWMS reviews', desc: 'Track every SWMS from draft to approval with version history.', icon: 'FileCheck2' },
  { title: 'QR sign-ons', desc: 'Workers scan a site QR code to sign on and acknowledge SWMS.', icon: 'QrCode' },
  { title: 'Contractor compliance', desc: 'Insurances, licences and inductions tracked per ABN.', icon: 'BadgeCheck' },
  { title: 'Contractor renewal links', desc: 'Email-driven self-serve renewals — no portal logins.', icon: 'Link2' },
  { title: 'Incidents', desc: 'Capture, triage and close incident actions with full audit trail.', icon: 'Siren' },
  { title: 'Inspections', desc: 'Scheduled inspections with pass/fail items and photo evidence.', icon: 'ShieldCheck' },
  { title: 'Hazard reports', desc: 'Field hazards classified by AI and routed to the right register.', icon: 'TriangleAlert' },
  { title: 'Compliance reports', desc: 'Live dashboards plus exportable PDF compliance summaries.', icon: 'BarChart3' },
  { title: 'Audit exports', desc: 'One-click audit packs for Comcare, SafeWork and client audits.', icon: 'FolderDown' },
];

// MOCKED: bottom feature strip
export const BOTTOM_STRIP = [
  { title: 'One source of truth', desc: 'Every record across every workspace in one connected platform.', icon: 'Database' },
  { title: 'Risk surfaced early', desc: 'AI flags recurring issues before they escalate.', icon: 'Radar' },
  { title: 'Built for oversight', desc: 'Roles, audit trails and exports designed for HSE leaders.', icon: 'Eye' },
  { title: 'Ask Intelligence', desc: 'Natural-language Q&A grounded in your own records.', icon: 'Sparkles' },
];

// MOCKED: feature checklist on hero
export const HERO_CHECKLIST = [
  ['AI SWMS', 'Daily pre-starts'],
  ['Site diaries', 'QR sign-ons'],
  ['Permit to work', 'Plant & equipment'],
  ['Hazards & incidents', 'Inspections'],
  ['Contractor workflows', 'Intelligence Centre'],
];

// MOCKED: floating mini-cards in hero illustration
export const HERO_FLOAT_CARDS = [
  { key: 'swms', title: 'SWMS', sub: 'Approved · 4 mins ago', tone: 'green' },
  { key: 'qr', title: 'QR sign-ons', sub: '12 workers signed', tone: 'blue' },
  { key: 'contractor', title: 'Contractor workflows', sub: '3 renewals due', tone: 'violet' },
  { key: 'hazards', title: 'Hazards & incidents', sub: '3 open · 1 high', tone: 'amber' },
  { key: 'inspections', title: 'Inspections', sub: '86% site walk', tone: 'green' },
  { key: 'intel', title: 'Intelligence Centre', sub: '12 reports', tone: 'violet' },
];

// MOCKED: integrations register
export const INTEGRATIONS = [
  {
    key: 'simpro',
    name: 'Simpro',
    purpose: 'Staff & users sync from Simpro to Paneltec Civil.',
    status: 'Not connected',
    logoChar: 'S',
    logoBg: '#F97316',
  },
  {
    key: 'm365',
    name: 'Microsoft 365',
    purpose: 'Email delivery for renewal links and notifications.',
    status: 'Not connected',
    logoChar: 'M',
    logoBg: '#2563EB',
  },
  {
    key: 'textmagic',
    name: 'TextMagic',
    purpose: 'SMS notifications for high-risk alerts and renewals.',
    status: 'Not connected',
    logoChar: 'T',
    logoBg: '#DC2626',
  },
  {
    key: 'navixy',
    name: 'Navixy',
    purpose: 'Vehicle and plant location for inspections and incidents.',
    status: 'Not connected',
    logoChar: 'N',
    logoBg: '#16A34A',
  },
];

// MOCKED: workspaces in topbar switcher
export const WORKSPACES = [
  { id: 'sydney-metro', name: 'Sydney Metro' },
  { id: 'newcastle-depot', name: 'Newcastle Depot' },
];
