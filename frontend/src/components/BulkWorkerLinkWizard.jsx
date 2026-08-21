// v58.13.26 — BulkWorkerLinkWizard. Two-step modal launched from the
// HrEmployeesPage header when auto-matches are available.
//
// Design (approved Pass 2, C-strict):
//   * Step 1 — Review auto-matches. Table of proposed links with a
//     Tier badge (email green, norm_basic blue, norm_lfi amber),
//     accept/reject checkbox per row, and bulk accept-all / accept
//     email-only / reject-all controls at the top.
//   * Step 2 — No-match employees. Per-row "Browse workers…" button
//     opens the existing v58.13.25 WorkerLinkModal for manual pick.
//   * Confirm N links → POST /api/hr/employees/link-worker/bulk.
//     Toast per-employee result. Refetch employee list on completion.
//
// v58.13.10 flash-bug guardrail: every action button calls
// e.stopPropagation() + e.preventDefault() before mutating state.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { X, CheckCircle2, XCircle, Loader2, User } from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../lib/api';
import useLockBodyScroll from '../lib/useLockBodyScroll';
import WorkerLinkModal from './WorkerLinkModal';

const TIER_STYLE = {
  email:      { label: 'Email',           cls: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
  norm_basic: { label: 'Name (exact)',    cls: 'bg-blue-100 text-blue-800 border-blue-300' },
  norm_lfi:   { label: 'Last + initial',  cls: 'bg-amber-100 text-amber-800 border-amber-300' },
};

function TierBadge({ tier }) {
  const style = TIER_STYLE[tier] || TIER_STYLE.norm_basic;
  return (
    <span
      data-testid={`bulk-link-tier-${tier}`}
      className={`inline-block px-2 py-0.5 rounded-md border text-[10px] font-bold uppercase tracking-wide ${style.cls}`}
    >
      {style.label}
    </span>
  );
}

export default function BulkWorkerLinkWizard({ onClose, onCompleted }) {
  useLockBodyScroll();
  const [step, setStep] = useState('auto');       // 'auto' | 'no_match'
  const [loading, setLoading] = useState(true);
  const [autoMatches, setAutoMatches] = useState([]);
  const [noMatch, setNoMatch] = useState([]);
  const [accepted, setAccepted] = useState({});   // { employee_id: bool }
  const [submitting, setSubmitting] = useState(false);
  const [browseFor, setBrowseFor] = useState(null); // employee object for WorkerLinkModal

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get('/hr/employees/link-candidates/bulk');
        if (cancelled) return;
        const auto = data.auto_matches || [];
        setAutoMatches(auto);
        setNoMatch(data.no_match || []);
        // Default: accept every proposed auto-match.
        const init = {};
        for (const row of auto) init[row.employee_id] = true;
        setAccepted(init);
      } catch (e) {
        if (!cancelled) toast.error(apiError(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const acceptedCount = useMemo(
    () => Object.values(accepted).filter(Boolean).length,
    [accepted],
  );

  const toggleOne = useCallback((e, employee_id) => {
    e.stopPropagation(); e.preventDefault();
    setAccepted((prev) => ({ ...prev, [employee_id]: !prev[employee_id] }));
  }, []);

  const acceptAll = useCallback((e) => {
    e.stopPropagation(); e.preventDefault();
    const next = {};
    for (const row of autoMatches) next[row.employee_id] = true;
    setAccepted(next);
  }, [autoMatches]);

  const acceptEmailOnly = useCallback((e) => {
    e.stopPropagation(); e.preventDefault();
    const next = {};
    for (const row of autoMatches) next[row.employee_id] = row.tier === 'email';
    setAccepted(next);
  }, [autoMatches]);

  const rejectAll = useCallback((e) => {
    e.stopPropagation(); e.preventDefault();
    const next = {};
    for (const row of autoMatches) next[row.employee_id] = false;
    setAccepted(next);
  }, [autoMatches]);

  const confirmLinks = useCallback(async (e) => {
    e.stopPropagation(); e.preventDefault();
    const links = autoMatches
      .filter((row) => accepted[row.employee_id])
      .map((row) => ({
        employee_id: row.employee_id,
        worker_id: row.worker_id,
        tier: row.tier,
      }));
    if (links.length === 0) {
      toast.info('No links selected.');
      return;
    }
    setSubmitting(true);
    try {
      const { data } = await api.post('/hr/employees/link-worker/bulk', { links });
      const succeeded = data.succeeded ?? 0;
      const failed = (data.failed || []).length;
      if (failed === 0) {
        toast.success(`Linked ${succeeded} employee${succeeded === 1 ? '' : 's'}.`);
      } else {
        toast.error(`${succeeded} linked · ${failed} failed. See details below.`);
        // Surface each failure so the user can act on it.
        for (const f of (data.failed || [])) {
          toast.error(`Employee ${f.employee_id}: ${f.error}`);
        }
      }
      // Move on to Step 2 so the user can browse the remainders.
      onCompleted?.();
      setStep('no_match');
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setSubmitting(false);
    }
  }, [autoMatches, accepted, onCompleted]);

  const closeSelf = useCallback((e) => {
    e?.stopPropagation?.(); e?.preventDefault?.();
    onClose();
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/50 p-3"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      data-testid="bulk-worker-link-wizard"
    >
      <div className="w-full max-w-4xl bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-5 py-3 border-b flex items-center gap-2">
          <User size={16} className="text-blue-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <h3 className="font-display font-bold text-slate-900 text-base">
              Bulk link workers to HR employees
            </h3>
            <p className="text-[11px] text-slate-500">
              {loading
                ? 'Loading…'
                : `${autoMatches.length} auto-matched · ${noMatch.length} need manual review`}
            </p>
          </div>
          {/* Step pill */}
          <div className="flex items-center gap-1 mr-2">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); e.preventDefault(); setStep('auto'); }}
              data-testid="bulk-link-step-auto"
              className={`text-xs px-2.5 py-1 rounded-full font-semibold border ${step === 'auto' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}
            >
              1. Auto-matches
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); e.preventDefault(); setStep('no_match'); }}
              data-testid="bulk-link-step-no-match"
              className={`text-xs px-2.5 py-1 rounded-full font-semibold border ${step === 'no_match' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}
            >
              2. No match
            </button>
          </div>
          <button
            onClick={closeSelf}
            data-testid="bulk-link-close"
            className="p-1 rounded hover:bg-slate-100 text-slate-500"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        {loading && (
          <div className="p-8 text-center text-sm text-slate-500" data-testid="bulk-link-loading">
            <Loader2 size={16} className="inline animate-spin mr-2" />
            Loading match proposals…
          </div>
        )}

        {!loading && step === 'auto' && (
          <>
            {autoMatches.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500" data-testid="bulk-link-auto-empty">
                No auto-matches available. Every unlinked employee needs a manual pick — switch to the No-match tab.
              </div>
            ) : (
              <>
                <div className="px-5 py-2 border-b border-slate-100 bg-slate-50 flex flex-wrap items-center gap-2">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mr-2">
                    Bulk actions:
                  </div>
                  <button
                    type="button"
                    onClick={acceptAll}
                    data-testid="bulk-link-accept-all"
                    className="px-3 py-1 rounded-md border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    Accept all ({autoMatches.length})
                  </button>
                  <button
                    type="button"
                    onClick={acceptEmailOnly}
                    data-testid="bulk-link-accept-email"
                    className="px-3 py-1 rounded-md border border-emerald-300 bg-emerald-50 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"
                  >
                    Accept email tier only ({autoMatches.filter((r) => r.tier === 'email').length})
                  </button>
                  <button
                    type="button"
                    onClick={rejectAll}
                    data-testid="bulk-link-reject-all"
                    className="px-3 py-1 rounded-md border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    Reject all
                  </button>
                  <div className="ml-auto text-xs text-slate-600" data-testid="bulk-link-selected-count">
                    <b>{acceptedCount}</b> of {autoMatches.length} selected
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto">
                  <table className="min-w-full text-sm" data-testid="bulk-link-auto-table">
                    <thead className="bg-white sticky top-0 border-b border-slate-200">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold w-12">Accept</th>
                        <th className="px-3 py-2 text-left font-semibold">Employee</th>
                        <th className="px-3 py-2 text-left font-semibold">Proposed worker</th>
                        <th className="px-3 py-2 text-left font-semibold w-32">Tier</th>
                      </tr>
                    </thead>
                    <tbody>
                      {autoMatches.map((row) => {
                        const on = !!accepted[row.employee_id];
                        return (
                          <tr key={row.employee_id} className="border-b border-slate-100 hover:bg-slate-50">
                            <td className="px-3 py-2">
                              <input
                                type="checkbox"
                                checked={on}
                                onChange={(e) => toggleOne(e, row.employee_id)}
                                data-testid={`bulk-link-accept-${row.employee_id}`}
                                className="h-4 w-4 rounded border-slate-400 text-blue-600 focus:ring-blue-500"
                              />
                            </td>
                            <td className="px-3 py-2 text-slate-800">{row.employee_name}</td>
                            <td className="px-3 py-2 text-slate-800">
                              <span className="font-semibold">{row.worker_name}</span>
                            </td>
                            <td className="px-3 py-2">
                              <TierBadge tier={row.tier} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            <div className="px-5 py-3 border-t border-slate-200 flex items-center gap-2">
              <div className="text-xs text-slate-500">
                Auto-suggest uses email exact match, then normalised full name, then last-name+first-initial. Fuzzy matching is deliberately excluded.
              </div>
              <button
                type="button"
                onClick={closeSelf}
                className="ml-auto px-3 py-1.5 rounded border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                data-testid="bulk-link-cancel"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmLinks}
                disabled={submitting || acceptedCount === 0}
                data-testid="bulk-link-confirm"
                className="px-4 py-1.5 rounded bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
              >
                {submitting ? (
                  <><Loader2 size={12} className="inline animate-spin mr-1" />Linking…</>
                ) : (
                  <><CheckCircle2 size={12} className="inline mr-1" />Confirm {acceptedCount} link{acceptedCount === 1 ? '' : 's'}</>
                )}
              </button>
            </div>
          </>
        )}

        {!loading && step === 'no_match' && (
          <>
            {noMatch.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500" data-testid="bulk-link-no-match-empty">
                Every unlinked employee has an auto-match proposal. Switch back to step 1.
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto">
                <div className="px-5 py-2 border-b border-slate-100 bg-slate-50 text-[11px] text-slate-600">
                  These employees have no exact-normalised worker match. Browse the worker list per employee to link manually.
                </div>
                <table className="min-w-full text-sm" data-testid="bulk-link-no-match-table">
                  <thead className="bg-white sticky top-0 border-b border-slate-200">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold">Employee</th>
                      <th className="px-3 py-2 text-right font-semibold w-40">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {noMatch.map((row) => (
                      <tr key={row.employee_id} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="px-3 py-2 text-slate-800">{row.employee_name}</td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation(); e.preventDefault();
                              setBrowseFor(row);
                            }}
                            data-testid={`bulk-link-browse-${row.employee_id}`}
                            className="inline-flex items-center px-2 py-1 rounded-md border border-blue-300 text-blue-700 text-xs font-semibold hover:bg-blue-50"
                          >
                            Browse workers…
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="px-5 py-3 border-t border-slate-200 flex items-center">
              <div className="text-xs text-slate-500">
                Manual links are audited the same way as auto-links.
              </div>
              <button
                type="button"
                onClick={closeSelf}
                data-testid="bulk-link-close-2"
                className="ml-auto px-3 py-1.5 rounded bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800"
              >
                Done
              </button>
            </div>
          </>
        )}
      </div>

      {/* Nested WorkerLinkModal for manual browse in step 2. */}
      {browseFor && (
        <WorkerLinkModal
          employee={{ id: browseFor.employee_id, first_name: browseFor.employee_name, last_name: '' }}
          onClose={() => setBrowseFor(null)}
          onLinked={() => {
            // Remove from local no_match list so the row disappears.
            setNoMatch((prev) => prev.filter((r) => r.employee_id !== browseFor.employee_id));
            setBrowseFor(null);
            onCompleted?.();
          }}
        />
      )}
    </div>
  );
}
