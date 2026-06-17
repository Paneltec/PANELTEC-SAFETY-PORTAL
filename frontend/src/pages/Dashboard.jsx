import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight, FileText, ClipboardCheck, NotebookPen, TriangleAlert, Siren,
  ShieldCheck, BarChart3, Download, Sparkles, Database, Radar, Eye, FileSearch,
} from 'lucide-react';
import { toast } from 'sonner';
import api from '../lib/api';
import { useWorkspace, wsParams } from '../lib/workspace';
import { CAPTURE_TOOLS, BOTTOM_STRIP } from '../mocks/dashboard';

const ICONS = { FileText, ClipboardCheck, NotebookPen, TriangleAlert, Siren, ShieldCheck, Sparkles, Database, Radar, Eye };

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
  return (
    <button onClick={onClick} data-testid={`capture-card-${tool.key}`}
      className="group w-full text-left rounded-2xl border border-slate-200 bg-white p-4 hover:border-brand-blue/30 hover:shadow-card transition-all">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-brand-blue-soft text-brand-blue flex items-center justify-center shrink-0">
          <Icon size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-base font-semibold">{tool.title}</h3>
            <ArrowRight size={16} className="text-slate-300 group-hover:text-brand-blue group-hover:translate-x-0.5 transition-all" />
          </div>
          <p className="mt-1 text-sm text-slate-500 leading-snug">{tool.desc}</p>
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
      <div className="mb-8">
        <div className="text-[11px] font-semibold tracking-[0.18em] text-brand-blue uppercase">Paneltec Civil Intelligence Centre</div>
        <h1 className="font-display text-3xl sm:text-4xl lg:text-5xl font-semibold mt-2 leading-tight tracking-tight">Live Compliance Dashboard</h1>
        <p className="mt-3 text-slate-600 max-w-2xl">Organisation-wide monitoring feeds your single source of truth.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* LEFT — Create & Capture */}
        <section className="lg:col-span-4 space-y-3" data-testid="capture-column">
          <div className="text-[11px] font-semibold tracking-[0.16em] text-slate-500 uppercase mb-1">Create &amp; Capture</div>
          {CAPTURE_TOOLS.map((t) => <CaptureCard key={t.key} tool={t} onClick={() => navigate(t.route)} />)}
          <button onClick={() => navigate('/app/swms')} data-testid="view-all-features"
            className="w-full mt-2 text-sm text-brand-blue hover:underline inline-flex items-center justify-center gap-1.5 py-2">
            View all features <ArrowRight size={14} />
          </button>
        </section>

        {/* CENTER — Snapshot */}
        <section className="lg:col-span-5 space-y-4" data-testid="snapshot-column">
          <div className="text-[11px] font-semibold tracking-[0.16em] text-slate-500 uppercase mb-1">Compliance Snapshot</div>
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
            <div className="flex items-center gap-5">
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
              <div className="flex-1">
                <div className="font-display text-2xl font-semibold">{band} · {score} / 100</div>
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
              <div key={k} className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="text-[10px] uppercase tracking-[0.14em] font-semibold text-slate-400">{k}</div>
                <div className="mt-1 text-sm font-medium text-slate-800">{v}</div>
              </div>
            ))}
          </div>

          <div className={`rounded-xl bg-${bandColor === 'emerald' ? 'brand-green-mint' : bandColor + '-50'} border border-${bandColor}-200 px-4 py-3 text-sm text-${bandColor}-800 flex items-center gap-2`} data-testid="strong-banner">
            <ShieldCheck size={16} className={`text-${bandColor}-600`} />
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
        </section>

        {/* RIGHT — Ask Intelligence (still MOCKED briefing copy) */}
        <section className="lg:col-span-3 space-y-4" data-testid="ask-column">
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

      <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-4 gap-4" data-testid="quick-actions">
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
