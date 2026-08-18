// v160.3.9.58.6 — Polls the new /pre-starts/bulk-import/last endpoint
// once on mount. Returns `{ job, loading, refresh }`. When there is no
// resumable job the endpoint returns 200 + `null`, so the wizard hides
// the resume button entirely (no clutter for first-time users).

import { useCallback, useEffect, useState } from 'react';
import api from '../../../lib/api';

export function useLastFailedJob({ withinDays = 30 } = {}) {
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await api.get('/pre-starts/bulk-import/last', {
        params: { within_days: withinDays, states: 'failed,awaiting_approval' },
      });
      setJob(resp.data || null);
    } catch {
      // Non-admin viewers get 403 — treat as "nothing to show".
      setJob(null);
    } finally {
      setLoading(false);
    }
  }, [withinDays]);

  useEffect(() => { refresh(); }, [refresh]);

  return { job, loading, refresh };
}
