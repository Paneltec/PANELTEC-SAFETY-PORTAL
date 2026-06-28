import React, { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { ArrowRight, Info, Loader2, Briefcase } from 'lucide-react';
import Logo from '../components/brand/Logo';
import { login, loginWithSimpro, safeNext } from '../lib/auth';
import { apiError } from '../lib/api';

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const nextPath = safeNext(location.search);
  const [email, setEmail] = useState('demo@paneltec.com');
  const [password, setPassword] = useState('demo123');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [busySimpro, setBusySimpro] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!email || !password) { setError('Enter an email and password to continue.'); return; }
    setBusy(true);
    try {
      await login(email, password);
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

          <div className="mt-6 rounded-xl border border-brand-blue-soft bg-brand-blue-soft/60 p-3 text-xs text-slate-700 flex gap-2" data-testid="demo-banner">
            <Info size={14} className="text-brand-blue mt-0.5 shrink-0" />
            <div>
              <div className="font-medium text-brand-blue">Demo credentials</div>
              <div className="text-slate-600">Email <span className="font-mono">demo@paneltec.com</span> · Password <span className="font-mono">demo123</span></div>
            </div>
          </div>

          <form onSubmit={submit} className="mt-6 space-y-4" data-testid="login-form">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" autoComplete="email" data-testid="login-email"
                className="w-full px-3 py-2.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/30 focus:border-brand-blue" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete="current-password" data-testid="login-password"
                className="w-full px-3 py-2.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/30 focus:border-brand-blue" />
            </div>
            {error && <div className="text-xs text-brand-red" data-testid="login-error">{error}</div>}
            <button type="submit" disabled={busy} data-testid="login-submit"
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-brand-blue text-white text-sm font-medium hover:bg-blue-600 transition-colors disabled:opacity-60">
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
            <Link to="/signup" className="text-brand-blue font-medium hover:underline" data-testid="login-to-signup">Start your free trial</Link>
          </p>
        </div>
      </div>

      <div className="hidden lg:flex flex-1 items-center justify-center relative overflow-hidden bg-brand-ink">
        <div className="absolute inset-0 bg-grid-soft opacity-[0.06]" />
        <div className="relative max-w-md px-10 text-slate-200">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-blue">Paneltec Civil</div>
          <h2 className="font-display text-3xl font-semibold mt-3 text-white leading-tight">One platform for SWMS, sign-ons, hazards and compliance intelligence.</h2>
          <p className="mt-4 text-sm text-slate-400">Built for civil contracting and construction teams who need oversight without the spreadsheets.</p>
          <div className="mt-8 grid grid-cols-2 gap-3 text-xs">
            {[['AI SWMS', '8 active'], ['Pre-starts', '12 captured'], ['Hazards', '6 flagged'], ['Inspections', '6 passed']].map(([k, v]) => (
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
