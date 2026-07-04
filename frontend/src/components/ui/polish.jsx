// Paneltec Civil · v156 — small, dependency-free UI primitives used across
// the app for a consistent premium feel. All CSS-driven (no framer-motion)
// so they add zero bundle weight beyond a handful of KB of JSX.
//
// Exports:
//   <PageTransition/>   — fade + tiny slide-up on route mount.
//   <Skeleton/>         — shimmer placeholder for lists/tables/detail loads.
//   <AnimatedNumber/>   — count-up counter with tabular-nums so digits don't
//                         shift width mid-animation.
//   <TrendDelta/>       — up/down arrow chip in green/red for stat deltas.
//   <EmptyState/>       — iconized empty view with a gradient blob backdrop
//                         and an optional primary CTA.
//   <TypingDots/>       — 3-dot typing indicator for the AI chat.
import React, { useEffect, useRef, useState } from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

// ─── PageTransition ───
// Wrap the routed content so each navigation gets a subtle mount animation.
// Keying by pathname is done by the caller (`<PageTransition key={pathname}>`).
export function PageTransition({ children, className = '' }) {
  return (
    <div className={`animate-fade-up ${className}`} data-testid="page-transition">
      {children}
    </div>
  );
}

// ─── Skeleton ───
// Shimmer block. `w` and `h` accept Tailwind-friendly class fragments or px.
export function Skeleton({ className = '', width, height, rounded = 'md', testid }) {
  const style = {};
  if (width) style.width = typeof width === 'number' ? `${width}px` : width;
  if (height) style.height = typeof height === 'number' ? `${height}px` : height;
  return (
    <div
      data-testid={testid || 'skeleton'}
      style={style}
      className={`bg-gradient-to-r from-slate-200 via-slate-100 to-slate-200
                  bg-[length:200%_100%] animate-shimmer-x
                  rounded-${rounded} ${className}`}
    />
  );
}

export function SkeletonText({ lines = 3, className = '' }) {
  return (
    <div className={`space-y-2 ${className}`} data-testid="skeleton-text">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} height={10} className={i === lines - 1 ? 'w-2/3' : 'w-full'}/>
      ))}
    </div>
  );
}

// ─── AnimatedNumber ───
// Requests-animation-frame count-up from 0 (or `from`) to `value`.
// Respects prefers-reduced-motion — snaps to the final value instantly.
export function AnimatedNumber({
  value,
  from = 0,
  duration = 900,
  format = (n) => Math.round(n).toLocaleString(),
  className = '',
  testid = 'animated-number',
}) {
  const [display, setDisplay] = useState(from);
  const rafRef = useRef(null);
  const startRef = useRef(null);
  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !Number.isFinite(value)) { setDisplay(value ?? 0); return; }
    startRef.current = null;
    const tick = (ts) => {
      if (startRef.current == null) startRef.current = ts;
      const t = Math.min(1, (ts - startRef.current) / duration);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (value - from) * eased);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [value, from, duration]);
  return (
    <span data-testid={testid} className={`tabular-nums ${className}`}>
      {format(display)}
    </span>
  );
}

// ─── TrendDelta ───
// Small chip: ▲ 12% (green) / ▼ 4% (red) / — (neutral).
export function TrendDelta({ value, suffix = '%', className = '', testid = 'trend-delta' }) {
  if (value == null || Number.isNaN(value)) {
    return (
      <span data-testid={testid}
        className={`inline-flex items-center gap-1 text-xs text-slate-500 ${className}`}>
        <Minus className="w-3 h-3"/>—
      </span>
    );
  }
  const up = value > 0;
  const flat = value === 0;
  const tone = flat
    ? 'text-slate-500 bg-slate-100'
    : up ? 'text-emerald-700 bg-emerald-50'
         : 'text-rose-700 bg-rose-50';
  const Icon = flat ? Minus : (up ? TrendingUp : TrendingDown);
  return (
    <span data-testid={testid}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-semibold ${tone} ${className}`}>
      <Icon className="w-3 h-3"/>
      {up && !flat ? '+' : ''}{value}{suffix}
    </span>
  );
}

// ─── EmptyState ───
// Line-icon + orange gradient blob + optional primary CTA + optional sub CTA.
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  actionLabel,
  secondaryAction,
  secondaryLabel,
  className = '',
  testid = 'empty-state',
}) {
  return (
    <div data-testid={testid}
      className={`relative overflow-hidden rounded-2xl bg-white border border-slate-200
                  px-6 py-10 text-center animate-fade-up ${className}`}>
      {/* Gradient blob backdrop — subtle orange halo behind the icon. */}
      <div aria-hidden
        className="pointer-events-none absolute -top-16 left-1/2 -translate-x-1/2
                   w-64 h-64 rounded-full opacity-40 blur-3xl"
        style={{ background: 'radial-gradient(circle, #fb923c 0%, rgba(251,146,60,0) 70%)' }}/>
      <div className="relative">
        {Icon && (
          <div className="mx-auto grid place-items-center w-16 h-16 rounded-2xl bg-orange-50 border border-orange-200 text-orange-600 mb-4 shadow-brand-sm">
            <Icon className="w-8 h-8" strokeWidth={1.5}/>
          </div>
        )}
        {title && <div className="text-lg font-semibold text-slate-900 mb-1">{title}</div>}
        {description && (
          <p className="text-sm text-slate-500 max-w-md mx-auto leading-relaxed">{description}</p>
        )}
        {(action || secondaryAction) && (
          <div className="mt-5 flex items-center justify-center gap-3">
            {action && (
              <button type="button" onClick={action}
                data-testid={`${testid}-action`}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-500 text-white text-sm font-semibold shadow-brand-md hover:-translate-y-0.5 active:scale-[0.98] transition-all duration-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-orange-300/60">
                {actionLabel || 'Get started'}
              </button>
            )}
            {secondaryAction && (
              <button type="button" onClick={secondaryAction}
                data-testid={`${testid}-secondary`}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white text-slate-700 text-sm font-semibold border border-slate-200 hover:border-slate-300 hover:-translate-y-0.5 transition-all duration-200">
                {secondaryLabel || 'Learn more'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── TypingDots ───
// Three-dot indicator for Ask Intelligence "thinking" state.
export function TypingDots({ className = '', testid = 'typing-dots' }) {
  return (
    <span data-testid={testid}
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-full bg-slate-100 ${className}`}>
      {[0, 1, 2].map((i) => (
        <span key={i}
          className="w-1.5 h-1.5 rounded-full bg-slate-500"
          style={{
            animation: `typing-dot 900ms ease-in-out ${i * 150}ms infinite`,
          }}/>
      ))}
      <style>{`
        @keyframes typing-dot {
          0%, 60%, 100% { opacity: 0.25; transform: translateY(0); }
          30% { opacity: 1; transform: translateY(-2px); }
        }
      `}</style>
    </span>
  );
}

export default PageTransition;
