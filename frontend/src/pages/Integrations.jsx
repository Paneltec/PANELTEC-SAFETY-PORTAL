// Settings → Integrations. Phase 4.19 v147 — now consumes
// `/api/health/integrations` (the same live source of truth that
// Settings → My Apps reads). Previously this page hit `/api/integrations`,
// which returns the per-org config-lifecycle status (`connected`/`error`/
// `not_connected`) — a stored field that is ignorant of Comms Safe Mode.
// The result was M365 and TextMagic rendering as "Connected" on this
// page while My Apps correctly showed them as "Disarmed by Comms Safe
// Mode". Both surfaces are now identical.
//
// The per-integration admin pages (SimproAdmin, NavixyAdmin,
// Microsoft365Admin, TextMagicAdmin) still call `GET /integrations/{kind}`
// for the config CRUD flow — we did NOT touch that endpoint or those
// pages. Only the top-level chip on this list flipped its data source.
import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plug, ArrowRight, Shield, CheckCircle2, XCircle, Loader2, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { INTEGRATIONS } from '../mocks/dashboard';
import api, { apiError } from '../lib/api';

// Map UI keys → per-integration admin route. `kind` is what the backend
// `/health/integrations` returns for each item; we normalise Microsoft's
// two spellings (`m365`, `microsoft365`) defensively — the health
// endpoint currently returns `m365` but the config endpoint uses
// `microsoft365`, and either could surface here as the health payload
// evolves.
const KIND_MAP = {
  simpro:    { route: '/app/settings/integrations/simpro' },
  m365:      { route: '/app/settings/integrations/microsoft365' },
  textmagic: { route: '/app/settings/integrations/textmagic' },
  navixy:    { route: '/app/settings/integrations/navixy' },
  smartfill: { route: '/app/settings/integrations/smartfill' },
};

const STATUS_STYLE = {
  up:    'bg-emerald-100 text-emerald-800 border-emerald-200',
  amber: 'bg-amber-100 text-amber-800 border-amber-200',
  down:  'bg-rose-100 text-rose-800 border-rose-200',
};

const STATUS_LABEL = {
  up:    'Connected',
  amber: 'Degraded',
  down:  'Down',
};

// Normalise the backend kind → UI key. Health endpoint uses `m365`;
// config endpoint uses `microsoft365`. Both mean the same integration.
function normaliseKind(k) {
  if (k === 'microsoft365') return 'm365';
  return k;
}

// v58.13.132ld — Dropbox OAuth "Connect" card. Separate from the
// mock-driven INTEGRATIONS grid above because Dropbox uses OAuth
// authorize + refresh-token flow instead of Comms Safe Mode +
// admin-config pattern.
function DropboxCard() {
  const [health, setHealth] = useState(null);      // last /dropbox/health payload
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const pollRef = useRef(null);

  const fetchHealth = React.useCallback(async () => {
    try {
      const { data } = await api.get('/dropbox/health');
      setHealth(data);
      return data;
    } catch (_e) {
      setHealth(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
    // Listen for the postMessage from the OAuth callback tab.
    const onMsg = (ev) => {
      if (ev?.data?.type === 'dropbox-oauth-connected') {
        fetchHealth();
        toast.success(`Dropbox connected as ${ev.data.account_email || 'account'}`);
      }
    };
    window.addEventListener('message', onMsg);
    return () => {
      window.removeEventListener('message', onMsg);
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchHealth]);

  const beginConnect = async () => {
    setStarting(true);
    try {
      const { data } = await api.get('/dropbox/oauth/start');
      if (!data?.authorize_url) throw new Error('missing authorize_url');
      const win = window.open(data.authorize_url, '_blank', 'noopener,noreferrer');
      if (!win) {
        toast.error('Popup blocked — allow popups for this site and try again.');
        return;
      }
      // Poll /health every 5s while the OAuth tab is open. Stop when
      // `connected && scopes_ok && refresh_token_present`.
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        const h = await fetchHealth();
        if (h?.connected && h?.scopes_ok && h?.refresh_token_present) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }, 5000);
      // Give up polling after 5 min.
      setTimeout(() => {
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }, 5 * 60 * 1000);
    } catch (err) {
      toast.error(apiError(err, 'Failed to start Dropbox OAuth'));
    } finally {
      setStarting(false);
    }
  };

  const isConnected = !!(health?.connected && health?.refresh_token_present);
  const scopesOk = !!health?.scopes_ok;

  let statusChip;
  if (loading) {
    statusChip = (
      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider border bg-slate-100 text-slate-500 border-slate-200">
        <Loader2 size={10} className="animate-spin" /> Checking…
      </span>
    );
  } else if (isConnected && scopesOk) {
    statusChip = (
      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider border bg-emerald-100 text-emerald-800 border-emerald-200"
            data-testid="dropbox-status-connected">
        <CheckCircle2 size={10} /> Connected
      </span>
    );
  } else if (isConnected && !scopesOk) {
    statusChip = (
      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider border bg-amber-100 text-amber-800 border-amber-200"
            data-testid="dropbox-status-scopes-missing">
        <XCircle size={10} /> Scopes missing
      </span>
    );
  } else {
    statusChip = (
      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider border bg-slate-100 text-slate-600 border-slate-200"
            data-testid="dropbox-status-not-connected">
        <XCircle size={10} /> Not connected
      </span>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 flex flex-col"
         data-testid="integration-card-dropbox">
      <div className="flex items-start gap-3">
        <div className="w-12 h-12 rounded-xl flex items-center justify-center text-white font-display font-bold text-lg shrink-0 bg-[#0061FF]"
             aria-hidden="true">D</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-display text-lg font-semibold">Dropbox</h3>
            {statusChip}
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Team folder mirror source · <span className="font-mono">Paneltec-General Administration</span>
          </p>
          {isConnected && health?.account_email && (
            <p className="text-xs text-slate-600 mt-1" data-testid="dropbox-account-email">
              Signed in as <b>{health.account_email}</b>
            </p>
          )}
          {health?.diagnostic && (
            <p className="text-xs text-amber-700 mt-2 max-w-md" data-testid="dropbox-diagnostic">
              {health.diagnostic}
            </p>
          )}
          {isConnected && scopesOk && typeof health?.top_level_folder_count === 'number' && (
            <p className="text-xs text-slate-500 mt-1" data-testid="dropbox-audit-summary">
              {health.top_level_folder_count} top-level folder(s) visible
              {health.estimated_total_gb ? ` · ~${health.estimated_total_gb} GB projected` : ''}
            </p>
          )}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2">
        {!isConnected || !scopesOk ? (
          <button
            type="button"
            onClick={beginConnect}
            disabled={starting}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 disabled:opacity-60 disabled:cursor-not-allowed"
            data-testid="dropbox-connect-btn"
          >
            {starting ? <Loader2 size={14} className="animate-spin" /> : <ExternalLink size={14} />}
            {isConnected && !scopesOk ? 'Reconnect Dropbox' : 'Connect Dropbox'}
          </button>
        ) : (
          <button
            type="button"
            onClick={beginConnect}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-slate-300 text-slate-700 text-sm font-medium hover:bg-slate-50"
            data-testid="dropbox-reconnect-btn"
          >
            <ExternalLink size={14} /> Reconnect
          </button>
        )}
        <span className="text-[10px] text-slate-400 uppercase tracking-wider">
          OAuth · offline access
        </span>
      </div>
    </div>
  );
}

function Card({ integ, health }) {
  const meta = KIND_MAP[integ.key] || {};
  const route = meta.route;
  // The tile shows the same truth as the integration's own page: if its
  // last Test connection succeeded it is Connected. Live checks (sync
  // freshness, Comms Safe Mode) appear underneath as the detail line /
  // Disarmed chip instead of overriding the headline.
  let status = health?.status;
  let label = STATUS_LABEL[status] || (health ? 'Unknown' : 'Checking…');
  if (health?.connected === true) { status = 'up'; label = 'Connected'; }
  else if (health && status === 'down' && /not connected/i.test(health.detail || '')) { label = 'Not connected'; }
  else if (status === 'amber') { label = 'Needs attention'; }
  const cls = STATUS_STYLE[status] || 'bg-slate-100 text-slate-600 border-slate-200';
  const disarmed = !!health?.disarmed;
  let detail = health?.detail || '';
  if (health?.connected === true && /not connected/i.test(detail)) {
    detail = 'Connection tested and working';
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 flex flex-col"
      data-testid={`integration-card-${integ.key}`}>
      <div className="flex items-start gap-3">
        <div className="w-12 h-12 rounded-xl flex items-center justify-center text-white font-display font-bold text-lg shrink-0"
             style={{ backgroundColor: integ.logoBg }} aria-hidden="true">
          {integ.logoChar}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-display text-lg font-semibold">{integ.name}</h3>
            <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider border ${cls}`}
                  data-testid={`integration-status-${integ.key}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${
                status === 'up'    ? 'bg-emerald-500' :
                status === 'amber' ? 'bg-amber-500'   :
                status === 'down'  ? 'bg-rose-500'    : 'bg-slate-400'}`} />
              {label}
            </span>
            {disarmed && (
              <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider bg-violet-50 text-violet-700 border border-violet-200"
                    title="Comms Safe Mode is on — outbound sends are intentionally suppressed."
                    data-testid={`integration-disarmed-${integ.key}`}>
                <Shield size={10} /> Sending paused
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-slate-600 leading-relaxed">{integ.purpose}</p>
          {detail && (
            <p className="mt-2 text-xs text-slate-500 leading-relaxed"
               data-testid={`integration-detail-${integ.key}`}>
              {detail}
            </p>
          )}
        </div>
      </div>
      <div className="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between">
        <span className="text-xs text-slate-400">Live status · per-org credentials</span>
        <Link to={route} data-testid={`integration-configure-${integ.key}`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-blue hover:underline">
          Configure <ArrowRight size={14} />
        </Link>
      </div>
    </div>
  );
}

export default function Integrations() {
  const [byKind, setByKind] = useState({});
  const [commsSafeMode, setCommsSafeMode] = useState(null);

  useEffect(() => {
    api.get('/health/integrations').then(({ data }) => {
      const map = {};
      (data?.items || []).forEach((row) => {
        const key = normaliseKind(row.kind);
        map[key] = {
          status:   row.status,
          detail:   row.detail,
          disarmed: !!row.disarmed,
          connected: row.connected,
        };
      });
      setByKind(map);
      setCommsSafeMode(data?.comms_safe_mode || null);
    }).catch(() => setByKind({}));
  }, []);

  const anyDisarmed = Object.values(byKind).some((h) => h?.disarmed);

  return (
    <div className="max-w-6xl mx-auto" data-testid="integrations-page">
      <nav className="text-xs text-slate-500 mb-3" aria-label="breadcrumb">
        Settings <span className="mx-1.5">/</span> <span className="text-slate-700">Integrations</span>
      </nav>
      <div className="flex items-start justify-between flex-wrap gap-4 mb-6">
        <div>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight">Integrations</h1>
          <p className="mt-2 text-slate-600 max-w-2xl">
            Third-party services this workspace is configured for. Live status
            reflects your <b>Comms Safe Mode</b> setting — connectors marked
            <span className="mx-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 text-[10px] font-semibold border border-violet-200">
              <Shield size={10} /> Sending paused
            </span>
            are intentionally suppressed, not broken.
          </p>
        </div>
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-brand-violet-soft text-brand-violet text-xs font-medium border border-violet-200">
          <Plug size={13} /> 6 connectors available
        </div>
      </div>

      {commsSafeMode === 'on' && anyDisarmed && (
        <div className="mb-6 rounded-xl border border-violet-200 bg-violet-50/70 px-4 py-3 text-xs text-violet-900 flex items-start gap-2"
             data-testid="integrations-safe-mode-banner">
          <Shield size={14} className="mt-0.5 shrink-0" />
          <div>
            <b>Comms Safe Mode is ON.</b> Outbound email (Microsoft 365) and SMS
            (TextMagic) sends are suppressed — messages queue to the outbox
            instead of hitting the wire. Turn this off in Settings → Comms Safe
            Mode when you're ready to go live.
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        {INTEGRATIONS.map((integ) => (
          <Card key={integ.key} integ={integ} health={byKind[integ.key]} />
        ))}
        {/* v58.13.132ld — Dropbox OAuth card. Sits alongside the
            Comms Safe Mode–gated integrations because it's another
            org-level connector, but drives its own OAuth flow
            rather than the admin-config pattern. */}
        <DropboxCard />
      </div>
    </div>
  );
}
