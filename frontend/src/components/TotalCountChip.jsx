import React from 'react';

/**
 * v58.13.132eb — TotalCountChip
 *
 * Reads the `X-Total-Count` header value that `crud.py::list_items`
 * emits since `.132ea` and renders a subtle "N showing · M total"
 * pill next to the page title.
 *
 * Props
 *   showing (number) — the rows the caller has actually rendered
 *                      (after client-side filters / search / etc.)
 *   total   (number) — the rows the server holds (before slice).
 *                      Callers should read this from
 *                      `response.headers['x-total-count']`.
 *   testid  (string, optional) — data-testid; defaults to
 *                      `total-count-chip`.
 *
 * Behaviour
 *   · When `total` is unknown (null/undefined) → renders only the
 *     `showing` count as a plain pill.
 *   · When `showing === total` → renders `N total` (no double count).
 *   · When `showing < total`   → renders `N showing · M total` +
 *     hint "Refine filters to narrow down." A future pager UX (blocked
 *     on the response-shape upgrade flagged in the .132ea memo) will
 *     replace the hint with real controls.
 */
export default function TotalCountChip({ showing, total, testid = 'total-count-chip' }) {
  const s = Number(showing) || 0;
  const t = (total == null || total === '') ? null : Number(total);

  const label = (
    t == null ? `${s.toLocaleString()} shown`
    : s === t ? `${t.toLocaleString()} total`
    : `${s.toLocaleString()} showing · ${t.toLocaleString()} total`
  );

  const isTruncated = t != null && s < t;

  return (
    <span
      data-testid={testid}
      className={
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 ' +
        'text-[11px] font-medium tabular-nums border ' +
        (isTruncated
          ? 'bg-amber-50 border-amber-200 text-amber-800'
          : 'bg-emerald-50 border-emerald-200 text-emerald-800')
      }
      title={isTruncated
        ? `Server holds ${t.toLocaleString()} records; ${s.toLocaleString()} rendered here. Refine filters to narrow down.`
        : `${t == null ? s : t} records`}
    >
      <span className={
        'inline-block h-1.5 w-1.5 rounded-full ' +
        (isTruncated ? 'bg-amber-500' : 'bg-emerald-500')
      } />
      {label}
    </span>
  );
}
