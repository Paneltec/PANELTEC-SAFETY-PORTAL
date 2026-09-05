/**
 * v58.13.127 — AssetMapModal
 *
 * Popup with an embedded OpenStreetMap (via Leaflet + react-leaflet)
 * centered on an asset's last-known GPS position.
 *
 * Data source: `asset.last_known_lat` + `asset.last_known_lng` +
 * `asset.navixy_last_position_time` (all synced by the 15-min
 * Navixy scheduler). 100% of Stephen's 72 Navixy assets have
 * populated coords, so this modal opens cleanly for every one.
 *
 * Design notes:
 *   · OpenStreetMap tiles — free, no API key, Tasmania-street-level.
 *   · Zoom 14 (street level).
 *   · Marker hover-tooltip: rego + humanised last-seen.
 *   · No marker-click popup (the modal itself is dedicated to one
 *     asset, so an extra popup layer is noise).
 *   · Google-Maps deep-link button opens native app on mobile.
 */
import React, { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Tooltip } from 'react-leaflet';
import L from 'leaflet';
import { X, MapPin, ExternalLink, Wifi, WifiOff } from 'lucide-react';

// Leaflet's default marker icons don't resolve under Vite/Webpack
// without an inline URL override. Standard workaround:
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// v58.13.127 — React 18 StrictMode compatibility patch.
// StrictMode double-invokes effects, so Leaflet's _initContainer
// fires twice on the same DOM node. The second call throws because
// the node already carries a `_leaflet_id`. The community-accepted
// fix is to strip the stamp on entry so the second init reclaims
// the container instead of throwing. Runs once at module load.
if (!L.Map.prototype._v127_strict_patched) {
  const _initOrig = L.Map.prototype._initContainer;
  L.Map.prototype._initContainer = function (id) {
    // If the passed element already carries a _leaflet_id, drop it
    // before delegating so StrictMode's second render succeeds.
    const el = typeof id === 'string' ? document.getElementById(id) : id;
    if (el && el._leaflet_id) {
      delete el._leaflet_id;
    }
    return _initOrig.call(this, id);
  };
  L.Map.prototype._v127_strict_patched = true;
}

function humaniseSince(iso) {
  if (!iso) return 'never';
  const then = new Date(iso.replace(' ', 'T'));
  if (isNaN(then.getTime())) return iso;
  const secs = Math.max(0, (Date.now() - then.getTime()) / 1000);
  if (secs < 60) return `${Math.floor(secs)}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86_400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86_400)}d ago`;
}

/**
 * v58.13.127 — Leaflet + React 18 StrictMode compatibility.
 *
 * react-leaflet 4.x + React 18 StrictMode collides on effect
 * double-invocation ("Map container is already initialized"). The
 * canonical workaround is to defer rendering the MapContainer by
 * one tick so the StrictMode dry-run has fully unmounted before the
 * real mount attaches the Leaflet instance.
 */
function StrictModeSafeMap({ lat, lng, rego, seenAgo, mapKey }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 0);
    return () => clearTimeout(t);
  }, []);
  if (!ready) {
    return (
      <div className="flex items-center justify-center h-[420px] text-slate-400 text-xs">
        Loading map…
      </div>
    );
  }
  return (
    <MapContainer key={mapKey} center={[lat, lng]} zoom={14} scrollWheelZoom
                  style={{ height: '420px', width: '100%' }}
                  data-testid="asset-map-container">
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <Marker position={[lat, lng]}>
        <Tooltip permanent={false} direction="top" offset={[0, -34]}>
          <div className="text-xs">
            <div className="font-bold">{rego}</div>
            <div>last seen {seenAgo}</div>
          </div>
        </Tooltip>
      </Marker>
    </MapContainer>
  );
}

export default function AssetMapModal({ asset, onClose }) {
  if (!asset) return null;
  const lat = asset.last_known_lat;
  const lng = asset.last_known_lng;
  const hasCoords = typeof lat === 'number' && typeof lng === 'number';
  const rego = asset.rego_serial || asset.name || 'Unknown';
  const seenAgo = humaniseSince(asset.navixy_last_position_time);
  const gmaps = hasCoords ? `https://www.google.com/maps?q=${lat},${lng}` : null;

  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4"
         data-testid="asset-map-modal"
         onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-200">
          <MapPin size={18} className="text-violet-600" />
          <div className="flex-1 min-w-0">
            <div className="font-bold text-slate-900 tabular-nums" data-testid="asset-map-rego">
              {rego}
            </div>
            <div className="text-xs text-slate-500 truncate" data-testid="asset-map-name">
              {asset.name || '—'}
            </div>
          </div>
          <button onClick={onClose}
                  data-testid="asset-map-close"
                  className="p-1.5 rounded-md hover:bg-slate-100 text-slate-500 hover:text-slate-800">
            <X size={18} />
          </button>
        </div>

        {/* Map */}
        <div className="relative bg-slate-100" style={{ minHeight: '420px' }}>
          {hasCoords ? (
            <StrictModeSafeMap
              lat={lat} lng={lng} rego={rego} seenAgo={seenAgo}
              mapKey={`map-${asset.id}-${lat.toFixed(4)}-${lng.toFixed(4)}`}
            />
          ) : (
            <div className="flex items-center justify-center h-[420px] text-slate-500 text-sm gap-2"
                 data-testid="asset-map-no-coords">
              <WifiOff size={18} className="text-slate-400" />
              No GPS ping received yet — tracker is provisioned but has not reported a position.
            </div>
          )}
        </div>

        {/* Footer readouts */}
        <div className="px-5 py-3 border-t border-slate-200 flex items-center gap-4 flex-wrap text-xs">
          <div className="flex items-center gap-1.5 tabular-nums" data-testid="asset-map-coords">
            <span className="font-bold text-slate-500 uppercase tracking-wider text-[10px]">Coords</span>
            <span className="font-mono text-slate-900">
              {hasCoords ? `${lat.toFixed(6)}, ${lng.toFixed(6)}` : '—'}
            </span>
          </div>
          <div className="flex items-center gap-1.5" data-testid="asset-map-lastseen">
            <span className="font-bold text-slate-500 uppercase tracking-wider text-[10px]">Last seen</span>
            <span className="text-slate-900">{seenAgo}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Wifi size={12} className={asset.navixy_device_id ? 'text-emerald-600' : 'text-slate-400'} />
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
              asset.navixy_device_id ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'
            }`}>
              {asset.navixy_device_id ? 'Navixy · connected' : 'Manual'}
            </span>
          </div>
          <div className="flex-1" />
          {gmaps && (
            <a href={gmaps} target="_blank" rel="noopener noreferrer"
               data-testid="asset-map-gmaps-link"
               className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800">
              Open in Google Maps <ExternalLink size={12} />
            </a>
          )}
        </div>
        <div className="px-5 pb-2 text-[10px] text-slate-400 text-right">
          &copy; OpenStreetMap contributors
        </div>
      </div>
    </div>
  );
}
