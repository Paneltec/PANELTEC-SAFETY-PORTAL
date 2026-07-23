// v160.3.9.0 — Auto-generated Feature Index registry.
//
// Single source of truth for the "Feature Index" card auto-rendered
// at the bottom of the User Manual. When a dev adds a new route or
// integration, they add it here — the manual updates on next page
// load without touching markdown.
//
// The `settings` group auto-populates from `SETTINGS_NAV_REGISTRY`
// so the two lists can't drift.
//
// Routes are RELATIVE to `/app` (the app shell mounts under that
// prefix). The Feature Index render layer prepends `/app` when it
// builds the anchor href.

import { SETTINGS_NAV_REGISTRY } from './settingsNavRegistry';

const _MAIN_ITEMS = [
  { key: 'dashboard',        label: 'Dashboard',            route: '/app/dashboard',        description: 'Live WHS compliance overview' },
  { key: 'ask',              label: 'Ask Intelligence',     route: '/app/ask',              description: 'Natural-language Q&A over your compliance data' },
  { key: 'swms',             label: 'AI SWMS',              route: '/app/swms',             description: 'AI-drafted Safe Work Method Statements' },
  { key: 'pre_starts',       label: 'Daily Pre-Starts',     route: '/app/pre-starts',       description: 'Per-shift equipment and site check-in' },
  { key: 'site_diary',       label: 'Site Diary',           route: '/app/site-diary',       description: 'AI-assisted daily site diary' },
  { key: 'hazards',          label: 'Hazard Reports',       route: '/app/hazards',          description: 'Reported site hazards' },
  { key: 'incidents',        label: 'Incident Reports',     route: '/app/incidents',        description: 'Reported site incidents' },
  { key: 'inspections',      label: 'Inspection Reports',   route: '/app/inspections',      description: 'Routine site inspections' },
  { key: 'risk_assessments', label: 'Risk Assessments',     route: '/app/risk-assessments', description: 'Hazard-driven risk assessment library' },
  { key: 'forms',            label: 'Forms',                route: '/app/forms',            description: 'Custom form templates + submissions' },
  { key: 'renewals',         label: 'Renewal Links',        route: '/app/renewals',         description: 'Public renewal-link workflow for expiring docs' },
  { key: 'contractors',      label: 'Contractors',          route: '/app/contractors',      description: 'Sub-contractor register and onboarding' },
  { key: 'suppliers',        label: 'Suppliers',            route: '/app/suppliers',        description: 'Approved supplier register' },
  { key: 'sites',            label: 'Sites',                route: '/app/sites',            description: 'Active project sites + QR sign-on' },
  { key: 'vehicles',         label: 'Plant & Vehicles',     route: '/app/vehicles',         description: 'Equipment and vehicle register' },
  { key: 'document_library', label: 'Document Library',     route: '/app/document-library', description: 'Central document store' },
  { key: 'audit_exports',    label: 'Audit Exports',        route: '/app/audit-exports',    description: 'Compliance audit exports' },
  { key: 'outbox',           label: 'Email Outbox',         route: '/app/outbox',           description: 'Delivery log for all system emails' },
  { key: 'profile',          label: 'Profile',              route: '/app/profile',          description: 'Your own user profile and preferences' },
  { key: 'help',             label: 'User Manual',          route: '/app/help',             description: 'This manual' },
];

const _INTEGRATION_ITEMS = [
  { key: 'simpro',        label: 'Simpro',        route: '/app/settings/integrations/simpro',       description: 'Worker + job data sync from Simpro' },
  { key: 'navixy',        label: 'Navixy',        route: '/app/settings/integrations/navixy',       description: 'Fleet GPS + engine-hours telemetry' },
  { key: 'microsoft_365', label: 'Microsoft 365', route: '/app/settings/integrations/microsoft365', description: 'Outbound email + calendar reminders' },
  { key: 'textmagic',     label: 'TextMagic',     route: '/app/settings/integrations/textmagic',    description: 'SMS reminders to workers' },
  { key: 'emergent_llm',  label: 'Emergent LLM',  route: null,                                       description: 'AI backbone for SWMS drafts, Ask Intelligence answers, Site Diary summaries' },
];

const _MOBILE_CAPTURE_ITEMS = [
  { key: 'crane_lift',         label: 'Crane Lift',        description: 'Rigging Crew grouped-crew form (v160.3.8.0)' },
  { key: 'daily_prestart',     label: 'Daily Pre-Start',   description: 'Per-shift equipment + site check' },
  { key: 'hazard_capture',     label: 'Hazard Report',     description: 'Field hazard capture with photo + AI analysis' },
  { key: 'incident_capture',   label: 'Incident Report',   description: 'Field incident capture + escalation' },
  { key: 'inspection_capture', label: 'Inspection',        description: 'Routine safety inspection walkaround' },
  { key: 'site_diary_capture', label: 'Site Diary Entry',  description: 'Daily site progress + weather + labour' },
  { key: 'qr_sign_on',         label: 'QR Sign-On',        description: 'Scan a site QR to log arrival, sign SWMS, and record induction' },
];

// v160.3.9.0 — Settings items reflect the live drag-and-drop nav so
// admin re-orderings automatically show up in the manual.
const _SETTINGS_ITEMS = SETTINGS_NAV_REGISTRY.map((it) => ({
  key:         it.key,
  label:       it.label,
  route:       it.route,
  description: it.description || '',
}));

export const APP_FEATURE_REGISTRY = [
  { id: 'main',            label: 'Main App Pages',       items: _MAIN_ITEMS },
  { id: 'settings',        label: 'Settings',             items: _SETTINGS_ITEMS },
  { id: 'integrations',    label: 'Integrations',         items: _INTEGRATION_ITEMS },
  { id: 'mobile_captures', label: 'Mobile Capture Forms', items: _MOBILE_CAPTURE_ITEMS },
];
