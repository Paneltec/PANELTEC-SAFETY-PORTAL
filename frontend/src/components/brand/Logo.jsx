import React from 'react';

// Paneltec Civil wordmark — "A"-style chevron icon in brand orange (Phase 4.10, v115)
// v156 — added a one-shot sheen sweep on mount via `.paneltec-logo-sheen`.
// Purely CSS; not looping. Respects prefers-reduced-motion.
export const Logo = ({ size = 'md', className = '' }) => {
  const sizes = {
    sm: { icon: 18, text: 'text-base' },
    md: { icon: 22, text: 'text-lg' },
    lg: { icon: 28, text: 'text-2xl' },
  };
  const s = sizes[size] || sizes.md;
  return (
    <div className={`paneltec-logo-sheen inline-flex items-center gap-2 rounded-md px-1 ${className}`} data-testid="brand-logo">
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
        Paneltec <span className="text-orange-500">Civil</span>
      </span>
    </div>
  );
};

export default Logo;
