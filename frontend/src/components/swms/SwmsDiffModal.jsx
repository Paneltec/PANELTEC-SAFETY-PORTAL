// Phase 4.1c — SWMS diff modal.
//
// Renders the structured delta between two SWMS revisions (returned by the
// backend `GET /api/swms/{id}/diff/{previous_id}` endpoint) as four sections
// with red-strikethrough removed pills on the left and green added pills on
// the right.
import { useEffect, useState } from 'react';
import { Loader2, X, ArrowRight } from 'lucide-react';
import api, { apiError } from '../../lib/api';

const SECTIONS = [
  { key: 'hazards',           label: 'Hazards' },
  { key: 'controls',          label: 'Controls' },
  { key: 'ppe',               label: 'PPE' },
  { key: 'activity_analysis', label: 'Activity Analysis' },
];

export default function SwmsDiffModal({ swmsId, previousId, currentLabel, previousLabel, onClose }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let alive = true;
    api.get(`/swms/${swmsId}/diff/${previousId}`)
      .then((r) => { if (alive) setData(r.data); })
      .catch((e) => { if (alive) setErr(apiError(e)); });
    return () => { alive = false; };
  }, [swmsId, previousId]);

  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  const header = data?.header || {};
  const reissuedDate = header.to_created_at
    ? new Date(header.to_created_at).toLocaleDateString()
    : null;

  return (
    <div
      data-testid="swms-diff-modal"
      className="fixed inset-0 z-[60] bg-slate-900/70 grid place-items-center p-4"
      onClick={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="w-full max-w-3xl max-h-[88vh] bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-wider font-bold text-violet-700">Revision diff</div>
            <div className="font-display font-bold text-slate-900 truncate inline-flex items-center gap-1.5">
              <span>{previousLabel || header.from_version || '?'}</span>
              <ArrowRight size={13} className="text-slate-400" />
              <span>{currentLabel || header.to_version || '?'}</span>
              {reissuedDate && <span className="text-xs font-normal text-slate-500 ml-1.5">· reissued {reissuedDate}</span>}
            </div>
          </div>
          <button type="button" onClick={onClose} data-testid="swms-diff-close"
            className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-slate-500 hover:bg-slate-200">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {!data && !err && (
            <div className="text-xs text-slate-500"><Loader2 size={12} className="inline animate-spin mr-1" /> Computing diff…</div>
          )}
          {err && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{err}</div>
          )}
          {data && SECTIONS.map((sec) => (
            <DiffSection key={sec.key} label={sec.label} bucket={data.diff?.[sec.key] || {}} sectionKey={sec.key} />
          ))}
        </div>
      </div>
    </div>
  );
}

function DiffSection({ label, bucket, sectionKey }) {
  const added = bucket.added || [];
  const removed = bucket.removed || [];
  const unchanged = bucket.unchanged || [];
  const noChange = added.length === 0 && removed.length === 0;
  return (
    <section data-testid={`swms-diff-section-${sectionKey}`}>
      <div className="flex items-center gap-2 mb-2">
        <h3 className="font-display text-sm font-bold text-slate-900">{label}</h3>
        <span className="text-[10px] uppercase tracking-wider font-semibold text-slate-500"
          data-testid={`swms-diff-counts-${sectionKey}`}>
          ({added.length} added · {removed.length} removed · {unchanged.length} unchanged)
        </span>
      </div>
      {noChange ? (
        <div className="text-[12px] text-slate-500 italic px-3 py-3 rounded-lg bg-slate-50 border border-slate-200"
          data-testid={`swms-diff-empty-${sectionKey}`}>
          No changes in this category.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <DiffColumn title={`Removed (${removed.length})`} accent="rose" items={removed} dataTestid={`swms-diff-removed-${sectionKey}`} strike />
          <DiffColumn title={`Added (${added.length})`} accent="emerald" items={added} dataTestid={`swms-diff-added-${sectionKey}`} />
        </div>
      )}
    </section>
  );
}

function DiffColumn({ title, accent, items, dataTestid, strike }) {
  const palette = accent === 'rose'
    ? { wrap: 'border-rose-200 bg-rose-50', ink: 'text-rose-800', pill: 'bg-white border-rose-200 text-rose-800' }
    : { wrap: 'border-emerald-200 bg-emerald-50', ink: 'text-emerald-800', pill: 'bg-white border-emerald-200 text-emerald-800' };
  return (
    <div className={`rounded-xl border ${palette.wrap} p-3`} data-testid={dataTestid}>
      <div className={`text-[10px] uppercase tracking-wider font-bold ${palette.ink} mb-2`}>{title}</div>
      {items.length === 0 ? (
        <div className="text-[11px] text-slate-500">—</div>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {items.map((it, i) => (
            <li key={`${i}-${typeof it === 'string' ? it.slice(0, 32) : i}`}
              className={`inline-block max-w-full px-2.5 py-1 rounded-full text-[11px] font-medium border ${palette.pill} ${strike ? 'line-through' : ''}`}>
              <span className="break-words">{typeof it === 'string' ? it : JSON.stringify(it)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
