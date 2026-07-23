// v160.3.9.6 — Manage Columns modal for the Inductions Matrix.
// Admin/HSEQ-lead only. Three tabs:
//   1. Suggested cleanup — auto A/B/C from GET /induction-columns/cleanup-suggestions
//   2. Merge — manual multi-source → target
//   3. Move to Certifications — manual multi-select hide-from-matrix
//
// Every apply refreshes the parent matrix via `onApplied()`.
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { X, Check, Loader2, Sparkles, ArrowRight, EyeOff } from 'lucide-react';
import api, { apiError } from '../../lib/api';
import useLockBodyScroll from '../../lib/useLockBodyScroll';

const CAT_LABEL = {
  site_induction: 'Site induction',
  competency:     'Competency',
  license:        'Licence',
};

export default function ManageColumnsModal({ open, onClose, onApplied, columns }) {
  useLockBodyScroll(open);
  const [tab, setTab] = useState('suggested');
  const [suggestions, setSuggestions] = useState(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);

  // Per-row selection state for the Suggested tab. Default: all checked.
  const [checkedA, setCheckedA] = useState(new Set());
  const [checkedB, setCheckedB] = useState(new Set());
  const [checkedC, setCheckedC] = useState(new Set());

  // Manual Merge tab state.
  const [mergeSources, setMergeSources] = useState(new Set());
  const [mergeTargetKey, setMergeTargetKey] = useState('');

  // Manual Move tab state.
  const [moveKeys, setMoveKeys] = useState(new Set());

  useEffect(() => {
    if (!open) return;
    setTab('suggested');
    setLoading(true);
    api.get('/induction-columns/cleanup-suggestions')
      .then((r) => {
        setSuggestions(r.data);
        setCheckedA(new Set(r.data.category_a.map((c) => c.column_key + '|' + c.header)));
        setCheckedB(new Set(r.data.category_b.map((_, i) => String(i))));
        setCheckedC(new Set(r.data.category_c.map((c) => c.column_key + '|' + c.header)));
      })
      .catch((e) => toast.error(apiError(e, 'Failed to load cleanup suggestions')))
      .finally(() => setLoading(false));
  }, [open]);

  const canonicalCols = useMemo(
    () => (columns || []).filter((c) => c.category),
    [columns],
  );

  if (!open) return null;

  const toggleRow = (setter, key) => (e) => {
    setter((prev) => {
      const n = new Set(prev);
      if (e.target.checked) n.add(key); else n.delete(key);
      return n;
    });
  };

  async function applyAllSuggestions() {
    if (!suggestions) return;
    setApplying(true);
    const summary = { merged: 0, moved: 0, cleared: 0, errors: [] };
    try {
      // Step 1: Merges (Cat-B) first — rogue rows fold into canonical.
      for (let i = 0; i < suggestions.category_b.length; i += 1) {
        if (!checkedB.has(String(i))) continue;
        const cluster = suggestions.category_b[i];
        try {
          const r = await api.post('/induction-columns/merge', {
            source_keys:     cluster.sources.map((s) => s.column_key),
            target_key:      cluster.target_key,
            target_name:     cluster.target_name,
            target_category: cluster.target_category,
          });
          summary.merged += r.data.merged || 0;
        } catch (e) {
          summary.errors.push(`Merge → ${cluster.target_name}: ${apiError(e)}`);
        }
      }

      // Step 2: Move-to-certifications (Cat-C).
      const cKeys = suggestions.category_c
        .filter((c) => checkedC.has(c.column_key + '|' + c.header))
        .map((c) => c.column_key);
      if (cKeys.length) {
        try {
          const r = await api.post('/induction-columns/move-to-certifications', { keys: cKeys });
          summary.moved += r.data.moved || 0;
        } catch (e) {
          summary.errors.push(`Move to Certifications: ${apiError(e)}`);
        }
      }

      // Step 3: Clear column_key on Cat-A stragglers.
      const aKeys = suggestions.category_a
        .filter((c) => checkedA.has(c.column_key + '|' + c.header))
        .map((c) => c.column_key);
      if (aKeys.length) {
        try {
          const r = await api.post('/induction-columns/clear-column-key', { keys: aKeys });
          summary.cleared += r.data.cleared || 0;
        } catch (e) {
          summary.errors.push(`Clear orphaned instances: ${apiError(e)}`);
        }
      }

      if (summary.errors.length) {
        toast.error(`Applied with ${summary.errors.length} error(s). Merged ${summary.merged}, moved ${summary.moved}, cleared ${summary.cleared}.`);
        summary.errors.forEach((e) => toast.error(e));
      } else {
        toast.success(`Merged ${summary.merged}, moved ${summary.moved} to Certifications, cleared ${summary.cleared} orphaned instances.`);
      }
      onApplied?.();
      onClose();
    } finally {
      setApplying(false);
    }
  }

  async function applyManualMerge() {
    if (!mergeTargetKey || mergeSources.size === 0) {
      toast.error('Pick at least one source and a target.');
      return;
    }
    const target = canonicalCols.find((c) => c.column_key === mergeTargetKey);
    if (!target) { toast.error('Target must be a canonical column.'); return; }
    if (mergeSources.has(mergeTargetKey)) {
      toast.error('Target cannot be in the sources.');
      return;
    }
    setApplying(true);
    try {
      const r = await api.post('/induction-columns/merge', {
        source_keys:     [...mergeSources],
        target_key:      target.column_key,
        target_name:     target.header,
        target_category: target.category,
      });
      toast.success(`Merged ${r.data.merged} row(s) into ${target.header}.`);
      onApplied?.();
      onClose();
    } catch (e) { toast.error(apiError(e, 'Merge failed')); }
    finally { setApplying(false); }
  }

  async function applyManualMove() {
    if (moveKeys.size === 0) { toast.error('Pick at least one column.'); return; }
    setApplying(true);
    try {
      // Manual move uses key-only form (backwards-compat fallback on the
      // server) since the multi-select drops column_key only.
      const r = await api.post('/induction-columns/move-to-certifications', {
        keys: [...moveKeys],
      });
      toast.success(`${r.data.moved} row(s) moved to Certifications.`);
      onApplied?.();
      onClose();
    } catch (e) { toast.error(apiError(e, 'Move failed')); }
    finally { setApplying(false); }
  }

  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4"
         onClick={onClose}
         data-testid="manage-columns-backdrop">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[88vh] flex flex-col"
           onClick={(e) => e.stopPropagation()}
           data-testid="manage-columns-modal">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Manage Inductions matrix columns</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Clean up rogue columns imported from Simpro. Every action is audit-logged.
            </p>
          </div>
          <button onClick={onClose} data-testid="manage-columns-close"
            className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100">
            <X size={16} />
          </button>
        </div>

        {/* Tabs */}
        <div className="px-6 pt-3 flex gap-1 border-b border-slate-200">
          {[
            ['suggested', 'Suggested cleanup', Sparkles],
            ['merge',     'Merge',             ArrowRight],
            ['move',      'Move to Certifications', EyeOff],
          ].map(([k, label, Icon]) => (
            <button key={k} onClick={() => setTab(k)}
              data-testid={`manage-tab-${k}`}
              className={`px-3 py-2 text-xs font-medium inline-flex items-center gap-1.5 border-b-2 -mb-px transition-colors ${
                tab === k
                  ? 'border-[#1e4a8c] text-[#1e4a8c]'
                  : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
              <Icon size={12} /> {label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="text-center py-16 text-slate-500 text-sm">
              <Loader2 size={20} className="inline animate-spin mr-2" />
              Loading suggestions…
            </div>
          ) : tab === 'suggested' ? (
            <SuggestedTab
              suggestions={suggestions}
              checkedA={checkedA} setCheckedA={setCheckedA}
              checkedB={checkedB} setCheckedB={setCheckedB}
              checkedC={checkedC} setCheckedC={setCheckedC}
              toggleRow={toggleRow}
            />
          ) : tab === 'merge' ? (
            <MergeTab
              columns={columns}
              canonicalCols={canonicalCols}
              mergeSources={mergeSources} setMergeSources={setMergeSources}
              mergeTargetKey={mergeTargetKey} setMergeTargetKey={setMergeTargetKey}
            />
          ) : (
            <MoveTab
              columns={columns}
              moveKeys={moveKeys} setMoveKeys={setMoveKeys}
            />
          )}
        </div>

        {/* Footer actions */}
        <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-end gap-2 bg-slate-50 rounded-b-2xl">
          <button onClick={onClose} disabled={applying}
            data-testid="manage-columns-cancel"
            className="px-4 py-2 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50">
            Cancel
          </button>
          {tab === 'suggested' && suggestions && (
            <button onClick={applyAllSuggestions} disabled={applying || loading}
              data-testid="manage-apply-all"
              className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-[#1e4a8c] hover:bg-[#173a70] disabled:opacity-50 inline-flex items-center gap-2">
              {applying ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              Apply all selected
            </button>
          )}
          {tab === 'merge' && (
            <button onClick={applyManualMerge} disabled={applying}
              data-testid="manage-apply-merge"
              className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-[#1e4a8c] hover:bg-[#173a70] disabled:opacity-50 inline-flex items-center gap-2">
              {applying ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
              Merge
            </button>
          )}
          {tab === 'move' && (
            <button onClick={applyManualMove} disabled={applying}
              data-testid="manage-apply-move"
              className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-[#1e4a8c] hover:bg-[#173a70] disabled:opacity-50 inline-flex items-center gap-2">
              {applying ? <Loader2 size={14} className="animate-spin" /> : <EyeOff size={14} />}
              Move to Certifications
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ───────────────────── Suggested tab ─────────────────────

function SuggestedTab({ suggestions, checkedA, setCheckedA, checkedB, setCheckedB, checkedC, setCheckedC, toggleRow }) {
  if (!suggestions) return null;
  const { totals, category_a: A, category_b: B, category_c: C } = suggestions;
  const projected = totals.canonical
    + B.filter((_, i) => checkedB.has(String(i)) && !B[i].target_exists).length
    - 0; // moves & clears remove rogue columns; canonical count unchanged.

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600 flex items-center gap-3">
        <Sparkles size={14} className="text-[#1e4a8c] shrink-0" />
        <span>
          Matrix currently has <strong>{totals.columns}</strong> columns
          ({totals.canonical} canonical, {totals.rogue} rogue). After applying the
          selections below, you&apos;ll be left with roughly <strong>{projected}</strong> clean columns.
        </span>
      </div>

      {/* Category B — Merge */}
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
          Category B — Merge {B.length} cluster{B.length === 1 ? '' : 's'}
        </h3>
        {B.length === 0 && <div className="text-xs text-slate-400 italic">None found.</div>}
        <div className="space-y-2">
          {B.map((cluster, i) => (
            <label key={i} data-testid={`sugg-b-${i}`}
              className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5 hover:border-slate-300">
              <input type="checkbox" checked={checkedB.has(String(i))}
                onChange={toggleRow(setCheckedB, String(i))}
                className="mt-1 w-3.5 h-3.5" />
              <div className="flex-1 text-xs">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-slate-900">
                    {cluster.sources.map((s) => s.header).join(', ')}
                  </span>
                  <ArrowRight size={12} className="text-slate-400" />
                  <span className="font-medium text-emerald-700">{cluster.target_name}</span>
                  <span className={`text-[9px] uppercase font-semibold px-1.5 py-0.5 rounded ${cluster.target_exists ? 'bg-slate-100 text-slate-600' : 'bg-amber-100 text-amber-800'}`}>
                    {cluster.target_exists ? 'Existing canonical' : 'New canonical'}
                  </span>
                  <span className="text-[9px] uppercase tracking-wider text-slate-400">
                    · {CAT_LABEL[cluster.target_category] || cluster.target_category}
                  </span>
                </div>
                <div className="mt-1 text-slate-500">
                  {cluster.sources.reduce((s, x) => s + x.cnt, 0)} row(s) affected.
                </div>
              </div>
            </label>
          ))}
        </div>
      </section>

      {/* Category C — Move to Certifications */}
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
          Category C — Move {C.length} column{C.length === 1 ? '' : 's'} to Certifications
        </h3>
        {C.length === 0 && <div className="text-xs text-slate-400 italic">None found.</div>}
        <div className="space-y-1.5">
          {C.map((row) => {
            const k = row.column_key + '|' + row.header;
            return (
              <label key={k} data-testid={`sugg-c-${row.column_key}`}
                className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 hover:border-slate-300">
                <input type="checkbox" checked={checkedC.has(k)}
                  onChange={toggleRow(setCheckedC, k)}
                  className="w-3.5 h-3.5" />
                <span className="font-medium text-slate-900 text-xs truncate">{row.header}</span>
                <span className="ml-auto text-[10px] text-slate-500">{row.cnt} row{row.cnt === 1 ? '' : 's'}</span>
              </label>
            );
          })}
        </div>
      </section>

      {/* Category A — Clear orphaned instances */}
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
          Category A — Clear {A.length} orphaned instance column{A.length === 1 ? '' : 's'}
        </h3>
        <p className="text-[11px] text-slate-500 mb-2">
          Individual worker documents that came in from Simpro with the person&apos;s initials + expiry baked into the name.
          Clearing the column_key removes them from the matrix; the underlying document remains and can be re-attached
          via the induction card.
        </p>
        {A.length === 0 && <div className="text-xs text-slate-400 italic">None found.</div>}
        <div className="max-h-64 overflow-y-auto space-y-1 border border-slate-200 rounded-lg p-2 bg-white">
          {A.map((row) => {
            const k = row.column_key + '|' + row.header;
            return (
              <label key={k} data-testid={`sugg-a-${row.column_key}-${row.header.slice(0,20)}`}
                className="flex items-center gap-2 px-2 py-1 hover:bg-slate-50 rounded">
                <input type="checkbox" checked={checkedA.has(k)}
                  onChange={toggleRow(setCheckedA, k)}
                  className="w-3.5 h-3.5" />
                <span className="text-[11px] text-slate-800 font-mono truncate">{row.header}</span>
                <span className="ml-auto text-[10px] text-slate-400">{row.cnt}</span>
              </label>
            );
          })}
        </div>
      </section>
    </div>
  );
}

// ───────────────────── Merge tab (manual) ─────────────────────

function MergeTab({ columns, canonicalCols, mergeSources, setMergeSources, mergeTargetKey, setMergeTargetKey }) {
  const toggleSrc = (k) => (e) => {
    setMergeSources((prev) => {
      const n = new Set(prev);
      if (e.target.checked) n.add(k); else n.delete(k);
      return n;
    });
  };
  return (
    <div className="space-y-5">
      <div>
        <label className="block text-xs font-semibold text-slate-600 mb-1.5">Sources (columns to merge FROM)</label>
        <div className="max-h-72 overflow-y-auto space-y-0.5 border border-slate-200 rounded-lg p-2 bg-white">
          {columns.map((c) => (
            <label key={c.column_key} className="flex items-center gap-2 px-2 py-1 hover:bg-slate-50 rounded">
              <input type="checkbox" checked={mergeSources.has(c.column_key)}
                onChange={toggleSrc(c.column_key)}
                className="w-3.5 h-3.5" />
              <span className="text-xs text-slate-700 flex-1 truncate">{c.header}</span>
              <span className={`text-[9px] uppercase tracking-wider font-semibold px-1 py-0.5 rounded ${c.category ? 'bg-slate-100 text-slate-600' : 'bg-red-50 text-red-700'}`}>
                {c.category ? c.category.replace('_',' ') : 'rogue'}
              </span>
            </label>
          ))}
        </div>
      </div>
      <div>
        <label className="block text-xs font-semibold text-slate-600 mb-1.5">Target (existing canonical column)</label>
        <select value={mergeTargetKey}
          onChange={(e) => setMergeTargetKey(e.target.value)}
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white">
          <option value="">— Select target canonical column —</option>
          {canonicalCols.map((c) => (
            <option key={c.column_key} value={c.column_key}>
              {c.header} · {CAT_LABEL[c.category] || c.category}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

// ───────────────────── Move tab (manual) ─────────────────────

function MoveTab({ columns, moveKeys, setMoveKeys }) {
  const toggle = (k) => (e) => {
    setMoveKeys((prev) => {
      const n = new Set(prev);
      if (e.target.checked) n.add(k); else n.delete(k);
      return n;
    });
  };
  return (
    <div>
      <p className="text-xs text-slate-500 mb-3">
        These rows will be hidden from the Inductions matrix but remain visible in the Certifications page.
      </p>
      <div className="max-h-96 overflow-y-auto space-y-0.5 border border-slate-200 rounded-lg p-2 bg-white">
        {columns.map((c) => (
          <label key={c.column_key} className="flex items-center gap-2 px-2 py-1 hover:bg-slate-50 rounded">
            <input type="checkbox" checked={moveKeys.has(c.column_key)}
              onChange={toggle(c.column_key)}
              className="w-3.5 h-3.5" />
            <span className="text-xs text-slate-700 flex-1 truncate">{c.header}</span>
            <span className={`text-[9px] uppercase tracking-wider font-semibold px-1 py-0.5 rounded ${c.category ? 'bg-slate-100 text-slate-600' : 'bg-red-50 text-red-700'}`}>
              {c.category ? c.category.replace('_',' ') : 'rogue'}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
