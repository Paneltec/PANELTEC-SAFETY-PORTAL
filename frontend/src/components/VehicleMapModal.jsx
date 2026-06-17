import React from 'react';
import { GoogleMap, Marker, InfoWindow, useJsApiLoader } from '@react-google-maps/api';
import { MapPin } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from './ui/dialog';
import { useGoogleMapsKey } from '../lib/googleMaps';

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

function pinSymbol(color, isOnline) {
  if (typeof window === 'undefined' || !window.google?.maps) return undefined;
  return {
    path: 'M12 2C7.6 2 4 5.6 4 10c0 6 8 12 8 12s8-6 8-12c0-4.4-3.6-8-8-8z',
    fillColor: '#' + (color || '2C6BFF').replace('#', ''),
    fillOpacity: 1,
    strokeColor: isOnline ? '#10B981' : '#475569',
    strokeWeight: 2,
    scale: 1.6,
    anchor: new window.google.maps.Point(12, 22),
  };
}

function MapBody({ vehicle, apiKey }) {
  const { isLoaded } = useJsApiLoader({ id: 'paneltec-gmaps', googleMapsApiKey: apiKey });
  if (!isLoaded) return <div className="h-full flex items-center justify-center text-sm text-slate-500">Loading map…</div>;
  const color = vehicle.tags?.[0]?.color;
  return (
    <GoogleMap
      mapContainerStyle={{ width: '100%', height: '100%' }}
      center={{ lat: vehicle.lat, lng: vehicle.lng }}
      zoom={15}
      options={{ mapTypeControl: true, streetViewControl: false, fullscreenControl: true }}
    >
      <Marker position={{ lat: vehicle.lat, lng: vehicle.lng }} icon={pinSymbol(color, vehicle.status === 'online')}>
        <InfoWindow position={{ lat: vehicle.lat, lng: vehicle.lng }}>
          <div className="text-xs space-y-1 min-w-[180px]" style={{ color: '#1F2937' }}>
            <div className="font-semibold text-sm">{vehicle.label}</div>
            <div>{vehicle.plate || '—'} · {relTime(vehicle.last_seen)}</div>
            {vehicle.movement_status && <div className="capitalize">Movement: {vehicle.movement_status}</div>}
            {vehicle.speed_kph != null && vehicle.speed_kph > 0 && <div>{vehicle.speed_kph} km/h</div>}
            {vehicle.address && <div style={{ fontStyle: 'italic' }}>{vehicle.address}</div>}
          </div>
        </InfoWindow>
      </Marker>
    </GoogleMap>
  );
}

export default function VehicleMapModal({ vehicle, open, onClose }) {
  const apiKey = useGoogleMapsKey();
  if (!vehicle) return null;
  const hasGps = typeof vehicle.lat === 'number' && typeof vehicle.lng === 'number';
  const lastReported = vehicle.last_seen ? new Date(vehicle.last_seen).toLocaleString() : null;

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
              <div className="w-16 h-16 rounded-2xl bg-white border border-slate-200 flex items-center justify-center mb-4">
                <MapPin size={28} className="text-slate-400" />
              </div>
              <h4 className="font-display text-xl font-semibold">Position not currently available</h4>
              <p className="mt-1.5 text-sm text-slate-600 max-w-sm">
                This vehicle has not reported a GPS position recently. Try again when the tracker is online.
              </p>
            </div>
          ) : apiKey === null ? (
            <div className="h-full flex flex-col items-center justify-center text-center px-6" data-testid="vehicle-map-no-key">
              <MapPin size={28} className="text-slate-400 mb-3" />
              <h4 className="font-display text-lg font-semibold">Google Maps not configured</h4>
              <p className="mt-1 text-sm text-slate-600 max-w-sm">
                Configure Google Maps in <a href="/app/settings/integrations/google-maps" className="text-brand-blue underline">Settings → Integrations</a> to enable map view.
              </p>
            </div>
          ) : apiKey === undefined ? (
            <div className="h-full flex items-center justify-center text-sm text-slate-500">Loading map…</div>
          ) : (
            <MapBody vehicle={vehicle} apiKey={apiKey} />
          )}
        </div>

        <DialogFooter className="px-5 py-2.5 border-t border-slate-200 bg-slate-50 flex-row items-center justify-between sm:justify-between gap-2">
          {lastReported ? (
            <div className="text-[11px] text-slate-500">Last reported: <span className="font-medium text-slate-700">{lastReported}</span></div>
          ) : <span />}
          <button onClick={onClose} data-testid="vehicle-map-close"
            className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 hover:bg-white">
            Close
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
