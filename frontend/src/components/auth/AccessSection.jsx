// Phase 4.7 — AccessSection: invite / PIN / reset / unlock controls for a user.
import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import api, { apiError } from '@/lib/api';
import { PinRevealModal, ChannelPickerDialog } from '@/components/auth/AuthBundle';

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

  const refresh = async () => {
    try { const { data } = await api.get(`/users/${userId}/access-status`); setStatus(data); }
    catch (e) { toast.error(apiError(e)); }
  };
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [userId]);

  const fireChannelAction = async (path, label, channel) => {
    setBusy(true);
    try {
      const { data } = await api.post(path, { channel });
      toast.success(`${label} sent via ${data?.channel || channel}`);
      setPicker(null);
      refresh();
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };

  const sendInvite = (channel) => fireChannelAction(`/users/${userId}/invite`, 'Invite', channel);
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
      setPin(data.pin); refresh();
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
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
        <button onClick={() => setPicker({ kind: 'invite' })} disabled={busy} data-testid="access-invite"
          className="px-3 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold disabled:opacity-60">
          {status.state === 'invite_pending' ? 'Resend invite…' : 'Send invite…'}
        </button>
        <button onClick={genPin} disabled={busy} data-testid="access-pin"
          className="px-3 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-50 text-xs font-semibold text-slate-700 disabled:opacity-60">
          Generate one-time PIN
        </button>
        <button onClick={() => setPicker({ kind: 'reset' })} disabled={busy} data-testid="access-reset"
          className="px-3 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-50 text-xs font-semibold text-slate-700 disabled:opacity-60">
          Reset password…
        </button>
        {status.state === 'locked' && (
          <button onClick={unlock} disabled={busy} data-testid="access-unlock"
            className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold disabled:opacity-60">
            Unlock account
          </button>
        )}
      </div>
      <ChannelPickerDialog
        open={picker?.kind === 'invite'} onClose={() => setPicker(null)}
        title="Send invite link"
        description="The worker will receive a one-tap link to set their password and sign in."
        onConfirm={sendInvite} busy={busy}
      />
      <ChannelPickerDialog
        open={picker?.kind === 'reset'} onClose={() => setPicker(null)}
        title="Send reset link"
        description="The worker will receive a link to choose a new password."
        onConfirm={sendReset} busy={busy}
      />
      <PinRevealModal pin={pin} open={!!pin} onClose={() => setPin(null)} />
    </section>
  );
}
