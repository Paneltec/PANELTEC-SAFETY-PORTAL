import React, { useEffect, useState } from 'react';
import { PALETTES, getPalette, setPalette, hydratePalette } from '../../lib/civilPalette';

/**
 * v58.13.67-palette-switcher — 3-chip phone-only palette switcher.
 *
 * Hydrates the persisted choice on mount, exposes a chip per palette
 * with 48×48 min tap target. Selected chip carries `aria-pressed="true"`
 * which the `.civil-chip` CSS rule paints in hi-vis using the palette's
 * own CTA colour, so the selection is self-evidently in the palette
 * that was just picked.
 *
 * Meant to be dropped anywhere inside a phone-viewport branch. Renders
 * nothing on wider viewports (parent wraps with `md:hidden`).
 */
export default function PaletteSwitcher({ className = '' }) {
  const [current, setCurrent] = useState('bitumen');

  useEffect(() => {
    // Sync state to whatever the hydrator put on <html>.
    setCurrent(hydratePalette());
  }, []);

  const pick = (name) => {
    const applied = setPalette(name);
    setCurrent(applied);
  };

  return (
    <div className={`flex items-center gap-2 ${className}`}
         role="group"
         aria-label="Site palette"
         data-testid="civil-palette-switcher">
      {PALETTES.map((name) => (
        <button
          key={name}
          type="button"
          onClick={() => pick(name)}
          aria-pressed={current === name}
          data-testid={`civil-palette-chip-${name}`}
          className="civil-chip flex-1"
        >
          {name}
        </button>
      ))}
    </div>
  );
}
