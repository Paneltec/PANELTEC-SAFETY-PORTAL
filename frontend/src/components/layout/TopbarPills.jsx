// Phase 4.16 (paneltec-v133) — Tech-aesthetic top-bar pills + rich user
// dropdown card. Split into its own file so AppShell.jsx stays focused
// on layout wiring. Consumed by <TopBar /> in AppShell.
import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import api from '../../lib/api';
import { runSwVersionGuard } from '@/lib/swVersionGuard';
import {
  DatabaseArrowUp20Regular, Pulse20Regular, Person20Regular, Mail20Regular,
  Phone20Regular, Warning20Regular, KeyMultiple20Regular, People20Regular,
  Broom20Regular, SignOut20Regular, ArrowRight16Regular,
} from '@fluentui/react-icons';

// ─────────────────────── Pills ───────────────────────

const DOT_TONES = {
  up:    { chip: 'bg-slate-900 text-emerald-300 border-emerald-500/40', dot: 'bg-emerald-500 shadow-[0_0_10px_2px_rgba(16,185,129,0.6)]' },
  amber: { chip: 'bg-slate-900 text-amber-300 border-amber-500/40',      dot: 'bg-amber-500 shadow-[0_0_10px_2px_rgba(245,158,11,0.6)]' },
  down:  { chip: 'bg-slate-900 text-rose-300 border-rose-500/40',        dot: 'bg-rose-500 shadow-[0_0_10px_2px_rgba(244,63,94,0.6)]' },
};

// Phase 4.18.2 v141 — each integration row in the popover deep-links to its
// admin config page. MongoDB is infrastructure — leave it non-clickable so
// users don't accidentally hunt for a page that doesn't exist.
const INTEGRATION_ROUTES = {
  simpro: '/app/settings/integrations/simpro',
  navixy: '/app/settings/integrations/navixy',
  m365: '/app/settings/integrations/microsoft365',
  textmagic: '/app/settings/integrations/textmagic',
};

export function ApiHealthPill() {
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () => api.get('/health/integrations').then((r) => alive && setData(r.data)).catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  const status = !data ? 'amber' : (data.counts.up === data.counts.total ? 'up' : (data.counts.up === 0 ? 'down' : 'amber'));
  const tone = DOT_TONES[status];
  const label = data ? `${data.counts.up}/${data.counts.total}` : '…/…';
  return (
    <div className="relative hidden md:block">
      <button
        onClick={() => setOpen((v) => !v)}
        data-testid="api-health-pill"
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-bold uppercase tracking-[0.15em] ${tone.chip}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${tone.dot}`} />
        <Pulse20Regular className="w-3 h-3 -mx-0.5" /> API · {label}
      </button>
      {open && data && (
        <div className="absolute right-0 mt-2 w-96 rounded-2xl bg-slate-950 text-slate-100 border border-orange-500/40 p-3 shadow-2xl z-40" data-testid="api-health-popover">
          <div className="text-[10px] uppercase tracking-[0.2em] text-orange-400 font-bold mb-2">Integrations</div>
          <ul className="space-y-1.5">
            {data.items.map((it) => {
              const t = DOT_TONES[it.status] || DOT_TONES.amber;
              const route = INTEGRATION_ROUTES[it.kind];
              const inner = (
                <>
                  <span className={`w-1.5 h-1.5 rounded-full ${t.dot} shrink-0`} />
                  <span className="shrink-0 font-semibold uppercase tracking-wider inline-flex items-center gap-1.5">
                    <span>{it.name}</span>
                    {it.disarmed && (
                      <span title="Deliberately disarmed by Comms Safe Mode"
                            data-testid={`api-health-disarmed-${it.kind}`}
                            className="inline-flex items-center gap-1 px-1.5 py-0 rounded border border-slate-600 bg-slate-800/60 text-slate-300 text-[9px] font-semibold tracking-wider normal-case">
                        🛡 disarmed
                      </span>
                    )}
                    {!route && it.kind === 'mongodb' && (
                      <span className="text-[9px] font-semibold text-slate-500 tracking-wider normal-case">
                        · System
                      </span>
                    )}
                  </span>
                  <span className="flex-1 min-w-0 text-slate-400 text-right truncate">{it.detail || '—'}</span>
                  {route && (
                    <ArrowRight16Regular className="shrink-0 w-3.5 h-3.5 text-slate-600 group-hover:text-orange-400 transition-colors" />
                  )}
                </>
              );
              if (!route) {
                return (
                  <li key={it.kind}
                      className="relative flex items-center gap-2 text-xs px-2 py-1 rounded-md"
                      data-testid={`api-health-row-${it.kind}`}>
                    {inner}
                  </li>
                );
              }
              return (
                <li key={it.kind} data-testid={`api-health-row-${it.kind}`}>
                  <Link
                    to={route}
                    onClick={() => setOpen(false)}
                    data-testid={`api-health-link-${it.kind}`}
                    className="group relative flex items-center gap-2 text-xs px-2 py-1 rounded-md
                               hover:bg-slate-900/50 transition-colors
                               before:absolute before:left-0 before:top-1 before:bottom-1 before:w-0.5
                               before:rounded-full before:bg-orange-500 before:opacity-0
                               hover:before:opacity-100 before:transition-opacity"
                  >
                    {inner}
                  </Link>
                </li>
              );
            })}
          </ul>
          {data.comms_safe_mode === 'on' && (
            <div className="mt-3 px-2 py-1.5 rounded-md bg-amber-950/40 border border-amber-700/40 text-[10px] text-amber-300 leading-snug"
                 data-testid="api-health-safe-mode-note">
              Comms Safe Mode is <span className="font-bold">ON</span> — outbound
              email & SMS integrations show red on purpose. They'll re-arm the
              moment safe mode is lifted.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function BackupPill() {
  // v156 (v155.1 backlog) — Pill now consumes /api/backup/summary, the
  // same aggregator the Backup Admin Hero uses. This guarantees the pill
  // number, colour and tooltip stay in lock-step with the admin page —
  // no more "top-bar says amber, admin says green" confusion.
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () => api.get('/backup/summary')
      .then((r) => alive && setData(r.data))
      .catch(() => {});
    load();
    const t = setInterval(load, 60000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  // Map Hero palette → pill tone. Hero uses 4 states; the pill only has
  // 3 tones so `setup` collapses to amber (the operator still needs to
  // finish wiring the LAN agent — amber is the correct urgency signal).
  const HEALTH_TO_TONE = {
    healthy:   'up',
    attention: 'amber',
    down:      'down',
    setup:     'amber',
  };
  const status = HEALTH_TO_TONE[data?.health] || 'amber';
  const tone = DOT_TONES[status];

  const humanSize = (bytes) => {
    if (!bytes && bytes !== 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  };
  const humanAgo = (iso) => {
    if (!iso) return 'never';
    const d = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (d < 60) return `${Math.round(d)}s ago`;
    if (d < 3600) return `${Math.round(d/60)}m ago`;
    if (d < 86400) return `${Math.round(d/3600)}h ago`;
    return `${Math.round(d/86400)}d ago`;
  };
  const humanFuture = (iso) => {
    if (!iso) return '—';
    const ms = new Date(iso).getTime() - Date.now();
    if (ms <= 0) return 'imminent';
    if (ms < 3600_000) return `in ${Math.round(ms / 60_000)} min`;
    if (ms < 86400_000) return `in ${(ms / 3600_000).toFixed(1)} h`;
    return `in ${(ms / 86400_000).toFixed(1)} d`;
  };

  const snap = data?.last_snapshot;
  const deliv = data?.last_delivery;
  const detailBits = [];
  if (snap?.created_at) detailBits.push(`Last snap ${humanAgo(snap.created_at)}`);
  if (snap?.size) detailBits.push(humanSize(snap.size));
  if (deliv?.received_at) {
    const dst = deliv.dest_name ? ` → ${deliv.dest_name}` : '';
    detailBits.push(`Delivered ${humanAgo(deliv.received_at)}${dst}`);
  } else {
    detailBits.push('LAN idle');
  }

  return (
    <div className="relative hidden lg:block">
      <button
        onClick={() => setOpen((v) => !v)}
        data-testid="backup-pill"
        title={data?.health_reason || detailBits.join(' · ')}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-bold uppercase tracking-[0.15em] transition-transform duration-200 hover:-translate-y-0.5 ${tone.chip}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${tone.dot}`} />
        <DatabaseArrowUp20Regular className="w-3 h-3 -mx-0.5" /> Backup
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-96 rounded-2xl bg-slate-950 text-slate-100 border border-orange-500/40 p-3 shadow-2xl z-40 animate-fade-up" data-testid="backup-popover">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] uppercase tracking-[0.2em] text-orange-400 font-bold">Backup summary</div>
            <div className={`text-[10px] font-semibold uppercase tracking-wider ${
              status === 'up' ? 'text-emerald-300'
              : status === 'down' ? 'text-rose-300'
              : 'text-amber-300'
            }`} data-testid="backup-pill-status">
              {data?.health || '…'}
            </div>
          </div>

          {!data && <div className="text-xs text-slate-400 px-2 py-2">Loading…</div>}

          {data && (
            <div className="space-y-2">
              {data.health_reason && (
                <div className="px-2 py-1.5 rounded-md bg-slate-900/60 border border-slate-800 text-[11px] text-slate-300 leading-snug"
                     data-testid="backup-pill-reason">
                  {data.health_reason}
                </div>
              )}

              <div className="grid grid-cols-1 gap-1.5 px-1">
                <SummaryRow label="Last snapshot" testid="backup-pill-last-snap"
                  value={snap?.created_at ? `${humanAgo(snap.created_at)}` : '—'}
                  sub={snap?.size ? `${humanSize(snap.size)}${snap.total_documents ? ` · ${snap.total_documents.toLocaleString()} docs` : ''}` : ''}/>
                <SummaryRow label="Last delivery" testid="backup-pill-last-delivery"
                  value={deliv?.received_at ? humanAgo(deliv.received_at) : 'never'}
                  sub={deliv?.dest_name ? `→ ${deliv.dest_name}${deliv.agent_name ? ` via ${deliv.agent_name}` : ''}` : ''}/>
                <SummaryRow label="Next snapshot" testid="backup-pill-next"
                  value={humanFuture(data.next_snapshot_at)}
                  sub={`${data.agent_count || 0} agent${data.agent_count === 1 ? '' : 's'} · ${data.destination_count || 0} destination${data.destination_count === 1 ? '' : 's'}`}/>
              </div>
            </div>
          )}

          <Link
            to="/app/settings/backup"
            onClick={() => setOpen(false)}
            data-testid="backup-admin-link"
            className="mt-3 group inline-flex items-center gap-1 text-[11px] font-semibold text-orange-300 hover:text-orange-200"
          >
            Open backup admin
            <ArrowRight16Regular className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
          </Link>
        </div>
      )}
    </div>
  );
}

// Compact key/value row used inside the Backup pill popover (v156).
function SummaryRow({ label, value, sub, testid }) {
  return (
    <div className="flex items-baseline gap-2 px-2 py-1 rounded-md hover:bg-slate-900/60" data-testid={testid}>
      <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 w-24 shrink-0">{label}</span>
      <span className="flex-1 min-w-0">
        <span className="text-xs text-slate-100 font-semibold tabular-nums">{value}</span>
        {sub && <span className="block text-[10px] text-slate-500 truncate">{sub}</span>}
      </span>
    </div>
  );
}

// ─────────────────────── Rich user dropdown card ───────────────────────

const TIMEOUT_OPTIONS = [
  { v: 15,      label: '15 min' },
  { v: 60,      label: '1 hour' },
  { v: 240,     label: '4 hours' },
  { v: 720,     label: '12 hours · default' },
  { v: 1440,    label: '24 hours' },
  { v: 10080,   label: '7 days · extended' },
];

function timeAgo(iso) {
  if (!iso) return '—';
  const diff = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return 'JUST NOW';
  if (diff < 3600) return `${Math.round(diff / 60)} MIN AGO`;
  if (diff < 86400) return `${Math.round(diff / 3600)} HR AGO`;
  return `${Math.round(diff / 86400)} D AGO`;
}

export function UserDropdownCard({ user, onChangePassword, onSignOut, onNavigate }) {
  const [timeoutMin, setTimeoutMin] = useState(720);
  const [alertMode, setAlertMode] = useState('both');
  const [safeMode, setSafeMode] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/settings/session-timeout/me').then((r) => setTimeoutMin(r.data?.effective_minutes || 720)).catch(() => {});
    api.get('/me/suspicious-alerts').then((r) => setAlertMode(r.data?.mode || 'both')).catch(() => {});
    api.get('/admin/comms-safe-mode/status').then((r) => setSafeMode(r.data)).catch(() => {});
  }, []);

  const saveTimeout = async () => {
    setBusy(true);
    try {
      await api.patch('/settings/session-timeout/me', { minutes: timeoutMin });
      toast.success('Session timeout updated');
    } catch (_) { toast.error('Could not save'); } finally { setBusy(false); }
  };

  const setAlerts = async (mode) => {
    setAlertMode(mode);
    try { await api.patch('/me/suspicious-alerts', { mode }); }
    catch (_) { toast.error('Could not save alert preference'); }
  };

  const clearCache = useCallback(async () => {
    if (!window.confirm('This will clear all local caches and reload. Any unsaved work will be lost.')) return;
    try { await runSwVersionGuard({ force: true }); } catch (_) { /* noop */ }
    try {
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch (_) { /* noop */ }
    window.location.reload();
  }, []);

  const role = (user?.role || 'user').toUpperCase();
  const initials = ((user?.name || user?.email || '?')
    .split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((s) => s[0]).join('') || '?').toUpperCase();

  return (
    <div className="text-slate-100" data-testid="user-dropdown-card">
      {/* Header */}
      <div className="px-5 pt-5 pb-4 border-b border-slate-800/80">
        <div className="flex items-center gap-3">
          <div className="grid place-items-center w-14 h-14 rounded-full bg-orange-500 text-white text-lg font-bold shadow-lg">{initials}</div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold tracking-wider uppercase truncate">{user?.name || user?.email || 'You'}</div>
            <div className="text-[11px] text-slate-400 truncate">{user?.email}</div>
            <div className="mt-1 flex items-center gap-2">
              <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-yellow-500 text-slate-900 text-[9px] font-bold uppercase tracking-[0.18em]" data-testid="user-role-pill">{role}</span>
              <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Last login · {timeAgo(user?.last_login_at)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Session timeout */}
      <div className="px-5 py-4 border-b border-slate-800/80">
        <div className="text-[10px] uppercase tracking-[0.2em] text-orange-400 font-bold mb-2">Session timeout</div>
        <div className="flex items-center gap-2">
          <select value={timeoutMin} onChange={(e) => setTimeoutMin(Number(e.target.value))}
            data-testid="session-timeout-select"
            className="flex-1 bg-slate-900 border border-slate-700 text-slate-100 text-xs px-2 py-1.5 rounded-md">
            {TIMEOUT_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
          </select>
          <button onClick={saveTimeout} disabled={busy}
            data-testid="session-timeout-save"
            className="px-3 py-1.5 rounded-md bg-orange-500 text-white text-[11px] font-bold uppercase tracking-wider hover:bg-orange-600 disabled:opacity-60">
            Save
          </button>
        </div>
        <p className="mt-2 text-[10px] text-slate-500">Idle sessions expire and require sign-in again. Applies to this browser.</p>
      </div>

      {/* Suspicious login alerts */}
      <div className="px-5 py-4 border-b border-slate-800/80">
        <div className="text-[10px] uppercase tracking-[0.2em] text-orange-400 font-bold mb-2">Suspicious-login alerts</div>
        <div className="grid grid-cols-4 gap-1.5" data-testid="suspicious-alerts-group">
          <AlertBtn active={alertMode === 'both'}  onClick={() => setAlerts('both')}  testid="alerts-both"><Mail20Regular /><Phone20Regular className="-ml-1" /> BOTH</AlertBtn>
          <AlertBtn active={alertMode === 'email'} onClick={() => setAlerts('email')} testid="alerts-email"><Mail20Regular /> EMAIL</AlertBtn>
          <AlertBtn active={alertMode === 'sms'}   onClick={() => setAlerts('sms')}   testid="alerts-sms"><Phone20Regular /> SMS</AlertBtn>
          <AlertBtn active={alertMode === 'off'}   onClick={() => setAlerts('off')}   testid="alerts-off">OFF</AlertBtn>
        </div>
        <p className="mt-2 text-[10px] text-slate-500 leading-relaxed">
          When a sign-in arrives from a new device or location, we&rsquo;ll ping you with a one-tap &ldquo;That wasn&rsquo;t me&rdquo; link that revokes the session and forces a password reset.
        </p>
        {safeMode?.effective === 'on' && (
          <div className="mt-2 flex items-start gap-1.5 px-2 py-1.5 rounded-md bg-amber-950/60 border border-amber-500/40 text-[10px] text-amber-200" data-testid="alerts-safe-mode-banner">
            <Warning20Regular className="text-amber-400 shrink-0" />
            Alerts captured but not delivered while Safe Mode is on. Change in Settings.
          </div>
        )}
      </div>

      {/* Quick actions */}
      <div className="py-2">
        <QuickRow icon={<KeyMultiple20Regular />} label="Change password" onClick={onChangePassword} testid="menu-change-password" />
        <QuickRow icon={<Person20Regular />}      label="My apps"          onClick={() => onNavigate('/app/settings/my-apps')} testid="menu-my-apps" />
        {(user?.role === 'admin') && (
          <QuickRow icon={<People20Regular />}    label="Users & permissions" onClick={() => onNavigate('/app/settings/users')} testid="menu-users" />
        )}
        <QuickRow icon={<Broom20Regular />}       label="Clear cache & reload" onClick={clearCache} testid="menu-clear-cache" />
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-slate-800/80 flex items-center justify-between">
        <button onClick={onSignOut} data-testid="menu-sign-out"
          className="inline-flex items-center gap-1.5 text-orange-400 hover:text-orange-300 text-[11px] font-bold uppercase tracking-wider">
          <SignOut20Regular /> Sign out
        </button>
        <span className="text-[10px] text-slate-500 truncate max-w-[55%]">{user?.email}</span>
      </div>
    </div>
  );
}

function AlertBtn({ active, onClick, testid, children }) {
  return (
    <button type="button" onClick={onClick} data-testid={testid}
      className={`inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider border transition-colors ${
        active
          ? 'bg-orange-500 border-orange-400 text-white'
          : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-orange-500/40'}`}>
      {active && <span className="w-1.5 h-1.5 rounded-full bg-white/90 mr-0.5" />}
      {children}
    </button>
  );
}

function QuickRow({ icon, label, onClick, testid }) {
  return (
    <button type="button" onClick={onClick} data-testid={testid}
      className="w-full flex items-center gap-3 px-5 py-2.5 hover:bg-slate-900/60 text-left group">
      <span className="grid place-items-center w-8 h-8 rounded-lg bg-slate-900 border border-slate-800 text-orange-400">{icon}</span>
      <span className="flex-1 text-xs font-bold uppercase tracking-wider text-slate-200">{label}</span>
      <ArrowRight16Regular className="text-slate-600 group-hover:text-orange-400" />
    </button>
  );
}
