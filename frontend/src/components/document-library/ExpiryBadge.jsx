// v58.13.132mg — Expiry badge chip. Colour-coded per bucket.
//
// Used next to filenames in Document Library rows, Shared-with-me
// rows, and any future SDS surface. Pure display; no state.
import React from 'react';
import { AlertTriangle, Clock, CheckCircle2 } from 'lucide-react';

function formatShort(iso) {
  if (!iso) return '';
  // ISO date (YYYY-MM-DD) → MM/YYYY for compact readability.
  const [y, m] = iso.split('-');
  return `${m}/${y}`;
}

const STYLES = {
  expired: {
    cls: 'bg-rose-50 text-rose-700 border-rose-200',
    icon: AlertTriangle,
    label: 'Expired',
  },
  expiring_soon: {
    cls: 'bg-amber-50 text-amber-700 border-amber-200',
    icon: Clock,
    label: 'Expires',
  },
  ok: {
    cls: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    icon: CheckCircle2,
    label: 'Expires',
  },
  unknown: {
    cls: 'bg-slate-50 text-slate-500 border-slate-200',
    icon: Clock,
    label: 'No expiry',
  },
};

export default function ExpiryBadge({ bucket, expiresAt, testId }) {
  const style = STYLES[bucket] || STYLES.unknown;
  const Icon = style.icon;
  if (bucket === 'unknown' && !expiresAt) return null;
  return (
    <span
      data-testid={testId || `expiry-badge-${bucket}`}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[10px] font-semibold whitespace-nowrap ${style.cls}`}
      title={expiresAt ? `${style.label} ${expiresAt}` : style.label}
    >
      <Icon size={10} />
      {expiresAt ? `${style.label} ${formatShort(expiresAt)}` : style.label}
    </span>
  );
}
