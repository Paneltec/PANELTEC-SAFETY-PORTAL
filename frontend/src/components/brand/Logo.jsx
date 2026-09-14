import React from 'react';

// Paneltec Group / tenant wordmark.
//
// v58.13.132fk — For the default Paneltec Group tenant, render the
// actual scanned wordmark PNG (converted from EPS via ghostscript
// + PIL — see `.132fk` ship memo). For custom-display-name tenants
// (e.g. "Acme Constructions"), fall back to the classic
// SVG-chevron + text wordmark so multi-tenant instances still
// look on-brand.
//
// v58.13.132dr — Wordmark text accepts a `displayName` prop that
// overrides the historical hard-coded "Paneltec Civil". Callers
// inside the authenticated shell pass the org's chosen brand name
// (lookup order: `org.display_name → trading_name → name → default`).
// Public pages (login, scan resolvers) keep the default so a
// non-authenticated visitor never sees a stale brand.
//
// Style rule: for CUSTOM tenants, everything up to the final
// whitespace-separated word renders in `text-brand-ink`, and the
// LAST word renders in orange — preserves the "Paneltec Civil"
// split so custom names still look on-brand.
const BRAND_DEFAULT = 'Paneltec Civil';
// v58.13.132fk — recognised Paneltec-family display names that
// should render the Group PNG wordmark instead of the fallback
// SVG-chevron form.
const PANELTEC_FAMILY = new Set([
  'Paneltec Civil', 'Paneltec Group', 'The Paneltec Group',
]);

const IMG_SIZES = {
  sm: 'h-5',   // 20px
  md: 'h-6',   // 24px  → ~124px wide
  lg: 'h-8',   // 32px  → ~165px wide
};

export const Logo = ({ size = 'md', className = '', displayName }) => {
  const name = ((displayName || '').trim() || BRAND_DEFAULT);
  const usePngWordmark = PANELTEC_FAMILY.has(name);

  if (usePngWordmark) {
    return (
      <div
        className={`inline-flex items-center rounded-md px-1 ${className}`}
        data-testid="brand-logo"
        data-brand-name={name}
        data-brand-variant="paneltec-group-png"
      >
        <img
          src="/brand/logo-wordmark-480.png"
          srcSet="/brand/logo-wordmark-480.png 1x, /brand/logo-wordmark-960.png 2x"
          alt={name}
          className={`${IMG_SIZES[size] || IMG_SIZES.md} w-auto object-contain`}
          draggable={false}
        />
      </div>
    );
  }

  const sizes = {
    sm: { icon: 18, text: 'text-base' },
    md: { icon: 22, text: 'text-lg' },
    lg: { icon: 28, text: 'text-2xl' },
  };
  const s = sizes[size] || sizes.md;
  const idx = name.lastIndexOf(' ');
  const head = idx > 0 ? name.slice(0, idx) : '';
  const tail = idx > 0 ? name.slice(idx + 1) : name;
  return (
    <div
      className={`paneltec-logo-sheen inline-flex items-center gap-2 rounded-md px-1 ${className}`}
      data-testid="brand-logo"
      data-brand-name={name}
      data-brand-variant="fallback-svg"
    >
      <svg
        width={s.icon}
        height={s.icon}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        className="shrink-0"
      >
        <path
          d="M12 3 L21 19 L15 19 L12 13 L9 19 L3 19 Z"
          fill="#F97316"
        />
        <path d="M12 3 L21 19 L15 19 L12 13 L9 19 L3 19 Z" stroke="#EA580C" strokeWidth="0.5" />
      </svg>
      <span className={`font-display font-semibold tracking-tight text-brand-ink ${s.text}`}>
        {head && <>{head} </>}<span className="text-orange-500">{tail}</span>
      </span>
    </div>
  );
};

export default Logo;
