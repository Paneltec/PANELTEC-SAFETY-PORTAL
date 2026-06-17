// Shared UI helpers for capture pages.
import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Loader2, Plus, Sparkles } from 'lucide-react';

export function PageHeader({ crumb, title, subtitle, action }) {
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

const STATUS_PALETTE = {
  draft: 'bg-slate-100 text-slate-700 border-slate-200',
  submitted: 'bg-brand-blue-soft text-brand-blue border-blue-200',
  approved: 'bg-brand-green-mint text-emerald-700 border-emerald-200',
  rejected: 'bg-red-50 text-red-700 border-red-200',
  changes_requested: 'bg-amber-50 text-amber-700 border-amber-200',
  open: 'bg-amber-50 text-amber-700 border-amber-200',
  in_progress: 'bg-brand-blue-soft text-brand-blue border-blue-200',
  closed: 'bg-brand-green-mint text-emerald-700 border-emerald-200',
  low: 'bg-slate-100 text-slate-700 border-slate-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  high: 'bg-orange-50 text-orange-700 border-orange-200',
  critical: 'bg-red-50 text-red-700 border-red-200',
};

export function StatusBadge({ value }) {
  const cls = STATUS_PALETTE[value] || 'bg-slate-100 text-slate-700 border-slate-200';
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wider border ${cls}`}>{String(value || '').replace(/_/g, ' ')}</span>;
}

export function NextArrow() {
  return <ArrowRight size={14} />;
}
