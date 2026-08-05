// v160.3.9.58.1 — Bulk-Import wizard job polling hook.
//
// A small, self-contained polling driver. Given a `jobId`, it polls the
// backend every `intervalMs` (default 3s) and returns:
//   { job, error, refresh }
//
// Callers derive their UI state from `job.state`:
//   init | downloading | extracting | dryrun | awaiting_approval |
//   processing | complete | failed
//
// The hook stops polling on terminal states (`complete`, `failed`,
// `awaiting_approval`) — Step 3 explicitly resumes polling when the
// user approves and the job moves to `processing`.
//
// This is intentionally NOT wrapped in a context — the persistent pill
// consumes the same hook independently, and the wizard page owns its
// own instance for the active-in-view job. React 18 batches state, so
// the double-poll cost is negligible.

import { useCallback, useEffect, useRef, useState } from 'react';
import api, { apiError } from '../../../lib/api';

// Only truly-terminal states stop the poll. `awaiting_approval` is an
// intermediate pause — `/approve` transitions it back to `downloading`
// so we must keep polling.
const TERMINAL_STATES = new Set(['complete', 'failed', 'cancelled']);

export function useBulkImportJob(jobId, { intervalMs = 3000, active = true } = {}) {
  const [job, setJob] = useState(null);
  const [error, setError] = useState(null);
  const timerRef = useRef(null);
  const stoppedRef = useRef(false);

  const fetchOnce = useCallback(async () => {
    if (!jobId) return null;
    try {
      const r = await api.get(`/pre-starts/bulk-import/${jobId}/status`);
      setJob(r.data);
      setError(null);
      // Stop polling on terminal states — a subsequent `active=true`
      // toggle (Step 3 approves) will re-arm.
      if (TERMINAL_STATES.has(r.data.state)) {
        stoppedRef.current = true;
      }
      return r.data;
    } catch (e) {
      setError(apiError(e, 'Failed to fetch job status'));
      return null;
    }
  }, [jobId]);

  useEffect(() => {
    if (!jobId || !active) return undefined;
    stoppedRef.current = false;
    let cancelled = false;

    const tick = async () => {
      if (cancelled || stoppedRef.current) return;
      await fetchOnce();
      if (cancelled || stoppedRef.current) return;
      timerRef.current = setTimeout(tick, intervalMs);
    };
    tick();

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [jobId, active, intervalMs, fetchOnce]);

  return { job, error, refresh: fetchOnce };
}

export const BULK_IMPORT_TERMINAL_STATES = TERMINAL_STATES;
