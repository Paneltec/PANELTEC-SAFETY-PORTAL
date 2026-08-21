// v58.13.25 — WorkerLinkModal. Opens from HrEmployeesPage when an
// admin clicks "Link worker…" on an unlinked employee row.
//
// v58.13.26 — /link-candidates now returns at most ONE candidate at
// similarity=1.0 (composite-normaliser exact match). Fuzzy tier
// removed. Chip stays green (perfect match) — no amber path anymore
// but the styling logic is preserved for defence-in-depth. Modal also
// accepts an optional `initialCandidateWorkerId` prop so the bulk
// wizard's "Browse workers…" fallback can pre-focus a candidate.
//
// Reuses the ChecklistLinkPicker pattern (v58.13.19) for the
// backdrop close + useLockBodyScroll + stopPropagation guards.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { X, Search, User, CheckCircle2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../lib/api';
import useLockBodyScroll from '../lib/useLockBodyScroll';

export default function WorkerLinkModal({ employee, onClose, onLinked, initialCandidateWorkerId }) {
  useLockBodyScroll();
  const [candidates, setCandidates] = useState([]);
  const [allWorkers, setAllWorkers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [busyWorkerId, setBusyWorkerId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [c, w] = await Promise.all([
          api.get(`/hr/employees/${employee.id}/link-candidates?limit=10`),
          api.get(`/workers?limit=500&active=true`),
        ]);
        if (cancelled) return;
        setCandidates(c.data?.candidates || []);
        // Filter out any workers already linked to a DIFFERENT
        // employee (candidates endpoint has already excluded these
        // — we just need to remove already-linked from the browse list).
        const linkedSet = new Set(
          (c.data?.candidates || []).map((x) => x.id).concat(
            // Anything not in candidates but linked is invisible to us
            // here; server-side already gates on org.
          )
        );
        const rows = Array.isArray(w.data) ? w.data : (w.data?.items || []);
        // Remove ones surfaced in the candidates strip so we don't
        // duplicate them in the browse list below.
        setAllWorkers(rows.filter((r) => !linkedSet.has(r.id)));
      } catch (e) {
        if (!cancelled) toast.error(apiError(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [employee.id]);

  const filteredWorkers = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const base = needle
      ? allWorkers.filter((w) => {
          const full = `${w.first_name || ''} ${w.last_name || ''} ${w.email || ''}`.toLowerCase();
          return full.includes(needle);
        })
      : allWorkers;
    // v58.13.26 — Float the pre-focused candidate to the top so the bulk
    // wizard's "Browse workers…" fallback lands on the right row.
    if (initialCandidateWorkerId) {
      const idx = base.findIndex((w) => w.id === initialCandidateWorkerId);
      if (idx > 0) {
        const clone = base.slice();
        const [row] = clone.splice(idx, 1);
        clone.unshift(row);
        return clone.slice(0, 100);
      }
    }
    return base.slice(0, 100);
  }, [allWorkers, q, initialCandidateWorkerId]);

  const link = useCallback(async (e, workerId) => {
    e?.stopPropagation?.(); e?.preventDefault?.();
    setBusyWorkerId(workerId);
    try {
      const r = await api.patch(`/hr/employees/${employee.id}/link-worker`,
        { worker_id: workerId });
      toast.success('Linked');
      onLinked?.(r.data);
      onClose();
    } catch (err) {
      const status = err?.response?.status;
      const data = err?.response?.data;
      if (status === 409 && data?.detail?.error === 'worker-already-linked') {
        toast.error(`Already linked to ${data.detail.linked_to_employee_name || 'another employee'}`);
      } else {
        toast.error(apiError(err));
      }
    } finally {
      setBusyWorkerId(null);
    }
  }, [employee.id, onClose, onLinked]);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 p-3"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      data-testid="worker-link-modal">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col max-h-[85vh]">
        <div className="px-5 py-3 border-b flex items-center gap-2">
          <User size={16} className="text-blue-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <h3 className="font-display font-bold text-slate-900 text-sm">
              Link a worker record
            </h3>
            <p className="text-[11px] text-slate-500 truncate">
              For {employee.first_name} {employee.last_name}
            </p>
          </div>
          <button onClick={(e) => { e.stopPropagation(); onClose(); }}
            data-testid="worker-link-close"
            className="p-1 rounded hover:bg-slate-100 text-slate-500">
            <X size={16} />
          </button>
        </div>
        {loading && (
          <div className="p-5 text-center text-xs text-slate-500"
            data-testid="worker-link-loading">
            <Loader2 size={14} className="inline animate-spin mr-1" />
            Loading candidates…
          </div>
        )}
        {!loading && candidates.length > 0 && (
          <div className="px-5 py-3 border-b bg-slate-50" data-testid="worker-link-suggestions">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
              Auto-suggested by name similarity
            </div>
            <div className="flex flex-wrap gap-1.5">
              {candidates.map((c) => {
                const isPerfect = c.similarity >= 1.0;
                const cls = isPerfect
                  ? 'bg-emerald-100 text-emerald-800 border-emerald-300 hover:bg-emerald-200'
                  : 'bg-amber-100 text-amber-800 border-amber-300 hover:bg-amber-200';
                return (
                  <button key={c.id} type="button"
                    onClick={(e) => link(e, c.id)}
                    disabled={busyWorkerId === c.id}
                    data-testid={`worker-link-suggest-${c.id}`}
                    title={`similarity ${c.similarity}`}
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-xs font-semibold transition-colors disabled:opacity-50 ${cls}`}>
                    {isPerfect && <CheckCircle2 size={11} />}
                    {c.name}
                    <span className="opacity-60 ml-0.5">· {Math.round(c.similarity * 100)}%</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {!loading && (
          <div className="px-5 py-3 border-b border-slate-100">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input type="text" value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search all workers by name or email…"
                data-testid="worker-link-search"
                className="w-full pl-8 pr-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
            </div>
          </div>
        )}
        {!loading && (
          <div className="flex-1 overflow-y-auto px-2 py-2">
            {filteredWorkers.length === 0 && (
              <div className="p-5 text-center text-xs text-slate-500"
                data-testid="worker-link-empty">
                {q ? `No workers matching "${q}".` : 'No unlinked workers available.'}
              </div>
            )}
            {filteredWorkers.length > 0 && (
              <ul className="space-y-1" data-testid="worker-link-list">
                {filteredWorkers.map((w) => (
                  <li key={w.id}>
                    <button type="button"
                      onClick={(e) => link(e, w.id)}
                      disabled={busyWorkerId === w.id}
                      className="w-full text-left px-3 py-2 rounded-lg border border-slate-200 hover:bg-blue-50 hover:border-blue-300 transition-colors disabled:opacity-50"
                      data-testid={`worker-link-item-${w.id}`}>
                      <div className="font-semibold text-sm text-slate-900">
                        {w.first_name} {w.last_name}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {w.position || '—'}{w.email && <span className="ml-2">· {w.email}</span>}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
