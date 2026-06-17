import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  MapPin, RefreshCw, Radio, ArrowRight, Tag as TagIcon, X as XIcon,
  Loader2, List as ListIcon, Map as MapIcon,
} from 'lucide-react';
import { GoogleMap, Marker, InfoWindow, useJsApiLoader } from '@react-google-maps/api';
import api, { apiError } from '../lib/api';
import { PageHeader } from '../components/capture/Ui';
import VehicleMapModal from '../components/VehicleMapModal';
import { useGoogleMapsKey } from '../lib/googleMaps';

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
const SYDNEY = { lat: -33.8688, lng: 151.2093 };

function loadPersistedTagIds() {
  try {
    const raw = localStorage.getItem(TAG_FILTER_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function pinSymbol(color, isOnline) {
  if (typeof window === 'undefined' || !window.google?.maps) return undefined;
  return {
    path: 'M12 2C7.6 2 4 5.6 4 10c0 6 8 12 8 12s8-6 8-12c0-4.4-3.6-8-8-8z',
    fillColor: '#' + (color || '2C6BFF').replace('#', ''),
    fillOpacity: 1,
    strokeColor: isOnline ? '#10B981' : '#475569',
    strokeWeight: 2,
    scale: 1.4,
    anchor: new window.google.maps.Point(12, 22),
  };
}

function VehicleFleetMap({ vehicles, apiKey, onMarkerClick }) {
  const { isLoaded } = useJsApiLoader({ id: 'paneltec-gmaps', googleMapsApiKey: apiKey });
  const [active, setActive] = useState(null);
  const positioned = useMemo(
    () => vehicles.filter((v) => typeof v.lat === 'number' && typeof v.lng === 'number'),
    [vehicles]
  );

  const onLoad = (map) => {
    if (positioned.length === 0) { map.setCenter(SYDNEY); map.setZoom(5); return; }
    if (positioned.length === 1) { map.setCenter({ lat: positioned[0].lat, lng: positioned[0].lng }); map.setZoom(14); return; }
    const bounds = new window.google.maps.LatLngBounds();
    positioned.forEach((v) => bounds.extend({ lat: v.lat, lng: v.lng }));
    map.fitBounds(bounds, 40);
  };

  if (!isLoaded) return <div className="h-[70vh] flex items-center justify-center text-sm text-slate-500" data-testid="vehicles-map-loading">Loading Google Maps…</div>;

  return (
    <div className="h-[70vh] rounded-b-2xl overflow-hidden" data-testid="vehicles-map">
      <GoogleMap
        mapContainerStyle={{ width: '100%', height: '100%' }}
        center={SYDNEY}
        zoom={5}
        onLoad={onLoad}
        options={{ mapTypeControl: true, streetViewControl: false, fullscreenControl: true }}
      >
        {positioned.map((v) => (
          <Marker key={v.id} position={{ lat: v.lat, lng: v.lng }}
                  icon={pinSymbol(v.tags?.[0]?.color, v.status === 'online')}
                  onClick={() => setActive(v.id)}>
            {active === v.id && (
              <InfoWindow position={{ lat: v.lat, lng: v.lng }} onCloseClick={() => setActive(null)}>
                <div className="text-xs space-y-1 min-w-[200px]" style={{ color: '#1F2937' }}>
                  <div className="font-semibold text-sm">{v.label}</div>
                  <div>{v.plate || '—'} · {v.status}</div>
                  {v.movement_status && <div className="capitalize">Movement: {v.movement_status}</div>}
                  {v.speed_kph != null && v.speed_kph > 0 && <div>{v.speed_kph} km/h</div>}
                  {v.address && <div style={{ fontStyle: 'italic' }}>{v.address}</div>}
                  {v.tags?.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, paddingTop: 4 }}>
                      {v.tags.map((t) => (
                        <span key={t.id} style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          padding: '1px 6px', borderRadius: 999, border: `1px solid #${(t.color || 'CBD5E1').replace('#','')}`,
                          color: `#${(t.color || '475569').replace('#','')}`, fontSize: 10,
                        }}>{t.name}</span>
                      ))}
                    </div>
                  )}
                  <button onClick={() => { setActive(null); onMarkerClick?.(v); }}
                          style={{ color: '#2C6BFF', textDecoration: 'underline', fontSize: 11, marginTop: 4 }}>
                    View details →
                  </button>
                </div>
              </InfoWindow>
            )}
          </Marker>
        ))}
      </GoogleMap>
    </div>
  );
}

export default function Vehicles() {
  const [data, setData] = useState(null);
  const [tags, setTags] = useState([]);
  const [selected, setSelected] = useState(() => new Set(loadPersistedTagIds()));
  const [busy, setBusy] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [view, setView] = useState('list');
  const [activeMapVehicle, setActiveMapVehicle] = useState(null);
  const apiKey = useGoogleMapsKey();

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
    } catch { /* tags optional */ }
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
            <div className="text-xs text-slate-500 italic py-4">No tags configured in Navixy yet.</div>
          ) : (
            <ul className="space-y-1" data-testid="vehicles-tag-list">
              {tags.map((t) => (
                <li key={t.id}>
                  <label className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-slate-50 cursor-pointer text-sm">
                    <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggleTag(t.id)} data-testid={`tag-toggle-${t.id}`} />
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: '#' + (t.color || '94A3B8').replace('#','') }} />
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
                  <p className="mt-1 text-sm text-slate-600 max-w-md mx-auto">Use the tags on the left to filter your vehicles.</p>
                </>
              ) : (
                <div className="text-sm text-slate-500">No vehicles match the selected tags.</div>
              )}
            </div>
          ) : view === 'map' ? (
            apiKey === null ? (
              <div className="p-10 text-center" data-testid="map-no-key">
                <MapPin size={28} className="mx-auto text-slate-400 mb-3" />
                <h4 className="font-display text-lg font-semibold">Google Maps not configured</h4>
                <p className="mt-1 text-sm text-slate-600 max-w-md mx-auto">
                  Configure Google Maps in{' '}
                  <Link to="/app/settings/integrations/google-maps" className="text-brand-blue underline">Settings → Integrations → Google Maps</Link>{' '}
                  to enable map view.
                </p>
              </div>
            ) : apiKey === undefined ? (
              <div className="p-10 text-center text-sm text-slate-500">Loading…</div>
            ) : (
              <VehicleFleetMap vehicles={vehicles} apiKey={apiKey} onMarkerClick={setActiveMapVehicle} />
            )
          ) : (
            <ul className="divide-y divide-slate-100 max-h-[70vh] overflow-y-auto">
              {vehicles.map((v, idx) => {
                const isOnline = v.status !== 'offline';
                const primary = v.tags?.[0];
                const moreCount = (v.tags?.length || 0) - 1;
                const rowBg = idx % 2 === 0 ? '#EAF3FB' : '#F2F8FC';
                return (
                <li key={v.id} className="px-4 py-3.5" style={{ backgroundColor: rowBg }} data-testid={`vehicle-${v.id}`}>
                  <div className="flex items-center gap-2">
                    <div className="font-bold text-base text-brand-blue truncate flex-1">{v.label}</div>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setActiveMapVehicle(v); }}
                      title="Show position on map"
                      aria-label={`Show ${v.label} on map`}
                      data-testid={`vehicle-pin-${v.id}`}
                      className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-white text-brand-blue hover:bg-brand-blue hover:text-white transition-colors"
                      style={{ borderWidth: 1, borderStyle: 'solid', borderColor: '#BCD8F5' }}
                    >
                      <MapPin size={14} />
                    </button>
                    {/* TODO: wire to real vehicle utilisation status */}
                    <span
                      className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider"
                      style={{ backgroundColor: '#D5EFE3', color: '#0F7A4F', border: '1px solid #A8DEC5' }}
                      data-testid={`vehicle-util-${v.id}`}
                    >
                      Free
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                    {isOnline ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-emerald-700">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Live
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-rose-700">
                        <span className="w-1.5 h-1.5 rounded-full bg-rose-500" /> Offline
                      </span>
                    )}
                    {v.speed_kph != null && v.speed_kph > 0 && (
                      <span className="text-[11px] text-slate-500">{v.speed_kph} km/h</span>
                    )}
                    {primary && (() => {
                      const c = '#' + (primary.color || '2C6BFF').replace('#', '');
                      return (
                        <span
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider"
                          style={{ backgroundColor: `${c}1A`, color: c, border: `1px solid ${c}55` }}
                          data-testid={`vehicle-tag-${v.id}`}
                        >
                          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: c }} />
                          {primary.name}
                        </span>
                      );
                    })()}
                    {moreCount > 0 && (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold text-slate-500 bg-white border border-slate-200">
                        +{moreCount} more
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500">
                    {v.plate || '—'} · <RelTime iso={v.last_seen} />
                    {v.movement_status ? ` · ${v.movement_status}` : ''}
                  </div>
                  {v.address && <div className="text-[11px] text-slate-400 truncate">{v.address}</div>}
                </li>
                );
              })}
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
