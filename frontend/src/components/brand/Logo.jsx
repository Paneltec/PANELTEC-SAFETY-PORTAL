import React from 'react';

// Paneltec Civil wordmark — "A"-style chevron icon in brand orange
// (Phase 4.10, v115). Purely CSS sheen sweep (v156). Respects
// prefers-reduced-motion.
//
// v58.13.132dr — Wordmark text now accepts a `displayName` prop that
// overrides the historical hard-coded "Paneltec Civil". Callers
// inside the authenticated shell pass the org's chosen brand name
// (lookup order: `org.display_name → trading_name → name → default`).
// Public pages (login, scan resolvers) keep the default so a
// non-authenticated visitor never sees a stale brand.
//
// Style rule: everything up to the final whitespace-separated word
// renders in `text-brand-ink`, and the LAST word renders in orange —
// preserves the "Paneltec Civil" split so custom names like
// "Acme Constructions" and "Big Group" still look on-brand.
const BRAND_DEFAULT = 'Paneltec Civil';

export const Logo = ({ size = 'md', className = '', displayName }) => {
  const sizes = {
    sm: { icon: 18, text: 'text-base' },
    md: { icon: 22, text: 'text-lg' },
    lg: { icon: 28, text: 'text-2xl' },
  };
  const s = sizes[size] || sizes.md;
  const name = ((displayName || '').trim() || BRAND_DEFAULT);
  const idx = name.lastIndexOf(' ');
  const head = idx > 0 ? name.slice(0, idx) : '';
  const tail = idx > 0 ? name.slice(idx + 1) : name;
  return (
    <div className={`paneltec-logo-sheen inline-flex items-center gap-2 rounded-md px-1 ${className}`} data-testid="brand-logo" data-brand-name={name}>
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
