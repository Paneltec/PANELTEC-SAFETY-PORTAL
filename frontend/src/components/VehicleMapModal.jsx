import React from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapPin } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from './ui/dialog';

function pinIcon(color, online) {
  const fill = color || '#2C6BFF';
  const ring = online ? '#10B981' : '#94A3B8';
  const html = `
    <div style="position:relative;width:28px;height:38px">
      <div style="position:absolute;left:2px;top:2px;width:24px;height:24px;border-radius:50%;background:${fill};border:3px solid ${ring};box-shadow:0 2px 6px rgba(0,0,0,.4)"></div>
      <div style="position:absolute;left:11px;top:22px;width:0;height:0;border-left:3px solid transparent;border-right:3px solid transparent;border-top:10px solid ${fill}"></div>
    </div>`;
  return L.divIcon({
    html, className: 'paneltec-vehicle-pin-modal', iconSize: [28, 38], iconAnchor: [14, 36], popupAnchor: [0, -34],
  });
}

function relTime(iso) {
  if (!iso) return '—';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (Number.isNaN(mins)) return iso;
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 60 / 24)}d ago`;
}

function statusPillClass(status) {
  switch (status) {
    case 'online':
    case 'active': return 'bg-emerald-100 text-emerald-800';
    case 'idle':   return 'bg-amber-100 text-amber-800';
    default:       return 'bg-slate-200 text-slate-600';
  }
}

export default function VehicleMapModal({ vehicle, open, onClose }) {
  if (!vehicle) return null;
  const hasGps = typeof vehicle.lat === 'number' && typeof vehicle.lng === 'number';
  const color = vehicle.tags?.[0]?.color;
  const lastReported = vehicle.last_seen
    ? new Date(vehicle.last_seen).toLocaleString()
    : 'unknown';

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl p-0 gap-0 overflow-hidden" data-testid="vehicle-map-modal">
        <DialogHeader className="px-5 py-3 border-b border-slate-200 bg-white">
          <DialogTitle className="flex items-center gap-3 text-base">
            <MapPin size={16} className="text-brand-blue" />
            <span className="truncate">{vehicle.label || 'Vehicle'}</span>
            <span className="text-xs text-slate-500 font-normal">{vehicle.plate || '—'}</span>
            <span className={`ml-auto text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase ${statusPillClass(vehicle.status)}`}
                  data-testid="vehicle-map-status">
              ● {vehicle.status || 'offline'}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="h-[500px] bg-slate-100" data-testid="vehicle-map-body">
          {!hasGps ? (
            <div className="h-full flex flex-col items-center justify-center text-center px-6" data-testid="vehicle-map-no-gps">
              <div className="w-14 h-14 rounded-2xl bg-white border border-slate-200 flex items-center justify-center mb-3">
                <MapPin size={24} className="text-slate-400" />
              </div>
              <h4 className="font-display text-lg font-semibold">No GPS position available</h4>
              <p className="mt-1 text-sm text-slate-600 max-w-sm">
                This vehicle hasn't reported a GPS position yet. Check the tracker is online in Navixy.
              </p>
            </div>
          ) : (
            <MapContainer center={[vehicle.lat, vehicle.lng]} zoom={15} scrollWheelZoom className="w-full h-full">
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <Marker position={[vehicle.lat, vehicle.lng]}
                      icon={pinIcon(color, vehicle.status === 'online')}>
                <Popup autoOpen autoClose={false} closeOnClick={false}>
                  <div className="text-xs space-y-1 min-w-[180px]">
                    <div className="font-semibold text-sm">{vehicle.label}</div>
                    <div className="text-slate-500">{vehicle.plate || '—'} · {relTime(vehicle.last_seen)}</div>
                    {vehicle.speed_kph != null && vehicle.speed_kph > 0 && (
                      <div className="text-slate-500">{vehicle.speed_kph} km/h</div>
                    )}
                    {vehicle.address && <div className="text-slate-500 italic">{vehicle.address}</div>}
                  </div>
                </Popup>
              </Marker>
            </MapContainer>
          )}
        </div>

        <DialogFooter className="px-5 py-2.5 border-t border-slate-200 bg-slate-50 flex-row items-center justify-between sm:justify-between gap-2">
          <div className="text-[11px] text-slate-500">Last reported: <span className="font-medium text-slate-700">{lastReported}</span></div>
          <button onClick={onClose} data-testid="vehicle-map-close"
            className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 hover:bg-white">
            Close
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
