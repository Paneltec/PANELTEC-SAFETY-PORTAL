// Shared form-field components for the 4 integration admin pages
// (Navixy, Simpro, Microsoft 365, TextMagic). Beige + navy theme.
import React from 'react';
import { Eye, EyeOff, CheckCircle2 } from 'lucide-react';

export const isMasked = (v) => typeof v === 'string' && (v.startsWith('••••') || v.startsWith('****'));

export function Field({ label, children, rightSlot }) {
  return (
    <label className="block">
      <div className="text-[10px] uppercase tracking-[0.18em] font-semibold text-slate-700 mb-1.5 flex items-center justify-between gap-2">
        <span>{label}</span>
        {rightSlot}
      </div>
      {children}
    </label>
  );
}

export function SavedChip({ savedValue, hasInput, testid }) {
  if (hasInput) {
    return (
      <span className="text-[10px] text-amber-700 inline-flex items-center gap-1 normal-case tracking-normal font-normal">
        Editing — click Save to confirm
      </span>
    );
  }
  if (!savedValue) return null;
  return (
    <span className="text-[10px] text-emerald-700 inline-flex items-center gap-1 normal-case tracking-normal font-normal" data-testid={testid}>
      <CheckCircle2 size={11} /> Saved · {savedValue}
    </span>
  );
}

export function Input({ type = 'text', value, onChange, placeholder, testid, disabled }) {
  return (
    <input
      type={type}
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      data-testid={testid}
      className="w-full px-3 py-2.5 text-sm rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600/30 disabled:opacity-60"
      style={{ backgroundColor: '#FAF6EC', border: '1px solid #D8CFB8' }}
    />
  );
}

export function InputWithToggle({ value, onChange, placeholder, show, onToggle, mono, testid, disabled }) {
  return (
    <div className="relative">
      <input
        type={show ? 'text' : 'password'}
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        data-testid={testid}
        className={`w-full pl-3 pr-9 py-2.5 text-sm rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600/30 disabled:opacity-60 ${mono ? 'font-mono' : ''}`}
        style={{ backgroundColor: '#FAF6EC', border: '1px solid #D8CFB8' }}
      />
      <button type="button" onClick={onToggle}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-800 p-1"
        aria-label="toggle visibility">
        {show ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
  );
}

export function AdminCard({ title, statusPill, children }) {
  return (
    <div className="rounded-2xl overflow-hidden shadow-card-lg" style={{ backgroundColor: '#F5EFE0' }}>
      <div className="px-8 py-5 flex items-center justify-between" style={{ backgroundColor: '#0F1B2D' }}>
        <div className="text-white text-[13px] font-semibold uppercase tracking-[0.18em]">{title}</div>
        {statusPill}
      </div>
      <div className="px-8 py-7 lg:px-10 lg:py-9 text-slate-800">{children}</div>
    </div>
  );
}

export function StatusPill({ connected, errored, testid, labels = {} }) {
  const live = labels.live || 'Connected';
  const off = labels.off || 'Not connected';
  const err = labels.err || 'Error';
  const cls = errored
    ? 'border-red-400 text-red-300'
    : connected
      ? 'border-emerald-400 text-emerald-300'
      : 'border-slate-500 text-slate-400';
  const dot = errored ? 'bg-red-400' : connected ? 'bg-emerald-400' : 'bg-slate-500';
  return (
    <span data-testid={testid}
      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-semibold uppercase tracking-[0.16em] border ${cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      {errored ? err : connected ? live : off}
    </span>
  );
}

export function authErrorToast(toast, e, kindLabel = 'integration') {
  const status = e?.response?.status;
  if (status === 401) return;
  if (status === 403) {
    toast.error("You don't have permission to edit integrations.", {
      description: 'Ask an admin to enable integrations.edit for your user, or run this as an admin.',
    });
    return;
  }
  const msg = e?.response?.data?.detail || e?.message || `Could not reach ${kindLabel}`;
  toast.error(typeof msg === 'string' ? msg : JSON.stringify(msg));
}
