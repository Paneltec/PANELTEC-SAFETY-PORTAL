// Phase 3.11 — Inductions Import Wizard
//
// Three steps:
//   1. URL — paste an .xlsx URL (Google Drive, OneDrive share, S3 — anything
//      anonymously fetchable). The backend pulls and parses it.
//   2. Preview — matched workers / unmatched workers / low-confidence cells
//      are surfaced. NO writes happen yet. The user can untick rows they
//      don't want to import.
//   3. Commit — fire POST /import-xlsx/commit with the filtered payload.
//
// Skip-and-flag policy: low-confidence and unparseable cells are NEVER
// written. They surface in a "Needs review" panel for the admin to fix
// manually after commit.
import { useState } from 'react';
import { X, Loader2, Upload, CheckCircle2, AlertTriangle, FileWarning } from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../lib/api';

const STATUS_PILL = {
  high:        'bg-[#d8ecdd] text-[#1f7a3f]',
  medium:      'bg-[#fef3c7] text-[#92400e]',
  low:         'bg-[#fde9c8] text-[#7a3f10]',
  unparseable: 'bg-[#fbe4e7] text-[#7a1f33]',
};

export default function InductionImportWizard({ onClose, onCommitted }) {
  const [step, setStep] = useState(1);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const [rowSel, setRowSel] = useState({});   // {worker_id: true}
  const [accSel, setAccSel] = useState({});

  const fetchPreview = async () => {
    if (!url.trim()) { toast.error('Paste an .xlsx URL first'); return; }
    setBusy(true);
    try {
      const { data } = await api.post('/workers/inductions/import-xlsx', { url: url.trim() });
      setPreview(data);
      // Default-select every matched worker row + every matched access row.
      const r = {}; (data.inductions?.matched_rows || []).forEach((row) => { if (row.worker_id) r[row.worker_id] = true; });
      const a = {}; (data.accessibilities?.matched_rows || []).forEach((row) => { if (row.worker_id) a[row.worker_id] = true; });
      setRowSel(r); setAccSel(a);
      setStep(2);
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };

  const commit = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const inductions = (preview.inductions.matched_rows || [])
        .filter((r) => rowSel[r.worker_id])
        .map((r) => ({
          worker_id: r.worker_id,
          cells: r.cells
            // Skip-and-flag: only write high/medium confidence with a real signal.
            .filter((c) => ['high', 'medium'].includes(c.confidence) && (c.date || c.not_held || c.held))
            .map((c) => ({
              column_key: c.column_key, header: c.header, category: c.category,
              date: c.date || null, not_held: !!c.not_held, held: !!c.held,
              confidence: c.confidence,
            })),
        }))
        .filter((r) => r.cells.length > 0);
      const access = (preview.accessibilities.matched_rows || [])
        .filter((r) => accSel[r.worker_id])
        .map((r) => ({ worker_id: r.worker_id, vehicle: !!r.vehicle,
          building_key: !!r.building_key, gate_key: !!r.gate_key, extras: r.extras || '' }));
      const { data } = await api.post('/workers/inductions/import-xlsx/commit', { inductions, access });
      toast.success(`Imported · ${data.certifications.inserted} new · ${data.certifications.updated} updated · ${data.access.upserted} access rows`);
      onCommitted?.();
      onClose?.();
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm"
         onClick={(e) => e.target === e.currentTarget && onClose?.()} data-testid="induction-wizard">
      <div className="w-full max-w-5xl bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]">
        {/* header */}
        <div className="px-6 py-4 border-b border-slate-200 bg-[#f5f3ff] flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-[0.16em] font-semibold text-[#5b21b6]">Phase 3.11 · Import wizard</div>
            <h2 className="font-display text-xl font-semibold text-slate-900 mt-0.5">Import inductions matrix</h2>
            <p className="text-xs text-slate-500 mt-1">
              Step {step} of 3 · {step === 1 ? 'Paste .xlsx URL' : step === 2 ? 'Review matches' : 'Commit'}
            </p>
          </div>
          <button onClick={onClose} data-testid="wizard-close"
            className="p-2 rounded-lg text-slate-500 hover:bg-white/60"><X size={16} /></button>
        </div>

        {/* body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {step === 1 && (
            <div className="space-y-4">
              <p className="text-sm text-slate-600">
                Paste a public URL to your Excel inductions tracker (.xlsx). The first sheet should be
                an inductions table with worker names in column A and certification columns across the top.
                A second sheet named &ldquo;Accessibilities&rdquo; with vehicle/key columns is optional.
              </p>
              <label className="block">
                <span className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">.xlsx URL</span>
                <input value={url} onChange={(e) => setUrl(e.target.value)}
                  data-testid="wizard-url-input" autoFocus
                  placeholder="https://…/Employee-Inductions.xlsx"
                  className="mt-1 w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/30" />
              </label>
              <div className="bg-[#f5f3ff] border border-[#ddd6fe] rounded-lg p-3 text-xs text-[#5b21b6]">
                <strong>Skip-and-flag parsing:</strong> Ambiguous dates (e.g. <code>06/24</code>, <code>10/1124</code>)
                and typos won&rsquo;t be silently guessed. They&rsquo;ll appear in a &ldquo;Needs review&rdquo; list so you
                can fix them manually.
              </div>
            </div>
          )}

          {step === 2 && preview && (
            <div className="space-y-5">
              {/* summary chips */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <SummaryChip label="Matched workers" value={preview.summary.matched_workers} tone="green" />
                <SummaryChip label="Unmatched"       value={preview.summary.unmatched_workers} tone="amber" />
                <SummaryChip label="Columns"          value={preview.summary.induction_columns} tone="blue" />
                <SummaryChip label="Needs review"     value={preview.summary.low_confidence_cells} tone="red" />
              </div>

              {/* matched rows */}
              <section>
                <h3 className="text-sm font-semibold text-slate-900 mb-2">Matched workers ({preview.inductions.matched_rows.length})</h3>
                <div className="border border-slate-200 rounded-lg max-h-72 overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-slate-500 text-[10px] uppercase tracking-wider">
                      <tr>
                        <th className="w-8 px-2 py-2"></th>
                        <th className="text-left px-3 py-2">Worker</th>
                        <th className="text-left px-3 py-2">Will write</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.inductions.matched_rows.map((r) => {
                        const writable = r.cells.filter((c) => ['high', 'medium'].includes(c.confidence) && (c.date || c.not_held || c.held));
                        return (
                          <tr key={r.worker_id} className="border-t border-slate-100"
                              data-testid={`wizard-row-${r.worker_id}`}>
                            <td className="px-2 py-2">
                              <input type="checkbox" checked={!!rowSel[r.worker_id]}
                                onChange={() => setRowSel({ ...rowSel, [r.worker_id]: !rowSel[r.worker_id] })}
                                className="w-3.5 h-3.5" />
                            </td>
                            <td className="px-3 py-2 text-slate-900 font-medium">{r.worker_name}</td>
                            <td className="px-3 py-2">
                              <div className="flex flex-wrap gap-1.5">
                                {writable.length === 0 && <span className="text-slate-400 italic">no usable cells</span>}
                                {writable.map((c) => (
                                  <span key={c.column_key}
                                    className={`inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded ${STATUS_PILL[c.confidence] || ''}`}>
                                    {c.header}: {c.date || (c.not_held ? 'not held' : c.held ? 'held' : '—')}
                                  </span>
                                ))}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* unmatched */}
              {preview.inductions.unmatched_rows.length > 0 && (
                <section>
                  <h3 className="text-sm font-semibold text-slate-900 mb-2 flex items-center gap-2">
                    <AlertTriangle size={14} className="text-amber-500" />
                    Unmatched names ({preview.inductions.unmatched_rows.length})
                  </h3>
                  <p className="text-xs text-slate-500 mb-2">
                    These rows weren&rsquo;t matched to an existing worker. Add the worker first, then re-run the import.
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {preview.inductions.unmatched_rows.map((r) => (
                      <span key={r.row} className="inline-flex items-center text-xs px-2 py-1 rounded bg-amber-50 text-amber-800 border border-amber-200">
                        {r.raw_name}
                      </span>
                    ))}
                  </div>
                </section>
              )}

              {/* low confidence */}
              {preview.inductions.low_confidence_cells.length > 0 && (
                <section>
                  <h3 className="text-sm font-semibold text-slate-900 mb-2 flex items-center gap-2">
                    <FileWarning size={14} className="text-red-500" />
                    Needs review — won&rsquo;t be written ({preview.inductions.low_confidence_cells.length})
                  </h3>
                  <div className="border border-red-200 rounded-lg max-h-44 overflow-auto bg-red-50/40">
                    <table className="w-full text-xs">
                      <thead className="bg-red-100/60 text-red-900 text-[10px] uppercase tracking-wider">
                        <tr>
                          <th className="text-left px-3 py-2">Worker</th>
                          <th className="text-left px-3 py-2">Column</th>
                          <th className="text-left px-3 py-2">Raw value</th>
                          <th className="text-left px-3 py-2">Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.inductions.low_confidence_cells.map((c, i) => (
                          <tr key={i} className="border-t border-red-100">
                            <td className="px-3 py-1.5 font-medium">{c.worker_name}</td>
                            <td className="px-3 py-1.5">{c.column}</td>
                            <td className="px-3 py-1.5 font-mono text-[11px]">{c.raw}</td>
                            <td className="px-3 py-1.5 text-red-700 text-[11px]">{c.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              {/* accessibilities */}
              {preview.accessibilities.matched_rows.length > 0 && (
                <section>
                  <h3 className="text-sm font-semibold text-slate-900 mb-2">Accessibilities ({preview.accessibilities.matched_rows.length})</h3>
                  <div className="border border-slate-200 rounded-lg max-h-44 overflow-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
                        <tr>
                          <th className="w-8 px-2 py-2"></th>
                          <th className="text-left px-3 py-2">Worker</th>
                          <th className="text-left px-3 py-2">Vehicle</th>
                          <th className="text-left px-3 py-2">Building key</th>
                          <th className="text-left px-3 py-2">Gate key</th>
                          <th className="text-left px-3 py-2">Extras</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.accessibilities.matched_rows.map((r) => (
                          <tr key={r.row} className="border-t border-slate-100">
                            <td className="px-2 py-1.5">
                              <input type="checkbox" checked={!!accSel[r.worker_id]}
                                onChange={() => setAccSel({ ...accSel, [r.worker_id]: !accSel[r.worker_id] })}
                                className="w-3.5 h-3.5" />
                            </td>
                            <td className="px-3 py-1.5 font-medium">{r.raw_name}</td>
                            <td className="px-3 py-1.5">{r.vehicle ? '✓' : '—'}</td>
                            <td className="px-3 py-1.5">{r.building_key ? '✓' : '—'}</td>
                            <td className="px-3 py-1.5">{r.gate_key ? '✓' : '—'}</td>
                            <td className="px-3 py-1.5 text-slate-500">{r.extras}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="flex flex-col items-center justify-center py-10">
              <CheckCircle2 size={36} className="text-emerald-500 mb-3" />
              <h3 className="font-semibold text-slate-900">Ready to commit</h3>
              <p className="text-xs text-slate-500 mt-1">This will write to certifications and access records.</p>
            </div>
          )}
        </div>

        {/* footer */}
        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
          <button onClick={onClose} className="text-sm text-slate-500 hover:text-slate-900">Cancel</button>
          {step === 1 && (
            <button onClick={fetchPreview} disabled={busy || !url.trim()}
              data-testid="wizard-fetch"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-blue text-white text-sm font-semibold hover:bg-blue-600 disabled:opacity-60">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Fetch & preview
            </button>
          )}
          {step === 2 && (
            <div className="flex gap-2">
              <button onClick={() => setStep(1)} className="text-sm text-slate-500 hover:text-slate-900">← Back</button>
              <button onClick={commit} disabled={busy}
                data-testid="wizard-commit"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-60">
                {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Commit import
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SummaryChip({ label, value, tone = 'blue' }) {
  const tints = {
    green: 'bg-[#d8ecdd] text-[#1f7a3f]',
    amber: 'bg-[#fef3c7] text-[#92400e]',
    blue:  'bg-[#e6eff9] text-[#1e4a8c]',
    red:   'bg-[#fbe4e7] text-[#7a1f33]',
  };
  return (
    <div className={`rounded-lg px-3 py-2 ${tints[tone]}`}>
      <div className="text-[10px] uppercase tracking-wider font-semibold opacity-80">{label}</div>
      <div className="text-2xl font-semibold leading-tight mt-0.5">{value}</div>
    </div>
  );
}
