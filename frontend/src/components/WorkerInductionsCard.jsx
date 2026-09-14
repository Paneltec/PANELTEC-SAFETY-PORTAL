// Phase 3.11 — Per-worker Inductions card shown inside the worker drawer.
// Phase 3.12 — Cards now open `InductionCardModal` (view/edit/add).
import { useEffect, useState } from 'react';
import { Loader2, CalendarOff, Check, FileText, AlertTriangle } from 'lucide-react';
import api, { apiError } from '../lib/api';
import { filesUrl } from '../lib/downloadUrl';
import { toast } from 'sonner';
import InductionCardModal from './InductionCardModal';

const STATUS_CHIP = {
  current:        { label: 'Current',  cls: 'bg-[#d8ecdd] text-[#1f7a3f]' },
  expiring:       { label: 'Expiring', cls: 'bg-[#fef3c7] text-[#92400e]' },
  expired:        { label: 'Expired',  cls: 'bg-[#fbe4e7] text-[#7a1f33]' },
  not_held:       { label: 'Not held', cls: 'bg-slate-100 text-slate-500' },
  held_no_expiry: { label: 'Held',     cls: 'bg-[#e6eff9] text-[#1e4a8c]' },
  invalid_date:   { label: 'Invalid',  cls: 'bg-[#fbe4e7] text-[#7a1f33]' },
  unknown:        { label: '—',        cls: 'bg-slate-50 text-slate-400 border border-dashed border-slate-300' },
};

export default function WorkerInductionsCard({ workerId, workerName }) {
  const [row, setRow] = useState(null);
  const [cols, setCols] = useState([]);
  const [loading, setLoading] = useState(true);
  // Phase 3.12 — modal target. `{inductionId?, inductionNameHint?, mode}`.
  const [modal, setModal] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/workers/inductions/matrix');
      setCols(data.columns);
      setRow(data.rows.find((r) => r.id === workerId) || null);
    } catch (e) { toast.error(apiError(e)); }
    finally { setLoading(false); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [workerId]);

  const openCard = (col, cell) => {
    if (cell?.cert_id) {
      setModal({ inductionId: cell.cert_id, mode: 'view' });
    } else {
      // Empty slot — open in add mode with column header as the name hint.
      setModal({ inductionNameHint: col.header, mode: 'add' });
    }
  };

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
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" data-testid={`worker-inductions-${workerId}`}>
        {cols.map((c) => {
          const cell = row.cells[c.column_key];
          const meta = STATUS_CHIP[cell?.status || 'unknown'];
          // v58.13.132fg — Root cause of Mel Linford's "induction
          // records won't show when I try to view" AND "no option
          // to add records to a worker profile" reports: this card
          // was a native <button> containing FilePresenceChip's
          // inner <button>. Nested interactive elements are
          // invalid HTML — Chrome reparents the tree and the
          // outer click is swallowed. Same pattern already used
          // in the Section component (see v160.3.6b). Fix: outer
          // element is a <div role="button"> with an onKeyDown
          // handler so keyboard access still works.
          return (
            <div key={c.column_key}
              role="button" tabIndex={0}
              onClick={() => openCard(c, cell)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  openCard(c, cell);
                }
              }}
              data-testid={`induction-card-${c.column_key}`}
              className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-slate-50 border border-slate-100 text-left hover:bg-white hover:border-[#bcd2ee] hover:shadow-sm transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1e4a8c]/40">
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
                {/* v160.3.5b — per-row file-presence chip */}
                <FilePresenceChip
                  workerId={workerId}
                  cell={cell}
                />
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

      {modal && (
        <InductionCardModal
          workerId={workerId}
          workerName={workerName || row?.name}
          inductionId={modal.inductionId}
          inductionNameHint={modal.inductionNameHint}
          initialMode={modal.mode}
          onClose={() => setModal(null)}
          onSaved={() => { load(); }}
        />
      )}
    </>
  );
}

const Tag = ({ children }) => (
  <span className="inline-flex items-center text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-white text-[#5b21b6]">{children}</span>
);

// v160.3.5b — Per-row file-presence chip. Renders one of three states:
//   • Cell has a `doc_file_id` → clickable "📄 File" (green) that opens the
//     GridFS blob via the shared download-token flow (`filesUrl`).
//   • Cell exists (cert_id set) but has NO doc_file_id → "⚠ No file"
//     (orange) — a real induction record with metadata only.
//   • Cell doesn't exist yet (empty slot) → renders nothing.
function FilePresenceChip({ workerId, cell }) {
  if (!cell || !cell.cert_id) return null;
  if (!cell.doc_file_id) {
    return (
      <span
        className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-orange-50 text-orange-700 border border-orange-200"
        title="No file attached"
        data-testid={`induction-file-missing-${cell.cert_id}`}
      >
        <AlertTriangle size={9} /> No file
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={async (e) => {
        e.stopPropagation();
        try {
          const u = await filesUrl(`/workers/${workerId}/certifications/${cell.cert_id}/file`);
          window.open(u, '_blank', 'noopener,noreferrer');
        } catch (_err) { toast.error('Unable to open file'); }
      }}
      className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100"
      title="Open attached file"
      data-testid={`induction-file-open-${cell.cert_id}`}
    >
      <FileText size={9} /> File
    </button>
  );
}
