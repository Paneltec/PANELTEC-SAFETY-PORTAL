// Phase 3.11 — Per-worker Inductions card shown inside the worker drawer.
// Compact list of induction cells for the selected worker, pulled from the
// live matrix and filtered client-side.
import { useEffect, useState } from 'react';
import { Loader2, CalendarOff, Check } from 'lucide-react';
import api, { apiError } from '../lib/api';
import { toast } from 'sonner';

const STATUS_CHIP = {
  current:        { label: 'Current',  cls: 'bg-[#d8ecdd] text-[#1f7a3f]' },
  expiring:       { label: 'Expiring', cls: 'bg-[#fef3c7] text-[#92400e]' },
  expired:        { label: 'Expired',  cls: 'bg-[#fbe4e7] text-[#7a1f33]' },
  not_held:       { label: 'Not held', cls: 'bg-slate-100 text-slate-500' },
  held_no_expiry: { label: 'Held',     cls: 'bg-[#e6eff9] text-[#1e4a8c]' },
  invalid_date:   { label: 'Invalid',  cls: 'bg-[#fbe4e7] text-[#7a1f33]' },
  unknown:        { label: '—',        cls: 'bg-slate-50 text-slate-400 border border-dashed border-slate-300' },
};

export default function WorkerInductionsCard({ workerId }) {
  const [row, setRow] = useState(null);
  const [cols, setCols] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        const { data } = await api.get('/workers/inductions/matrix');
        if (!alive) return;
        setCols(data.columns);
        setRow(data.rows.find((r) => r.id === workerId) || null);
      } catch (e) { toast.error(apiError(e)); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [workerId]);

  if (loading) {
    return (
      <div className="text-xs text-slate-400 inline-flex items-center gap-2">
        <Loader2 size={12} className="animate-spin" /> Loading inductions…
      </div>
    );
  }
  if (!row || cols.length === 0) {
    return (
      <p className="text-xs text-slate-400 italic">No induction columns set up. Import an .xlsx from the Inductions Matrix tab.</p>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" data-testid={`worker-inductions-${workerId}`}>
      {cols.map((c) => {
        const cell = row.cells[c.column_key];
        const meta = STATUS_CHIP[cell?.status || 'unknown'];
        return (
          <div key={c.column_key} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-slate-50 border border-slate-100">
            <div className="min-w-0">
              <div className="text-[11px] font-medium text-slate-900 truncate">{c.header}</div>
              <div className="text-[10px] uppercase tracking-wider text-slate-400">{c.category.replace('_', ' ')}</div>
            </div>
            <div className="flex flex-col items-end gap-1 flex-shrink-0">
              <span className={`inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded ${meta.cls}`}>
                {cell?.not_held ? <CalendarOff size={9} className="mr-1" /> : null}
                {cell?.held_no_expiry ? <Check size={9} className="mr-1" /> : null}
                {meta.label}
              </span>
              {cell?.expiry_date && (
                <span className="text-[10px] font-mono text-slate-500">
                  {cell.expiry_date.slice(8, 10)}/{cell.expiry_date.slice(5, 7)}/{cell.expiry_date.slice(2, 4)}
                </span>
              )}
            </div>
          </div>
        );
      })}
      {(row.access?.vehicle || row.access?.building_key || row.access?.gate_key || row.access?.extras) && (
        <div className="col-span-full px-3 py-2 rounded-lg bg-[#f5f3ff] border border-[#ddd6fe]">
          <div className="text-[10px] uppercase tracking-wider font-semibold text-[#5b21b6] mb-1">Access</div>
          <div className="flex flex-wrap gap-1.5">
            {row.access.vehicle && <Tag>Vehicle</Tag>}
            {row.access.building_key && <Tag>Building key</Tag>}
            {row.access.gate_key && <Tag>Gate key</Tag>}
            {row.access.extras && <span className="text-[11px] text-slate-500">· {row.access.extras}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

const Tag = ({ children }) => (
  <span className="inline-flex items-center text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-white text-[#5b21b6]">{children}</span>
);
