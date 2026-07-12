import React, { useCallback, useState } from 'react';
import { Upload, Loader2, Check, X as XIcon, AlertCircle, Users, Sparkles } from 'lucide-react';
import api, { apiError } from '../../lib/api';
import { toast } from 'sonner';
import { UnmatchedSuggestions } from './SimproZipUploadModal';

// v160.3.3 — Bulk multi-ZIP upload. Drops N ZIPs at once, auto-identifies
// which worker each ZIP belongs to via `/identify-zip`, admins can override
// any auto-match via a dropdown, then commits sequentially.
// v160.3.4 — adds a "Review unmatched" step between identify and commit
// that combines auto-taxonomy suggestions across all ZIPs.
export function BulkSimproZipModal({ onClose, onDone }) {
  const [phase, setPhase] = useState('idle'); // idle | identifying | ready | reviewing | running | done | error
  const [zips, setZips] = useState([]);         // [{file, name, matched_worker, match_score, tokens}]
  const [workers, setWorkers] = useState([]);
  const [results, setResults] = useState([]);
  const [error, setError] = useState(null);
  // v160.3.4 — combined unmatched suggestion state
  const [combinedGroups, setCombinedGroups] = useState([]);
  const [acceptChecked, setAcceptChecked] = useState({});
  const [applyingSuggestions, setApplyingSuggestions] = useState(false);

  React.useEffect(() => {
    api.get('/workers').then((r) => setWorkers(r.data || [])).catch(() => {});
  }, []);

  const onDrop = useCallback(async (e) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer?.files || []).filter((f) => f.name.toLowerCase().endsWith('.zip'));
    if (files.length === 0) return;
    await handleBatch(files);
  }, []);

  const handleBatch = async (files) => {
    if (files.length > 20) {
      toast.error('Max 20 ZIPs per batch');
      return;
    }
    setPhase('identifying');
    const identified = [];
    for (const f of files) {
      try {
        const fd = new FormData();
        fd.append('file', f);
        const { data } = await api.post('/integrations/simpro/workers/identify-zip', fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        identified.push({ file: f, name: f.name, ...data, override_worker_id: data.matched_worker?.id || '' });
      } catch (e) {
        identified.push({ file: f, name: f.name, error: apiError(e) });
      }
    }
    setZips(identified);
    setPhase('ready');
  };

  // v160.3.4 — dry-run every ZIP that has an assigned worker, then
  // combine `unmatched_groups` across all ZIPs into a single review panel.
  const gotoReview = async () => {
    setPhase('reviewing');
    const combined = new Map();
    for (const z of zips) {
      const wid = z.override_worker_id || z.matched_worker?.id;
      if (!wid) continue;
      try {
        const fd = new FormData();
        fd.append('file', z.file);
        const { data } = await api.post(
          `/workers/${wid}/simpro-zip-import?dry_run=1`,
          fd,
          { headers: { 'Content-Type': 'multipart/form-data' } }
        );
        (data.unmatched_groups || []).forEach((g) => {
          const key = g.suggested_slug || '__no_suggestion__';
          const prev = combined.get(key);
          if (!prev) {
            combined.set(key, { ...g, sample_filenames: [...(g.sample_filenames || [])] });
          } else {
            prev.count += g.count;
            g.sample_filenames.forEach((f) => {
              if (!prev.sample_filenames.includes(f) && prev.sample_filenames.length < 6) {
                prev.sample_filenames.push(f);
              }
            });
          }
        });
      } catch (_e) { /* silent — continue to next zip */ }
    }
    const list = Array.from(combined.values()).sort(
      (a, b) => (b.count || 0) - (a.count || 0)
    );
    // Re-compute auto_accept_default with combined counts.
    list.forEach((g) => {
      if (g.suggested_slug && !g.existing_slug_hit) {
        g.auto_accept_default = g.count >= 3 || (g.confidence || 0) >= 0.85;
      }
    });
    const seed = {};
    list.forEach((g) => {
      if (g.suggested_slug && !g.existing_slug_hit) {
        seed[g.suggested_slug] = !!g.auto_accept_default;
      }
    });
    setCombinedGroups(list);
    setAcceptChecked(seed);
  };

  const acceptAndCommit = async () => {
    const suggestions = combinedGroups
      .filter((g) => g.suggested_slug && !g.existing_slug_hit && acceptChecked[g.suggested_slug])
      .map((g) => ({
        slug: g.suggested_slug,
        label: g.suggested_label,
        simpro_variants: g.sample_filenames.map((f) => f.replace(/\.[^.]+$/, '')),
      }));
    setApplyingSuggestions(true);
    try {
      if (suggestions.length > 0) {
        await api.post('/integrations/simpro/workers/accept-suggestions', { suggestions });
        toast.success(`Accepted ${suggestions.length} new cert kind${suggestions.length === 1 ? '' : 's'}`);
      }
    } catch (e) {
      toast.error(apiError(e));
      setApplyingSuggestions(false);
      return;
    }
    setApplyingSuggestions(false);
    await commit();
  };

  const commit = async () => {
    setPhase('running');
    const out = [];
    for (const z of zips) {
      const wid = z.override_worker_id || z.matched_worker?.id;
      if (!wid) {
        out.push({ zip: z.name, ok: false, error: 'No worker assigned' });
        continue;
      }
      try {
        const fd = new FormData();
        fd.append('file', z.file);
        const { data } = await api.post(
          `/workers/${wid}/simpro-zip-import?dry_run=0`,
          fd,
          { headers: { 'Content-Type': 'multipart/form-data' } }
        );
        out.push({ zip: z.name, worker: workers.find((w) => w.id === wid), ok: true, result: data.result });
      } catch (e) {
        out.push({ zip: z.name, ok: false, error: apiError(e) });
      }
    }
    setResults(out);
    setPhase('done');
    const okN = out.filter((r) => r.ok).length;
    toast.success(`Bulk import complete — ${okN} / ${out.length} workers`);
    onDone?.();
  };

  return (
    <div
      className="fixed inset-0 z-[70] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={phase === 'running' || phase === 'identifying' ? undefined : onClose}
      data-testid="bulk-simpro-zip-modal"
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 px-6 pt-6 pb-3 border-b border-slate-200">
          <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
            <Users size={18} />
          </div>
          <div className="flex-1">
            <h3 className="font-display text-lg font-semibold text-slate-900">Bulk import Simpro ZIPs</h3>
            <p className="mt-0.5 text-sm text-slate-600">
              Drop multiple `employee_attachments.zip` files. Each is auto-matched to a worker
              via photo + PDF filename tokens. Confirm or override each row before applying.
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700" data-testid="bulk-simpro-close">
            <XIcon size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {phase === 'idle' && (
            <div
              className="rounded-2xl border-2 border-dashed border-slate-300 p-10 text-center bg-slate-50 hover:bg-emerald-50 transition-colors"
              onDrop={onDrop}
              onDragOver={(e) => e.preventDefault()}
              data-testid="bulk-simpro-drop"
            >
              <Upload size={32} className="mx-auto text-slate-400" />
              <p className="mt-3 text-sm font-medium text-slate-700">Drag multiple ZIP files here</p>
              <p className="text-xs text-slate-500 mt-1">Or click to browse</p>
              <input
                type="file"
                accept=".zip,application/zip"
                multiple
                onChange={(e) => e.target.files?.length && handleBatch(Array.from(e.target.files))}
                className="mt-4 text-xs"
                data-testid="bulk-simpro-file-input"
              />
            </div>
          )}

          {phase === 'identifying' && (
            <div className="py-12 flex items-center justify-center text-slate-500 text-sm gap-2">
              <Loader2 size={16} className="animate-spin" /> Auto-identifying workers from ZIP contents…
            </div>
          )}

          {phase === 'ready' && (
            <div data-testid="bulk-simpro-ready">
              <div className="mb-3 text-sm text-slate-600">
                {zips.length} ZIP{zips.length === 1 ? '' : 's'} · {zips.filter((z) => z.matched_worker).length} auto-matched · {zips.filter((z) => !z.matched_worker).length} need review
              </div>
              <div className="rounded-xl border border-slate-200 overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider">
                    <tr>
                      <th className="text-left px-3 py-2">ZIP file</th>
                      <th className="text-left px-3 py-2">Auto-match</th>
                      <th className="text-left px-3 py-2">Override</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {zips.map((z, i) => (
                      <tr key={i} className="hover:bg-slate-50">
                        <td className="px-3 py-2 font-medium text-slate-900 truncate max-w-[200px]" title={z.name}>
                          {z.name} <span className="text-slate-400 font-normal">({Math.round((z.size || 0) / 1024)} KB)</span>
                        </td>
                        <td className="px-3 py-2">
                          {z.matched_worker ? (
                            <span className="text-emerald-700">
                              → {z.matched_worker.name}
                              <span className="ml-1.5 text-[10px] text-emerald-600">
                                ({z.match_score.toFixed(2)})
                              </span>
                            </span>
                          ) : (
                            <span className="text-rose-700 text-[11px]">Not identified — pick manually →</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <select
                            value={z.override_worker_id || ''}
                            onChange={(e) => {
                              const v = e.target.value;
                              setZips((old) => old.map((x, j) => (j === i ? { ...x, override_worker_id: v } : x)));
                            }}
                            className="text-xs border border-slate-300 rounded px-2 py-1 max-w-[220px]"
                            data-testid={`bulk-worker-select-${i}`}
                          >
                            <option value="">— select worker —</option>
                            {workers.map((w) => (
                              <option key={w.id} value={w.id}>
                                {(w.first_name || '') + ' ' + (w.last_name || '')}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {phase === 'reviewing' && (
            <div data-testid="bulk-simpro-reviewing" className="space-y-3">
              {combinedGroups.length === 0 ? (
                <div className="py-10 flex items-center justify-center text-slate-500 text-sm gap-2">
                  <Loader2 size={16} className="animate-spin" /> Dry-running each ZIP + collecting suggestions…
                </div>
              ) : (
                <>
                  <div className="text-xs text-slate-600">
                    Combined auto-taxonomy across {zips.filter((z) => z.override_worker_id).length} ZIP(s).
                    Accept suggestions before committing to boost cert-kind coverage in one hit.
                  </div>
                  <UnmatchedSuggestions
                    groups={combinedGroups}
                    acceptChecked={acceptChecked}
                    onToggle={(slug, val) =>
                      setAcceptChecked((s) => ({ ...s, [slug]: val }))
                    }
                    onSelectAll={(val) => {
                      const next = {};
                      combinedGroups.forEach((g) => {
                        if (g.suggested_slug && !g.existing_slug_hit) next[g.suggested_slug] = val;
                      });
                      setAcceptChecked(next);
                    }}
                    onAcceptAndReplan={() => {
                      toast.info('Selections captured — press "Accept + commit" to persist and upload.');
                    }}
                    applying={false}
                  />
                </>
              )}
            </div>
          )}

          {phase === 'running' && (
            <div className="py-12 flex items-center justify-center text-slate-500 text-sm gap-2">
              <Loader2 size={16} className="animate-spin" /> Uploading ZIPs sequentially…
            </div>
          )}

          {phase === 'done' && (
            <div data-testid="bulk-simpro-done" className="space-y-2">
              {results.map((r, i) => (
                <div
                  key={i}
                  className={`rounded-xl border p-3 text-xs ${r.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-rose-200 bg-rose-50 text-rose-900'}`}
                >
                  <div className="font-semibold flex items-center gap-1.5">
                    {r.ok ? <Check size={13} /> : <AlertCircle size={13} />} {r.zip}
                    {r.ok && r.worker && ` → ${r.worker.first_name} ${r.worker.last_name}`}
                  </div>
                  {r.ok && r.result?.counts && (
                    <div className="mt-1 text-[11px]">
                      attached={r.result.counts.attached} · created={r.result.counts.created} · HR={r.result.counts.hr_docs} · unmatched={r.result.counts.unmatched} · photo={r.result.counts.photo}
                    </div>
                  )}
                  {!r.ok && <div className="mt-1">{r.error}</div>}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-6 py-3 border-t border-slate-200 flex items-center justify-end gap-2 bg-slate-50">
          <button
            onClick={onClose}
            disabled={phase === 'running' || phase === 'identifying'}
            className="px-4 py-2 rounded-lg text-sm font-medium text-slate-700 hover:bg-white disabled:opacity-50"
            data-testid="bulk-simpro-cancel"
          >
            {phase === 'done' ? 'Close' : 'Cancel'}
          </button>
          {phase === 'ready' && (
            <button
              onClick={gotoReview}
              disabled={zips.every((z) => !z.override_worker_id)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-violet-700 text-white text-sm font-semibold hover:bg-violet-800 disabled:opacity-50 shadow-sm"
              data-testid="bulk-simpro-review"
            >
              <Sparkles size={13} /> Review unmatched suggestions
            </button>
          )}
          {phase === 'reviewing' && (
            <button
              onClick={acceptAndCommit}
              disabled={applyingSuggestions || combinedGroups.length === 0}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-700 text-white text-sm font-semibold hover:bg-emerald-800 disabled:opacity-50 shadow-sm"
              data-testid="bulk-simpro-apply"
            >
              <Upload size={13} /> Accept selected + commit {zips.filter((z) => z.override_worker_id).length} ZIP{zips.filter((z) => z.override_worker_id).length === 1 ? '' : 's'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
