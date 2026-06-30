import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { ArrowRight, Loader2, Briefcase } from 'lucide-react';
import {
  ShieldCheckmark24Regular,
  Sparkle24Regular,
  Certificate24Regular,
  ChartMultiple24Regular,
} from '@fluentui/react-icons';
import Logo from '../components/brand/Logo';
import { login, loginWithSimpro, safeNext } from '../lib/auth';
import api, { apiError } from '../lib/api';
import { ForgotPasswordModal } from '../components/auth/AuthBundle';

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const nextPath = safeNext(location.search);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [rememberMeAllowed, setRememberMeAllowed] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [busySimpro, setBusySimpro] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);

  // Phase 3.16 — Public endpoint tells us whether the org admin has enabled
  // the "Keep me logged in" feature. We only render the checkbox if so; this
  // keeps the login page calm for the common (kiosk / strict-policy) case.
  useEffect(() => {
    let alive = true;
    api.get('/settings/login-options')
      .then((r) => { if (alive) setRememberMeAllowed(!!r.data?.remember_me_enabled); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!email || !password) { setError('Enter an email and password to continue.'); return; }
    setBusy(true);
    try {
      await login(email, password, { remember_me: rememberMeAllowed && rememberMe });
      navigate(nextPath, { replace: true });
    } catch (err) {
      setError(apiError(err) || 'Invalid email or password.');
    } finally {
      setBusy(false);
    }
  };

  const submitSimpro = async () => {
    setError('');
    if (!email) { setError('Enter your work email to sign in with Simpro.'); return; }
    setBusySimpro(true);
    try {
      await loginWithSimpro(email);
      navigate(nextPath, { replace: true });
    } catch (err) {
      setError(apiError(err) || 'Could not sign in with Simpro.');
    } finally {
      setBusySimpro(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-brand-bg">
      <div className="flex-1 flex items-center justify-center px-5 py-10">
        <div className="w-full max-w-sm">
          <Link to="/" className="inline-block mb-8"><Logo size="md" /></Link>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Welcome back</h1>
          <p className="mt-2 text-sm text-slate-600">Sign in to your Paneltec Civil workspace.</p>

          <form onSubmit={submit} className="mt-6 space-y-4" data-testid="login-form">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" autoComplete="email" data-testid="login-email"
                className="w-full px-3 py-2.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500/30 focus:border-orange-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete="current-password" data-testid="login-password"
                className="w-full px-3 py-2.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500/30 focus:border-orange-500" />
            </div>
            {error && <div className="text-xs text-brand-red" data-testid="login-error">{error}</div>}
            <div className="flex justify-end -mt-1.5">
              <button type="button" onClick={() => setForgotOpen(true)}
                data-testid="forgot-password-link"
                className="text-[12px] font-medium text-orange-500 hover:underline">
                Forgot password?
              </button>
            </div>
            {rememberMeAllowed && (
              <label className="flex items-center gap-2 text-sm text-slate-700 select-none cursor-pointer" data-testid="remember-me-row">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  data-testid="remember-me-checkbox"
                  className="h-4 w-4 rounded border-slate-300 text-orange-500 focus:ring-orange-500/30" />
                <span>Keep me logged in</span>
                <span className="text-[11px] text-slate-400">· extends idle window to 30 days</span>
              </label>
            )}
            <button type="submit" disabled={busy} data-testid="login-submit"
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-orange-500 text-white text-sm font-medium hover:bg-orange-600 transition-colors disabled:opacity-60">
              {busy ? <><Loader2 size={16} className="animate-spin" /> Signing in…</> : <>Sign in <ArrowRight size={16} /></>}
            </button>
          </form>

          <div className="mt-4 flex items-center gap-3 text-[11px] uppercase tracking-wider text-slate-400">
            <div className="flex-1 h-px bg-slate-200" /><span>or</span><div className="flex-1 h-px bg-slate-200" />
          </div>
          <button
            type="button"
            onClick={submitSimpro}
            disabled={busySimpro || !email}
            data-testid="login-with-simpro"
            className="mt-4 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            {busySimpro ? <Loader2 size={16} className="animate-spin" /> : <Briefcase size={14} />} Sign in with Simpro
          </button>
          <p className="mt-1 text-[11px] text-slate-500">For staff imported from Simpro — enter your work email above, then tap Sign in with Simpro.</p>

          <p className="mt-6 text-sm text-slate-600">
            No account yet?{' '}
            <Link to="/signup" className="text-orange-500 font-medium hover:underline" data-testid="login-to-signup">Start your free trial</Link>
          </p>
        </div>
      </div>

      <div className="hidden lg:flex flex-1 items-center justify-center relative overflow-hidden bg-brand-ink">
        <div className="absolute inset-0 bg-grid-soft opacity-[0.06]" />
        <div className="relative max-w-md px-10 text-slate-200">
          {/* Phase 4.10.3 (v118) — authoritative marketing copy.
              Replaces the legacy "One platform for SWMS…" headline and the
              four mock stat cards (8 active / 12 captured / 6 flagged /
              6 passed) with the same hero block that anchors Cover.jsx,
              so the message a worker sees while signing in matches the
              one they saw on the landing page. */}
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-orange-500"
               data-testid="login-hero-eyebrow">
            WHS Compliance for civil teams
          </div>
          <h2 className="font-display text-4xl sm:text-5xl lg:text-6xl font-bold leading-tight tracking-tight mt-4 text-white"
              data-testid="login-hero-headline">
            <span className="block">Build Safer.</span>
            <span className="block">Build Smarter.</span>
            <span className="block" style={{ color: 'var(--paneltec-gold)' }}>Build Together.</span>
          </h2>
          <p className="mt-5 text-sm text-slate-300 leading-relaxed"
             data-testid="login-hero-subhead">
            All your civil construction safety forms, inspections, certifications and analytics — in one powerful portal.
          </p>
          <div className="mt-8 grid grid-cols-2 gap-3" data-testid="login-hero-pills">
            {[
              { icon: ShieldCheckmark24Regular, label: 'Real-time Compliance' },
              { icon: Sparkle24Regular,         label: 'AI-Powered Insights' },
              { icon: Certificate24Regular,     label: 'Cert Tracking' },
              { icon: ChartMultiple24Regular,   label: 'Live Analytics' },
            ].map(({ icon: Icon, label }) => (
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
      </div>
      <ForgotPasswordModal open={forgotOpen} onClose={() => setForgotOpen(false)} />
    </div>
  );
}
