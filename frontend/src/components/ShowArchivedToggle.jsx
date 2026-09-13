import React from 'react';

/**
 * v58.13.132ec — ShowArchivedToggle
 * v58.13.132ee — Now displays the archived count in-place (from the
 *                new `X-Archived-Count` header) so admins can see the
 *                depth of the archive without opening the drawer.
 *
 * Small pill toggle that flips a list page between "hide archived" (default)
 * and "show archived" (includes greyed rows). Wraps the query param that
 * every `.132ec`-updated list endpoint reads (`?include_archived=true`).
 *
 * Props
 *   value        (bool)   — current state
 *   onChange     (bool→v) — called with the new value
 *   count        (number|null) — archived rows count (from `X-Archived-Count`)
 *   testid       (string) — data-testid; defaults to `show-archived-toggle`
 */
export default function ShowArchivedToggle({
  value,
  onChange,
  count = null,
  testid = 'show-archived-toggle',
}) {
  const n = (count == null || count === '') ? null : Number(count);
  const countLabel = n != null ? ` (${n.toLocaleString()})` : '';
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      data-testid={testid}
      data-active={value ? 'true' : 'false'}
      data-archived-count={n != null ? String(n) : ''}
      title={value ? 'Hide archived records' : 'Show archived records'}
      className={
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 ' +
        'text-[11px] font-medium border transition-colors ' +
        (value
          ? 'bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100'
          : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50')
      }
    >
      <span
        className={
          'inline-block h-1.5 w-1.5 rounded-full ' +
          (value ? 'bg-amber-500' : 'bg-slate-300')
        }
      />
      {value ? `Showing archived${countLabel}` : `Show archived${countLabel}`}
    </button>
  );
}
