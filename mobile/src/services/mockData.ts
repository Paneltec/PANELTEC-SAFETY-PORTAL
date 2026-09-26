/**
 * v58.13.132cz — Mock data for endpoints that return 404/401.
 *
 * ⚠️  MOCKED: These are NOT real backend responses.
 *     Real endpoints: /api/mobile/records/mine → 404
 *                     /api/users/me → 401
 *                     AI daily briefing → not implemented
 *
 * Flag every consumer of this file with a RED "MOCKED" badge.
 */

export const MOCK_USER_PROFILE = {
  id: 'mock-user-001',
  name: 'Stephen McGuire',
  first_name: 'Stephen',
  last_name: 'McGuire',
  email: 'stephen@paneltec.com.au',
  position: 'Site Supervisor',
  company: 'Paneltec Group',
  phone: '+61 400 123 456',
  employee_id: 'EMP-0042',
  role_id: 'admin',
  role_label: 'Administrator',
  avatar_initials: 'SM',
  _mocked: true,
};

export const MOCK_AI_BRIEFING = {
  summary: 'Good morning. 3 pre-starts due today across 2 active sites. 1 certification expiring this week (White Card — Josh Drew). No open hazards or incidents from yesterday.',
  items: [
    { type: 'compliance', label: '3 Pre-starts due', severity: 'info' },
    { type: 'compliance', label: '1 cert expiring (White Card)', severity: 'warning' },
    { type: 'compliance', label: '0 open hazards', severity: 'success' },
    { type: 'weather', label: 'Sydney 24°C, partly cloudy', severity: 'info' },
  ],
  _mocked: true,
};

export const MOCK_COMPLIANCE_LIST = [
  { id: 'c1', title: 'Daily Pre-Start Check', type: 'pre_start', status: 'due', site: 'Connector Park', dueAt: new Date().toISOString() },
  { id: 'c2', title: 'SWMS Review — Excavation', type: 'swms', status: 'pending', site: 'Connector Park', dueAt: new Date().toISOString() },
];

export type RecordGroup = {
  type: string;
  label: string;
  icon: string;
  color: string;
  count: number;
  items: RecordItem[];
};

export type RecordItem = {
  id: string;
  title: string;
  date: string;
  status: string;
  site?: string;
};

export const MOCK_MY_RECORDS: RecordGroup[] = [
  {
    type: 'pre_start', label: 'Pre-Starts', icon: 'checkbox-outline', color: '#10B981',
    count: 12,
    items: [
      { id: 'ps1', title: 'Heavy Equipment Pre-Start', date: '2026-04-14', status: 'completed', site: 'Connector Park' },
      { id: 'ps2', title: 'Volvo A30G Dump Truck', date: '2026-04-14', status: 'completed', site: 'Connector Park' },
      { id: 'ps3', title: 'Komatsu D65 Dozer', date: '2026-04-13', status: 'completed', site: 'Moorebank Depot' },
    ],
  },
  {
    type: 'hazard', label: 'Hazard Reports', icon: 'warning-outline', color: '#F59E0B',
    count: 4,
    items: [
      { id: 'h1', title: 'Unstable trench wall — Lot 7', date: '2026-04-12', status: 'open', site: 'Connector Park' },
      { id: 'h2', title: 'Overhead power line clearance', date: '2026-04-10', status: 'resolved' },
    ],
  },
  {
    type: 'incident', label: 'Incident Reports', icon: 'alert-circle-outline', color: '#EF4444',
    count: 1,
    items: [
      { id: 'i1', title: 'Minor LTI — twisted ankle', date: '2026-04-08', status: 'closed', site: 'Moorebank Depot' },
    ],
  },
  {
    type: 'inspection', label: 'Inspections', icon: 'clipboard-outline', color: '#3B82F6',
    count: 6,
    items: [
      { id: 'in1', title: 'Weekly site inspection', date: '2026-04-14', status: 'completed', site: 'Connector Park' },
      { id: 'in2', title: 'Monthly safety audit', date: '2026-04-01', status: 'completed', site: 'Moorebank Depot' },
    ],
  },
  {
    type: 'swms', label: 'SWMS Acknowledgements', icon: 'shield-checkmark-outline', color: '#8B5CF6',
    count: 8,
    items: [
      { id: 's1', title: 'Excavation Works v3.2', date: '2026-04-14', status: 'acknowledged' },
      { id: 's2', title: 'Concrete Pouring v2.1', date: '2026-04-10', status: 'acknowledged' },
    ],
  },
];

export const MOCK_AD_HOC_JOB = {
  id: 'adhoc-001',
  title: 'Sample St Trench Works',
  site_name: 'Sample St Trench · Kings Park',
  site_address: '19 Connector Park Drive, Kings Park NSW 2148',
  client: 'Sydney Water',
  assigned_at: new Date().toISOString(),
  issued_at: new Date().toISOString(),
  start_time: '07:00',
  status: 'pending_accept',
  task: 'Excavate & shore 12m storm-water trench — depth 2.4m',
  notes: 'Urgent callout — blocked storm drain causing flooding on access road. Excavator + 2 labourers required.',
  supervisor_name: 'Dave Wilson',
  supervisor_phone: '0412 345 678',
  contact_name: 'Dave Wilson',
  contact_phone: '0412 345 678',
  _mocked: true,
};
