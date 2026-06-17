import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MapPin, RefreshCw, Radio, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../lib/api';
import { PageHeader } from '../components/capture/Ui';

function RelTime({ iso }) {
  if (!iso) return <span className="text-slate-400">—</span>;
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (Number.isNaN(mins)) return <span>{iso}</span>;
  if (mins < 1) return <span>just now</span>;
  if (mins < 60) return <span>{mins}m ago</span>;
  return <span>{Math.round(mins / 60)}h ago</span>;
}

export default function Vehicles() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setBusy(true); setError('');
    try { const r = await api.get('/integrations/navixy/vehicles'); setData(r.data); }
    catch (e) { setError(apiError(e)); }
    finally { setBusy(false); }
  };
  useEffect(() => { load(); }, []);

  if (busy && !data) return <div className="text-sm text-slate-500">Loading vehicles…</div>;

  if (error) {
    return (
      <div className="max-w-3xl mx-auto text-center" data-testid="vehicles-not-connected">
        <PageHeader title="Vehicles" subtitle="Live fleet tracking via Navixy GPS." />
        <div className="rounded-2xl border border-slate-200 bg-white p-10">
          <div className="inline-flex w-12 h-12 rounded-xl bg-slate-100 items-center justify-center mb-4"><Radio size={22} className="text-slate-400" /></div>
          <h3 className="font-display text-lg font-semibold">Navixy is not connected</h3>
          <p className="mt-2 text-sm text-slate-500">{error}</p>
          <Link to="/app/settings/integrations/navixy" className="mt-5 inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-brand-blue text-white text-sm font-medium hover:bg-blue-600">
            Configure Navixy <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    );
  }

  const vehicles = data?.vehicles || [];
  return (
    <div className="max-w-6xl mx-auto" data-testid="vehicles-page">
      <PageHeader crumb="Compliance / Vehicles" title="Vehicles"
        subtitle={`${data?.count || 0} vehicles · Navixy live fleet`}
        action={<button onClick={load} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 text-sm hover:bg-slate-50" data-testid="vehicles-refresh"><RefreshCw size={14} /> Refresh</button>} />

      <div className="grid lg:grid-cols-3 gap-5">
        <div className="lg:col-span-1 rounded-2xl border border-slate-200 bg-white divide-y divide-slate-100 max-h-[70vh] overflow-y-auto">
          {vehicles.length === 0 && <div className="p-6 text-sm text-slate-500 italic">No vehicles in your fleet.</div>}
          {vehicles.map((v) => (
            <div key={v.id} className="p-3 hover:bg-slate-50" data-testid={`vehicle-${v.id}`}>
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${v.status === 'online' ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                <div className="font-medium text-sm truncate flex-1">{v.label}</div>
                {v.speed_kph != null && <span className="text-xs text-slate-500">{v.speed_kph} km/h</span>}
              </div>
              <div className="text-xs text-slate-500 mt-0.5">{v.plate || '—'} · <RelTime iso={v.last_seen} /></div>
              {v.address && <div className="text-xs text-slate-400 mt-0.5 truncate">{v.address}</div>}
            </div>
          ))}
        </div>

        <div className="lg:col-span-2 rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-100 to-slate-50 p-10 flex flex-col items-center justify-center text-center min-h-[60vh]" data-testid="vehicles-map-placeholder">
          <div className="w-16 h-16 rounded-2xl bg-white border border-slate-200 shadow-card flex items-center justify-center mb-4"><MapPin size={28} className="text-brand-blue" /></div>
          <div className="font-display text-xl font-semibold">Map view coming soon</div>
          <p className="mt-2 text-sm text-slate-600 max-w-md">Showing {vehicles.filter((v) => v.status === 'online').length} active of {vehicles.length} vehicles. Interactive map rendering arrives in Phase B.</p>
        </div>
      </div>
    </div>
  );
}
