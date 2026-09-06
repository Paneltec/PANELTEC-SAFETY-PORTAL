/**
 * v58.13.131c — Amber "N open fuel anomalies" banner for FleetRegister.
 *
 * Fetches `GET /fleet/fuel/anomalies?resolved=false&count_only=true`
 * on mount. Renders nothing when count is zero. Clicking navigates
 * to `/app/fleet/fuel/anomalies`.
 */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ChevronRight } from 'lucide-react';
import api from '../lib/api';

export default function FuelAnomalyBanner() {
  const [count, setCount] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.get('/fleet/fuel/anomalies', {
      params: { resolved: false, count_only: true },
    })
      .then((r) => { if (!cancelled) setCount(r.data?.count ?? 0); })
      .catch(() => { if (!cancelled) setCount(0); });
    return () => { cancelled = true; };
  }, []);

  if (!count || count <= 0) return null;

  return (
    <Link
      to="/app/fleet/fuel/anomalies"
      data-testid="fuel-anomaly-banner"
      className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 hover:bg-amber-100/70 px-4 py-3 transition-colors"
    >
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-amber-100 border border-amber-200 flex items-center justify-center">
          <AlertTriangle className="text-amber-700" size={18} />
        </div>
        <div>
          <div className="text-sm font-bold text-amber-900">
            {count} open fuel {count === 1 ? 'anomaly' : 'anomalies'}
          </div>
          <div className="text-[11px] text-amber-800/80">
            Review flagged transactions from the SmartFill CSV importer.
          </div>
        </div>
      </div>
      <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-900">
        Open inbox <ChevronRight size={13} />
      </span>
    </Link>
  );
}
