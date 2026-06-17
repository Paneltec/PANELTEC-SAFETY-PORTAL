import React, { useEffect, useMemo, useState } from 'react';
import { Save, Eye, EyeOff, Loader2, ShieldCheck, KeyRound } from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../lib/api';
import { PageHeader } from '../components/capture/Ui';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function scorePassword(pwd) {
  if (!pwd) return { score: 0, label: '' };
  let s = 0;
  if (pwd.length >= 8) s += 1;
  if (pwd.length >= 12) s += 1;
  if (/[A-Z]/.test(pwd) && /[a-z]/.test(pwd)) s += 1;
  if (/\d/.test(pwd)) s += 1;
  if (/[^A-Za-z0-9]/.test(pwd)) s += 1;
  if (s <= 2) return { score: 1, label: 'Weak', color: 'bg-rose-500', text: 'text-rose-700' };
  if (s <= 3) return { score: 2, label: 'Medium', color: 'bg-amber-500', text: 'text-amber-700' };
  return { score: 3, label: 'Strong', color: 'bg-emerald-500', text: 'text-emerald-700' };
}

export default function MyProfile() {
  const [me, setMe] = useState(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);

  const [curPwd, setCurPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [showCur, setShowCur] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [pwdBusy, setPwdBusy] = useState(false);

  const load = async () => {
    try {
      const { data } = await api.get('/auth/me');
      setMe(data);
      setName(data.name || '');
      setEmail(data.email || '');
    } catch (e) { toast.error(apiError(e)); }
  };
  useEffect(() => { load(); }, []);

  const strength = useMemo(() => scorePassword(newPwd), [newPwd]);
  const emailValid = !email || EMAIL_RE.test(email);
  const accountDirty = me && (name !== (me.name || '') || email !== (me.email || ''));

  const saveAccount = async () => {
    if (!emailValid) { toast.error('Enter a valid email'); return; }
    setBusy(true);
    try {
      const payload = { name };
      if (email !== me.email) payload.email = email;
      const { data } = await api.post('/auth/update-profile', payload);
      // Refresh token so the user stays logged in after token_version bump on email change.
      if (data?.access_token) localStorage.setItem('paneltec_token', data.access_token);
      toast.success('Profile updated');
      load();
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };

  const changePassword = async () => {
    if (!curPwd) { toast.error('Enter your current password'); return; }
    if (newPwd.length < 8) { toast.error('New password must be at least 8 characters'); return; }
    if (newPwd !== confirmPwd) { toast.error('New password and confirmation do not match'); return; }
    setPwdBusy(true);
    try {
      const { data } = await api.post('/auth/change-password', { current_password: curPwd, new_password: newPwd });
      if (data?.access_token) localStorage.setItem('paneltec_token', data.access_token);
      toast.success('Password changed — other sessions have been signed out');
      setCurPwd(''); setNewPwd(''); setConfirmPwd('');
    } catch (e) { toast.error(apiError(e)); }
    finally { setPwdBusy(false); }
  };

  if (!me) return <div className="text-sm text-slate-500">Loading…</div>;

  return (
    <div className="max-w-3xl mx-auto space-y-6" data-testid="my-profile">
      <PageHeader crumb="My Profile" title="My Profile" subtitle="Manage your account details and password." />

      {/* Card 1 — Account details */}
      <div className="rounded-2xl border border-slate-200 bg-white" data-testid="profile-account-card">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
          <ShieldCheck size={14} className="text-brand-blue" />
          <h3 className="font-display text-sm font-semibold">Account details</h3>
        </div>
        <div className="p-5 grid sm:grid-cols-2 gap-4">
          <label className="block">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Name</div>
            <input value={name} onChange={(e) => setName(e.target.value)} data-testid="profile-name"
              className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-brand-blue/25 focus:border-brand-blue outline-none" />
          </label>
          <label className="block">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Email</div>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="profile-email"
              className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-brand-blue/25 focus:border-brand-blue outline-none" />
            {!emailValid && <div className="text-[11px] text-rose-600 mt-1">Enter a valid email</div>}
          </label>

          <div className="sm:col-span-2 grid sm:grid-cols-3 gap-3 pt-2 border-t border-slate-100">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Role</div>
              <span className="inline-block text-xs px-2 py-0.5 bg-slate-100 rounded font-medium" data-testid="profile-role">{me.role}</span>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Status</div>
              <span className="inline-block text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase bg-emerald-100 text-emerald-800">Active</span>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Member since</div>
              <span className="text-xs text-slate-700">{me.created_at ? new Date(me.created_at).toLocaleDateString() : '—'}</span>
            </div>
            <div className="sm:col-span-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Workspaces</div>
              <div className="flex flex-wrap gap-1.5">
                {(me.workspace_ids || []).length === 0
                  ? <span className="text-xs text-slate-400 italic">None assigned</span>
                  : (me.workspace_ids || []).map((w) => (
                    <span key={w} className="text-[10px] px-2 py-0.5 rounded-full bg-brand-blue-soft text-brand-blue font-medium font-mono">{w.slice(0,8)}</span>
                  ))}
              </div>
            </div>
          </div>
        </div>
        <div className="px-5 py-3 border-t border-slate-100 flex justify-end">
          <button onClick={saveAccount} disabled={busy || !accountDirty} data-testid="profile-save"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-blue text-white text-sm font-medium hover:bg-blue-600 disabled:opacity-50">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save changes
          </button>
        </div>
      </div>

      {/* Card 2 — Change password */}
      <div className="rounded-2xl border border-slate-200 bg-white" data-testid="profile-password-card">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
          <KeyRound size={14} className="text-brand-blue" />
          <h3 className="font-display text-sm font-semibold">Change password</h3>
        </div>
        <div className="p-5 space-y-4">
          <PwdField label="Current password" value={curPwd} onChange={setCurPwd} show={showCur} setShow={setShowCur} testId="profile-cur-pwd" autoComplete="current-password" />
          <div>
            <PwdField label="New password" value={newPwd} onChange={setNewPwd} show={showNew} setShow={setShowNew} testId="profile-new-pwd" autoComplete="new-password" />
            {newPwd && (
              <div className="mt-2 flex items-center gap-2" data-testid="profile-pwd-strength">
                <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                  <div className={`h-full ${strength.color || ''} transition-all`} style={{ width: `${(strength.score / 3) * 100}%` }} />
                </div>
                <span className={`text-[11px] font-semibold ${strength.text || 'text-slate-500'}`}>{strength.label}</span>
              </div>
            )}
            <div className="mt-1 text-[11px] text-slate-500">Min 8 chars · a letter + a number or symbol.</div>
          </div>
          <div>
            <PwdField label="Confirm new password" value={confirmPwd} onChange={setConfirmPwd} show={showNew} setShow={setShowNew} testId="profile-confirm-pwd" autoComplete="new-password" />
            {confirmPwd && confirmPwd !== newPwd && <div className="text-[11px] text-rose-600 mt-1">Passwords do not match</div>}
          </div>
          <div className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
            Changing your password will sign you out of any other sessions but keep you here.
          </div>
        </div>
        <div className="px-5 py-3 border-t border-slate-100 flex justify-end">
          <button onClick={changePassword} disabled={pwdBusy || !curPwd || !newPwd || newPwd !== confirmPwd}
            data-testid="profile-change-pwd"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-blue text-white text-sm font-medium hover:bg-blue-600 disabled:opacity-50">
            {pwdBusy ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />} Change password
          </button>
        </div>
      </div>
    </div>
  );
}

function PwdField({ label, value, onChange, show, setShow, testId, autoComplete }) {
  return (
    <label className="block">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">{label}</div>
      <div className="relative">
        <input type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete} data-testid={testId}
          className="w-full pl-3 pr-10 py-2.5 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-brand-blue/25 focus:border-brand-blue outline-none" />
        <button type="button" onClick={() => setShow((s) => !s)} tabIndex={-1}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-slate-700" aria-label="Toggle visibility">
          {show ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
    </label>
  );
}
