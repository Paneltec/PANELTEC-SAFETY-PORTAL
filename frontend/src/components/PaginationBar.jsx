import React, { useCallback, useEffect, useState } from 'react';

/**
 * v58.13.132eh — <PaginationBar />
 *
 * Load-More affordance + persistent page-size selector for CAPTURE
 * list pages. Companion to the total-count chip (`.132ef`) and the
 * category-count pills (`.132eg`) — three chips of pagination truth
 * on every list surface.
 *
 * Props
 *   showing     (number) — rows currently loaded on the page
 *   total       (number) — total DB count (from X-Total-Count)
 *   pageSize    (number) — current page size (default 5000)
 *   onPageSize  ((n)=>void) — user picked a new page size
 *   onLoadMore  (()=>void) — user clicked Load more
 *   loading     (bool)   — request in flight
 *   testidPrefix(str)    — data-testid namespace (e.g. `pre-starts`)
 *   storageKey  (str)    — localStorage key for page-size persistence
 */
export default function PaginationBar({
  showing,
  total,
  pageSize,
  onPageSize,
  onLoadMore,
  loading = false,
  testidPrefix = 'list',
  storageKey,
}) {
  const canLoadMore = typeof total === 'number' && showing < total;
  const options = [100, 500, 1000, 5000];

  const handlePageSize = useCallback((e) => {
    const n = Number(e.target.value);
    if (storageKey) {
      try { localStorage.setItem(storageKey, String(n)); } catch { /* noop */ }
    }
    onPageSize?.(n);
  }, [onPageSize, storageKey]);

  return (
    <div className="flex items-center gap-3 py-3 text-sm text-slate-600"
         data-testid={`${testidPrefix}-pagination-bar`}>
      <button
        type="button"
        onClick={onLoadMore}
        disabled={loading || !canLoadMore}
        className="px-3 py-1.5 rounded border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
        data-testid={`${testidPrefix}-load-more-btn`}
      >
        {loading ? 'Loading…' : canLoadMore ? `Load more (${Math.min(pageSize, total - showing).toLocaleString()})` : 'All records loaded'}
      </button>
      <span className="text-slate-500 tabular-nums" data-testid={`${testidPrefix}-pagination-count`}>
        {Number(showing).toLocaleString()} of {Number(total ?? 0).toLocaleString()}
      </span>
      <label className="ml-auto flex items-center gap-2 text-slate-500">
        <span>Page size</span>
        <select
          value={pageSize}
          onChange={handlePageSize}
          className="border border-slate-300 rounded px-2 py-1 text-sm bg-white"
          data-testid={`${testidPrefix}-page-size-select`}
        >
          {options.map((n) => (
            <option key={n} value={n}>{n.toLocaleString()}</option>
          ))}
        </select>
      </label>
    </div>
  );
}

/**
 * Hook that reads a persisted page size from localStorage. Returns
 * `[pageSize, setPageSize]`. Values outside the allowed range are
 * ignored.
 */
export function usePersistedPageSize(storageKey, defaultSize = 5000) {
  const [pageSize, setPageSize] = useState(() => {
    if (!storageKey) return defaultSize;
    try {
      const v = Number(localStorage.getItem(storageKey));
      if ([100, 500, 1000, 5000].includes(v)) return v;
    } catch { /* noop */ }
    return defaultSize;
  });
  useEffect(() => {
    if (!storageKey) return;
    try { localStorage.setItem(storageKey, String(pageSize)); } catch { /* noop */ }
  }, [pageSize, storageKey]);
  return [pageSize, setPageSize];
}
