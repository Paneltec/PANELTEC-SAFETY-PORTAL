// Phase 4.7.1 — shared access-actions kebab.
//
// Surfaces Send invite / Reset password / Generate PIN / Unlock for a given
// user_id. Invite + reset open a `ChannelPickerDialog` first so the admin
// can pick email / SMS / auto — wiring matches the backend's required
// `channel` field on `/users/{id}/invite` and `/users/{id}/reset-password`.
//
// Lives in `components/auth/` so the Users admin AND the Workers list can
// import it (the latter passes the linked user_id discovered by email
// match — see Workers.jsx).
import React, { useState } from 'react';
import { toast } from 'sonner';
import { MoreVertical } from 'lucide-react';
import api, { apiError } from '@/lib/api';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { ChannelPickerDialog, PinRevealModal } from '@/components/auth/AuthBundle';

export default function AccessKebab({ userId, canEdit = true, onAfterAction, testIdSuffix }) {
  // `picker` is null | { kind: 'invite' | 'reset' }
  const [picker, setPicker] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pin, setPin] = useState(null);
  const suffix = testIdSuffix || userId;

  const closePicker = () => setPicker(null);

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
      onAfterAction?.();
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };

  const firePin = async () => {
    setBusy(true);
    try {
      const { data } = await api.post(`/users/${userId}/pin`);
      setPin(data?.pin);
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

  if (!canEdit) return null;

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
        </DropdownMenuContent>
      </DropdownMenu>

      <ChannelPickerDialog
        open={picker?.kind === 'invite'}
        onClose={closePicker}
        title="Send invite link"
        description="The worker will receive a one-tap link to set their password and sign in. Choose how to deliver it."
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
      <PinRevealModal pin={pin} open={!!pin} onClose={() => setPin(null)} />
    </>
  );
}
