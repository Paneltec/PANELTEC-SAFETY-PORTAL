import React, { useEffect, useState } from 'react';
import { Eye, EyeOff, Save, Zap, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../lib/api';
import { PageHeader } from '../components/capture/Ui';

export default function GoogleMapsAdmin() {
  const [cfg, setCfg] = useState(null);
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const { data } = await api.get('/integrations/google_maps');
      setCfg(data);
      setApiKey('');
    } catch (e) { toast.error(apiError(e)); }
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    setBusy(true);
    try {
      await api.put('/integrations/google_maps', { api_key: apiKey || null });
      toast.success('Saved');
      setApiKey('');
      load();
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };

  const test = async () => {
    setBusy(true);
    try {
      await api.post('/integrations/google_maps/test-connection');
      toast.success('Connected — Maps JavaScript API is reachable');
      load();
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };

  if (!cfg) return <div className="text-sm text-slate-500">Loading…</div>;
  const isLive = cfg.status === 'connected';
  const maskedSaved = cfg.config?.api_key;

  return (
    <div className="max-w-3xl mx-auto" data-testid="gmaps-admin">
      <PageHeader crumb="Settings / Integrations / Google Maps" title="Google Maps" subtitle="Map tiles & geocoding for the Vehicles page." />
      <div className="rounded-2xl border" style={{ backgroundColor: '#F5EFE0', borderColor: '#D8CFB8' }}>
        <div className="px-5 py-3 rounded-t-2xl text-white flex items-center justify-between" style={{ backgroundColor: '#0F172A' }}>
          <div className="font-display text-sm tracking-wider uppercase">Google Maps · Map Tiles & Geocoding</div>
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${isLive ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-500/20 text-slate-300'}`} data-testid="gmaps-status">
            ● {isLive ? 'Live' : 'Not connected'}
          </span>
        </div>
        <div className="p-6 space-y-5">
          <label className="block">
            <div className="text-xs uppercase tracking-wider font-semibold text-slate-700 mb-1.5">API Key</div>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={maskedSaved ? `Saved (${maskedSaved}) — enter a new key to replace` : 'AIza…'}
                className="w-full px-3 py-2 pr-10 border border-slate-300 rounded-lg text-sm bg-white"
                autoComplete="off"
                data-testid="gmaps-key-input"
              />
              <button type="button" onClick={() => setShowKey((s) => !s)} className="absolute right-2 top-2 text-slate-400 hover:text-slate-600" aria-label="Toggle visibility">
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            {maskedSaved && <div className="mt-1.5 inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800" data-testid="gmaps-saved-chip">Saved · {maskedSaved}</div>}
          </label>
          <div className="text-xs text-slate-600 leading-relaxed">
            Create a Maps JavaScript API key in{' '}
            <a href="https://console.cloud.google.com/google/maps-apis" target="_blank" rel="noopener noreferrer" className="text-brand-blue underline">Google Cloud Console</a>.
            Enable <strong>Maps JavaScript API</strong> (and optionally Geocoding API). Restrict the key to your domain in production.
          </div>
          <div className="flex gap-2">
            <button onClick={save} disabled={busy} data-testid="gmaps-save" className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-sm font-medium disabled:opacity-50">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
            </button>
            <button onClick={test} disabled={busy} data-testid="gmaps-test" className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50" style={{ backgroundColor: '#0F172A' }}>
              <Zap size={14} /> Test connection
            </button>
          </div>
          {cfg.last_error && <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">{cfg.last_error}</div>}
        </div>
      </div>
    </div>
  );
}
