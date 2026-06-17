import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { MapPin, RefreshCw, Radio, ArrowRight, Tag as TagIcon, X as XIcon, Loader2 } from 'lucide-react';
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
  if (mins < 60 * 24) return <span>{Math.round(mins / 60)}h ago</span>;
  return <span>{Math.round(mins / 60 / 24)}d ago</span>;
}

const TAG_FILTER_KEY = 'paneltec_vehicle_tag_filter';

function loadPersistedTagIds() {
  try {
    const raw = localStorage.getItem(TAG_FILTER_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

export default function Vehicles() {
  const [data, setData] = useState(null);
  const [tags, setTags] = useState([]);
  const [selected, setSelected] = useState(() => new Set(loadPersistedTagIds()));
  const [busy, setBusy] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  // Persist selection on every change. Initial render writes back what we
  // already hydrated (idempotent).
  useEffect(() => {
    try { localStorage.setItem(TAG_FILTER_KEY, JSON.stringify(Array.from(selected))); }
    catch { /* ignore quota errors */ }
  }, [selected]);

  const loadTags = async () => {
    try {
      const { data: d } = await api.get('/integrations/navixy/tags');
      const tagList = d.tags || [];
      setTags(tagList);
      // Prune any persisted IDs that no longer exist in Navixy.
      setSelected((prev) => {
        const valid = new Set(tagList.map((t) => t.id));
        const filtered = new Set([...prev].filter((id) => valid.has(id)));
        return filtered.size === prev.size ? prev : filtered;
      });
    } catch { /* tags are optional; ignore */ }
  };

  const loadVehicles = async (tagSet) => {
    setRefreshing(true); setError('');
    try {
      const qs = tagSet && tagSet.size ? `?tag_ids=${[...tagSet].join(',')}` : '';
      const { data: d } = await api.get(`/integrations/navixy/vehicles${qs}`);
      setData(d);
    } catch (e) { setError(apiError(e)); setData(null); }
    finally { setBusy(false); setRefreshing(false); }
  };

  useEffect(() => { loadTags(); setBusy(false); }, []);

  // Only fetch vehicles once tags are selected; clear data when filters cleared.
  useEffect(() => {
    if (selected.size === 0) { setData(null); return; }
    const t = setTimeout(() => loadVehicles(selected), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const tagCounts = useMemo(() => {
    const m = {};
    for (const v of data?.vehicles || []) for (const t of v.tags || []) m[t.id] = (m[t.id] || 0) + 1;
    return m;
  }, [data]);

  const toggleTag = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const clearFilters = () => setSelected(new Set());

  if (busy && !data && !error) return <div className="text-sm text-slate-500" data-testid="vehicles-loading">Loading vehicles…</div>;

  // Not connected → read-only empty-state card. Links to the integrations LIST, not the edit page.
  if (error) {
    return (
      <div className="max-w-3xl mx-auto text-center" data-testid="vehicles-not-connected">
        <PageHeader title="Vehicles" subtitle="Live fleet tracking via Navixy GPS." />
        <div className="rounded-2xl border p-10" style={{ backgroundColor: '#F5EFE0', borderColor: '#D8CFB8' }}>
          <div className="inline-flex w-14 h-14 rounded-2xl bg-white border border-slate-200 items-center justify-center mb-4">
            <Radio size={26} className="text-brand-blue" />
          </div>
          <h3 className="font-display text-xl font-semibold">Connect Navixy to see your fleet</h3>
          <p className="mt-2 text-sm text-slate-700 max-w-md mx-auto">
            Navixy GPS integration is not connected yet. An administrator can connect it from Settings → Integrations → Navixy.
          </p>
          <Link to="/app/settings/integrations" data-testid="vehicles-open-integrations"
            className="mt-6 inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-brand-blue text-white text-sm font-medium hover:bg-blue-600">
            Open Integrations <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    );
  }

  const vehicles = data?.vehicles || [];
  const total = data?.total ?? vehicles.length;
  const filtered = selected.size > 0;

  return (
    <div className="max-w-6xl mx-auto" data-testid="vehicles-page">
      <PageHeader crumb="Compliance / Vehicles" title="Vehicles"
        subtitle={<>Live fleet from Navixy GPS. <Link to="/app/settings/integrations" className="text-brand-blue hover:underline ml-1">Manage in Settings → Integrations</Link></>}
        action={<button onClick={() => loadVehicles(selected)} disabled={refreshing} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 text-sm hover:bg-slate-50 disabled:opacity-50" data-testid="vehicles-refresh">
          {refreshing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Refresh
        </button>} />

      <div className="grid lg:grid-cols-3 gap-5">
        {/* LEFT — tag selector */}
        <aside className="lg:col-span-1 rounded-2xl border border-slate-200 bg-white p-4 max-h-[75vh] overflow-y-auto" data-testid="vehicles-tag-panel">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="font-display text-sm font-semibold flex items-center gap-1.5"><TagIcon size={13} /> Tags</h3>
              <div className="text-[11px] text-slate-500">Filter by Navixy tags{selected.size > 0 && ` · ${selected.size} selected`}</div>
            </div>
            {selected.size > 0 && (
              <button onClick={clearFilters} className="text-xs text-brand-blue hover:underline inline-flex items-center gap-0.5" data-testid="vehicles-clear-filters">
                <XIcon size={11} /> Clear
              </button>
            )}
          </div>
          {tags.length === 0 ? (
            <div className="text-xs text-slate-500 italic py-4">No tags configured in Navixy yet. Tags can be created in your Navixy dashboard.</div>
          ) : (
            <ul className="space-y-1" data-testid="vehicles-tag-list">
              {tags.map((t) => (
                <li key={t.id}>
                  <label className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-slate-50 cursor-pointer text-sm">
                    <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggleTag(t.id)} data-testid={`tag-toggle-${t.id}`} />
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: t.color || '#94A3B8' }} />
                    <span className="flex-1 truncate">{t.name}</span>
                    <span className="text-[11px] text-slate-400">{tagCounts[t.id] || 0}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </aside>

        {/* RIGHT — fleet list */}
        <div className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white" data-testid="vehicles-list-panel">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h3 className="font-display text-sm font-semibold">Fleet</h3>
              <div className="text-[11px] text-slate-500" data-testid="vehicles-count">
                {filtered ? `${vehicles.length} of ${total} vehicles` : `${total} vehicles`}
              </div>
            </div>
          </div>
          {vehicles.length === 0 ? (
            <div className="p-10 text-center" data-testid="vehicles-empty-state">
              {selected.size === 0 ? (
                <>
                  <div className="inline-flex w-14 h-14 rounded-2xl bg-brand-blue-soft items-center justify-center mb-3"><TagIcon size={22} className="text-brand-blue" /></div>
                  <h4 className="font-display text-lg font-semibold">Select one or more tags to view your fleet</h4>
                  <p className="mt-1 text-sm text-slate-600 max-w-md mx-auto">Use the tags on the left to filter your vehicles. We don&apos;t load the full fleet by default — picking a tag keeps the view focused and fast.</p>
                </>
              ) : (
                <div className="text-sm text-slate-500">No vehicles match the selected tags. Try clearing filters.</div>
              )}
            </div>
          ) : (
            <ul className="divide-y divide-slate-100 max-h-[70vh] overflow-y-auto">
              {vehicles.map((v) => (
                <li key={v.id} className="p-3 hover:bg-slate-50" data-testid={`vehicle-${v.id}`}>
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${v.status === 'online' ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                    <div className="font-medium text-sm truncate flex-1">{v.label}</div>
                    {v.speed_kph != null && v.speed_kph > 0 && <span className="text-xs text-slate-500">{v.speed_kph} km/h</span>}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">{v.plate || '—'} · <RelTime iso={v.last_seen} /></div>
                  {v.address && <div className="text-xs text-slate-400 mt-0.5 truncate">{v.address}</div>}
                  {v.tags?.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {v.tags.map((t) => (
                        <span key={t.id} className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border" style={{ borderColor: t.color || '#CBD5E1', color: t.color || '#475569' }}>
                          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: t.color || '#94A3B8' }} />
                          {t.name}
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Map placeholder — Phase B */}
      <div className="mt-5 rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-100 to-slate-50 p-10 flex flex-col items-center justify-center text-center" data-testid="vehicles-map-placeholder">
        <div className="w-14 h-14 rounded-2xl bg-white border border-slate-200 shadow-card flex items-center justify-center mb-3"><MapPin size={24} className="text-brand-blue" /></div>
        <div className="font-display text-lg font-semibold">Map view coming soon</div>
        <p className="mt-1 text-sm text-slate-600 max-w-md">Showing {vehicles.filter((v) => v.status === 'online').length} active of {vehicles.length} vehicles. Interactive map arrives in Phase B.</p>
      </div>
    </div>
  );
}
