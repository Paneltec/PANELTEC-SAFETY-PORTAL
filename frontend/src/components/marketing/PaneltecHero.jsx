import React from 'react';
import {
  ShieldCheckmark24Regular,
  Sparkle24Regular,
  Certificate24Regular,
  ChartMultiple24Regular,
} from '@fluentui/react-icons';
import { ShieldCheck, Sparkles, Award, BarChart3 } from 'lucide-react';

// Phase 4.10.4 (paneltec-v119) — single source of truth for the
// Paneltec Civil marketing hero block. Used by:
//   · Login.jsx          → <PaneltecHero variant="dark" />
//   · Cover.jsx desktop  → <PaneltecHero variant="cover" />
//   · Cover.jsx mobile   → <PaneltecHero variant="compact" />
//
// Editing any of the strings below changes BOTH the public landing page
// and the sign-in screen simultaneously — they cannot drift apart again.
//
// If the marketing copy needs to change, EDIT IT HERE and only here.

export const PANELTEC_HERO_COPY = Object.freeze({
  eyebrow: 'WHS Compliance for civil teams',
  headline: ['Build Safer.', 'Build Smarter.', 'Build Together.'],
  subhead: 'All your civil construction safety forms, inspections, certifications and analytics — in one powerful portal.',
  pills: Object.freeze([
    { label: 'Real-time Compliance', fluent: ShieldCheckmark24Regular, lucide: ShieldCheck },
    { label: 'AI-Powered Insights',  fluent: Sparkle24Regular,         lucide: Sparkles    },
    { label: 'Cert Tracking',        fluent: Certificate24Regular,     lucide: Award       },
    { label: 'Live Analytics',       fluent: ChartMultiple24Regular,   lucide: BarChart3   },
  ]),
});

const Headline = ({ className }) => (
  <h2 className={`font-display font-bold leading-tight tracking-tight ${className}`}>
    <span className="block">{PANELTEC_HERO_COPY.headline[0]}</span>
    <span className="block">{PANELTEC_HERO_COPY.headline[1]}</span>
    <span className="block" style={{ color: 'var(--paneltec-gold)' }}>{PANELTEC_HERO_COPY.headline[2]}</span>
  </h2>
);

export default function PaneltecHero({ variant = 'dark' }) {
  if (variant === 'dark') {
    // Login.jsx right-panel — flat dark slate, Fluent icons, orange
    // left-edge accent on each pill.
    return (
      <div className="text-slate-200" data-testid="paneltec-hero" data-variant="dark">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-orange-500"
             data-testid="paneltec-hero-eyebrow">
          {PANELTEC_HERO_COPY.eyebrow}
        </div>
        <Headline className="text-4xl sm:text-5xl lg:text-6xl mt-4 text-white" data-testid="paneltec-hero-headline" />
        <p className="mt-5 text-sm text-slate-300 leading-relaxed"
           data-testid="paneltec-hero-subhead">
          {PANELTEC_HERO_COPY.subhead}
        </p>
        <div className="mt-8 grid grid-cols-2 gap-3" data-testid="paneltec-hero-pills">
          {PANELTEC_HERO_COPY.pills.map(({ label, fluent: Icon }) => (
            <div key={label}
              className="relative rounded-xl bg-slate-900 border border-slate-800 p-3 pl-3.5 overflow-hidden">
              <div className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r bg-orange-500" aria-hidden="true" />
              <div className="flex items-center gap-2">
                <Icon className="text-orange-400 shrink-0" />
                <span className="text-sm font-medium text-white leading-tight">{label}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (variant === 'cover') {
    // Cover.jsx desktop hero — over the construction-site photo +
    // gradient. Translucent pill eyebrow, lucide icons, glass chips.
    return (
      <div data-testid="paneltec-hero" data-variant="cover">
        <div className="inline-block text-[11px] font-semibold uppercase tracking-[0.22em] text-orange-500 bg-white/10 backdrop-blur px-3 py-1.5 rounded-full mb-5 border border-white/15"
             data-testid="paneltec-hero-eyebrow">
          {PANELTEC_HERO_COPY.eyebrow}
        </div>
        <Headline className="text-4xl lg:text-5xl xl:text-[56px] text-white" data-testid="paneltec-hero-headline" />
        <p className="mt-5 text-base lg:text-lg text-white/75 leading-relaxed max-w-[460px]"
           data-testid="paneltec-hero-subhead">
          {PANELTEC_HERO_COPY.subhead}
        </p>
        <div className="mt-7 grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-w-[520px]" data-testid="paneltec-hero-pills">
          {PANELTEC_HERO_COPY.pills.map(({ label, lucide: Icon }, i) => (
            <div key={label}
              className="inline-flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-black/40 backdrop-blur-sm border border-white/10">
              <Icon size={18}
                className="shrink-0"
                style={i === 0 ? { color: '#FFFFFF' } : { color: 'var(--paneltec-gold)' }} />
              <span className="text-sm font-medium text-white">{label}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // compact — Cover.jsx mobile-only intro above the sign-in card.
  // No pills, lighter typography, slate-900 text on cream background.
  return (
    <div data-testid="paneltec-hero" data-variant="compact">
      <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-orange-500 mb-2"
           data-testid="paneltec-hero-eyebrow">
        {PANELTEC_HERO_COPY.eyebrow}
      </div>
      <Headline className="text-2xl text-[#0F1B2D]" data-testid="paneltec-hero-headline" />
      <p className="mt-2 text-sm text-slate-600 leading-relaxed"
         data-testid="paneltec-hero-subhead">
        {PANELTEC_HERO_COPY.subhead}
      </p>
    </div>
  );
}
