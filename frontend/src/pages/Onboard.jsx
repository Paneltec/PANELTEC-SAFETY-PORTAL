// Phase 4.7 — Onboarding & Reset Password public pages (token-driven).
import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import axios from 'axios';
import { passwordRuleError, passwordStrength } from '@/lib/passwordRules';
import { setToken } from '@/lib/auth';

const API = (process.env.REACT_APP_BACKEND_URL || '') + '/api';

function StrengthMeter({ value }) {
  const s = passwordStrength(value);
  const cls = ['bg-rose-500','bg-orange-400','bg-amber-400','bg-emerald-500','bg-emerald-600'][s.score] || 'bg-slate-200';
  return (
    <div data-testid="pw-strength" className="mt-1.5">
      <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
        <div className={`h-full ${cls} transition-all`} style={{ width: `${(s.score+1)*20}%` }} />
      </div>
      <div className="text-xs mt-1 text-slate-500">Strength: <span className="font-medium text-slate-700">{s.label}</span> · Min 10 chars, 1 letter + 1 digit + 1 special</div>
    </div>
  );
}

export function PasswordPanel({ flavour, token }) {
  // flavour: 'invite' | 'reset' — drives copy + endpoints.
  const navigate = useNavigate();
  const [pw, setPw] = useState('');
  const [cf, setCf] = useState('');
  const [busy, setBusy] = useState(false);
  const [meta, setMeta] = useState(null);   // {user_email, org_name}
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!token) { setError('No token supplied.'); return; }
    // Phase 4.7.1 — both flavours pre-flight the token now. Invite uses
    // `/auth/invite/validate`; reset has its own `/auth/reset/validate`
    // mirror so we don't show a password form for a dead link.
    const url = flavour === 'invite'
      ? `${API}/auth/invite/validate`
      : `${API}/auth/reset/validate`;
    axios.post(url, { token })
      .then((r) => setMeta(r.data))
      .catch((e) => setError(e?.response?.data?.detail || 'Link invalid or expired.'));
  }, [token, flavour]);

  const submit = async (e) => {
    e.preventDefault();
    const err = passwordRuleError(pw);
    if (err) { toast.error(err); return; }
    if (pw !== cf) { toast.error("Passwords don't match."); return; }
    setBusy(true);
    try {
      const url = `${API}/auth/${flavour}/redeem`;
      const { data } = await axios.post(url, { token, password: pw, confirm_password: cf });
      setToken(data.access_token);
      toast.success(flavour === 'invite' ? 'Welcome aboard.' : 'Password reset — signed in.');
      navigate('/app');
    } catch (ex) {
      toast.error(ex?.response?.data?.detail || 'Could not complete request.');
    } finally { setBusy(false); }
  };

  if (error) {
    return (
      <div className="max-w-md w-full text-center" data-testid="onboard-error">
        <div className="w-12 h-12 mx-auto rounded-2xl bg-rose-50 text-rose-600 inline-flex items-center justify-center text-2xl">!</div>
        <h1 className="font-display text-2xl mt-3 text-slate-900">Link can't be used</h1>
        <p className="text-sm text-slate-600 mt-2">{error}</p>
        <a href="/login" className="inline-block mt-4 text-sm text-orange-600 hover:underline">Back to sign in</a>
        <p className="mt-6 pt-4 border-t border-slate-100 text-xs text-slate-500" data-testid="onboard-help">
          Need help? Contact your administrator to issue a fresh link or PIN.
        </p>
      </div>
    );
  }
  if (!meta) return <div className="text-sm text-slate-500" data-testid="onboard-loading">Loading…</div>;

  const heading = flavour === 'invite'
    ? <>Welcome{meta.user_name ? `, ${meta.user_name}` : ''}<br/><span className="text-orange-600">joining {meta.org_name}</span></>
    : <>Reset password<br/><span className="text-orange-600">for {meta.user_email || ''}</span></>;

  return (
    <form onSubmit={submit} className="max-w-md w-full" data-testid={`${flavour}-form`}>
      <div className="text-center mb-6">
        <div className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-orange-600 font-semibold">Paneltec Civil</div>
        <h1 className="font-display text-3xl mt-2 text-slate-900 leading-tight">{heading}</h1>
        <p className="text-sm text-slate-500 mt-2">Set a strong password to {flavour === 'invite' ? 'activate your account' : 'reset access'}.</p>
      </div>
      <label className="block text-xs font-semibold text-slate-600">New password</label>
      <input type="password" value={pw} onChange={(e) => setPw(e.target.value)}
        data-testid="pw-new" autoFocus
        className="w-full mt-1 rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200 focus:border-orange-400" />
      <StrengthMeter value={pw} />
      <label className="block text-xs font-semibold text-slate-600 mt-4">Confirm password</label>
      <input type="password" value={cf} onChange={(e) => setCf(e.target.value)}
        data-testid="pw-confirm"
        className="w-full mt-1 rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200 focus:border-orange-400" />
      <button type="submit" disabled={busy} data-testid={`${flavour}-submit`}
        className="w-full mt-6 inline-flex items-center justify-center gap-2 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white text-sm font-semibold py-2.5">
        {busy ? 'Working…' : (flavour === 'invite' ? 'Activate my account' : 'Reset password')}
      </button>
    </form>
  );
}

function PublicShell({ children }) {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6" data-testid="public-shell">
      <div className="rounded-3xl bg-white shadow-xl p-8 max-w-md w-full border border-slate-200">{children}</div>
    </div>
  );
}

export default function Onboard() {
  const [params] = useSearchParams();
  return <PublicShell><PasswordPanel flavour="invite" token={params.get('token') || ''} /></PublicShell>;
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  return <PublicShell><PasswordPanel flavour="reset" token={params.get('token') || ''} /></PublicShell>;
}
