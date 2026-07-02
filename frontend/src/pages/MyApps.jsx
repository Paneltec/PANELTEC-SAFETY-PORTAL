// Phase 4.16 (paneltec-v133) — MY APPS stub. Lists third-party
// integrations the current user's org has connected. Real per-user app
// registration comes later; for now we mirror /api/health/integrations.
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';
import { PageHeader } from '../components/capture/Ui';
import { PlugConnected20Regular } from '@fluentui/react-icons';

export default function MyApps() {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    api.get('/health/integrations').then((r) => setRows(r.data?.items || [])).catch(() => setRows([]));
  }, []);
  return (
    <div className="p-6 lg:p-8" data-testid="my-apps-page">
      <PageHeader crumb="Settings / My apps" title="My apps"
        subtitle="Third-party services your account has access to." />
      <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {rows.map((r) => (
          <li key={r.kind} data-testid={`my-app-${r.kind}`}
            className="rounded-2xl border border-slate-200 bg-white p-4 flex items-center gap-3">
            <span className="grid place-items-center w-10 h-10 rounded-xl bg-orange-50 text-orange-600">
              <PlugConnected20Regular />
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-slate-900">{r.name}</div>
              <div className="text-xs text-slate-500">{r.detail || '—'}</div>
            </div>
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
              r.status === 'up' ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : r.status === 'amber' ? 'bg-amber-50 border-amber-200 text-amber-800'
              : 'bg-rose-50 border-rose-200 text-rose-700'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${
                r.status === 'up' ? 'bg-emerald-500'
                : r.status === 'amber' ? 'bg-amber-500' : 'bg-rose-500'}`} />
              {r.status}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-xs text-slate-500">
        Manage connections in <Link to="/app/settings/integrations" className="text-orange-600 font-semibold hover:underline">Settings → Integrations</Link>.
      </p>
    </div>
  );
}
