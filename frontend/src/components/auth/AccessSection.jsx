// Phase 4.7 — AccessSection: invite / PIN / reset / unlock controls for a user.
import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import api, { apiError } from '@/lib/api';
import { getUser } from '@/lib/auth';
import { PinRevealModal, ChannelPickerDialog, ResetLinkRevealModal } from '@/components/auth/AuthBundle';
import { Loader2, Shield } from 'lucide-react';

const STATE_PILL = {
  active:          { label: 'Active',           cls: 'bg-emerald-50 text-emerald-700' },
  invite_pending:  { label: 'Invite pending',   cls: 'bg-orange-50 text-orange-700' },
  never_logged_in: { label: 'Never logged in',  cls: 'bg-slate-100 text-slate-600' },
  locked:          { label: 'Locked',           cls: 'bg-rose-50 text-rose-700' },
};

export default function AccessSection({ userId, compact = false }) {
  const [status, setStatus] = useState(null);
  const [picker, setPicker] = useState(null); // null | { kind: 'invite'|'reset' }
  const [busy, setBusy] = useState(false);
  const [pin, setPin] = useState(null);
  // v58.13.132bb — carry invite URL alongside the PIN reveal so the
  // modal can offer Copy invite link + Email me this info.
  const [pinInviteUrl, setPinInviteUrl] = useState(null);
  const [pinUserEmail, setPinUserEmail] = useState(null);
  // v58.13.132bb — Reset link reveal state (comms_safe_mode fallback).
  const [resetLink, setResetLink] = useState(null);
  const [resetUserEmail, setResetUserEmail] = useState(null);
  // v58.13.132az — Detect "am I looking at myself?" so the drawer can
  // surface a Change-admin-PIN button. Only shown for admins viewing
  // their own row — otherwise the field is Users Management → kebab
  // → Clear admin console PIN (see AccessKebab in .132av).
  const me = getUser();
  const isSelf = !!(me && me.id === userId);
  const isAdmin = me?.role === 'admin';
  const [pinModalOpen, setPinModalOpen] = useState(false);
  const [pinStatus, setPinStatus] = useState(null); // { has_pin, set_at } | null
  const [curPin, setCurPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pinBusy, setPinBusy] = useState(false);

  // v58.13.66 — `refresh` wrapped in `useCallback` so its identity is
  // stable across renders that don't change `userId`. Previously we
  // suppressed the exhaustive-deps warning with an eslint-disable
  // comment; the useCallback + honest deps pattern is safer against
  // future maintainers who might add stateful reads to `refresh`.
  const refresh = useCallback(async () => {
    try { const { data } = await api.get(`/users/${userId}/access-status`); setStatus(data); }
    catch (e) { toast.error(apiError(e)); }
  }, [userId]);
  useEffect(() => { refresh(); }, [refresh]);

  // v58.13.132az — Pull admin-console PIN status (has_pin + set_at)
  // when the drawer is open on the current user's own row and they
  // are an admin. Same endpoint used by MyProfile.
  useEffect(() => {
    if (!isSelf || !isAdmin) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.post('/auth/admin-console/status');
        if (!cancelled) setPinStatus(data);
      } catch (_) { /* silent — button just won't render */ }
    })();
    return () => { cancelled = true; };
  }, [isSelf, isAdmin]);

  const fireChannelAction = async (path, label, channel) => {
    setBusy(true);
    try {
      const { data } = await api.post(path, { channel });
      toast.success(`${label} sent via ${data?.channel || channel}`);
      setPicker(null);
      refresh();
      // v58.13.132bb — reset-password response now includes the raw
      // link so admins can hand-deliver when comms_safe_mode blocks
      // the M365/SMS channel. Open the reveal modal automatically.
      if (data?.link && path.includes('/reset-password')) {
        setResetLink(data.link);
        // Look up the target user's email via access-status refetch
        // so mailto can pre-fill it — best-effort, silent on fail.
        try {
          const { data: as } = await api.get(`/users/${userId}/access-status`);
          setResetUserEmail(as?.email || null);
        } catch (_) { /* noop */ }
      }
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };

  // v160.3.9.32-4c.1 — sendInvite removed. Admin uses sendReset (magic
  // link) or the direct Set-password dialog in the drawer instead.
  const sendReset  = (channel) => fireChannelAction(`/users/${userId}/reset-password`, 'Reset link', channel);
  const unlock = async () => {
    setBusy(true);
    try { await api.post(`/users/${userId}/unlock`); toast.success('Account unlocked'); refresh(); }
    catch (e) { toast.error(apiError(e)); } finally { setBusy(false); }
  };
  const genPin = async () => {
    setBusy(true);
    try {
      const { data } = await api.post(`/users/${userId}/pin`);
      setPin(data.pin);
      // v58.13.132bb — carry the fresh install URL + email through
      // so PinRevealModal can render the Copy-link + Email-me row.
      setPinInviteUrl(data.invite_url || null);
      setPinUserEmail(data.user_email || null);
      refresh();
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };

  // v58.13.132az — Change / set admin console PIN from the Users &
  // Permissions drawer. Same shape as MyProfile's modal — accepts
  // current PIN when rotating, requires two matching new PINs.
  const openPinModal = () => {
    setCurPin(''); setNewPin(''); setConfirmPin('');
    setPinModalOpen(true);
  };
  const closePinModal = () => { if (!pinBusy) setPinModalOpen(false); };
  const submitPin = async () => {
    if (!/^\d{4}$/.test(newPin)) { toast.error('New PIN must be exactly 4 digits'); return; }
    if (newPin !== confirmPin) { toast.error('New PIN and confirmation do not match'); return; }
    if (pinStatus?.has_pin && !/^\d{4}$/.test(curPin)) {
      toast.error('Current PIN required to rotate'); return;
    }
    setPinBusy(true);
    try {
      const payload = { pin: newPin };
      if (pinStatus?.has_pin) payload.current_pin = curPin;
      await api.post('/auth/admin-console/set-pin', payload);
      toast.success(pinStatus?.has_pin ? 'Admin console PIN rotated' : 'Admin console PIN set');
      setPinModalOpen(false);
      // Refresh status so the button label flips Set→Change.
      try {
        const { data } = await api.post('/auth/admin-console/status');
        setPinStatus(data);
      } catch (_) { /* noop */ }
    } catch (e) { toast.error(apiError(e)); }
    finally { setPinBusy(false); }
  };

  if (!status) return <div className="text-xs text-slate-500" data-testid="access-loading">Loading access…</div>;

  const pill = STATE_PILL[status.state] || STATE_PILL.active;
  const expiresIn = status.invite_expires_at
    ? Math.max(0, Math.floor((new Date(status.invite_expires_at) - new Date()) / 86400000))
    : null;
  const lastLogin = status.last_login_at
    ? Math.floor((new Date() - new Date(status.last_login_at)) / 86400000) : null;
  const subline = status.state === 'invite_pending' && expiresIn != null
    ? `expires in ${expiresIn} day${expiresIn === 1 ? '' : 's'}`
    : status.state === 'active' && lastLogin != null
    ? `last login ${lastLogin}d ago`
    : status.state === 'locked' ? 'too many failed attempts' : '';

  return (
    <section className={compact ? '' : 'rounded-2xl border border-slate-200 bg-white p-5'} data-testid="access-section">
      {!compact && <h3 className="font-display text-lg font-semibold text-slate-900 mb-2">Access</h3>}
      <div className="flex items-center gap-2 mb-3">
        <span data-testid="access-pill"
          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold ${pill.cls}`}>
          {pill.label}
        </span>
        {subline && <span className="text-xs text-slate-500">· {subline}</span>}
      </div>
      <div className="flex flex-wrap gap-2">
        {/* v160.3.9.32-4c.1 — "Send invite…" button removed. Backend
            invite endpoint returns 410; admin uses Reset password or
            the direct Set-password dialog from the drawer instead. */}
        <button onClick={genPin} disabled={busy} data-testid="access-pin"
          className="px-3 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-50 text-xs font-semibold text-slate-700 disabled:opacity-60">
          Generate one-time PIN
        </button>
        <button onClick={() => setPicker({ kind: 'reset' })} disabled={busy} data-testid="access-reset"
          className="px-3 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-50 text-xs font-semibold text-slate-700 disabled:opacity-60">
          Reset password…
        </button>
        {/* v58.13.132az — Change admin-console PIN button. Only when
            looking at your own row AND you are an admin — the whole
            point is to surface the rotation UX for admins who can't
            find MyProfile. Non-admin rows never see this. */}
        {isSelf && isAdmin && (
          <button onClick={openPinModal} data-testid="access-change-admin-pin"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 text-white hover:bg-amber-600 text-xs font-semibold disabled:opacity-60"
          >
            <Shield size={12} />
            {pinStatus?.has_pin ? 'Change admin PIN' : 'Set admin PIN'}
          </button>
        )}
        {status.state === 'locked' && (
          <button onClick={unlock} disabled={busy} data-testid="access-unlock"
            className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold disabled:opacity-60">
            Unlock account
          </button>
        )}
      </div>
      <ChannelPickerDialog
        open={picker?.kind === 'reset'} onClose={() => setPicker(null)}
        title="Send reset link"
        description="The worker will receive a link to choose a new password."
        onConfirm={sendReset} busy={busy}
      />
      <PinRevealModal
        pin={pin}
        inviteUrl={pinInviteUrl}
        userEmail={pinUserEmail}
        open={!!pin}
        onClose={() => { setPin(null); setPinInviteUrl(null); setPinUserEmail(null); }}
      />

      {/* v58.13.132bb — Reset link reveal (comms_safe_mode fallback). */}
      <ResetLinkRevealModal
        link={resetLink}
        userEmail={resetUserEmail}
        open={!!resetLink}
        onClose={() => { setResetLink(null); setResetUserEmail(null); }}
      />

      {/* v58.13.132az — Change admin-console PIN modal (drawer variant). */}
      {pinModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
          onClick={closePinModal}
          data-testid="access-change-admin-pin-modal"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden"
          >
            <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
              <Shield size={14} className="text-amber-600" />
              <h4 className="font-display text-sm font-semibold">
                {pinStatus?.has_pin ? 'Change admin console PIN' : 'Set admin console PIN'}
              </h4>
            </div>
            <div className="p-5 space-y-3">
              {pinStatus?.has_pin && (
                <DrawerPinField
                  label="Current PIN"
                  value={curPin}
                  onChange={setCurPin}
                  testId="access-change-admin-pin-current"
                  autoFocus
                />
              )}
              <DrawerPinField
                label="New PIN"
                value={newPin}
                onChange={setNewPin}
                testId="access-change-admin-pin-new"
                autoFocus={!pinStatus?.has_pin}
              />
              <DrawerPinField
                label="Confirm new PIN"
                value={confirmPin}
                onChange={setConfirmPin}
                testId="access-change-admin-pin-confirm"
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
                onClick={closePinModal}
                disabled={pinBusy}
                data-testid="access-change-admin-pin-cancel"
                className="px-3 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={submitPin}
                disabled={
                  pinBusy
                  || !/^\d{4}$/.test(newPin)
                  || newPin !== confirmPin
                  || (pinStatus?.has_pin && !/^\d{4}$/.test(curPin))
                }
                data-testid="access-change-admin-pin-submit"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 disabled:opacity-50"
              >
                {pinBusy ? <Loader2 size={14} className="animate-spin" /> : <Shield size={14} />}
                {pinStatus?.has_pin ? 'Rotate PIN' : 'Set PIN'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// v58.13.132az — Drawer-local PIN field so AccessSection doesn't
// depend on MyProfile. Same guard shape as the one shipped in
// .132ax: strict 4 digits, onKeyDown swallows non-digits, paste is
// sanitised in onChange.
function DrawerPinField({ label, value, onChange, testId, autoFocus }) {
  const ALLOW = new Set([
    'Backspace', 'Delete', 'ArrowLeft', 'ArrowRight',
    'Tab', 'Home', 'End', 'Enter',
  ]);
  const guardKey = (e) => {
    if (ALLOW.has(e.key)) return;
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
