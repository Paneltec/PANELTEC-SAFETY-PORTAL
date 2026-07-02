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
      toast.error('Env var COMMS_SAFE_MODE is locked ON. Ask your operator to lift the lock.');
      return;
    }
    setBusy(true);
    try {
      await api.patch('/admin/comms-safe-mode', { mode });
      toast.success(`Comms Safe Mode set to ${mode.toUpperCase()}`);
      await load();
    } catch (e) { toast.error(apiError(e)); }
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
          <div className="mt-3 flex gap-2">
            <button onClick={() => toggle('on')} disabled={busy || locked || eff === 'on'}
              data-testid="safe-mode-toggle-on"
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-500 hover:bg-amber-600 text-white disabled:opacity-50 disabled:cursor-not-allowed">
              Turn ON
            </button>
            <button onClick={() => toggle('off')} disabled={busy || locked || eff === 'off'}
              data-testid="safe-mode-toggle-off"
              className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed">
              Turn OFF
            </button>
          </div>
          {status && (
            <div className="mt-2 text-[11px] text-slate-500">
              env: <span className="font-mono">{status.env_value}</span> · org: <span className="font-mono">{status.org_value}</span> · effective: <span className="font-mono font-semibold">{status.effective}</span>
            </div>
          )}
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

      <div className="mt-4 text-xs text-slate-500">
        Looking for the live outbox? <Link to="/app/email/outbox" className="text-orange-600 hover:underline inline-flex items-center gap-0.5">Email outbox <ChevronRight size={11} /></Link>
      </div>
    </div>
  );
}
