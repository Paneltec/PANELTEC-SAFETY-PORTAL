import React from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, Check, FileCheck2, QrCode, BadgeCheck, Link2, Siren, ShieldCheck,
  TriangleAlert, BarChart3, FolderDown, Database, Radar, Eye, Sparkles, Play,
} from 'lucide-react';
import Logo from '../components/brand/Logo';
import {
  HERO_CHECKLIST, HERO_FLOAT_CARDS, CONNECTED_WORKFLOWS, BOTTOM_STRIP,
} from '../mocks/dashboard';

const ICONS = {
  FileCheck2, QrCode, BadgeCheck, Link2, Siren, ShieldCheck, TriangleAlert,
  BarChart3, FolderDown, Database, Radar, Eye, Sparkles,
};

const TOPNAV = [
  { label: 'Product', href: '#product' },
  { label: 'Features', href: '#features' },
  { label: 'Compliance', href: '#compliance' },
  { label: 'Enterprise', href: '#enterprise' },
  { label: 'Pricing', href: '#pricing' },
  { label: 'Contact', href: '#contact' },
];

const toneClasses = {
  green: 'bg-brand-green-mint text-emerald-700 border-emerald-200',
  blue: 'bg-brand-blue-soft text-brand-blue border-blue-200',
  violet: 'bg-brand-violet-soft text-brand-violet border-violet-200',
  amber: 'bg-brand-amber-soft text-amber-700 border-amber-200',
};

function FloatCard({ idx, title, sub, tone }) {
  // MOCKED: positioning is deterministic, not data-driven
  const positions = [
    'top-4 left-2 rotate-[-3deg]',
    'top-2 right-4 rotate-[2deg]',
    'top-32 left-[-12px] rotate-[2deg]',
    'top-40 right-[-8px] rotate-[-2deg]',
    'bottom-24 left-8 rotate-[-1deg]',
    'bottom-6 right-10 rotate-[3deg]',
  ];
  return (
    <div
      className={`absolute ${positions[idx]} w-[180px] sm:w-[200px] rounded-2xl bg-white shadow-float border border-slate-100 p-3 animate-float-y`}
      style={{ animationDelay: `${idx * 0.4}s` }}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className={`inline-flex w-2 h-2 rounded-full ${tone === 'green' ? 'bg-emerald-500' : tone === 'blue' ? 'bg-brand-blue' : tone === 'violet' ? 'bg-brand-violet' : 'bg-amber-500'}`} />
        <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-400">{title}</div>
      </div>
      <div className="text-sm font-medium text-slate-900 leading-snug">{sub}</div>
    </div>
  );
}

function MiniDashboardCard() {
  // Centered "Live Compliance Dashboard" preview card
  return (
    <div className="rounded-3xl bg-white border border-slate-200 shadow-card-lg p-6 lg:p-8 mx-auto max-w-5xl" data-testid="dashboard-preview-card">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="text-[10px] font-semibold tracking-[0.18em] text-brand-blue uppercase">Paneltec Civil Intelligence Centre</div>
          <h3 className="font-display text-2xl sm:text-3xl font-semibold mt-1">Live Compliance Dashboard</h3>
        </div>
        <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-brand-green-mint text-emerald-700 border border-emerald-200">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Live
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
        {[
          ['AI SWMS', 142], ['Pre-starts', 486], ['Site diary', 368],
          ['Hazards', 94], ['Incidents', 24], ['Inspections', 212],
        ].map(([k, v]) => (
          <div key={k} className="rounded-xl border border-slate-200 px-3 py-2.5 flex items-center justify-between">
            <div>
              <div className="text-xs text-slate-500">{k}</div>
              <div className="text-[10px] text-slate-400">this quarter</div>
            </div>
            <div className="text-xl font-display font-semibold">{v}</div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border-2 border-emerald-200 bg-brand-green-mint/50 p-5 flex items-center gap-5">
        <div className="relative w-20 h-20 shrink-0">
          <svg viewBox="0 0 36 36" className="w-20 h-20 -rotate-90">
            <circle cx="18" cy="18" r="15.9" fill="none" stroke="#A7F3D0" strokeWidth="3" />
            <circle cx="18" cy="18" r="15.9" fill="none" stroke="#10B981" strokeWidth="3" strokeDasharray="100 100" strokeLinecap="round" />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="font-display text-base font-bold text-emerald-700">100</div>
            <div className="text-[9px] uppercase tracking-wider text-emerald-700 font-semibold">Strong</div>
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[0.16em] font-semibold text-emerald-700">Compliance Attention Score</div>
          <div className="font-display text-xl font-semibold mt-0.5">Strong · 100 / 100</div>
          <div className="text-sm text-slate-600 mt-1">Organisation-wide compliance signal is strong across every workspace.</div>
        </div>
      </div>
    </div>
  );
}

export default function Landing() {
  return (
    <div className="min-h-screen bg-white text-brand-ink">
      {/* TOP NAV */}
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur border-b border-slate-100">
        <div className="max-w-7xl mx-auto px-5 lg:px-8 h-16 flex items-center justify-between">
          <Link to="/" data-testid="landing-logo-link"><Logo size="md" /></Link>
          <nav className="hidden lg:flex items-center gap-7">
            {TOPNAV.map((n) => (
              <a key={n.label} href={n.href} className="text-sm text-slate-600 hover:text-slate-900 transition-colors">
                {n.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <Link to="/login" className="hidden sm:inline text-sm text-slate-700 hover:text-slate-900" data-testid="nav-sign-in">Sign in</Link>
            <Link
              to="/signup"
              data-testid="nav-get-started"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-brand-blue text-white text-sm font-medium hover:bg-blue-600 transition-colors shadow-sm"
            >
              Get started — 7-day free trial
            </Link>
          </div>
        </div>
      </header>

      {/* HERO */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-grid-soft opacity-60 pointer-events-none" />
        <div className="max-w-7xl mx-auto px-5 lg:px-8 pt-14 pb-20 grid lg:grid-cols-2 gap-10 lg:gap-16 items-center relative">
          {/* LEFT */}
          <div className="animate-fade-up">
            <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-slate-200 bg-white text-xs font-medium text-slate-700">
              <Sparkles size={13} className="text-brand-violet" />
              AI-assisted construction safety · WHS compliance workflows
            </span>
            <h1 className="font-display mt-5 text-4xl sm:text-5xl lg:text-6xl font-semibold leading-[1.05] tracking-tight text-balance">
              One connected WHS compliance platform for construction teams
            </h1>
            <p className="mt-5 text-base sm:text-lg text-slate-600 max-w-xl text-balance">
              Paneltec Civil brings SWMS, QR worker sign-ons, contractor submissions, hazard reports,
              incidents, inspections, corrective actions, audit trails and compliance intelligence
              into one connected workflow.
            </p>

            {/* checklist */}
            <ul className="mt-7 grid grid-cols-2 gap-x-6 gap-y-2 max-w-xl">
              {HERO_CHECKLIST.flat().map((item) => (
                <li key={item} className="flex items-center gap-2 text-sm text-slate-700">
                  <span className="inline-flex w-5 h-5 rounded-full bg-brand-green-mint items-center justify-center">
                    <Check size={12} className="text-emerald-700" strokeWidth={3} />
                  </span>
                  {item}
                </li>
              ))}
            </ul>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                to="/signup"
                data-testid="hero-start-trial"
                className="inline-flex items-center gap-2 px-5 py-3 rounded-full bg-brand-blue text-white text-sm font-medium hover:bg-blue-600 transition-colors shadow-sm"
              >
                Start free trial <ArrowRight size={16} />
              </Link>
              <button
                data-testid="hero-watch-demo"
                className="inline-flex items-center gap-2 px-5 py-3 rounded-full border border-slate-300 text-sm font-medium hover:bg-slate-50 transition-colors"
              >
                <Play size={14} /> Watch SWMS demo
              </button>
              <span className="text-xs text-slate-500">Cancel anytime.</span>
            </div>
          </div>

          {/* RIGHT — illustration */}
          <div className="relative h-[520px] lg:h-[600px]">
            {/* peach radial gradient bed */}
            <div className="absolute inset-0 rounded-[2.5rem] bg-radial-peach" />
            {/* construction worker bg photo */}
            {/* MOCKED: Unsplash placeholder hi-vis worker */}
            <div className="absolute inset-6 rounded-[2rem] overflow-hidden">
              <img
                src="https://images.unsplash.com/photo-1581094794329-c8112a89af12?auto=format&fit=crop&w=1200&q=80"
                alt="Construction site worker in hi-vis"
                className="w-full h-full object-cover opacity-90"
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
                data-testid="hero-photo"
              />
              <div className="absolute inset-0 bg-gradient-to-tr from-orange-100/40 via-transparent to-pink-100/40 mix-blend-multiply" />
            </div>
            {/* floating cards */}
            {HERO_FLOAT_CARDS.map((c, i) => (
              <FloatCard key={c.key} idx={i} title={c.title} sub={c.sub} tone={c.tone} />
            ))}
          </div>
        </div>
      </section>

      {/* CONNECTED WORKFLOWS */}
      <section id="features" className="bg-brand-bg py-20">
        <div className="max-w-7xl mx-auto px-5 lg:px-8">
          <div className="max-w-3xl">
            <div className="text-[11px] font-semibold tracking-[0.18em] text-brand-blue uppercase">Connected Workflows</div>
            <h2 className="font-display text-3xl sm:text-4xl lg:text-5xl font-semibold mt-3 leading-tight tracking-tight">
              From field records to compliance oversight.
            </h2>
            <p className="mt-4 text-slate-600 text-base sm:text-lg max-w-2xl">
              Every record from the field flows into one register your HSE team can audit, export and act on — no spreadsheets, no email threads, no surprises.
            </p>
          </div>

          <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {CONNECTED_WORKFLOWS.map((w) => {
              const Icon = ICONS[w.icon] || Sparkles;
              return (
                <div key={w.title} className="rounded-2xl bg-white p-6 border border-slate-200 shadow-card hover:shadow-card-lg transition-shadow">
                  <div className="w-10 h-10 rounded-full bg-brand-blue-soft text-brand-blue flex items-center justify-center mb-4">
                    <Icon size={18} />
                  </div>
                  <h3 className="font-display text-lg font-semibold">{w.title}</h3>
                  <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">{w.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* DASHBOARD PREVIEW */}
      <section id="compliance" className="bg-white py-20">
        <div className="max-w-7xl mx-auto px-5 lg:px-8">
          <div className="text-center mb-10">
            <div className="text-[11px] font-semibold tracking-[0.18em] text-brand-blue uppercase">Live Compliance Dashboard</div>
            <h2 className="font-display text-3xl sm:text-4xl lg:text-5xl font-semibold mt-3 max-w-3xl mx-auto leading-tight">
              The single source of truth for your organisation.
            </h2>
          </div>
          <MiniDashboardCard />
        </div>
      </section>

      {/* BOTTOM STRIP */}
      <section id="enterprise" className="bg-brand-bg py-20">
        <div className="max-w-7xl mx-auto px-5 lg:px-8 grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {BOTTOM_STRIP.map((b) => {
            const Icon = ICONS[b.icon] || Sparkles;
            return (
              <div key={b.title} className="">
                <div className="w-10 h-10 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-brand-blue mb-4 shadow-card">
                  <Icon size={18} />
                </div>
                <h3 className="font-display text-lg font-semibold">{b.title}</h3>
                <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">{b.desc}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* CTA */}
      <section id="pricing" className="bg-white py-20">
        <div className="max-w-4xl mx-auto px-5 lg:px-8 text-center">
          <h2 className="font-display text-3xl sm:text-4xl lg:text-5xl font-semibold leading-tight">
            Start your 7-day free trial.
          </h2>
          <p className="mt-4 text-slate-600 text-base sm:text-lg">No credit card required. Cancel anytime.</p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <Link
              to="/signup"
              data-testid="cta-signup"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-brand-blue text-white text-sm font-medium hover:bg-blue-600 transition-colors shadow-sm"
            >
              Get started <ArrowRight size={16} />
            </Link>
            <Link to="/login" className="text-sm text-slate-700 hover:text-slate-900" data-testid="cta-signin">
              Sign in →
            </Link>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer id="contact" className="bg-brand-ink text-slate-300">
        <div className="max-w-7xl mx-auto px-5 lg:px-8 py-14 grid sm:grid-cols-2 lg:grid-cols-5 gap-10">
          <div className="lg:col-span-2">
            <div className="flex items-center gap-2">
              <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 3 L21 19 L15 19 L12 13 L9 19 L3 19 Z" fill="#2C6BFF" />
              </svg>
              <span className="font-display font-semibold text-white">Paneltec <span className="text-brand-blue">Civil</span></span>
            </div>
            <p className="mt-4 text-sm text-slate-400 max-w-sm">
              The connected WHS platform for civil contracting and construction teams. Built for site, designed for oversight.
            </p>
          </div>
          {[
            { h: 'Product', items: ['AI SWMS', 'Pre-starts', 'Site Diary', 'Hazards', 'Incidents'] },
            { h: 'Compliance', items: ['Contractors', 'Renewals', 'Audit Exports', 'Intelligence'] },
            { h: 'Company', items: ['About', 'Careers', 'Contact', 'Press'] },
            { h: 'Legal', items: ['Privacy', 'Terms', 'Security', 'DPA'] },
          ].map((col) => (
            <div key={col.h}>
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 mb-3">{col.h}</div>
              <ul className="space-y-2">
                {col.items.map((it) => (
                  <li key={it}><a className="text-sm text-slate-300 hover:text-white" href="#contact">{it}</a></li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="border-t border-white/5">
          <div className="max-w-7xl mx-auto px-5 lg:px-8 py-5 text-xs text-slate-500 flex items-center justify-between">
            <span>© {new Date().getFullYear()} Paneltec Civil. All rights reserved.</span>
            <span>v1.0 · Phase 1</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
