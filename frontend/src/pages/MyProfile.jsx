import React, { useEffect, useMemo, useState } from 'react';
import { Save, Eye, EyeOff, Loader2, ShieldCheck, KeyRound, Shield } from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../lib/api';
import { persistToken } from '../lib/auth';
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
      if (data?.access_token) persistToken(data.access_token);
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
      if (data?.access_token) persistToken(data.access_token);
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

      {/* v58.13.132av — Card 3 · Admin console PIN.
          Admin-role only. Fetches /auth/admin-console/status on mount
          to decide between "Set your PIN" (first-time) vs
          "Rotate PIN" (current PIN required). Backend gate is the
          same _require_admin dep used for /set-pin, so a viewer of
          this page who isn't an admin never sees the card. */}
      {me.role === 'admin' && <AdminPinCard />}

      {/* v58.13.132gd — Card 4 · Download platform manual.
          Admin-only. Prompts for the same admin-console PIN and
          streams the current docs/paneltec_group_platform_manual.docx
          via the PIN-gated endpoint. */}
      {me.role === 'admin' && <ManualDownloadCard />}
    </div>
  );
}

// ─── v58.13.132gd — Download platform manual card ─────────────
function ManualDownloadCard() {
  const [pinOpen, setPinOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);

  const open = () => { setPin(''); setPinOpen(true); };
  const close = () => { if (!busy) setPinOpen(false); };

  const download = async () => {
    if (!/^\d{4}$/.test(pin)) {
      toast.error('PIN must be exactly 4 digits'); return;
    }
    setBusy(true);
    try {
      const resp = await api.get('/docs/manual.docx', {
        responseType: 'blob',
        headers: { 'X-Admin-Console-Pin': pin },
      });
      const blob = new Blob([resp.data], {
        type: 'application/vnd.openxmlformats-officedocument.'
              + 'wordprocessingml.document',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'paneltec_group_platform_manual.docx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('Manual downloaded');
      setPinOpen(false);
    } catch (e) {
      // Blob-typed axios errors don't carry a readable body — read
      // it manually so the toast shows the real reason (wrong PIN,
      // lockout, not-generated).
      let detail = '';
      try {
        const txt = await (e?.response?.data?.text?.() || Promise.resolve(''));
        if (txt) {
          try { detail = JSON.parse(txt).detail; } catch { detail = txt; }
        }
      } catch { /* fallthrough */ }
      toast.error(detail || apiError(e) || 'Manual download failed');
    } finally { setBusy(false); }
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white"
      data-testid="profile-manual-card">
      <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
        <Shield size={14} className="text-blue-600" />
        <h3 className="font-display text-sm font-semibold">
          Platform manual
        </h3>
        <span className="ml-auto text-[10px] uppercase tracking-wider text-slate-400">
          Word doc · admin
        </span>
      </div>
      <div className="p-5 space-y-3">
        <div className="text-[13px] text-slate-600 leading-relaxed">
          Downloads the current generated{' '}
          <code>paneltec_group_platform_manual.docx</code> — architecture,
          integrations, permission matrix, and the full API reference —
          rendered from the live codebase at last regeneration.
          Requires the admin-console PIN so the manual isn't casually
          exfiltrated from a shared browser session.
        </div>
      </div>
      <div className="px-5 py-3 border-t border-slate-100 flex justify-end gap-2">
        <button
          onClick={open}
          data-testid="profile-manual-download-open"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700"
        >
          <Shield size={14} /> Download manual
        </button>
      </div>

      {pinOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
          onClick={close}
          data-testid="profile-manual-pin-modal"
        >
          <div onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
              <Shield size={14} className="text-blue-600" />
              <h4 className="font-display text-sm font-semibold">
                Enter admin console PIN
              </h4>
            </div>
            <div className="p-5 space-y-3">
              <PinField
                label="PIN"
                value={pin}
                onChange={setPin}
                testId="profile-manual-pin-input"
                autoFocus
              />
              <div className="text-[11px] text-slate-500 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
                Uses the same rate-limited PIN as the admin console
                (3/30s, 6/15min lockout tiers).
              </div>
            </div>
            <div className="px-5 py-3 border-t border-slate-100 flex justify-end gap-2">
              <button onClick={close} disabled={busy}
                data-testid="profile-manual-pin-cancel"
                className="px-3 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm hover:bg-slate-50 disabled:opacity-50">
                Cancel
              </button>
              <button onClick={download} disabled={busy || !/^\d{4}$/.test(pin)}
                data-testid="profile-manual-pin-submit"
                className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
                {busy ? 'Downloading…' : 'Download'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── v58.13.132av — Admin console PIN card ────────────────────
function AdminPinCard() {
  const [status, setStatus] = useState(null);   // { has_pin, set_at }
  const [statusLoading, setStatusLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [curPin, setCurPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [busy, setBusy] = useState(false);

  const loadStatus = async () => {
    setStatusLoading(true);
    try {
      const { data } = await api.post('/auth/admin-console/status');
      setStatus(data);
    } catch (e) { toast.error(apiError(e)); }
    finally { setStatusLoading(false); }
  };
  useEffect(() => { loadStatus(); }, []);

  const openModal = () => {
    setCurPin(''); setNewPin(''); setConfirmPin('');
    setModalOpen(true);
  };
  const closeModal = () => { if (!busy) setModalOpen(false); };

  const submit = async () => {
    if (!/^\d{4}$/.test(newPin)) { toast.error('New PIN must be exactly 4 digits'); return; }
    if (newPin !== confirmPin) { toast.error('New PIN and confirmation do not match'); return; }
    if (status?.has_pin && !/^\d{4}$/.test(curPin)) {
      toast.error('Current PIN required to rotate'); return;
    }
    setBusy(true);
    try {
      const payload = { pin: newPin };
      if (status?.has_pin) payload.current_pin = curPin;
      await api.post('/auth/admin-console/set-pin', payload);
      toast.success(status?.has_pin ? 'Admin console PIN rotated' : 'Admin console PIN set');
      setModalOpen(false);
      loadStatus();
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };

  const fmtSetAt = (iso) => {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const yy = d.getFullYear();
      const hh = String(d.getHours()).padStart(2, '0');
      const mn = String(d.getMinutes()).padStart(2, '0');
      return `${dd}/${mm}/${yy} ${hh}:${mn}`;
    } catch { return iso; }
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white" data-testid="profile-admin-pin-card">
      <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
        <Shield size={14} className="text-amber-600" />
        <h3 className="font-display text-sm font-semibold">Admin console PIN</h3>
        <span className="ml-auto text-[10px] uppercase tracking-wider text-slate-400">
          {statusLoading ? '…' : (status?.has_pin ? 'Set' : 'Not set')}
        </span>
      </div>
      <div className="p-5 space-y-3">
        <div className="text-[13px] text-slate-600 leading-relaxed">
          A 4-digit PIN that unlocks the operational status pills in the app header
          (Import PDFs, API health, Backup, Comms Safe Mode). Kept separate from your
          password so you can show the app on-screen without leaking metadata.
        </div>
        <div className="grid sm:grid-cols-2 gap-3 pt-2 border-t border-slate-100">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Status</div>
            {statusLoading
              ? <span className="text-[13px] text-slate-400">Loading…</span>
              : status?.has_pin
                ? <span className="inline-block text-[11px] px-2 py-0.5 rounded-full font-semibold uppercase bg-emerald-100 text-emerald-800" data-testid="profile-admin-pin-status">PIN set</span>
                : <span className="inline-block text-[11px] px-2 py-0.5 rounded-full font-semibold uppercase bg-amber-100 text-amber-800" data-testid="profile-admin-pin-status">Not yet set</span>}
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Last set</div>
            <span className="text-[13px] font-mono text-slate-700" data-testid="profile-admin-pin-set-at">
              {statusLoading ? '…' : fmtSetAt(status?.set_at)}
            </span>
          </div>
        </div>
      </div>
      <div className="px-5 py-3 border-t border-slate-100 flex justify-end gap-2">
        <button
          onClick={openModal}
          disabled={statusLoading}
          data-testid="profile-admin-pin-open"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 disabled:opacity-50"
        >
          <Shield size={14} /> {status?.has_pin ? 'Change PIN' : 'Set PIN'}
        </button>
      </div>

      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
          onClick={closeModal}
          data-testid="profile-admin-pin-modal"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden"
          >
            <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
              <Shield size={14} className="text-amber-600" />
              <h4 className="font-display text-sm font-semibold">
                {status?.has_pin ? 'Change admin console PIN' : 'Set admin console PIN'}
              </h4>
            </div>
            <div className="p-5 space-y-3">
              {status?.has_pin && (
                <PinField
                  label="Current PIN"
                  value={curPin}
                  onChange={setCurPin}
                  testId="profile-admin-pin-current"
                  autoFocus
                />
              )}
              <PinField
                label="New PIN"
                value={newPin}
                onChange={setNewPin}
                testId="profile-admin-pin-new"
                autoFocus={!status?.has_pin}
              />
              <PinField
                label="Confirm new PIN"
                value={confirmPin}
                onChange={setConfirmPin}
                testId="profile-admin-pin-confirm"
              />
              {confirmPin && confirmPin !== newPin && (
                <div className="text-[11px] text-rose-600">PINs do not match.</div>
              )}
              <div className="text-[11px] text-slate-500 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                3 wrong attempts → 30s lockout · 6 wrong attempts → 15min lockout.
              </div>
            </div>
            <div className="px-5 py-3 border-t border-slate-100 flex justify-end gap-2">
              <button
                onClick={closeModal}
                disabled={busy}
                data-testid="profile-admin-pin-cancel"
                className="px-3 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={
                  busy
                  || !/^\d{4}$/.test(newPin)
                  || newPin !== confirmPin
                  || (status?.has_pin && !/^\d{4}$/.test(curPin))
                }
                data-testid="profile-admin-pin-submit"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 disabled:opacity-50"
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Shield size={14} />}
                {status?.has_pin ? 'Rotate PIN' : 'Set PIN'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PinField({ label, value, onChange, testId, autoFocus }) {
  // v58.13.132ax — strict 4-digit only. `onChange` receives the
  // sanitised value; `onKeyDown` swallows non-digit / edit keystrokes
  // so paste of "12ab34" still produces "1234", and the browser
  // native numeric keyboard is preferred on mobile.
  const ALLOW = new Set([
    'Backspace', 'Delete', 'ArrowLeft', 'ArrowRight',
    'Tab', 'Home', 'End', 'Enter',
  ]);
  const guardKey = (e) => {
    if (ALLOW.has(e.key)) return;
    // Copy / paste / cut / select-all combos.
    if (e.metaKey || e.ctrlKey) return;
    if (!/^\d$/.test(e.key)) e.preventDefault();
  };
  return (
    <label className="block">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">{label}</div>
      <input
        type="password"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={4}
        autoFocus={autoFocus}
        value={value}
        onKeyDown={guardKey}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 4))}
        data-testid={testId}
        className="w-full px-3 py-2.5 text-lg tracking-[0.5em] text-center font-mono border border-slate-300 rounded-lg focus:ring-2 focus:ring-amber-500/25 focus:border-amber-500 outline-none"
      />
    </label>
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
