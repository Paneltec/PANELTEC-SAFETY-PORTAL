import React, { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { ArrowRight, Eye, EyeOff, Loader2, AlertCircle, ShieldCheck, UserCog, Download, Share, Plus, X, Sparkles, Award, BarChart3 } from 'lucide-react';
import { login, safeNext } from '../lib/auth';
import { apiError } from '../lib/api';
import { usePwaInstall } from '../lib/pwa';
import { ForgotPasswordModal } from '../components/auth/AuthBundle';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Cover() {
  const navigate = useNavigate();
  const location = useLocation();
  const nextPath = safeNext(location.search);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { canInstall, isIOS, prompt: triggerInstall, dismiss: dismissInstall } = usePwaInstall();
  const [iosOpen, setIosOpen] = useState(false);
  // Phase 4.7.2 — same self-serve forgot-password modal the /login page uses.
  // The previous Cover.jsx pointed at a dead `/forgot-password` route.
  const [forgotOpen, setForgotOpen] = useState(false);

  const handleInstall = async () => {
    if (isIOS) { setIosOpen(true); return; }
    const { outcome } = await triggerInstall();
    if (outcome === 'dismissed') dismissInstall();
  };

  const doLogin = async (em, pw) => {
    setError('');
    if (!EMAIL_RE.test(em.trim())) { setError('Please enter a valid email address.'); return; }
    if (!pw) { setError('Enter your password to continue.'); return; }
    setBusy(true);
    try {
      // Defensive: nuke any stale Service Worker API caches BEFORE login.
      // Earlier versions of the SW cached API responses (including some 401s
      // when the backend was briefly down), which manifested as "logged out
      // straightaway". Clearing here is cheap and guarantees a clean session.
      try {
        if ('caches' in window) {
          const keys = await caches.keys();
          await Promise.all(keys
            .filter((k) => /api/i.test(k))
            .map((k) => caches.delete(k)));
        }
      } catch { /* ignore */ }
      await login(em.trim(), pw);
      navigate(nextPath, { replace: true });
    } catch (err) {
      const msg = apiError(err) || '';
      if (msg.toLowerCase().includes('disabled')) setError(msg);
      else setError('Invalid email or password. Please try again.');
    } finally { setBusy(false); }
  };

  const submit = (e) => { e.preventDefault(); doLogin(email, password); };

  const demo = async (em, pw, label) => {
    setEmail(em); setPassword(pw);
    await doLogin(em, pw);
    void label;
  };

  return (
    <div className="min-h-screen w-full bg-[#FBF8F2]" data-testid="cover-page">
      {/* Topbar */}
      <div className="absolute top-0 inset-x-0 z-20 flex items-center justify-between px-6 md:px-10 py-5">
        <Link to="/" className="flex items-center gap-2.5" data-testid="cover-brand">
          {/* Phase 4.10 v115 — chevron mark inlined as SVG to render in
              brand orange. The legacy /brand/mark.png is the old cobalt
              version and is now unreferenced. */}
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0">
            <path d="M12 3 L21 19 L15 19 L12 13 L9 19 L3 19 Z" fill="#F97316" />
            <path d="M12 3 L21 19 L15 19 L12 13 L9 19 L3 19 Z" stroke="#EA580C" strokeWidth="0.5" />
          </svg>
          <span className="font-display text-[13px] font-bold tracking-[0.22em] text-slate-900 md:text-white">PANELTEC CIVIL</span>
        </Link>
        <div className="hidden sm:flex items-center gap-4 text-[12px] tracking-wide text-slate-600 md:text-white/80">
          {canInstall && (
            <button type="button" onClick={handleInstall} data-testid="cover-install-pill"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-slate-300 md:border-white/25 bg-white/80 md:bg-white/10 backdrop-blur text-slate-900 md:text-white text-[11px] font-semibold uppercase tracking-wider hover:bg-white md:hover:bg-white/20">
              <Download size={12} /> Install Paneltec on your phone →
            </button>
          )}
          <span>Need access? <span className="font-semibold text-slate-900 md:text-white">Contact your admin</span></span>
        </div>
      </div>

      {/* iOS install instructions modal */}
      {iosOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setIosOpen(false)} data-testid="cover-ios-modal">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-3">
              <h3 className="font-display text-lg font-bold text-[#0F1B2D]">Install on iPhone</h3>
              <button onClick={() => setIosOpen(false)} className="text-slate-400 hover:text-slate-700" aria-label="Close"><X size={18} /></button>
            </div>
            <ol className="space-y-3 text-sm text-slate-700">
              <li className="flex items-start gap-2.5"><span className="inline-flex w-6 h-6 rounded-full bg-orange-100 text-orange-500 font-bold text-xs items-center justify-center shrink-0">1</span>
                Tap the <Share size={14} className="inline align-text-bottom mx-0.5" /> Share button in Safari&apos;s toolbar.</li>
              <li className="flex items-start gap-2.5"><span className="inline-flex w-6 h-6 rounded-full bg-orange-100 text-orange-500 font-bold text-xs items-center justify-center shrink-0">2</span>
                Scroll down and tap <Plus size={14} className="inline align-text-bottom mx-0.5" /> <strong>Add to Home Screen</strong>.</li>
              <li className="flex items-start gap-2.5"><span className="inline-flex w-6 h-6 rounded-full bg-orange-100 text-orange-500 font-bold text-xs items-center justify-center shrink-0">3</span>
                Tap <strong>Add</strong>. The Paneltec icon will appear on your home screen.</li>
            </ol>
            <button onClick={() => setIosOpen(false)} className="mt-5 w-full py-2.5 rounded-lg bg-orange-500 text-white font-semibold text-sm">Got it</button>
          </div>
        </div>
      )}

      <div className="min-h-screen w-full md:grid md:grid-cols-[3fr_2fr]">
        {/* LEFT — hero (hidden on mobile) */}
        <div className="hidden md:block relative overflow-hidden">
          <img src="/brand/hero.png" alt="Australian civil construction site at golden hour" className="absolute inset-0 w-full h-full object-cover" data-testid="cover-hero-img" />
          <div className="absolute inset-0" style={{ background: 'linear-gradient(110deg, rgba(15,27,45,0.85) 0%, rgba(15,27,45,0.55) 40%, rgba(15,27,45,0) 70%)' }} />
          <div className="relative h-full flex flex-col justify-between p-12 lg:p-16">
            <div className="mt-[12vh] max-w-[520px]">
              <div className="inline-block text-[11px] font-semibold uppercase tracking-[0.22em] text-orange-500 bg-white/10 backdrop-blur px-3 py-1.5 rounded-full mb-5 border border-white/15">
                WHS Compliance for civil teams
              </div>
              <h1 className="font-display text-4xl lg:text-5xl xl:text-[56px] font-bold leading-[1.05] text-white tracking-tight" data-testid="cover-hero-headline">
                <span className="block">Build Safer.</span>
                <span className="block">Build Smarter.</span>
                <span className="block" style={{ color: 'var(--paneltec-gold)' }}>Build Together.</span>
              </h1>
              <p className="mt-5 text-base lg:text-lg text-white/75 leading-relaxed max-w-[460px]" data-testid="cover-subtitle">
                All your civil construction safety forms, inspections, certifications and analytics — in one powerful portal.
              </p>

              {/* 4 value-prop chips */}
              <div className="mt-7 grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-w-[520px]" data-testid="cover-feature-chips">
                <div className="inline-flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-black/40 backdrop-blur-sm border border-white/10">
                  <ShieldCheck size={18} className="text-white shrink-0" />
                  <span className="text-sm font-medium text-white">Real-time Compliance</span>
                </div>
                <div className="inline-flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-black/40 backdrop-blur-sm border border-white/10">
                  <Sparkles size={18} style={{ color: 'var(--paneltec-gold)' }} className="shrink-0" />
                  <span className="text-sm font-medium text-white">AI-Powered Insights</span>
                </div>
                <div className="inline-flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-black/40 backdrop-blur-sm border border-white/10">
                  <Award size={18} style={{ color: 'var(--paneltec-gold)' }} className="shrink-0" />
                  <span className="text-sm font-medium text-white">Cert Tracking</span>
                </div>
                <div className="inline-flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-black/40 backdrop-blur-sm border border-white/10">
                  <BarChart3 size={18} style={{ color: 'var(--paneltec-gold)' }} className="shrink-0" />
                  <span className="text-sm font-medium text-white">Live Analytics</span>
                </div>
              </div>
            </div>
            <div className="text-[11px] uppercase tracking-[0.22em] text-white/60 font-semibold" data-testid="cover-trust">
              AS/NZS 4801 · ISO 45001 · Comcare ready
            </div>
          </div>
        </div>

        {/* RIGHT — login pane */}
        <div className="relative bg-[#FBF8F2]">
          <div className="min-h-screen flex items-center justify-center px-4 sm:px-6 md:px-8 py-24 md:py-10">
            <div className="w-full max-w-[460px]">
              {/* Mobile-only hero intro */}
              <div className="md:hidden mb-6 px-2">
                <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-orange-500 mb-2">
                  WHS Compliance for civil teams
                </div>
                <h1 className="font-display text-2xl font-bold leading-tight tracking-tight text-[#0F1B2D]">
                  <span className="block">Build Safer.</span>
                  <span className="block">Build Smarter.</span>
                  <span className="block" style={{ color: 'var(--paneltec-gold)' }}>Build Together.</span>
                </h1>
                <p className="mt-2 text-sm text-slate-600 leading-relaxed">
                  All your civil construction safety forms, inspections, certifications and analytics — in one powerful portal.
                </p>
              </div>

              {/* The elevated login card */}
              <div className="relative bg-white rounded-2xl shadow-xl border border-slate-200 p-8 sm:p-10 overflow-hidden" data-testid="cover-card">
                {/* Accent stripe — Phase 4.10 v115: cobalt → brand orange */}
                <div className="absolute top-0 left-0 bottom-0 w-1" style={{ backgroundColor: '#F97316' }} aria-hidden="true" />

                {/* Phase 4.10 v115 — chevron mark inlined as SVG to render
                    in brand orange. The legacy /brand/mark.png is the old
                    cobalt version and is now unreferenced from any
                    rendered surface. */}
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="mb-5" data-testid="cover-mark">
                  <path d="M12 3 L21 19 L15 19 L12 13 L9 19 L3 19 Z" fill="#F97316" />
                  <path d="M12 3 L21 19 L15 19 L12 13 L9 19 L3 19 Z" stroke="#EA580C" strokeWidth="0.5" />
                </svg>
                <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-orange-500">Sign in to your account</div>
                <h2 className="mt-2 font-display text-3xl sm:text-4xl font-bold tracking-tight text-[#0F1B2D]">Welcome back</h2>
                <p className="mt-1.5 text-sm text-slate-600">Sign in below to access your Paneltec Civil dashboard.</p>

                <form onSubmit={submit} className="mt-7 space-y-4" data-testid="cover-login-form" autoComplete="on">
                  <div>
                    <label htmlFor="cover-email" className="block text-sm font-medium text-slate-800 mb-1.5">Email address</label>
                    <input id="cover-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                      placeholder="e.g. you@paneltec.com.au" autoComplete="email" autoFocus required
                      data-testid="cover-email"
                      className="w-full px-3.5 py-3 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500/25 focus:border-orange-500 placeholder:text-slate-400" />
                  </div>

                  <div>
                    <label htmlFor="cover-password" className="block text-sm font-medium text-slate-800 mb-1.5">Password</label>
                    <div className="relative">
                      <input id="cover-password" type={showPwd ? 'text' : 'password'} value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Enter your password" autoComplete="current-password" required
                        data-testid="cover-password"
                        className="w-full pl-3.5 pr-11 py-3 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500/25 focus:border-orange-500 placeholder:text-slate-400" />
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
                        className="h-3.5 w-3.5 rounded border-slate-300 text-orange-500 focus:ring-orange-500/30" data-testid="cover-remember" />
                      Remember me
                    </label>
                    <Link to="/signup" className="text-orange-500 hover:underline font-medium">No account?</Link>
                    <button type="button" onClick={() => setForgotOpen(true)}
                      className="text-orange-500 hover:underline font-medium" data-testid="cover-forgot">Forgot password?</button>
                  </div>

                  {error && (
                    <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-rose-50 border border-rose-200 text-[12px] text-rose-800" data-testid="cover-error">
                      <AlertCircle size={14} className="mt-0.5 shrink-0" />
                      <span>{error}</span>
                    </div>
                  )}

                  <button type="submit" disabled={busy} data-testid="cover-submit"
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-3.5 rounded-lg bg-orange-500 text-white text-base font-bold tracking-wide hover:bg-orange-600 active:bg-orange-700 transition-colors disabled:opacity-60 shadow-md">
                    {busy ? <><Loader2 size={18} className="animate-spin" /> Signing in…</> : <>Sign in to Paneltec Civil <ArrowRight size={18} /></>}
                  </button>
                </form>

                {/* Demo accounts removed — production app uses real credentials only. */}
                <div className="mt-5 text-center text-[12px] text-slate-500" data-testid="cover-help">
                  Need an account? Contact your administrator.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <ForgotPasswordModal open={forgotOpen} onClose={() => setForgotOpen(false)} />
    </div>
  );
}
