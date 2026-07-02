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
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plug, ArrowRight, Shield } from 'lucide-react';
import { INTEGRATIONS } from '../mocks/dashboard';
import api from '../lib/api';

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

function Card({ integ, health }) {
  const meta = KIND_MAP[integ.key] || {};
  const route = meta.route;
  const status = health?.status;
  const cls = STATUS_STYLE[status] || 'bg-slate-100 text-slate-600 border-slate-200';
  const label = STATUS_LABEL[status] || 'Unknown';
  const disarmed = !!health?.disarmed;
  const detail = health?.detail || '';

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
                <Shield size={10} /> Disarmed
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
              <Shield size={10} /> Disarmed
            </span>
            are intentionally suppressed, not broken.
          </p>
        </div>
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-brand-violet-soft text-brand-violet text-xs font-medium border border-violet-200">
          <Plug size={13} /> 4 connectors available
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
      </div>
    </div>
  );
}
