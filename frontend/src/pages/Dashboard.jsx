import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight, FileText, ClipboardCheck, NotebookPen, TriangleAlert, Siren,
  ShieldCheck, BarChart3, Download, Sparkles, Database, Radar, Eye, FileSearch,
  AlertTriangle, Award, Clock, HardHat, UserCog, Users2, FolderOpen, Truck,
  ClipboardList,
} from 'lucide-react';
import { toast } from 'sonner';
import api from '../lib/api';
import { useWorkspace, wsParams } from '../lib/workspace';
import { CAPTURE_TOOLS, BOTTOM_STRIP } from '../mocks/dashboard';

const ICONS = { FileText, ClipboardCheck, NotebookPen, TriangleAlert, Siren, ShieldCheck, Sparkles, Database, Radar, Eye, HardHat, Award, UserCog, Users2, FolderOpen, Truck, ClipboardList };

// Filler widgets for the centre column — close the gap below the action row
// so the Key Metrics column visually balances the Ask Intelligence column.
const CERT_STATUS_CHIP = {
  expired:       'bg-[#f7d8dc] text-[#a8324c] border-[#e69aa3]',
  expiring_soon: 'bg-[#f7eed1] text-[#8c6a1a] border-[#e6d995]',
  missing_file:  'bg-[#f7eed1] text-[#8c6a1a] border-[#e6d995]',
};
const CERT_STATUS_RANK = { expired: 0, expiring_soon: 1, missing_file: 2 };

function UpcomingCertExpiriesCard() {
  const navigate = useNavigate();
  const [rows, setRows] = useState(null);
  useEffect(() => {
    let alive = true;
    api.get('/workers/certifications/all')
      .then((r) => {
        if (!alive) return;
        const flagged = (r.data || []).filter((c) =>
          ['expired', 'expiring_soon', 'missing_file'].includes(c.status?.key)
        );
        flagged.sort((a, b) => {
          const ra = CERT_STATUS_RANK[a.status?.key] ?? 9;
          const rb = CERT_STATUS_RANK[b.status?.key] ?? 9;
          if (ra !== rb) return ra - rb;
          return (a.expiry_date || 'z').localeCompare(b.expiry_date || 'z');
        });
        setRows(flagged.slice(0, 5));
      })
      .catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, []);

  const count = rows?.length ?? 0;
  return (
    <div className="rounded-2xl border border-[#e6d995] bg-[#fffaeb] p-4" data-testid="dashboard-cert-expiries">
      <div className="flex items-center gap-2 mb-3">
        <div className="rounded-lg bg-[#f7eed1] p-1.5"><AlertTriangle size={14} className="text-[#8c6a1a]" /></div>
        <div className="text-sm font-semibold text-[#5c4810] flex-1">Upcoming cert expiries</div>
        {rows !== null && (
          <span className="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full bg-[#f7eed1] text-[#8c6a1a]">
            {count} at risk
          </span>
        )}
      </div>
      {rows === null ? (
        <div className="text-xs text-slate-500">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-[#d8ecdd] text-[#1f7a3f] border border-[#b6dcbf]">
          <ShieldCheck size={11} /> No certs need attention. Nice.
        </div>
      ) : (
        <ul className="space-y-1" data-testid="cert-expiry-list">
          {rows.map((c) => (
            <li key={c.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/70 transition-colors">
              <Award size={12} className="text-[#8c6a1a] shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-slate-900 truncate">
                  {c.worker_first_name} {c.worker_last_name}
                </div>
                <div className="text-[11px] text-slate-500 truncate">{c.name}</div>
              </div>
              <span className={`inline-flex items-center text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border whitespace-nowrap ${CERT_STATUS_CHIP[c.status?.key] || CERT_STATUS_CHIP.missing_file}`}>
                {c.status?.label}
              </span>
            </li>
          ))}
        </ul>
      )}
      <button onClick={() => navigate('/app/settings/certifications')}
        data-testid="view-all-certs-link"
        className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-[#8c6a1a] hover:underline">
        View all certs <ArrowRight size={11} />
      </button>
    </div>
  );
}

const MODULE_META = {
  swms:      { label: 'SWMS',      icon: FileText,        tint: 'bg-[#d8ecdd] text-[#1f7a3f]', route: '/app/swms' },
  hazards:   { label: 'Hazard',    icon: TriangleAlert,   tint: 'bg-[#f8d7c3] text-[#9c4f1a]', route: '/app/hazards' },
  incidents: { label: 'Incident',  icon: Siren,           tint: 'bg-[#f7d8dc] text-[#a8324c]', route: '/app/incidents' },
};

function timeAgo(iso) {
  if (!iso) return '';
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diff = Math.max(0, Math.floor((now - then) / 1000));
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

function RecentActivityCard() {
  const navigate = useNavigate();
  const [rows, setRows] = useState(null);
  useEffect(() => {
    let alive = true;
    Promise.all([
      api.get('/swms').then((r) => (r.data || []).slice(0, 3).map((x) => ({ ...x, _module: 'swms' }))).catch(() => []),
      api.get('/hazards').then((r) => (r.data || []).slice(0, 3).map((x) => ({ ...x, _module: 'hazards' }))).catch(() => []),
      api.get('/incidents').then((r) => (r.data || []).slice(0, 2).map((x) => ({ ...x, _module: 'incidents' }))).catch(() => []),
    ]).then((batches) => {
      if (!alive) return;
      const merged = batches.flat()
        .filter((r) => r.created_at)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, 5);
      setRows(merged);
    });
    return () => { alive = false; };
  }, []);

  return (
    <div className="rounded-2xl border border-[#b9d2ec] bg-[#eff5fc] p-4" data-testid="dashboard-recent-activity">
      <div className="flex items-center gap-2 mb-3">
        <div className="rounded-lg bg-[#d8e6f4] p-1.5"><Clock size={14} className="text-[#1e4a8c]" /></div>
        <div className="text-sm font-semibold text-[#1e3a6b]">Recent activity</div>
      </div>
      {rows === null ? (
        <div className="text-xs text-slate-500">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="text-xs text-slate-500 italic">Nothing new yet — capture your first record.</div>
      ) : (
        <ul className="space-y-1" data-testid="recent-activity-list">
          {rows.map((r) => {
            const meta = MODULE_META[r._module];
            const Icon = meta.icon;
            return (
              <li key={`${r._module}-${r.id}`}>
                <button onClick={() => navigate(meta.route)}
                  data-testid={`activity-${r._module}-${r.id}`}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/70 transition-colors text-left">
                  <div className={`rounded-md p-1.5 shrink-0 ${meta.tint}`}><Icon size={11} /></div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-slate-900 truncate">
                      {meta.label} · {r.title || r.reference || r.ref || '(untitled)'}
                    </div>
                    <div className="text-[11px] text-slate-500 truncate">
                      {r.created_by_name || 'Someone'} · {timeAgo(r.created_at)}
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// Compliance Snapshot — value-prop cards above the capture grid.
const SNAPSHOT_CARDS = [
  { key: 'one-source', title: 'One source of truth', icon: Database, pastel: 'sage',
    desc: 'Every record across every workspace in one connected platform.' },
  { key: 'risk-early', title: 'Risk surfaced early', icon: TriangleAlert, pastel: 'peach',
    desc: 'AI flags recurring issues before they escalate.' },
  { key: 'oversight', title: 'Built for oversight', icon: ShieldCheck, pastel: 'sky',
    desc: 'Roles, audit trails and exports designed for HSE leaders.' },
  { key: 'ask-intel', title: 'Ask Intelligence', icon: Sparkles, pastel: 'lilac',
    desc: 'Natural-language questions answered instantly across every safety record.' },
];

function SnapshotCard({ card }) {
  const Icon = card.icon;
  return (
    <div data-testid={`snapshot-card-${card.key}`}
      className="group rounded-2xl bg-white p-4 transition-all hover:-translate-y-0.5 hover:shadow-card"
      style={{ borderLeft: `4px solid var(--pastel-${card.pastel}-ink)`, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
      <div className={`w-9 h-9 rounded-xl pastel-icon-${card.pastel} flex items-center justify-center mb-2.5`}>
        <Icon size={16} />
      </div>
      <h3 className="font-display text-base font-semibold text-slate-900">{card.title}</h3>
      <p className="mt-1 text-sm text-slate-600 leading-snug">{card.desc}</p>
    </div>
  );
}

// Per-module pastel-tile mapping (Thread B theme).
// Background images live in /public/tile-bgs/ — applied via inline style to
// dodge webpack's css-loader root-relative URL resolution.
const TILE_BG_BY_KEY = {
  swms: '/tile-bgs/swms.png', 'ai-swms': '/tile-bgs/swms.png',
  'pre-starts': '/tile-bgs/prestarts.png', prestarts: '/tile-bgs/prestarts.png',
  'site-diary': '/tile-bgs/diary.png', diary: '/tile-bgs/diary.png',
  hazards: '/tile-bgs/hazards.png',
  incidents: '/tile-bgs/incidents.png',
  inspections: '/tile-bgs/inspections.png',
  // New "People & Compliance" + "Contractors & Docs" tiles reuse existing
  // illustrations whose colour temperatures match the pastel target.
  workers: '/tile-bgs/prestarts.png',
  certifications: '/tile-bgs/compliance.png',
  users: '/tile-bgs/contractors.png',
  suppliers: '/tile-bgs/contractors.png',
  'document-library': '/tile-bgs/intelligence.png',
  vehicles: '/tile-bgs/prestarts.png',
  forms: '/tile-bgs/diary.png',
  'generate-ai': '/tile-bgs/diary.png',
};
const ICON_PASTEL_BY_KEY = {
  swms: 'pastel-icon-mint', 'ai-swms': 'pastel-icon-mint',
  'pre-starts': 'pastel-icon-sky', prestarts: 'pastel-icon-sky',
  'site-diary': 'pastel-icon-butter', diary: 'pastel-icon-butter',
  hazards: 'pastel-icon-peach',
  incidents: 'pastel-icon-blush',
  inspections: 'pastel-icon-lavender',
  workers: 'pastel-icon-sky',
  certifications: 'pastel-icon-butter',
  users: 'pastel-icon-slate',
  suppliers: 'pastel-icon-mint',
  'document-library': 'pastel-icon-lavender',
  vehicles: 'pastel-icon-sky',
  forms: 'pastel-icon-sky',
  'generate-ai': 'pastel-icon-lavender',
};

// Left-column grouping — each group renders a small uppercase tracking-wide
// heading above its tiles so the column scrolls with rhythm rather than as a
// flat unbroken stack.
const CAPTURE_GROUPS = [
  { heading: 'Capture & Records', keys: ['swms', 'pre-starts', 'site-diary', 'forms', 'generate-ai'] },
  { heading: 'Risk & Incidents',  keys: ['hazards', 'incidents', 'inspections'] },
  { heading: 'People & Compliance', extras: [
    { key: 'workers',        title: 'Workers',              desc: 'Field crew directory synced from Simpro + manual adds.', icon: 'HardHat',  route: '/app/settings/workers' },
    { key: 'certifications', title: 'Certifications',       desc: 'White Card, First Aid, Heights — expiries at a glance.', icon: 'Award',    route: '/app/settings/certifications' },
    { key: 'users',          title: 'Users & Permissions',  desc: 'Org members, roles and workspace access.',                icon: 'UserCog',  route: '/app/users' },
  ] },
  { heading: 'Contractors & Docs', extras: [
    { key: 'suppliers',        title: 'Suppliers',         desc: 'Vendor directory with tasks, notes and renewal links.', icon: 'Users2',   route: '/app/suppliers' },
    { key: 'document-library', title: 'Document Library',  desc: '46 seed folders for licences, SDS, manuals and more.',   icon: 'FolderOpen', route: '/app/document-library' },
  ] },
  { heading: 'Ops & Fleet', extras: [
    { key: 'vehicles', title: 'Vehicles & Fleet', desc: 'Live GPS tracking via Navixy when configured.', icon: 'Truck', route: '/app/vehicles' },
  ] },
];

const METRIC_ROWS = [
  { key: 'swms', label: 'AI SWMS', field: 'swms_count', icon: 'FileText' },
  { key: 'pre-starts', label: 'Pre-starts', field: 'prestarts_count', icon: 'ClipboardCheck' },
  { key: 'site-diary', label: 'Site diary', field: 'diary_count', icon: 'NotebookPen' },
  { key: 'hazards', label: 'Hazards', field: 'hazards_count', icon: 'TriangleAlert' },
  { key: 'incidents', label: 'Incidents', field: 'incidents_count', icon: 'Siren' },
  { key: 'inspections', label: 'Inspections', field: 'inspections_count', icon: 'ShieldCheck' },
];

function CaptureCard({ tool, onClick }) {
  const Icon = ICONS[tool.icon] || FileText;
  const bgUrl = TILE_BG_BY_KEY[tool.key];
  const iconClass = ICON_PASTEL_BY_KEY[tool.key] || 'bg-brand-blue-soft text-brand-blue';
  return (
    <button onClick={onClick} data-testid={`capture-card-${tool.key}`}
      style={bgUrl ? { backgroundImage: `url(${bgUrl})` } : undefined}
      className="tile-bg group w-full text-left rounded-2xl border border-slate-200 bg-white p-4 hover:border-brand-blue/30 hover:shadow-card transition-all">
      <div className="flex items-start gap-3">
        <div className={`w-10 h-10 rounded-xl ${iconClass} flex items-center justify-center shrink-0`}>
          <Icon size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-base font-semibold">{tool.title}</h3>
            <ArrowRight size={16} className="text-slate-300 group-hover:text-brand-blue group-hover:translate-x-0.5 transition-all" />
          </div>
          <p className="mt-1 text-sm text-slate-700 leading-snug">{tool.desc}</p>
        </div>
      </div>
    </button>
  );
}

function MetricChip({ row, value }) {
  const Icon = ICONS[row.icon] || FileText;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 flex items-center gap-3" data-testid={`metric-${row.key}`}>
      <div className="w-9 h-9 rounded-lg bg-slate-50 text-slate-600 flex items-center justify-center shrink-0"><Icon size={16} /></div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-slate-800 truncate">{row.label}</div>
        <div className="text-[10px] uppercase tracking-wider text-slate-400">this quarter</div>
      </div>
      <div className="font-display text-xl font-semibold">{value}</div>
    </div>
  );
}

function ProofChip({ kind, label }) {
  return (
    <div className="rounded-lg border border-violet-200 bg-white p-2.5 text-xs flex gap-2 items-start">
      <span className="px-1.5 py-0.5 rounded bg-brand-violet-soft text-brand-violet text-[10px] font-semibold uppercase tracking-wider shrink-0">{kind}</span>
      <span className="text-slate-700 leading-snug">{label}</span>
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { workspaceId } = useWorkspace();
  const [m, setM] = useState(null);
  const [loading, setLoading] = useState(true);
  const [briefing, setBriefing] = useState(null);
  const [briefingLoading, setBriefingLoading] = useState(true);
  const [pdfBusy, setPdfBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true); setBriefingLoading(true);
    const params = wsParams(workspaceId);
    api.get('/dashboard/metrics', { params })
      .then((r) => { if (alive) setM(r.data); })
      .catch(() => toast.error('Could not load dashboard metrics'))
      .finally(() => { if (alive) setLoading(false); });
    api.get('/ask/briefing', { params })
      .then((r) => { if (alive) setBriefing(r.data); })
      .catch(() => {})
      .finally(() => { if (alive) setBriefingLoading(false); });
    return () => { alive = false; };
  }, [workspaceId]);

  const downloadPdf = async () => {
    setPdfBusy(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const ninetyAgo = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
      const payload = {
        date_from: ninetyAgo, date_to: today, format: 'pdf',
        title: 'Quarterly Compliance Pack',
        include: ['swms', 'pre_starts', 'site_diary', 'hazards', 'incidents', 'inspections', 'contractors'],
        ...wsParams(workspaceId),
      };
      const { data } = await api.post('/audit-exports', payload);
      const url = `${process.env.REACT_APP_BACKEND_URL}${data.file_url}`;
      window.open(url, '_blank', 'noopener');
      toast.success('PDF audit pack generated', { description: 'Opening in a new tab.' });
    } catch (e) {
      toast.error('Could not generate PDF');
    } finally { setPdfBusy(false); }
  };

  const score = m?.attention_score ?? 0;
  const band = m?.attention_band ?? 'Strong';
  const bandColor = band === 'Strong' ? 'emerald' : band === 'Watch' ? 'amber' : 'red';

  return (
    <div className="max-w-[1400px] mx-auto" data-testid="dashboard-page">
      <div
        className="page-banner mb-8 px-6 sm:px-8 py-7 sm:py-9 border border-slate-200 shadow-sm"
        style={{ backgroundImage: 'url(/tile-bgs/compliance.png)' }}
        data-testid="dashboard-banner"
      >
        <div className="text-[11px] font-semibold tracking-[0.18em] text-brand-blue uppercase">Paneltec Civil Intelligence Centre</div>
        <h1 className="font-display text-3xl sm:text-4xl lg:text-5xl font-semibold mt-2 leading-tight tracking-tight text-slate-900">Live Compliance Dashboard</h1>
        <p className="mt-3 text-slate-700 max-w-2xl">Organisation-wide monitoring feeds your single source of truth.</p>
      </div>

      {/* Compliance Snapshot — value-prop cards (Thread B) */}
      <section className="mb-8" data-testid="compliance-snapshot">
        <h2 className="font-display text-lg font-semibold text-slate-900 mb-3">Compliance Snapshot</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {SNAPSHOT_CARDS.map((c) => <SnapshotCard key={c.key} card={c} />)}
        </div>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* LEFT — Create & Capture, grouped */}
        <section className="xl:col-span-4 space-y-3" data-testid="capture-column">
          {CAPTURE_GROUPS.map((group, gi) => {
            // Resolve tiles: explicit `extras` for new groups, otherwise look
            // up from the existing CAPTURE_TOOLS mock by key.
            const tiles = group.extras
              ? group.extras
              : group.keys.map((k) => CAPTURE_TOOLS.find((t) => t.key === k)).filter(Boolean);
            if (tiles.length === 0) return null;
            return (
              <div key={group.heading} className="space-y-2" data-testid={`capture-group-${group.heading.toLowerCase().replace(/[^a-z]/g,'-')}`}>
                <div className={`text-[11px] font-semibold tracking-[0.16em] text-slate-500 uppercase ${gi === 0 ? 'mb-1' : 'mt-4 mb-1 pt-3 border-t border-slate-200/70'}`}>
                  {group.heading}
                </div>
                {tiles.map((t) => <CaptureCard key={t.key} tool={t} onClick={() => navigate(t.route)} />)}
              </div>
            );
          })}
          <button onClick={() => navigate('/app/swms')} data-testid="view-all-features"
            className="w-full mt-2 text-sm text-brand-blue hover:underline inline-flex items-center justify-center gap-1.5 py-2">
            View all features <ArrowRight size={14} />
          </button>
        </section>

        {/* CENTER — Snapshot */}
        <section className="xl:col-span-5 space-y-4" data-testid="snapshot-column">
          <div className="text-[11px] font-semibold tracking-[0.16em] text-slate-500 uppercase mb-1">Key metrics</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {METRIC_ROWS.map((row) => (
              <MetricChip key={row.key} row={row} value={loading ? '…' : (m?.[row.field] ?? 0)} />
            ))}
          </div>

          <div className={`rounded-2xl border-2 border-${bandColor}-200 bg-${bandColor === 'emerald' ? 'brand-green-mint' : bandColor + '-50'}/40 p-5`} data-testid="attention-score-card">
            <div className="flex items-center justify-between mb-3">
              <div className={`text-[10px] uppercase tracking-[0.18em] font-semibold text-${bandColor}-700`}>Compliance Attention Score</div>
              <span className={`text-[10px] px-2 py-0.5 rounded-full bg-white border border-${bandColor}-200 text-${bandColor}-700 font-semibold`}>Org-wide</span>
            </div>
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-5">
              <div className="relative w-24 h-24 shrink-0">
                <svg viewBox="0 0 36 36" className="w-24 h-24 -rotate-90">
                  <circle cx="18" cy="18" r="15.9" fill="none" stroke={bandColor === 'emerald' ? '#A7F3D0' : bandColor === 'amber' ? '#FDE68A' : '#FECACA'} strokeWidth="3" />
                  <circle cx="18" cy="18" r="15.9" fill="none" stroke={bandColor === 'emerald' ? '#10B981' : bandColor === 'amber' ? '#F59E0B' : '#EF4444'} strokeWidth="3" strokeDasharray={`${score} 100`} strokeLinecap="round" />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <div className={`font-display text-lg font-bold text-${bandColor}-700`}>{score}/100</div>
                  <div className={`text-[9px] uppercase tracking-wider text-${bandColor}-700 font-semibold`}>{band}</div>
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-display text-xl sm:text-2xl font-semibold">{band} · {score} / 100</div>
                <p className="mt-1.5 text-sm text-slate-700 leading-relaxed">
                  {band === 'Strong' && 'Compliance signal is strong across every workspace. No registers are flagged for management escalation.'}
                  {band === 'Watch' && 'A handful of records need attention — review the hazards and submitted SWMS this week.'}
                  {band === 'Action needed' && 'Multiple open hazards or incidents — escalate review immediately.'}
                </p>
                <p className="mt-1 text-sm text-slate-600">{m?.records_needing_attention ?? 0} records pending sign-off.</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              ['Monitoring scope', m?.monitoring_scope ?? 'Organisation wide'],
              ['Workspaces', m?.workspaces_scope ?? 'All allowed workspaces'],
              ['Registers connected', m?.registers_connected ?? 26],
              ['Records needing attention', m?.records_needing_attention ?? 0],
            ].map(([k, v]) => (
              <div key={k} className="rounded-xl border border-slate-200 bg-white p-3.5">
                <div className="text-[10px] uppercase tracking-[0.14em] font-semibold text-slate-400">{k}</div>
                <div className="mt-1 text-sm font-medium text-slate-800 break-words">{v}</div>
              </div>
            ))}
          </div>

          <div className={`rounded-xl bg-${bandColor === 'emerald' ? 'brand-green-mint' : bandColor + '-50'} border border-${bandColor}-200 px-4 py-3 text-sm text-${bandColor}-800 flex items-center gap-2`} data-testid="strong-banner">
            <ShieldCheck size={16} className={`text-${bandColor}-600 shrink-0`} />
            {band === 'Strong' && 'Strong organisation-wide compliance monitoring signal.'}
            {band === 'Watch' && 'A few items need a look — see open hazards and submitted SWMS.'}
            {band === 'Action needed' && 'Compliance signal is below threshold — review action items.'}
          </div>

          <div className="flex flex-wrap gap-2">
            <button data-testid="live-dashboard-btn"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-brand-ink text-white text-sm font-medium hover:bg-slate-800 transition-colors">
              <BarChart3 size={16} /> Live dashboard
            </button>
            <button data-testid="download-pdf-btn" onClick={downloadPdf} disabled={pdfBusy}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-slate-300 text-sm font-medium hover:bg-slate-50 transition-colors disabled:opacity-60">
              <Download size={16} /> {pdfBusy ? 'Generating…' : 'Download PDF report'}
            </button>
          </div>

          {/* Filler widgets — close the dead-space gap with the Ask column. */}
          <UpcomingCertExpiriesCard />
          <RecentActivityCard />
        </section>

        {/* RIGHT — Ask Intelligence (still MOCKED briefing copy) */}
        <section className="xl:col-span-3 space-y-4" data-testid="ask-column">
          <div className="text-[11px] font-semibold tracking-[0.16em] text-brand-violet uppercase mb-1">Ask Intelligence</div>
          <p className="text-sm text-slate-600 leading-relaxed">Natural-language Q&amp;A grounded in your own records — every answer is cited to source evidence.</p>
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="text-[10px] uppercase tracking-[0.16em] font-semibold text-slate-400 mb-2">Your question</div>
            <p className="text-sm text-slate-800 leading-snug">What needs management attention now, what should we do, and what evidence proves it?</p>
          </div>
          {briefingLoading ? (
            <div className="rounded-2xl border-2 border-violet-200 bg-brand-violet-soft/40 p-4 animate-pulse">
              <div className="h-3 w-32 bg-violet-100 rounded mb-3" />
              <div className="h-4 w-3/4 bg-violet-100 rounded mb-2" />
              <div className="h-3 w-full bg-violet-100 rounded mb-1" />
              <div className="h-3 w-5/6 bg-violet-100 rounded" />
            </div>
          ) : briefing ? (
            <div className="rounded-2xl border-2 border-violet-200 bg-brand-violet-soft/60 p-4" data-testid="briefing-card">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[10px] uppercase tracking-[0.16em] font-semibold text-brand-violet">Intelligence Briefing</div>
                <span className="text-[10px] inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-brand-green-mint text-emerald-700 font-semibold">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> {briefing.confidence || 'high'} confidence
                </span>
              </div>
              <h3 className="font-display text-base font-semibold text-slate-900">{briefing.title}</h3>
              <p className="mt-1.5 text-sm text-slate-700 leading-relaxed">{briefing.body}</p>
              {briefing.cited_evidence?.length > 0 && (
                <div className="mt-3">
                  <div className="text-[10px] uppercase tracking-[0.16em] font-semibold text-slate-500 mb-1.5 flex items-center gap-1">
                    <FileSearch size={11} /> Cited evidence
                  </div>
                  <div className="space-y-1.5">
                    {briefing.cited_evidence.slice(0, 3).map((c, i) => (
                      <div key={i} className="rounded-lg border border-violet-200 bg-white p-2.5 text-xs flex gap-2 items-start">
                        <span className="px-1.5 py-0.5 rounded bg-brand-violet-soft text-brand-violet text-[10px] font-semibold uppercase tracking-wider shrink-0">{c.record_type}</span>
                        <span className="text-slate-700 leading-snug">{c.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : null}
          <button onClick={() => navigate('/app/ask')} data-testid="explore-ask-btn"
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-brand-ink text-white text-sm font-medium hover:bg-slate-800 transition-colors">
            Explore Ask Intelligence <ArrowRight size={14} />
          </button>
        </section>
      </div>

      <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4" data-testid="quick-actions">
        {BOTTOM_STRIP.map((b) => {
          const Icon = ICONS[b.icon] || Sparkles;
          return (
            <div key={b.title} className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="w-9 h-9 rounded-lg bg-brand-blue-soft text-brand-blue flex items-center justify-center mb-3"><Icon size={16} /></div>
              <div className="font-display font-semibold text-sm">{b.title}</div>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">{b.desc}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
