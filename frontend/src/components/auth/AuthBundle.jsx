// Phase 4.7 — bundle of small auth UI components shared by Login + Profile + Users admin.
import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import api, { apiError } from '@/lib/api';
import { copyToClipboard } from '@/lib/clipboard';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { passwordRuleError, passwordStrength } from '@/lib/passwordRules';

const API_BASE = (process.env.REACT_APP_BACKEND_URL || '') + '/api';

function StrengthBar({ value }) {
  const s = passwordStrength(value);
  const cls = ['bg-rose-500','bg-orange-400','bg-amber-400','bg-emerald-500','bg-emerald-600'][s.score] || 'bg-slate-200';
  return (
    <div className="mt-1.5" data-testid="pw-strength">
      <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
        <div className={`h-full ${cls} transition-all`} style={{ width: `${(s.score+1)*20}%` }} />
      </div>
      <div className="text-[11px] mt-1 text-slate-500">Strength: <strong>{s.label}</strong> · Min 10 chars, 1 letter + 1 digit + 1 special</div>
    </div>
  );
}

// ───── Forgot-password modal (link on Login page) ────────────────────
export function ForgotPasswordModal({ open, onClose }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e?.preventDefault();
    if (!email) { toast.error('Enter your email.'); return; }
    setBusy(true);
    try {
      await axios.post(`${API_BASE}/auth/forgot-password`, { email });
      toast.success("If that email is on file, we've sent a reset link.");
      onClose?.();
      setEmail('');
    } catch { toast.success("If that email is on file, we've sent a reset link."); onClose?.(); }
    finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose?.()}>
      <DialogContent className="max-w-md" data-testid="forgot-modal">
        <DialogHeader>
          <DialogTitle className="font-display">Forgot your password?</DialogTitle>
          <DialogDescription>Enter the email on your Paneltec account and we&rsquo;ll send a reset link.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3 pt-2">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            autoFocus required data-testid="forgot-email" placeholder="you@example.com"
            className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200 focus:border-orange-400" />
          <DialogFooter>
            <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-100">Cancel</button>
            <button type="submit" disabled={busy} data-testid="forgot-submit"
              className="px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold disabled:opacity-60">
              {busy ? 'Sending…' : 'Send reset link'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ───── Change Password modal (Profile dropdown + must-change guard) ─
export function ChangePasswordModal({ open, onClose, locked = false, onChanged }) {
  // `locked` removes the close button — used by MustChangePasswordGuard.
  const [cur, setCur] = useState('');
  const [pw, setPw] = useState('');
  const [cf, setCf] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e?.preventDefault();
    const err = passwordRuleError(pw);
    if (err) { toast.error(err); return; }
    if (pw !== cf) { toast.error("Passwords don't match."); return; }
    setBusy(true);
    try {
      await api.post('/auth/change-password',
        { current_password: cur, new_password: pw, confirm_password: cf });
      toast.success('Password changed. Other sessions have been signed out.');
      setCur(''); setPw(''); setCf('');
      onChanged?.();
      if (!locked) onClose?.();
    } catch (ex) { toast.error(apiError(ex)); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!locked && !v) onClose?.(); }}>
      <DialogContent className="max-w-md" data-testid="change-pw-modal"
        onPointerDownOutside={(e) => locked && e.preventDefault()}
        onEscapeKeyDown={(e) => locked && e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="font-display">{locked ? 'Set a new password' : 'Change password'}</DialogTitle>
          <DialogDescription>
            {locked
              ? 'Your admin requires you to choose a new password before you can use the app.'
              : 'You will be signed out of other browsers and devices on success.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3 pt-2">
          <div>
            <label className="block text-xs font-semibold text-slate-600">Current password</label>
            <input type="password" value={cur} onChange={(e) => setCur(e.target.value)}
              autoFocus required data-testid="pw-current"
              className="w-full mt-1 rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200 focus:border-orange-400" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600">New password</label>
            <input type="password" value={pw} onChange={(e) => setPw(e.target.value)}
              required data-testid="pw-new"
              className="w-full mt-1 rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200 focus:border-orange-400" />
            <StrengthBar value={pw} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600">Confirm</label>
            <input type="password" value={cf} onChange={(e) => setCf(e.target.value)}
              required data-testid="pw-confirm"
              className="w-full mt-1 rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200 focus:border-orange-400" />
          </div>
          <DialogFooter>
            {!locked && (
              <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-100">Cancel</button>
            )}
            <button type="submit" disabled={busy} data-testid="change-pw-submit"
              className="px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold disabled:opacity-60">
              {busy ? 'Saving…' : 'Change password'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ───── MustChangePasswordGuard ───────────────────────────────────────
// Reads `must_change_password` from `/api/me` and pins a non-dismissable
// ChangePasswordModal over the app until the user complies.
export function MustChangePasswordGuard({ children }) {
  const [must, setMust] = useState(false);
  const refresh = async () => {
    try {
      const { data } = await api.get('/auth/me');
      setMust(!!data?.must_change_password);
    } catch { setMust(false); }
  };
  useEffect(() => { refresh(); }, []);
  return (
    <>
      {children}
      <ChangePasswordModal open={must} locked
        onChanged={() => { setMust(false); refresh(); }} />
    </>
  );
}


// ───── Channel picker (invite + reset password) ─────────────────────
// Phase 4.7.1 — backend's `/users/{id}/invite` and `/reset-password` both
// accept `{ channel: "email" | "sms" | "auto" }`. Surfacing the choice in a
// tiny dialog (rather than auto-firing) makes intent explicit and lets the
// admin steer (e.g. fall back to SMS for a worker with no email on file).
export function ChannelPickerDialog({ open, onClose, title, description, confirmLabel, onConfirm, busy }) {
  const fire = async (channel) => {
    await onConfirm?.(channel);
  };
  return (
    <Dialog open={open} onOpenChange={(v) => !v && !busy && onClose?.()}>
      <DialogContent className="max-w-sm" data-testid="channel-picker">
        <DialogHeader>
          <DialogTitle className="font-display">{title || 'Send'}</DialogTitle>
          <DialogDescription>
            {description || 'Choose how to deliver this link.'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 pt-1">
          <button type="button" onClick={() => fire('auto')} disabled={busy}
            data-testid="channel-pick-auto"
            className="w-full text-left px-4 py-3 rounded-lg border-2 border-orange-200 bg-orange-50 hover:border-orange-400 hover:bg-orange-100 transition disabled:opacity-60">
            <div className="text-sm font-semibold text-slate-900">Auto <span className="ml-1.5 text-[10px] uppercase tracking-wider font-bold text-orange-700 bg-orange-200 px-1.5 py-0.5 rounded">Recommended</span></div>
            <div className="text-xs text-slate-600 mt-0.5">Try email first, fall back to SMS.</div>
          </button>
          <button type="button" onClick={() => fire('email')} disabled={busy}
            data-testid="channel-pick-email"
            className="w-full text-left px-4 py-2.5 rounded-lg border border-slate-200 hover:border-slate-400 hover:bg-slate-50 disabled:opacity-60">
            <div className="text-sm font-semibold text-slate-900">Email only</div>
            <div className="text-xs text-slate-500 mt-0.5">Skip SMS even if the worker has a phone.</div>
          </button>
          <button type="button" onClick={() => fire('sms')} disabled={busy}
            data-testid="channel-pick-sms"
            className="w-full text-left px-4 py-2.5 rounded-lg border border-slate-200 hover:border-slate-400 hover:bg-slate-50 disabled:opacity-60">
            <div className="text-sm font-semibold text-slate-900">SMS only</div>
            <div className="text-xs text-slate-500 mt-0.5">Useful for field workers without email.</div>
          </button>
        </div>
        <DialogFooter className="pt-2">
          <button type="button" onClick={onClose} disabled={busy}
            className="px-3 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-60">Cancel</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


// ───── PIN reveal modal (used inside AccessSection) ─────────────────
// v58.13.132bb — Extended: shows the mobile onboarding install link
// alongside the PIN and provides Copy PIN / Copy invite link /
// Email me buttons. `comms_safe_mode` blocks the auto-email path,
// so admins now have a manual delivery path built in.
export function PinRevealModal({ pin, inviteUrl, userEmail, open, onClose }) {
  const copyPin = () => {
    copyToClipboard(pin || '', { successMsg: 'PIN copied to clipboard' });
  };
  const copyLink = () => {
    copyToClipboard(inviteUrl || '', { successMsg: 'Invite link copied to clipboard' });
  };
  const emailMe = () => {
    // Opens the admin's default mailer with a pre-filled draft they
    // can forward manually — never sends via our backend, so it
    // slides past comms_safe_mode without touching M365.
    const subject = encodeURIComponent('Your Paneltec Civil access');
    const body = encodeURIComponent(
      `Hi,\n\n`
      + `Your one-time PIN for Paneltec Civil Field is: ${pin}\n`
      + (inviteUrl
        ? `\nOpen this link on your phone to install / sign in:\n${inviteUrl}\n`
        : '')
      + `\nThe PIN is valid for 24 hours.\n\nPaneltec Civil`
    );
    const to = userEmail ? encodeURIComponent(userEmail) : '';
    window.location.href = `mailto:${to}?subject=${subject}&body=${body}`;
  };
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose?.()}>
      <DialogContent className="max-w-md text-center" data-testid="pin-modal">
        <DialogHeader>
          <DialogTitle className="font-display">One-time PIN</DialogTitle>
          <DialogDescription>
            Read this aloud or copy it to the worker now. It can&rsquo;t be shown again — generate
            another if it&rsquo;s lost. Valid for 24 hours.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-2 mb-3">
          <div data-testid="pin-value"
            className="font-mono font-bold text-orange-600 select-all"
            style={{ fontSize: 48, letterSpacing: '0.25em' }}>
            {pin}
          </div>
        </div>
        {inviteUrl && (
          <div className="mb-3 text-left" data-testid="pin-invite-url-block">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
              Mobile install link
            </div>
            <div className="p-2 rounded-lg bg-slate-50 border border-slate-200 font-mono text-[11px] text-slate-700 break-all select-all"
                 data-testid="pin-invite-url">
              {inviteUrl}
            </div>
          </div>
        )}
        <DialogFooter className="sm:justify-center gap-2 flex-wrap">
          <button type="button" onClick={copyPin} data-testid="pin-copy"
            className="px-3 py-2 rounded-lg text-sm font-medium text-slate-700 border border-slate-300 hover:bg-slate-50">
            Copy PIN
          </button>
          {inviteUrl && (
            <button type="button" onClick={copyLink} data-testid="pin-copy-link"
              className="px-3 py-2 rounded-lg text-sm font-medium text-slate-700 border border-slate-300 hover:bg-slate-50">
              Copy invite link
            </button>
          )}
          <button type="button" onClick={emailMe} data-testid="pin-email-me"
            className="px-3 py-2 rounded-lg text-sm font-medium text-slate-700 border border-slate-300 hover:bg-slate-50">
            Email me this info
          </button>
          <button type="button" onClick={onClose} data-testid="pin-confirm"
            className="px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold">
            I&rsquo;ve recorded this
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// v58.13.132bb — Reset link reveal modal. Same shape as PinRevealModal
// but shows just the reset URL — no PIN. Used after `send_reset`
// succeeds so the admin can copy or email the link manually while
// comms_safe_mode is on.
export function ResetLinkRevealModal({ link, userEmail, open, onClose }) {
  const copyLink = () => {
    copyToClipboard(link || '', { successMsg: 'Reset link copied to clipboard' });
  };
  const emailMe = () => {
    const subject = encodeURIComponent('Reset your Paneltec Civil password');
    const body = encodeURIComponent(
      `Hi,\n\nOpen this link to reset your Paneltec Civil password (valid 24 h):\n\n${link}\n\nPaneltec Civil`
    );
    const to = userEmail ? encodeURIComponent(userEmail) : '';
    window.location.href = `mailto:${to}?subject=${subject}&body=${body}`;
  };
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose?.()}>
      <DialogContent className="max-w-md" data-testid="reset-link-modal">
        <DialogHeader>
          <DialogTitle className="font-display">Reset link ready</DialogTitle>
          <DialogDescription>
            Comms Safe Mode is on — the automatic email may not have been delivered. Copy this
            link and hand it to the worker, or open your mailer to forward it. Valid for 24 hours.
          </DialogDescription>
        </DialogHeader>
        <div className="my-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
            Password reset URL
          </div>
          <div className="p-2 rounded-lg bg-slate-50 border border-slate-200 font-mono text-[11px] text-slate-700 break-all select-all"
               data-testid="reset-link-value">
            {link}
          </div>
        </div>
        <DialogFooter className="sm:justify-center gap-2 flex-wrap">
          <button type="button" onClick={copyLink} data-testid="reset-link-copy"
            className="px-3 py-2 rounded-lg text-sm font-medium text-slate-700 border border-slate-300 hover:bg-slate-50">
            Copy reset link
          </button>
          <button type="button" onClick={emailMe} data-testid="reset-link-email-me"
            className="px-3 py-2 rounded-lg text-sm font-medium text-slate-700 border border-slate-300 hover:bg-slate-50">
            Email me this info
          </button>
          <button type="button" onClick={onClose} data-testid="reset-link-close"
            className="px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold">
            Done
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
