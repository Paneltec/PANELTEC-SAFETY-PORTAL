// Shared UI helpers for capture pages.
import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Loader2, Plus, Sparkles } from 'lucide-react';

// Module → pastel theme map (Thread B). Resolves a pastel theme from a crumb
// string like "Capture / AI SWMS" or "Compliance / Contractors".
const MODULE_PASTEL = {
  'AI SWMS':            { key: 'mint',     img: '/tile-bgs/swms.png',         ink: 'text-[#1f7a3f]', tint: 'rgba(216,236,221,0.55)' },
  'Daily Pre-Starts':   { key: 'sky',      img: '/tile-bgs/prestarts.png',    ink: 'text-[#1e4a8c]', tint: 'rgba(216,230,244,0.55)' },
  'Site Diary':         { key: 'butter',   img: '/tile-bgs/diary.png',        ink: 'text-[#8c6a1a]', tint: 'rgba(247,238,209,0.55)' },
  'Hazard Reports':     { key: 'peach',    img: '/tile-bgs/hazards.png',      ink: 'text-[#a8480f]', tint: 'rgba(247,223,209,0.55)' },
  'Incident Reports':   { key: 'blush',    img: '/tile-bgs/incidents.png',    ink: 'text-[#a8324c]', tint: 'rgba(247,216,220,0.55)' },
  'Inspection Reports': { key: 'lavender', img: '/tile-bgs/inspections.png',  ink: 'text-[#4f3a8c]', tint: 'rgba(226,220,239,0.55)' },
  'Contractors':        { key: 'sage',     img: '/tile-bgs/contractors.png',  ink: 'text-[#2e5e2e]', tint: 'rgba(221,231,216,0.55)' },
  'Renewal Links':      { key: 'sage',     img: '/tile-bgs/contractors.png',  ink: 'text-[#2e5e2e]', tint: 'rgba(221,231,216,0.55)' },
  'Audit Exports':      { key: 'coral',    img: '/tile-bgs/compliance.png',   ink: 'text-[#a83a2e]', tint: 'rgba(247,216,209,0.55)' },
  'Vehicles':           { key: 'sky',      img: '/tile-bgs/dashboard-hero.png', ink: 'text-[#1e4a8c]', tint: 'rgba(216,230,244,0.55)' },
};

function pastelFromCrumb(crumb) {
  if (!crumb || typeof crumb !== 'string') return null;
  const parts = crumb.split('/').map((s) => s.trim()).filter(Boolean);
  // Only apply the banner to list pages — crumbs with exactly TWO segments
  // (e.g. "Capture / AI SWMS"). Detail / New crumbs have three or more.
  if (parts.length !== 2) return null;
  return MODULE_PASTEL[parts[1]] || null;
}

export function PageHeader({ crumb, title, subtitle, action, pastel: pastelOverride }) {
  const pastel = pastelOverride === false ? null : (pastelOverride || pastelFromCrumb(crumb));

  if (pastel) {
    return (
      <div
        className="page-banner mb-6 px-6 sm:px-8 py-7 sm:py-8 border border-slate-200 shadow-sm"
        style={{ backgroundImage: `url(${pastel.img})` }}
        data-testid="page-banner"
        data-pastel={pastel.key}
      >
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div className="min-w-0">
            {crumb && <div className={`text-[11px] font-semibold tracking-[0.16em] uppercase mb-2 ${pastel.ink}`}>{crumb}</div>}
            <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight text-slate-900">{title}</h1>
            {subtitle && <p className="mt-1.5 text-sm text-slate-700 max-w-2xl">{subtitle}</p>}
          </div>
          {action}
        </div>
      </div>
    );
  }

  return (
    <div className="mb-6 flex items-start justify-between flex-wrap gap-3">
      <div>
        {crumb && <div className="text-xs text-slate-500 mb-2">{crumb}</div>}
        <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1.5 text-sm text-slate-600 max-w-2xl">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function NewButton({ to, label = 'Create new', testid }) {
  return (
    <Link to={to} data-testid={testid}
      className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-brand-blue text-white text-sm font-medium hover:bg-blue-600 transition-colors shadow-sm">
      <Plus size={16} /> {label}
    </Link>
  );
}

export function BackButton({ to }) {
  return (
    <Link to={to} className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900 mb-4" data-testid="back-button">
      <ArrowLeft size={14} /> Back
    </Link>
  );
}

export function AiButton({ onClick, busy, label = 'Generate with AI', testid }) {
  return (
    <button type="button" onClick={onClick} disabled={busy} data-testid={testid}
      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-brand-violet text-white text-sm font-medium hover:bg-violet-700 transition-colors disabled:opacity-60 shadow-sm">
      {busy ? <><Loader2 size={16} className="animate-spin" /> Thinking…</> : <><Sparkles size={14} /> {label}</>}
    </button>
  );
}

export function PrimaryButton({ children, onClick, type = 'button', busy, disabled, testid }) {
  return (
    <button type={type} onClick={onClick} disabled={busy || disabled} data-testid={testid}
      className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-brand-blue text-white text-sm font-medium hover:bg-blue-600 transition-colors disabled:opacity-60">
      {busy ? <Loader2 size={14} className="animate-spin" /> : null}{children}
    </button>
  );
}

export function GhostButton({ children, onClick, testid, type = 'button' }) {
  return (
    <button type={type} onClick={onClick} data-testid={testid}
      className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50">
      {children}
    </button>
  );
}

export function Field({ label, children, hint, required }) {
  return (
    <label className="block">
      <div className="text-sm font-medium text-slate-700 mb-1">
        {label}{required && <span className="text-brand-red ml-1">*</span>}
      </div>
      {children}
      {hint && <div className="text-xs text-slate-500 mt-1">{hint}</div>}
    </label>
  );
}

export const inputClass =
  'w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/30 focus:border-brand-blue';

export function EmptyState({ title, body, action }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center" data-testid="empty-state">
      <h3 className="font-display text-lg font-semibold">{title}</h3>
      <p className="mt-2 text-sm text-slate-500 max-w-md mx-auto">{body}</p>
      {action && <div className="mt-5 inline-flex">{action}</div>}
    </div>
  );
}

// Status badges — Thread B pastel theme.
// Each pill uses a soft pastel background + a dark, WCAG-AA-readable ink
// colour. Destructive states (rejected / critical) sit on a slightly more
// saturated blush so they still read as "needs attention" without the harsh
// primary red.
const STATUS_PALETTE = {
  // SWMS lifecycle
  draft:              'bg-slate-100 text-slate-700 border-slate-200',
  submitted:          'bg-[#d8e6f4] text-[#1e4a8c] border-[#b9d2ec]',
  approved:           'bg-[#d8ecdd] text-[#1f7a3f] border-[#b6dcbf]',
  rejected:           'bg-[#f4c7cd] text-[#7a1f33] border-[#e69aa3]',
  changes_requested:  'bg-[#f7eed1] text-[#8c6a1a] border-[#e6d99c]',
  // Hazards / incidents lifecycle (closed = resolved → mint)
  open:               'bg-[#f7dfd1] text-[#a8480f] border-[#e9c0a5]',
  in_progress:        'bg-[#d8e6f4] text-[#1e4a8c] border-[#b9d2ec]',
  closed:             'bg-[#d8ecdd] text-[#1f7a3f] border-[#b6dcbf]',
  // Severity
  low:                'bg-slate-100 text-slate-700 border-slate-200',
  medium:             'bg-[#f7eed1] text-[#8c6a1a] border-[#e6d99c]',
  high:               'bg-[#f7dfd1] text-[#a8480f] border-[#e9c0a5]',
  critical:           'bg-[#f4c7cd] text-[#7a1f33] border-[#e69aa3]',
  // Renewal / contractor lifecycle
  active:             'bg-[#d8ecdd] text-[#1f7a3f] border-[#b6dcbf]',
  pending:            'bg-[#f7eed1] text-[#8c6a1a] border-[#e6d99c]',
  expired:            'bg-[#f4c7cd] text-[#7a1f33] border-[#e69aa3]',
  overdue:            'bg-[#f4c7cd] text-[#7a1f33] border-[#e69aa3]',
  failed:             'bg-[#f4c7cd] text-[#7a1f33] border-[#e69aa3]',
};

export function StatusBadge({ value }) {
  const cls = STATUS_PALETTE[value] || 'bg-slate-100 text-slate-700 border-slate-200';
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wider border ${cls}`} data-testid={`status-badge-${value}`}>{String(value || '').replace(/_/g, ' ')}</span>;
}

export function NextArrow() {
  return <ArrowRight size={14} />;
}
