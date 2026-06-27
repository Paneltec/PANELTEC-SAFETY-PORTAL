import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plug, ArrowRight } from 'lucide-react';
import { INTEGRATIONS } from '../mocks/dashboard';
import api from '../lib/api';

// Map UI keys → backend `kind` strings + per-integration admin route.
const KIND_MAP = {
  simpro: { kind: 'simpro', route: '/app/settings/integrations/simpro' },
  m365: { kind: 'microsoft365', route: '/app/settings/integrations/microsoft365' },
  textmagic: { kind: 'textmagic', route: '/app/settings/integrations/textmagic' },
  navixy: { kind: 'navixy', route: '/app/settings/integrations/navixy' },
};

const STATUS_STYLE = {
  connected: 'bg-emerald-100 text-emerald-700',
  error: 'bg-red-100 text-red-700',
  not_connected: 'bg-amber-100 text-amber-700',
};

const STATUS_LABEL = {
  connected: 'Connected',
  error: 'Error',
  not_connected: 'Not connected',
};

function Card({ integ, status }) {
  const meta = KIND_MAP[integ.key] || {};
  const route = meta.route;
  const cls = STATUS_STYLE[status] || STATUS_STYLE.not_connected;
  const label = STATUS_LABEL[status] || STATUS_LABEL.not_connected;
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 flex flex-col" data-testid={`integration-card-${integ.key}`}>
      <div className="flex items-start gap-3">
        <div className="w-12 h-12 rounded-xl flex items-center justify-center text-white font-display font-bold text-lg shrink-0"
             style={{ backgroundColor: integ.logoBg }} aria-hidden="true">
          {integ.logoChar}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-display text-lg font-semibold">{integ.name}</h3>
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider ${cls}`}
                  data-testid={`integration-status-${integ.key}`}>
              {label}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-600 leading-relaxed">{integ.purpose}</p>
        </div>
      </div>
      <div className="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between">
        <span className="text-xs text-slate-400">Live API · per-org credentials</span>
        <Link to={route} data-testid={`integration-configure-${integ.key}`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-blue hover:underline">
          Configure <ArrowRight size={14} />
        </Link>
      </div>
    </div>
  );
}

export default function Integrations() {
  const [statuses, setStatuses] = useState({});
  useEffect(() => {
    api.get('/integrations').then(({ data }) => {
      const map = {};
      (data || []).forEach((row) => { map[row.kind] = row.status; });
      setStatuses(map);
    }).catch(() => setStatuses({}));
  }, []);

  return (
    <div className="max-w-6xl mx-auto" data-testid="integrations-page">
      <nav className="text-xs text-slate-500 mb-3" aria-label="breadcrumb">
        Settings <span className="mx-1.5">/</span> <span className="text-slate-700">Integrations</span>
      </nav>
      <div className="flex items-start justify-between flex-wrap gap-4 mb-8">
        <div>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight">Integrations</h1>
          <p className="mt-2 text-slate-600 max-w-2xl">
            Connect Paneltec Civil to the tools your team already uses. All 4 connectors below are live — paste your
            own per-org credentials inside each admin page.
          </p>
        </div>
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-brand-violet-soft text-brand-violet text-xs font-medium border border-violet-200">
          <Plug size={13} /> 4 connectors available
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        {INTEGRATIONS.map((integ) => {
          const kind = (KIND_MAP[integ.key] || {}).kind;
          return <Card key={integ.key} integ={integ} status={statuses[kind]} />;
        })}
      </div>
    </div>
  );
}
