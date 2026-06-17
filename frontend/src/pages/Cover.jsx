import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowRight, Eye, EyeOff, Loader2, Copy, Check, AlertCircle } from 'lucide-react';
import { login } from '../lib/auth';
import { apiError } from '../lib/api';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Cover() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!EMAIL_RE.test(email.trim())) { setError('Please enter a valid email address.'); return; }
    if (!password) { setError('Enter your password to continue.'); return; }
    setBusy(true);
    try {
      await login(email.trim(), password);
      navigate('/app/dashboard');
    } catch (err) {
      const msg = apiError(err) || '';
      if (msg.toLowerCase().includes('disabled')) setError(msg);
      else setError('Invalid email or password. Please try again.');
    } finally { setBusy(false); }
  };

  const copyDemo = async () => {
    try {
      await navigator.clipboard.writeText('demo@paneltec.com / demo123');
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* no clipboard permission — silent */ }
  };

  return (
    <div className="min-h-screen w-full bg-[#FBF8F2]" data-testid="cover-page">
      {/* Topbar — over hero on desktop, plain on mobile */}
      <div className="absolute top-0 inset-x-0 z-20 flex items-center justify-between px-6 md:px-10 py-5">
        <Link to="/" className="flex items-center gap-2.5" data-testid="cover-brand">
          <img src="/brand/mark.png" alt="" className="h-7 w-auto" />
          <span className="font-display text-[13px] font-bold tracking-[0.22em] text-slate-900 md:text-white">PANELTEC CIVIL</span>
        </Link>
        <div className="hidden sm:block text-[12px] tracking-wide text-slate-600 md:text-white/80">
          Need access? <span className="font-semibold text-slate-900 md:text-white">Contact your admin</span>
        </div>
      </div>

      <div className="min-h-screen w-full md:grid md:grid-cols-[3fr_2fr]">
        {/* LEFT — hero (hidden on mobile) */}
        <div className="hidden md:block relative overflow-hidden">
          <img src="/brand/hero.png" alt="Australian civil construction site at golden hour" className="absolute inset-0 w-full h-full object-cover" data-testid="cover-hero-img" />
          <div className="absolute inset-0" style={{ background: 'linear-gradient(110deg, rgba(15,27,45,0.85) 0%, rgba(15,27,45,0.55) 40%, rgba(15,27,45,0) 70%)' }} />
          <div className="relative h-full flex flex-col justify-between p-16 lg:p-20">
            <div className="mt-[15vh] max-w-[460px]">
              <div className="inline-block text-[11px] font-semibold uppercase tracking-[0.22em] text-brand-blue bg-white/10 backdrop-blur px-3 py-1.5 rounded-full mb-6 border border-white/15">
                WHS Compliance for civil teams
              </div>
              <h1 className="font-display text-4xl lg:text-5xl xl:text-[56px] font-bold leading-[1.05] text-white tracking-tight">
                One source of truth for Australian civil safety.
              </h1>
              <p className="mt-5 text-base lg:text-lg text-white/75 leading-relaxed">
                SWMS, pre-starts, hazards, contractors, fleet — every operational record in one place.
              </p>
            </div>
            <div className="text-[11px] uppercase tracking-[0.22em] text-white/60 font-semibold" data-testid="cover-trust">
              AS/NZS 4801 · ISO 45001 · Comcare ready
            </div>
          </div>
        </div>

        {/* RIGHT — login pane */}
        <div className="relative bg-[#FBF8F2] md:shadow-[inset_24px_0_36px_-24px_rgba(15,27,45,0.18)]">
          <div className="min-h-screen flex items-center justify-center px-6 sm:px-10 md:px-12 py-24 md:py-10">
            <div className="w-full max-w-[420px]">
              {/* Mobile-only: hero copy stacked above the form */}
              <div className="md:hidden mb-8">
                <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-brand-blue mb-3">
                  WHS Compliance for civil teams
                </div>
                <h1 className="font-display text-3xl font-bold leading-tight tracking-tight text-[#0F1B2D]">
                  One source of truth for Australian civil safety.
                </h1>
                <p className="mt-3 text-sm text-slate-600">
                  SWMS, pre-starts, hazards, contractors, fleet — every operational record in one place.
                </p>
              </div>

              <img src="/brand/mark.png" alt="Paneltec Civil" className="h-14 w-auto mb-6" data-testid="cover-mark" />
              <h2 className="font-display text-[32px] font-bold tracking-tight text-[#0F1B2D]">Welcome back</h2>
              <p className="mt-1.5 text-sm text-slate-600">Sign in to your Paneltec Civil workspace.</p>

              <form onSubmit={submit} className="mt-8 space-y-5" data-testid="cover-login-form" autoComplete="on">
                <div>
                  <label htmlFor="cover-email" className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 mb-1.5">Email</label>
                  <input id="cover-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com" autoComplete="email" autoFocus required
                    data-testid="cover-email"
                    className="w-full px-3.5 py-3 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/25 focus:border-brand-blue placeholder:text-slate-400" />
                </div>

                <div>
                  <label htmlFor="cover-password" className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 mb-1.5">Password</label>
                  <div className="relative">
                    <input id="cover-password" type={showPwd ? 'text' : 'password'} value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••" autoComplete="current-password" required
                      data-testid="cover-password"
                      className="w-full pl-3.5 pr-11 py-3 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/25 focus:border-brand-blue placeholder:text-slate-400" />
                    <button type="button" onClick={() => setShowPwd((s) => !s)} tabIndex={-1}
                      aria-label={showPwd ? 'Hide password' : 'Show password'}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-slate-700"
                      data-testid="cover-toggle-pwd">
                      {showPwd ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between text-[12px]">
                  <label className="inline-flex items-center gap-2 cursor-pointer text-slate-600">
                    <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-slate-300 text-brand-blue focus:ring-brand-blue/30" data-testid="cover-remember" />
                    Remember me
                  </label>
                  <Link to="/forgot-password" className="text-brand-blue hover:underline font-medium" data-testid="cover-forgot">Forgot password?</Link>
                </div>

                {error && (
                  <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-rose-50 border border-rose-200 text-[12px] text-rose-800" data-testid="cover-error">
                    <AlertCircle size={14} className="mt-0.5 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                <button type="submit" disabled={busy} data-testid="cover-submit"
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-brand-blue text-white text-sm font-semibold tracking-wide hover:bg-blue-600 active:bg-blue-700 transition-colors disabled:opacity-60">
                  {busy ? <><Loader2 size={16} className="animate-spin" /> Signing in…</> : <>Sign in <ArrowRight size={16} /></>}
                </button>
              </form>

              {/* Demo credentials */}
              <div className="mt-6 rounded-lg bg-slate-100 border border-slate-200 px-3.5 py-2.5 flex items-center justify-between gap-3" data-testid="cover-demo">
                <div className="font-mono text-[11px] text-slate-700 truncate">demo@paneltec.com / demo123</div>
                <button type="button" onClick={copyDemo} aria-label="Copy demo credentials"
                  className="inline-flex items-center justify-center w-7 h-7 rounded-md border border-slate-300 bg-white text-slate-500 hover:text-brand-blue hover:border-brand-blue/40"
                  data-testid="cover-demo-copy">
                  {copied ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
