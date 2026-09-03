// Phase 4.7.3 — Comms Safe Mode admin page.
//
// Shows the current effective mode (env-locked vs org-overridable), a toggle
// (admin only, disabled when env locks it), and a chronological list of the
// most recent blocked email/SMS messages so the admin can audit what would
// have been delivered.
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Zap, Mail, MessageSquare, Lock, ChevronRight } from 'lucide-react';
import api, { apiError } from '../lib/api';
import { PageHeader } from '../components/capture/Ui';
import HowThisWorks from '../components/help/HowThisWorks';

const CHANNEL_ICON = { email: Mail, sms: MessageSquare };

export default function CommsSafeMode() {
  const [status, setStatus] = useState(null);
  const [blocked, setBlocked] = useState({ items: [], count: 0 });
  const [channelF, setChannelF] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const [s, b] = await Promise.all([
        api.get('/admin/comms-safe-mode/status'),
        api.get(`/admin/comms-outbox-blocked${channelF ? `?channel=${channelF}` : ''}`),
      ]);
      setStatus(s.data);
      setBlocked(b.data);
    } catch (e) { toast.error(apiError(e)); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [channelF]);

  const toggle = async (mode) => {
    if (status?.env_locked) {
      toast.error('Locked by env var — contact your operator.');
      return;
    }
    setBusy(true);
    try {
      await api.patch('/admin/comms-safe-mode', { mode });
      toast.success(`Comms Safe Mode set to ${mode.toUpperCase()}`);
      await load();
    } catch (e) {
      // v58.7.1 — Defensive: if the backend rejects with 423 (env
      // locked between load and click) surface the same toast as the
      // pre-check above so the user isn't left wondering.
      const code = e?.response?.status;
      if (code === 423) toast.error('Locked by env var — contact your operator.');
      else toast.error(apiError(e));
    }
    finally { setBusy(false); }
  };

  const eff = status?.effective || 'on';
  const locked = !!status?.env_locked;

  return (
    <div data-testid="comms-safe-mode-page">
      <PageHeader title="Comms Safe Mode" subtitle="Outbound email and SMS kill switch." />

      <HowThisWorks schematicSlug="comms_safe_mode" />

      <div className={`mb-6 rounded-2xl border p-5 flex items-start gap-4 ${
        eff === 'on'
          ? 'bg-amber-50 border-amber-200'
          : 'bg-emerald-50 border-emerald-200'
      }`}>
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
          eff === 'on' ? 'bg-amber-200 text-amber-800' : 'bg-emerald-200 text-emerald-800'
        }`}>
          <Zap size={20} className={eff === 'on' ? 'fill-amber-600 text-amber-600' : ''} />
        </div>
        <div className="flex-1">
          <div className="font-display text-lg font-semibold text-slate-900">
            Safe Mode is {eff === 'on' ? 'ON' : 'OFF'}
          </div>
          <div className="text-sm text-slate-600 mt-1">
            {eff === 'on'
              ? 'Outbound email and SMS are being CAPTURED for review but NOT delivered. Toggle off when you\'re ready to send to real recipients.'
              : 'Outbound email and SMS are being delivered normally via M365 / TextMagic.'}
          </div>
          {locked && (
            <div className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 bg-slate-200 px-2 py-0.5 rounded-md" data-testid="env-lock-pill">
              <Lock size={11} /> Locked by env var (operator-controlled)
            </div>
          )}
          {/* v58.7.1 — Prominent lock banner ABOVE the toggle buttons.
              The old small pill was too easy to miss; users would
              click the greyed-out buttons and get no visible feedback.
              This banner spells out both the "why" (env var) and the
              "how" (ask operator) in one row. */}
          {locked && (
            <div className="mt-3 rounded-xl border border-slate-300 bg-slate-100 p-3 flex items-start gap-2 text-sm text-slate-800"
                 data-testid="env-lock-banner">
              <Lock size={16} className="mt-0.5 shrink-0 text-slate-600" />
              <span>
                <span className="font-semibold">Toggle is locked at the environment level.</span>
                {' '}Ask your operator to lift the lock before changing this setting.
              </span>
            </div>
          )}
          <div className="mt-3 flex gap-2">
            <button onClick={() => toggle('on')} disabled={busy || locked || eff === 'on'}
              data-testid="safe-mode-toggle-on"
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-500 hover:bg-amber-600 text-white disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-amber-500">
              Turn Safe Mode ON
            </button>
            <button
              onClick={() => {
                // v58.13.88 — confirmation modal before turning OFF.
                // Turning ON is always safe; turning OFF opens the door.
                if (!window.confirm(
                  'Turn Safe Mode OFF?\n\n' +
                  'This will allow real emails and SMS to be sent to real recipients from ' +
                  'every legitimate Send button in the app.\n\n' +
                  'Recommended: only turn OFF for the bounded window you need to send, ' +
                  'then turn ON again.\n\n' +
                  'Continue?'
                )) return;
                toggle('off');
              }}
              disabled={busy || locked || eff === 'off'}
              data-testid="safe-mode-toggle-off"
              className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent">
              Turn Safe Mode OFF…
            </button>
          </div>
          {status && (
            <div className="mt-2 text-[11px] text-slate-500">
              env: <span className="font-mono">{status.env_value}</span> · org: <span className="font-mono">{status.org_value}</span> · effective: <span className="font-mono font-semibold">{status.effective}</span>
            </div>
          )}
          {/* v58.13.88 — plain-English "what does this affect" panel */}
          <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700">
            <div className="font-semibold text-slate-900 mb-1">What Safe Mode affects</div>
            <div className="text-xs text-slate-600 leading-relaxed">
              <span className="font-semibold text-slate-800">Blocks:</span> Microsoft 365 outbound email and TextMagic outbound SMS.<br/>
              <span className="font-semibold text-slate-800">Does NOT block:</span> in-app notifications (bell), Simpro sync, Navixy GPS, MongoDB, the app itself, or any read-only feature.<br/>
              <span className="mt-2 block"><span className="font-semibold text-slate-800">Keep it ON</span> when testing, doing dev work, running imports, or when you're not actively sending comms.</span>
              <span className="block"><span className="font-semibold text-slate-800">Turn it OFF</span> when you're about to click Send Invite / Send Reminder / Send Renewal, then turn back ON.</span>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white">
        <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between flex-wrap gap-2">
          <div>
            <h3 className="font-display text-lg font-semibold text-slate-900">Blocked outbox</h3>
            <p className="text-xs text-slate-500">Recent messages that were held back. Most-recent first.</p>
          </div>
          <div className="flex items-center gap-2">
            <select value={channelF} onChange={(e) => setChannelF(e.target.value)}
              data-testid="blocked-channel-filter"
              className="text-sm border border-slate-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-orange-200">
              <option value="">All channels</option>
              <option value="email">Email</option>
              <option value="sms">SMS</option>
            </select>
            <span className="text-xs text-slate-500" data-testid="blocked-count">{blocked.count} blocked</span>
            {blocked.count > 0 ? (
              <button
                type="button"
                data-testid="blocked-clear-btn"
                disabled={busy}
                onClick={async () => {
                  if (!window.confirm(
                    `Clear ${blocked.count} blocked ${channelF || 'email/sms'} row(s) from the outbox? This cannot be undone.`
                  )) return;
                  setBusy(true);
                  try {
                    const { data } = await api.delete(
                      `/admin/comms-outbox-blocked${channelF ? `?channel=${channelF}` : ''}`
                    );
                    toast.success(`Cleared ${data?.deleted ?? 0} blocked row(s)`);
                    await load();
                  } catch (e) { toast.error(apiError(e)); }
                  finally { setBusy(false); }
                }}
                className="text-xs px-2.5 py-1.5 rounded-md border border-rose-300 text-rose-700 bg-rose-50 hover:bg-rose-100 disabled:opacity-50"
              >
                Clear
              </button>
            ) : null}
          </div>
        </div>
        {blocked.items.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500" data-testid="blocked-empty">
            Nothing blocked yet. Once Safe Mode catches a send, it will appear here.
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {blocked.items.map((b) => {
              const Icon = CHANNEL_ICON[b.channel] || Mail;
              return (
                <li key={b.id} className="p-4 hover:bg-slate-50" data-testid={`blocked-row-${b.id}`}>
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-800 flex items-center justify-center flex-shrink-0">
                      <Icon size={14} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] uppercase tracking-wider font-bold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">{b.channel}</span>
                        <span className="text-sm font-medium text-slate-900 truncate">
                          {b.subject || (b.channel === 'sms' ? '(SMS — no subject)' : '(no subject)')}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 mt-1 truncate">
                        to <span className="font-mono">{(b.to || []).join(', ')}</span>
                      </div>
                      <div className="text-[11px] text-slate-400 mt-1">
                        {new Date(b.ts).toLocaleString()} · endpoint: <span className="font-mono">{b.triggered_by_endpoint}</span>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* v58.13.88 — clear CTA replaces the italic "Looking for the live outbox?" line. */}
      <div className="mt-6 flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4">
        <div className="text-sm text-slate-700">
          <div className="font-semibold text-slate-900">Want to see queued or sent messages?</div>
          <div className="text-xs text-slate-500 mt-0.5">The full outbox lists every email/SMS the app has queued, sent, blocked, or cancelled.</div>
        </div>
        <Link to="/app/email/outbox" data-testid="open-outbox-cta"
          className="shrink-0 inline-flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-white">
          Open Outbox <ChevronRight size={12} />
        </Link>
      </div>

      {/* v58.13.88 — Belt-and-braces reassurance note. */}
      <div className="mt-4 text-[11px] text-slate-400 leading-relaxed">
        Even with Safe Mode OFF, the app architecturally prevents automatic sends. Every outbound
        message requires a live authenticated user action on the call stack — see v58.13.86-.87 changelogs
        (Path A / B / C deletions + ContextVar gate).
      </div>
    </div>
  );
}
