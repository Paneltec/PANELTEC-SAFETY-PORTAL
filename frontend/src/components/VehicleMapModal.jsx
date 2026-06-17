import React from 'react';
import { MapPin, ExternalLink } from 'lucide-react';
import { Dialog, DialogContent } from './ui/dialog';

export default function VehicleMapModal({ vehicle, open, onClose }) {
  if (!vehicle) return null;
  const hasGps = typeof vehicle.lat === 'number' && typeof vehicle.lng === 'number';
  const isLive = vehicle.status !== 'offline';
  const trackerId = vehicle.id;
  const directionsHref = hasGps
    ? `https://www.google.com/maps/dir/?api=1&destination=${vehicle.lat},${vehicle.lng}`
    : null;
  const navixyHref = trackerId ? `https://my.us.navixy.com/?tracker=${trackerId}` : null;
  const embedSrc = hasGps
    ? `https://maps.google.com/maps?q=${vehicle.lat},${vehicle.lng}&z=15&output=embed`
    : null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl p-0 gap-0 overflow-hidden" data-testid="vehicle-map-modal">
        {/* Header */}
        <div className="px-5 py-3 border-b border-slate-200 bg-white">
          <div className="font-display text-base font-semibold text-slate-900 truncate" data-testid="vmm-label">
            {vehicle.label || 'Vehicle'}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-slate-500">
            <span className={`w-1.5 h-1.5 rounded-full ${isLive ? 'bg-emerald-500' : 'bg-slate-400'}`} />
            <span className={isLive ? 'text-emerald-700 font-semibold' : 'text-slate-500 font-semibold'}>
              GPS {isLive ? 'Live' : 'Offline'}
            </span>
            <span className="text-slate-300">·</span>
            <span>Tracker ID <span className="font-mono normal-case text-slate-600">{trackerId}</span></span>
          </div>
        </div>

        {/* Body — edge to edge */}
        <div className="h-[600px] bg-slate-100 relative" data-testid="vehicle-map-body">
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
          ) : (
            <iframe
              title={`Map of ${vehicle.label || 'vehicle'}`}
              src={embedSrc}
              width="100%"
              height="100%"
              style={{ border: 0, display: 'block' }}
              loading="lazy"
              allowFullScreen
              referrerPolicy="no-referrer-when-downgrade"
              data-testid="vmm-iframe"
            />
          )}
        </div>

        {/* Bottom strip — only when GPS */}
        {hasGps && (
          <div className="px-4 py-2 border-t border-slate-200 bg-white flex items-center justify-between text-xs" data-testid="vmm-strip">
            <div className="font-mono text-slate-600 tabular-nums" data-testid="vmm-coords">
              {vehicle.lat.toFixed(5)}, {vehicle.lng.toFixed(5)}
            </div>
            <div className="flex items-center gap-4">
              {directionsHref && (
                <a href={directionsHref} target="_blank" rel="noopener noreferrer"
                   className="inline-flex items-center gap-1 text-brand-blue hover:underline font-medium"
                   data-testid="vmm-directions">
                  Directions <ExternalLink size={11} />
                </a>
              )}
              {navixyHref && (
                <a href={navixyHref} target="_blank" rel="noopener noreferrer"
                   className="inline-flex items-center gap-1 text-brand-blue hover:underline font-medium"
                   data-testid="vmm-navixy">
                  Open in Navixy <ExternalLink size={11} />
                </a>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
