import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight, FileText, ClipboardCheck, NotebookPen, TriangleAlert, Siren,
  ShieldCheck, BarChart3, Download, Sparkles, Database, Radar, Eye, FileSearch,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  CAPTURE_TOOLS, COMPLIANCE_METRICS, ATTENTION_SCORE, MONITORING_FACTS,
  ASK_BRIEFING, BOTTOM_STRIP,
} from '../mocks/dashboard';

const ICONS = {
  FileText, ClipboardCheck, NotebookPen, TriangleAlert, Siren, ShieldCheck,
  Sparkles, Database, Radar, Eye,
};

function CaptureCard({ tool, onClick }) {
  const Icon = ICONS[tool.icon] || FileText;
  return (
    <button
      onClick={onClick}
      data-testid={`capture-card-${tool.key}`}
      className="group w-full text-left rounded-2xl border border-slate-200 bg-white p-4 hover:border-brand-blue/30 hover:shadow-card transition-all"
    >
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

function MetricChip({ m }) {
  const Icon = ICONS[m.icon] || FileText;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 flex items-center gap-3" data-testid={`metric-${m.key}`}>
      <div className="w-9 h-9 rounded-lg bg-slate-50 text-slate-600 flex items-center justify-center shrink-0">
        <Icon size={16} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-slate-800 truncate">{m.label}</div>
        <div className="text-[10px] uppercase tracking-wider text-slate-400">this quarter</div>
      </div>
      <div className="font-display text-xl font-semibold">{m.value}</div>
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

  return (
    <div className="max-w-[1400px] mx-auto" data-testid="dashboard-page">
      {/* Header */}
      <div className="mb-8">
        <div className="text-[11px] font-semibold tracking-[0.18em] text-brand-blue uppercase">
          Paneltec Civil Intelligence Centre
        </div>
        <h1 className="font-display text-3xl sm:text-4xl lg:text-5xl font-semibold mt-2 leading-tight tracking-tight">
          Live Compliance Dashboard
        </h1>
        <p className="mt-3 text-slate-600 max-w-2xl">
          Organisation-wide monitoring feeds your single source of truth.
        </p>
      </div>

      {/* 3 col grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* LEFT — Create & Capture */}
        <section className="lg:col-span-4 space-y-3" data-testid="capture-column">
          <div className="text-[11px] font-semibold tracking-[0.16em] text-slate-500 uppercase mb-1">
            Create &amp; Capture
          </div>
          {CAPTURE_TOOLS.map((t) => (
            <CaptureCard key={t.key} tool={t} onClick={() => navigate(t.route)} />
          ))}
          <button
            onClick={() => navigate('/app/swms')}
            data-testid="view-all-features"
            className="w-full mt-2 text-sm text-brand-blue hover:underline inline-flex items-center justify-center gap-1.5 py-2"
          >
            View all features <ArrowRight size={14} />
          </button>
        </section>

        {/* CENTER — Compliance Snapshot */}
        <section className="lg:col-span-5 space-y-4" data-testid="snapshot-column">
          <div className="text-[11px] font-semibold tracking-[0.16em] text-slate-500 uppercase mb-1">
            Compliance Snapshot
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {COMPLIANCE_METRICS.map((m) => <MetricChip key={m.key} m={m} />)}
          </div>

          {/* Attention score card */}
          <div className="rounded-2xl border-2 border-emerald-200 bg-brand-green-mint/40 p-5" data-testid="attention-score-card">
            <div className="flex items-center justify-between mb-3">
              <div className="text-[10px] uppercase tracking-[0.18em] font-semibold text-emerald-700">
                Compliance Attention Score
              </div>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-white border border-emerald-200 text-emerald-700 font-semibold">
                Org-wide
              </span>
            </div>
            <div className="flex items-center gap-5">
              <div className="relative w-24 h-24 shrink-0">
                <svg viewBox="0 0 36 36" className="w-24 h-24 -rotate-90">
                  <circle cx="18" cy="18" r="15.9" fill="none" stroke="#A7F3D0" strokeWidth="3" />
                  <circle cx="18" cy="18" r="15.9" fill="none" stroke="#10B981" strokeWidth="3"
                    strokeDasharray={`${ATTENTION_SCORE.score} 100`} strokeLinecap="round" />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <div className="font-display text-lg font-bold text-emerald-700">
                    {ATTENTION_SCORE.score}/{ATTENTION_SCORE.outOf}
                  </div>
                  <div className="text-[9px] uppercase tracking-wider text-emerald-700 font-semibold">
                    {ATTENTION_SCORE.band}
                  </div>
                </div>
              </div>
              <div className="flex-1">
                <div className="font-display text-2xl font-semibold">
                  {ATTENTION_SCORE.band} · {ATTENTION_SCORE.score} / {ATTENTION_SCORE.outOf}
                </div>
                <p className="mt-1.5 text-sm text-slate-700 leading-relaxed">{ATTENTION_SCORE.blurb}</p>
                <p className="mt-1 text-sm text-slate-600">{ATTENTION_SCORE.scopeLine}</p>
              </div>
            </div>
          </div>

          {/* monitoring facts */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              ['Monitoring scope', MONITORING_FACTS.scope],
              ['Workspaces', MONITORING_FACTS.workspaces],
              ['Registers connected', MONITORING_FACTS.registers],
              ['Records needing attention', MONITORING_FACTS.needsAttention],
            ].map(([k, v]) => (
              <div key={k} className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="text-[10px] uppercase tracking-[0.14em] font-semibold text-slate-400">{k}</div>
                <div className="mt-1 text-sm font-medium text-slate-800">{v}</div>
              </div>
            ))}
          </div>

          {/* Mint banner */}
          <div className="rounded-xl bg-brand-green-mint border border-emerald-200 px-4 py-3 text-sm text-emerald-800 flex items-center gap-2" data-testid="strong-banner">
            <ShieldCheck size={16} className="text-emerald-600" />
            Strong organisation-wide compliance monitoring signal.
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            <button
              data-testid="live-dashboard-btn"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-brand-ink text-white text-sm font-medium hover:bg-slate-800 transition-colors"
            >
              <BarChart3 size={16} /> Live dashboard
            </button>
            <button
              data-testid="download-pdf-btn"
              onClick={() =>
                toast.success('PDF export queued', {
                  description: 'MOCKED: report will be emailed when ready.',
                })
              }
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-slate-300 text-sm font-medium hover:bg-slate-50 transition-colors"
            >
              <Download size={16} /> Download PDF report
            </button>
          </div>
        </section>

        {/* RIGHT — Ask Intelligence */}
        <section className="lg:col-span-3 space-y-4" data-testid="ask-column">
          <div className="text-[11px] font-semibold tracking-[0.16em] text-brand-violet uppercase mb-1">
            Ask Intelligence
          </div>
          <p className="text-sm text-slate-600 leading-relaxed">
            Natural-language Q&amp;A grounded in your own records — every answer is cited to source evidence.
          </p>

          {/* question card */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="text-[10px] uppercase tracking-[0.16em] font-semibold text-slate-400 mb-2">Your question</div>
            <p className="text-sm text-slate-800 leading-snug">{ASK_BRIEFING.question}</p>
          </div>

          {/* briefing */}
          <div className="rounded-2xl border-2 border-violet-200 bg-brand-violet-soft/60 p-4" data-testid="briefing-card">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[10px] uppercase tracking-[0.16em] font-semibold text-brand-violet">Intelligence Briefing</div>
              <span className="text-[10px] inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-brand-green-mint text-emerald-700 font-semibold">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> high confidence
              </span>
            </div>
            <h3 className="font-display text-base font-semibold text-slate-900">{ASK_BRIEFING.title}</h3>
            <p className="mt-1.5 text-sm text-slate-700 leading-relaxed">{ASK_BRIEFING.body}</p>
            <div className="mt-3">
              <div className="text-[10px] uppercase tracking-[0.16em] font-semibold text-slate-500 mb-1.5 flex items-center gap-1">
                <FileSearch size={11} /> Cited evidence
              </div>
              <div className="space-y-1.5">
                {ASK_BRIEFING.citations.map((c, i) => <ProofChip key={i} kind={c.kind} label={c.label} />)}
              </div>
            </div>
          </div>

          <button
            onClick={() => navigate('/app/ask')}
            data-testid="explore-ask-btn"
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-brand-ink text-white text-sm font-medium hover:bg-slate-800 transition-colors"
          >
            Explore Ask Intelligence <ArrowRight size={14} />
          </button>
        </section>
      </div>

      {/* Quick actions bottom strip */}
      <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-4 gap-4" data-testid="quick-actions">
        {BOTTOM_STRIP.map((b) => {
          const Icon = ICONS[b.icon] || Sparkles;
          return (
            <div key={b.title} className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="w-9 h-9 rounded-lg bg-brand-blue-soft text-brand-blue flex items-center justify-center mb-3">
                <Icon size={16} />
              </div>
              <div className="font-display font-semibold text-sm">{b.title}</div>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">{b.desc}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
