import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Info } from 'lucide-react';
import Logo from '../components/brand/Logo';
import { signIn } from '../lib/auth';

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const submit = (e) => {
    e.preventDefault();
    if (!email || !password) {
      setError('Enter an email and password to continue.');
      return;
    }
    // MOCKED: no real auth. Any non-empty creds succeed.
    signIn({ email, name: email.split('@')[0] });
    navigate('/app/dashboard');
  };

  return (
    <div className="min-h-screen flex bg-brand-bg">
      <div className="flex-1 flex items-center justify-center px-5 py-10">
        <div className="w-full max-w-sm">
          <Link to="/" className="inline-block mb-8"><Logo size="md" /></Link>

          <h1 className="font-display text-3xl font-semibold tracking-tight">Welcome back</h1>
          <p className="mt-2 text-sm text-slate-600">Sign in to your Paneltec Civil workspace.</p>

          <div
            className="mt-6 rounded-xl border border-brand-blue-soft bg-brand-blue-soft/60 p-3 text-xs text-slate-700 flex gap-2"
            data-testid="demo-banner"
          >
            <Info size={14} className="text-brand-blue mt-0.5 shrink-0" />
            <div>
              <div className="font-medium text-brand-blue">Demo credentials</div>
              <div className="text-slate-600">Email <span className="font-mono">demo@paneltec.com</span> · Password <span className="font-mono">demo123</span></div>
            </div>
          </div>

          <form onSubmit={submit} className="mt-6 space-y-4" data-testid="login-form">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                autoComplete="email"
                data-testid="login-email"
                className="w-full px-3 py-2.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/30 focus:border-brand-blue"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                data-testid="login-password"
                className="w-full px-3 py-2.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/30 focus:border-brand-blue"
              />
            </div>
            {error && <div className="text-xs text-brand-red" data-testid="login-error">{error}</div>}
            <button
              type="submit"
              data-testid="login-submit"
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-brand-blue text-white text-sm font-medium hover:bg-blue-600 transition-colors"
            >
              Sign in <ArrowRight size={16} />
            </button>
          </form>

          <p className="mt-6 text-sm text-slate-600">
            No account yet?{' '}
            <Link to="/signup" className="text-brand-blue font-medium hover:underline" data-testid="login-to-signup">
              Start your free trial
            </Link>
          </p>
        </div>
      </div>

      {/* Right brand panel */}
      <div className="hidden lg:flex flex-1 items-center justify-center relative overflow-hidden bg-brand-ink">
        <div className="absolute inset-0 bg-grid-soft opacity-[0.06]" />
        <div className="relative max-w-md px-10 text-slate-200">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-blue">Paneltec Civil</div>
          <h2 className="font-display text-3xl font-semibold mt-3 text-white leading-tight">
            One platform for SWMS, sign-ons, hazards and compliance intelligence.
          </h2>
          <p className="mt-4 text-sm text-slate-400">
            Built for civil contracting and construction teams who need oversight without the spreadsheets.
          </p>
          <div className="mt-8 grid grid-cols-2 gap-3 text-xs">
            {[
              ['AI SWMS', '142 this Q'],
              ['Pre-starts', '486 captured'],
              ['Hazards', '94 flagged'],
              ['Inspections', '212 passed'],
            ].map(([k, v]) => (
              <div key={k} className="rounded-xl bg-white/5 border border-white/10 p-3">
                <div className="text-slate-400">{k}</div>
                <div className="text-white font-display text-base font-semibold mt-1">{v}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
