// v58.13.41 — Shared density segmented control.
// v58.13.42 — Wrapper testid restored to the canonical
// `capture-density-control` (v58.13.40 contract). Per-mode testids
// remain namespaced by `testidPrefix` so pages that render more
// than one instance (e.g. tabbed views) can still be targeted
// uniquely. A `data-density-page` attribute is emitted alongside
// the canonical testid so scoped Playwright queries still work.
//
// Extracted from `CaptureListToolbar` so pages that don't use the
// toolbar (SiteSigninList, CsIncidentsList, PreStarts) can still
// render the same 4-icon segmented control. `CaptureListToolbar`
// now delegates to this component so there's a single visual truth.
//
// Props:
//   mode           — current density mode: 'auto' | 'compact' |
//                    'comfortable' | 'spacious'.
//   onChange       — (nextMode) => void.
//   testidPrefix   — optional. Defaults to 'capture'. Emitted testids:
//                      · `capture-density-control`      (wrapper, canonical, always)
//                      · `${testidPrefix}-density-<mode>` (each radio)
//                    plus `data-density-page="${testidPrefix}"` on
//                    the wrapper for per-page scoping.
import React from 'react';
import { Wand2, Rows3, LayoutGrid, LayoutList } from 'lucide-react';

const OPTIONS = [
  { m: 'auto',        Icon: Wand2,      title: 'Auto (by volume)' },
  { m: 'compact',     Icon: Rows3,      title: 'Compact' },
  { m: 'comfortable', Icon: LayoutGrid, title: 'Comfortable' },
  { m: 'spacious',    Icon: LayoutList, title: 'Spacious' },
];

export default function CaptureDensityControl({ mode, onChange, testidPrefix = 'capture' }) {
  if (typeof onChange !== 'function') return null;
  return (
    <div
      role="radiogroup"
      aria-label="Tile density"
      data-testid="capture-density-control"
      data-density-page={testidPrefix}
      className="inline-flex items-center rounded-full border border-slate-200 bg-white p-0.5 shadow-sm"
    >
      {OPTIONS.map(({ m, Icon, title }) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={mode === m}
          title={title}
          onClick={() => onChange(m)}
          data-testid={`${testidPrefix}-density-${m}`}
          className={
            'inline-flex items-center justify-center h-7 w-7 rounded-full transition-colors ' +
            (mode === m
              ? 'bg-slate-900 text-white'
              : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100')
          }
        >
          <Icon size={13} />
        </button>
      ))}
    </div>
  );
}
