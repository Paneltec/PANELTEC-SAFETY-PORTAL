import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  MapPin, RefreshCw, Radio, ArrowRight, Tag as TagIcon, X as XIcon,
  Loader2, List as ListIcon, Map as MapIcon,
} from 'lucide-react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import api, { apiError } from '../lib/api';
import { PageHeader } from '../components/capture/Ui';
import VehicleMapModal from '../components/VehicleMapModal';

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
const SYDNEY = [-33.8688, 151.2093];

function loadPersistedTagIds() {
  try {
    const raw = localStorage.getItem(TAG_FILTER_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

// --- Leaflet ---------------------------------------------------------------

// Color-coded pin via divIcon (avoids the broken default marker-image URLs
// that ship with leaflet under webpack).
function buildPinIcon(color, online) {
  const fill = color || '#2C6BFF';
  const ring = online ? '#10B981' : '#94A3B8';
  const html = `
    <div style="position:relative;width:24px;height:32px">
      <div style="position:absolute;left:2px;top:2px;width:20px;height:20px;border-radius:50%;background:${fill};border:2px solid ${ring};box-shadow:0 1px 3px rgba(0,0,0,.35)"></div>
      <div style="position:absolute;left:9px;top:18px;width:0;height:0;border-left:3px solid transparent;border-right:3px solid transparent;border-top:8px solid ${fill}"></div>
    </div>`;
  return L.divIcon({
    html, className: 'paneltec-vehicle-pin', iconSize: [24, 32], iconAnchor: [12, 30], popupAnchor: [0, -28],
  });
}

function RecenterOnVehicles({ vehicles }) {
  const map = useMap();
  useEffect(() => {
    const pts = (vehicles || [])
      .filter((v) => typeof v.lat === 'number' && typeof v.lng === 'number')
      .map((v) => [v.lat, v.lng]);
    if (pts.length === 0) {
      map.setView(SYDNEY, 10);
      return;
    }
    if (pts.length === 1) {
      map.setView(pts[0], 14);
      return;
    }
    map.fitBounds(pts, { padding: [40, 40], maxZoom: 14 });
  }, [vehicles, map]);
  return null;
}

function VehicleMap({ vehicles }) {
  return (
    <div className="relative h-[70vh] rounded-b-2xl overflow-hidden" data-testid="vehicles-map">
      <MapContainer center={SYDNEY} zoom={10} scrollWheelZoom className="w-full h-full">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <RecenterOnVehicles vehicles={vehicles} />
        {vehicles.map((v) => {
          const color = v.tags?.[0]?.color;
          return (
            <Marker key={v.id} position={[v.lat, v.lng]} icon={buildPinIcon(color, v.status === 'online')}>
              <Popup>
                <div className="text-xs space-y-1 min-w-[180px]" data-testid={`vehicle-popup-${v.id}`}>
                  <div className="font-semibold text-sm flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full ${v.status === 'online' ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                    {v.label}
                  </div>
                  <div className="text-slate-500">{v.plate || '—'} · <RelTime iso={v.last_seen} /></div>
                  {v.speed_kph != null && v.speed_kph > 0 && <div className="text-slate-500">{v.speed_kph} km/h</div>}
                  {v.address && <div className="text-slate-500 italic">{v.address}</div>}
                  {v.tags?.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {v.tags.map((t) => (
                        <span key={t.id} className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border"
                              style={{ borderColor: t.color || '#CBD5E1', color: t.color || '#475569' }}>
                          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: t.color || '#94A3B8' }} />
                          {t.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
}

// --- Main page -------------------------------------------------------------

export default function Vehicles() {
  const [data, setData] = useState(null);
  const [tags, setTags] = useState([]);
  const [selected, setSelected] = useState(() => new Set(loadPersistedTagIds()));
  const [busy, setBusy] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [view, setView] = useState('list'); // 'list' | 'map'
  const [activeMapVehicle, setActiveMapVehicle] = useState(null);

  useEffect(() => {
    try { localStorage.setItem(TAG_FILTER_KEY, JSON.stringify(Array.from(selected))); }
    catch { /* ignore quota errors */ }
  }, [selected]);

  const loadTags = async () => {
    try {
      const { data: d } = await api.get('/integrations/navixy/tags');
      const tagList = d.tags || [];
      setTags(tagList);
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

        {/* RIGHT — fleet list / map */}
        <div className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white relative" data-testid="vehicles-list-panel">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h3 className="font-display text-sm font-semibold">Fleet</h3>
              <div className="text-[11px] text-slate-500" data-testid="vehicles-count">
                {filtered ? `${vehicles.length} of ${total} vehicles` : `${total} vehicles`}
              </div>
            </div>
            {/* List/Map toggle */}
            <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden text-xs" data-testid="vehicles-view-toggle">
              <button onClick={() => setView('list')} data-testid="vehicles-view-list"
                className={`inline-flex items-center gap-1 px-2.5 py-1.5 ${view === 'list' ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                <ListIcon size={12} /> List
              </button>
              <button onClick={() => setView('map')} data-testid="vehicles-view-map"
                className={`inline-flex items-center gap-1 px-2.5 py-1.5 ${view === 'map' ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                <MapIcon size={12} /> Map
              </button>
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
          ) : view === 'map' ? (
            <VehicleMap vehicles={vehicles} />
          ) : (
            <ul className="divide-y divide-slate-100 max-h-[70vh] overflow-y-auto">
              {vehicles.map((v) => (
                <li key={v.id} className="p-3 hover:bg-slate-50" data-testid={`vehicle-${v.id}`}>
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${v.status === 'online' ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                    <div className="font-medium text-sm truncate flex-1">{v.label}</div>
                    {v.speed_kph != null && v.speed_kph > 0 && <span className="text-xs text-slate-500">{v.speed_kph} km/h</span>}
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setActiveMapVehicle(v); }}
                      title="Show position on map"
                      aria-label={`Show ${v.label} on map`}
                      data-testid={`vehicle-pin-${v.id}`}
                      className="inline-flex items-center justify-center w-7 h-7 rounded-lg border border-brand-blue/30 text-brand-blue hover:bg-brand-blue hover:text-white hover:border-brand-blue transition-colors"
                    >
                      <MapPin size={13} />
                    </button>
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

      <VehicleMapModal
        vehicle={activeMapVehicle}
        open={!!activeMapVehicle}
        onClose={() => setActiveMapVehicle(null)}
      />
    </div>
  );
}

// MapPin import is no longer used in the body but kept around in case the
// empty-state copy ever references it again.
// eslint-disable-next-line no-unused-vars
const _MapPinFallback = MapPin;
