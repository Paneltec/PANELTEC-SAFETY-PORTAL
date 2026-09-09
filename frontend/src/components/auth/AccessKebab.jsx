// Phase 4.7.1 — shared access-actions kebab.
//
// Surfaces Reset password / Generate PIN / Unlock for a given
// v160.3.9.32-4c.1 — "Send invite" removed; backend endpoint returns 410.
// user_id. Invite + reset open a `ChannelPickerDialog` first so the admin
// can pick email / SMS / auto — wiring matches the backend's required
// `channel` field on `/users/{id}/invite` and `/users/{id}/reset-password`.
//
// Lives in `components/auth/` so the Users admin AND the Workers list can
// import it (the latter passes the linked user_id discovered by email
// match — see Workers.jsx).
import React, { useState } from 'react';
import { toast } from 'sonner';
import { MoreVertical, Loader2, ShieldOff } from 'lucide-react';
import api, { apiError } from '@/lib/api';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { ChannelPickerDialog, PinRevealModal, ResetLinkRevealModal } from '@/components/auth/AuthBundle';

export default function AccessKebab({ userId, canEdit, can, onAfterAction, testIdSuffix }) {
  // v160.3.9.29-2a — Dual-prop shim during the sub-phase 2a→2b/2c
  // migration. New consumers should pass `can={...}`; legacy consumers
  // (`canEdit={...}`) continue to work unchanged. Default is `true`
  // to preserve the pre-shim behaviour when neither is supplied.
  const gate = (can !== undefined) ? can : (canEdit !== undefined ? canEdit : true);
  // `picker` is null | { kind: 'invite' | 'reset' }
  const [picker, setPicker] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pin, setPin] = useState(null);
  // v58.13.132bb — carry the invite URL + target email through so
  // the modal can offer Copy invite link + Email me this info.
  const [pinInviteUrl, setPinInviteUrl] = useState(null);
  const [pinUserEmail, setPinUserEmail] = useState(null);
  const [resetLink, setResetLink] = useState(null);
  const [resetUserEmail, setResetUserEmail] = useState(null);
  // v58.13.132av — Clear admin console PIN.
  //   Opens a confirmation modal that asks for the acting admin's
  //   own PIN (rate-limited via the same lockout ledger as unlock).
  //   Wires to POST /api/users/{id}/admin-console/clear-pin.
  const [clearOpen, setClearOpen] = useState(false);
  const [actingPin, setActingPin] = useState('');
  const suffix = testIdSuffix || userId;

  const closePicker = () => setPicker(null);

  // v58.13.86 — fireInvite() restored. Backend `/users/{id}/invite`
  // was re-enabled from HTTP 410 → 201. Admin explicitly clicks Send
  // Invite → this fires the invite email/SMS (subject to Comms Safe
  // Mode). Uses the same ChannelPickerDialog as reset.
  const fireInvite = async (channel) => {
    setBusy(true);
    try {
      const { data } = await api.post(`/users/${userId}/invite`, { channel });
      closePicker();
      toast.success(`Invite sent via ${data?.channel || channel}`);
      onAfterAction?.();
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };

  const fireReset = async (channel) => {
    setBusy(true);
    try {
      const { data } = await api.post(`/users/${userId}/reset-password`, { channel });
      closePicker();
      toast.success(`Reset link sent via ${data?.channel || channel}`);
      // v58.13.132bb — surface the raw link so admins can hand-
      // deliver when comms_safe_mode blocks the auto-email path.
      if (data?.link) {
        setResetLink(data.link);
        setResetUserEmail(data?.user_email || null);
      }
      onAfterAction?.();
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };

  const firePin = async () => {
    setBusy(true);
    try {
      const { data } = await api.post(`/users/${userId}/pin`);
      setPin(data?.pin);
      // v58.13.132bb — carry the fresh onboarding install URL
      // through to the reveal modal.
      setPinInviteUrl(data?.invite_url || null);
      setPinUserEmail(data?.user_email || null);
      onAfterAction?.();
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };

  const fireUnlock = async () => {
    setBusy(true);
    try {
      await api.post(`/users/${userId}/unlock`);
      toast.success('Account unlocked');
      onAfterAction?.();
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };

  // v58.13.132av — Clear target user's admin console PIN.
  const fireClearAdminPin = async () => {
    if (!/^\d{4}$/.test(actingPin)) {
      toast.error('Enter your own 4-digit admin console PIN');
      return;
    }
    setBusy(true);
    try {
      await api.post(`/users/${userId}/admin-console/clear-pin`, { acting_pin: actingPin });
      toast.success('Admin console PIN cleared for this user');
      setClearOpen(false);
      setActingPin('');
      onAfterAction?.();
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };

  if (!gate) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            title="Access actions"
            data-testid={`access-kebab-${suffix}`}
            disabled={busy}
            className="inline-flex items-center justify-center w-7 h-7 rounded bg-orange-50 text-orange-700 hover:bg-orange-100 disabled:opacity-50">
            <MoreVertical size={14} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Access</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {/* v58.13.86 — "Send invite…" restored per user directive
              on manual-send buttons. Backend now returns 201 again. */}
          <DropdownMenuItem onSelect={() => setPicker({ kind: 'invite' })}
            data-testid={`access-kebab-invite-${suffix}`}>
            Send invite…
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setPicker({ kind: 'reset' })}
            data-testid={`access-kebab-reset-${suffix}`}>
            Reset password…
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={firePin}
            data-testid={`access-kebab-pin-${suffix}`}>
            Generate one-time PIN
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={fireUnlock}
            data-testid={`access-kebab-unlock-${suffix}`}
            className="text-rose-700 focus:text-rose-700">
            Unlock account
          </DropdownMenuItem>
          {/* v58.13.132av — Clear admin console PIN.
              Backend gates on _require_admin (role=='admin') AND
              re-verifies the acting admin's own PIN — so this menu
              item is safe to render for every user row; the endpoint
              rejects a non-admin caller. */}
          <DropdownMenuItem onSelect={() => setClearOpen(true)}
            data-testid={`access-kebab-clear-admin-pin-${suffix}`}
            className="text-amber-800 focus:text-amber-800">
            Clear admin console PIN…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ChannelPickerDialog
        open={picker?.kind === 'invite'}
        onClose={closePicker}
        title="Send invite"
        description="The worker will receive a link to set their password and access Paneltec. Their onboarding state resets to 'awaiting first login' until they redeem the link."
        onConfirm={fireInvite}
        busy={busy}
      />
      <ChannelPickerDialog
        open={picker?.kind === 'reset'}
        onClose={closePicker}
        title="Send reset link"
        description="The worker will receive a link to choose a new password. Their current password keeps working until they redeem the link."
        onConfirm={fireReset}
        busy={busy}
      />
      <PinRevealModal
        pin={pin}
        inviteUrl={pinInviteUrl}
        userEmail={pinUserEmail}
        open={!!pin}
        onClose={() => { setPin(null); setPinInviteUrl(null); setPinUserEmail(null); }}
      />
      <ResetLinkRevealModal
        link={resetLink}
        userEmail={resetUserEmail}
        open={!!resetLink}
        onClose={() => { setResetLink(null); setResetUserEmail(null); }}
      />

      {/* v58.13.132av — Clear admin console PIN confirmation modal. */}
      {clearOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
          onClick={() => { if (!busy) { setClearOpen(false); setActingPin(''); } }}
          data-testid={`access-kebab-clear-admin-pin-modal-${suffix}`}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden"
          >
            <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
              <ShieldOff size={14} className="text-amber-600" />
              <h4 className="font-display text-sm font-semibold">Clear admin console PIN</h4>
            </div>
            <div className="p-5 space-y-3">
              <div className="text-[13px] text-slate-600 leading-relaxed">
                This clears the target user's admin console PIN. They'll be prompted
                to set a new one on their next unlock. Audit-logged with your user id.
              </div>
              <label className="block">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
                  Confirm with your own admin console PIN
                </div>
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={4}
                  autoFocus
                  value={actingPin}
                  onKeyDown={(e) => {
                    // v58.13.132ax — swallow non-digit typed keys so
                    // even a "12ab34" paste can't survive to submit.
                    const allow = new Set([
                      'Backspace', 'Delete', 'ArrowLeft', 'ArrowRight',
                      'Tab', 'Home', 'End', 'Enter',
                    ]);
                    if (allow.has(e.key)) return;
                    if (e.metaKey || e.ctrlKey) return;
                    if (!/^\d$/.test(e.key)) e.preventDefault();
                  }}
                  onChange={(e) => setActingPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  data-testid={`access-kebab-clear-admin-pin-acting-${suffix}`}
                  className="w-full px-3 py-2.5 text-lg tracking-[0.5em] text-center font-mono border border-slate-300 rounded-lg focus:ring-2 focus:ring-amber-500/25 focus:border-amber-500 outline-none"
                />
              </label>
              <div className="text-[11px] text-slate-500 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                Wrong attempts count against the same 3/30s + 6/15min lockout as the
                header unlock. If you haven't set your own admin console PIN yet, do
                that first in your <span className="font-semibold">Profile → Admin console PIN</span>.
              </div>
            </div>
            <div className="px-5 py-3 border-t border-slate-100 flex justify-end gap-2">
              <button
                onClick={() => { setClearOpen(false); setActingPin(''); }}
                disabled={busy}
                data-testid={`access-kebab-clear-admin-pin-cancel-${suffix}`}
                className="px-3 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={fireClearAdminPin}
                disabled={busy || !/^\d{4}$/.test(actingPin)}
                data-testid={`access-kebab-clear-admin-pin-confirm-${suffix}`}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 disabled:opacity-50"
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : <ShieldOff size={14} />}
                Clear PIN
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
