import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import api from '@/lib/api';

/**
 * v58.13.132ed — Bulk ArchiveDialog
 * v58.13.132ee — Live-fetch sites on open (deferred).
 * v58.13.132ef — Simplified per Stephen: removed the Site filter and
 *                the free-text Reason input. Dialog now surfaces four
 *                filter sections: Date range · Oldest N · Status ·
 *                Category. Backend still accepts `site_id` + `reason`
 *                on the payload but the FE no longer sends them.
 *
 * Props
 *   open       (bool)    — controlled visibility
 *   onClose    (fn)      — called on cancel / after successful archive
 *   apiPath    (string)  — e.g. `/incidents`
 *   moduleLabel(string)  — e.g. `Incident Reports`
 *   knownStatuses (str[])— options for the Status multi-select
 *   knownCategories (str[])— options for the Category multi-select
 *   onArchived (fn)      — called after commit so parent can refetch
 */
export default function ArchiveDialog({
  open, onClose, apiPath, moduleLabel = 'records',
  knownStatuses = [], knownCategories = [],
  onArchived,
}) {
  const [dateMode, setDateMode] = useState('before'); // 'before' | 'between'
  const [dateBefore, setDateBefore] = useState('');
  const [dateStart, setDateStart] = useState('');
  const [dateEnd, setDateEnd] = useState('');
  const [oldestN, setOldestN] = useState(null); // null | 100 | 200 | 500 | 1000 | 'custom'
  const [customN, setCustomN] = useState('');
  const [statusIn, setStatusIn] = useState([]);
  const [categoryIn, setCategoryIn] = useState([]);
  const [preview, setPreview] = useState(null); // {matched_count, matched_ids_sample}
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (!open) {
      // reset on close
      setDateMode('before'); setDateBefore(''); setDateStart(''); setDateEnd('');
      setOldestN(null); setCustomN(''); setStatusIn([]);
      setCategoryIn([]); setPreview(null); setConfirmOpen(false);
    }
  }, [open]);

  const criteria = useMemo(() => {
    const c = {};
    if (dateMode === 'before' && dateBefore) c.date_before = dateBefore;
    if (dateMode === 'between' && dateStart && dateEnd) c.date_between = [dateStart, dateEnd];
    if (oldestN === 'custom' && Number(customN) > 0) c.oldest_n = Number(customN);
    else if (typeof oldestN === 'number') c.oldest_n = oldestN;
    if (statusIn.length) c.status_in = statusIn;
    if (categoryIn.length) c.category_in = categoryIn;
    return c;
  }, [dateMode, dateBefore, dateStart, dateEnd, oldestN, customN, statusIn, categoryIn]);

  // v58.13.132eh — Any single valid criteria arms the Archive button.
  // Previously Archive required a completed Preview + a non-zero
  // matched_count, which surprised Stephen: clicking "Oldest 1000"
  // felt like it should be enough to enable Archive. Now Preview
  // stays available as an optional dry-run, but Archive lights up
  // as soon as the criteria dict is non-empty. The commit path still
  // hits `dry_run: false` and shows the server's actual archived_count
  // in the toast.
  const hasAnyCriteria = Object.keys(criteria).length > 0;

  const runPreview = async () => {
    setBusy(true); setPreview(null);
    try {
      const r = await api.post(`${apiPath}/archive`, { criteria, dry_run: true });
      setPreview(r.data);
    } catch (e) {
      toast.error('Preview failed', { description: e?.response?.data?.detail || e.message });
    } finally { setBusy(false); }
  };

  const runArchive = async () => {
    setConfirmOpen(false); setBusy(true);
    try {
      const r = await api.post(`${apiPath}/archive`, { criteria, dry_run: false });
      toast.success(`Archived ${r.data.archived_count} ${moduleLabel}`);
      onArchived?.(r.data);
      onClose?.();
    } catch (e) {
      toast.error('Archive failed', { description: e?.response?.data?.detail || e.message });
    } finally { setBusy(false); }
  };

  if (!open) return null;
  const toggleFrom = (list, setter) => (v) =>
    setter(list.includes(v) ? list.filter(x => x !== v) : [...list, v]);

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-start justify-center p-6 overflow-auto"
         data-testid="archive-dialog">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-900">Archive {moduleLabel}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700" data-testid="archive-dialog-close">✕</button>
        </div>
        <div className="p-5 space-y-5 text-sm">
          {/* 1. Date range */}
          <div data-testid="archive-dialog-section-date">
            <div className="font-medium text-slate-700 mb-2">1. Date range</div>
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2">
                <input type="radio" checked={dateMode === 'before'} onChange={() => setDateMode('before')} data-testid="archive-date-before-radio" />
                <span className="text-slate-600">Archive records dated before</span>
                <input type="date" value={dateBefore} onChange={(e) => setDateBefore(e.target.value)}
                       disabled={dateMode !== 'before'}
                       className="border border-slate-300 rounded px-2 py-1"
                       data-testid="archive-date-before" />
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" checked={dateMode === 'between'} onChange={() => setDateMode('between')} data-testid="archive-date-between-radio" />
                <span className="text-slate-600">Between</span>
                <input type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)}
                       disabled={dateMode !== 'between'}
                       className="border border-slate-300 rounded px-2 py-1"
                       data-testid="archive-date-start" />
                <span className="text-slate-600">and</span>
                <input type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)}
                       disabled={dateMode !== 'between'}
                       className="border border-slate-300 rounded px-2 py-1"
                       data-testid="archive-date-end" />
              </label>
            </div>
          </div>
          {/* 2. Oldest N */}
          <div data-testid="archive-dialog-section-oldest-n">
            <div className="font-medium text-slate-700 mb-2">2. Oldest N (optional cap)</div>
            <div className="flex items-center gap-2 flex-wrap">
              {[100, 200, 500, 1000].map((n) => (
                <button key={n} type="button" onClick={() => setOldestN(n)}
                        data-testid={`archive-oldest-${n}`}
                        className={
                          'rounded-full px-3 py-1 text-xs border ' +
                          (oldestN === n
                            ? 'bg-blue-50 border-blue-300 text-blue-800'
                            : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50')
                        }>
                  Oldest {n}
                </button>
              ))}
              <button type="button" onClick={() => setOldestN('custom')}
                      data-testid="archive-oldest-custom"
                      className={
                        'rounded-full px-3 py-1 text-xs border ' +
                        (oldestN === 'custom'
                          ? 'bg-blue-50 border-blue-300 text-blue-800'
                          : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50')
                      }>Custom</button>
              {oldestN === 'custom' && (
                <input type="number" min="1" value={customN} onChange={(e) => setCustomN(e.target.value)}
                       className="border border-slate-300 rounded px-2 py-1 w-24"
                       placeholder="N" data-testid="archive-oldest-custom-input" />
              )}
              <button type="button" onClick={() => { setOldestN(null); setCustomN(''); }}
                      className="text-xs text-slate-500 underline"
                      data-testid="archive-oldest-clear">clear</button>
            </div>
          </div>
          {/* 3. Status filter */}
          {knownStatuses.length > 0 && (
            <div data-testid="archive-dialog-section-status">
              <div className="font-medium text-slate-700 mb-2">3. Status filter</div>
              <div className="flex flex-wrap gap-2">
                {knownStatuses.map((s) => (
                  <label key={s} className="inline-flex items-center gap-1.5 text-xs bg-slate-50 border border-slate-200 rounded-full px-2.5 py-1">
                    <input type="checkbox" checked={statusIn.includes(s)}
                           onChange={() => toggleFrom(statusIn, setStatusIn)(s)}
                           data-testid={`archive-status-${s}`} />
                    <span>{s}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
          {/* 4. Category / template filter */}
          {knownCategories.length > 0 && (
            <div data-testid="archive-dialog-section-category">
              <div className="font-medium text-slate-700 mb-2">
                {knownStatuses.length > 0 ? '4' : '3'}. Category / template filter
              </div>
              <div className="flex flex-wrap gap-2">
                {knownCategories.map((c) => (
                  <label key={c} className="inline-flex items-center gap-1.5 text-xs bg-slate-50 border border-slate-200 rounded-full px-2.5 py-1">
                    <input type="checkbox" checked={categoryIn.includes(c)}
                           onChange={() => toggleFrom(categoryIn, setCategoryIn)(c)}
                           data-testid={`archive-category-${c}`} />
                    <span>{c}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
          {/* Preview result */}
          {preview && (
            <div className="rounded border border-blue-200 bg-blue-50 px-3 py-2 text-blue-900"
                 data-testid="archive-preview-result">
              <strong>{preview.matched_count}</strong> records match your criteria.
              {preview.matched_ids_sample?.length ? (
                <span className="text-slate-600 text-xs block mt-1">
                  First IDs: {preview.matched_ids_sample.slice(0, 3).map(x => x.slice(0, 8)).join(', ')}…
                </span>
              ) : null}
            </div>
          )}
        </div>
        <div className="px-5 py-3 border-t border-slate-200 flex items-center justify-between">
          <button onClick={onClose} className="text-sm text-slate-600 hover:text-slate-900"
                  data-testid="archive-dialog-cancel">Cancel</button>
          <div className="flex items-center gap-2">
            <button onClick={runPreview} disabled={busy || !hasAnyCriteria}
                    className="text-sm px-3 py-1.5 rounded border border-slate-300 hover:bg-slate-50 disabled:opacity-50"
                    data-testid="archive-preview-btn">Preview</button>
            <button onClick={() => setConfirmOpen(true)}
                    disabled={busy || !hasAnyCriteria || (preview && preview.matched_count === 0)}
                    className="text-sm px-3 py-1.5 rounded bg-amber-600 hover:bg-amber-700 text-white disabled:opacity-40 disabled:cursor-not-allowed"
                    data-testid="archive-commit-btn">
              Archive{preview ? ` ${preview.matched_count}` : '…'}
            </button>
          </div>
        </div>
      </div>
      {/* Confirm step */}
      {confirmOpen && (
        <div className="fixed inset-0 z-[60] bg-slate-900/60 flex items-center justify-center"
             data-testid="archive-confirm-dialog">
          <div className="bg-white rounded-lg shadow-xl p-5 max-w-sm">
            <p className="text-slate-800">
              You're about to archive{' '}
              {preview
                ? <><strong>{preview.matched_count}</strong> {moduleLabel}</>
                : <>{moduleLabel} matching your criteria (no preview run)</>}
              . Continue?
            </p>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button onClick={() => setConfirmOpen(false)}
                      className="text-sm px-3 py-1.5 rounded border border-slate-300 hover:bg-slate-50"
                      data-testid="archive-confirm-cancel">Cancel</button>
              <button onClick={runArchive} disabled={busy}
                      className="text-sm px-3 py-1.5 rounded bg-amber-600 hover:bg-amber-700 text-white"
                      data-testid="archive-confirm-ok">Archive</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
