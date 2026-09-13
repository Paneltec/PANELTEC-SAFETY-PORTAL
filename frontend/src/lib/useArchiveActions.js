import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import api from './api';

/**
 * v58.13.132ec — useArchiveActions
 *
 * Shared hook that gives every capture list page a consistent
 * archive/unarchive lifecycle:
 *
 *   const { showArchived, setShowArchived, onArchive, onUnarchive } =
 *     useArchiveActions('/incidents', setItems, refetch);
 *
 * · `showArchived`     — bool. Passed into `?include_archived=...`.
 * · `setShowArchived`  — flip the toggle.
 * · `onArchive(r)`     — POST /{apiPath}/{r.id}/archive. On success,
 *                        either evicts the row (if `showArchived` is
 *                        false) or marks it archived in-place (if true).
 * · `onUnarchive(r)`   — inverse, only meaningful when `showArchived`
 *                        is true.
 *
 * `applyLocal` should update the local state array so the toast lands
 * on an already-updated list.
 *
 * Params
 *   apiPath   (string)                — e.g. `/incidents`
 *   setItems  ((prev) => next => void) — parent's setItems dispatch
 *   refetch   (optional () => void)   — fallback if optimistic update
 *                                        can't be applied
 */
export default function useArchiveActions(apiPath, setItems, refetch) {
  const [showArchived, setShowArchived] = useState(false);

  const onArchive = useCallback(async (r) => {
    if (!r?.id) return;
    // v58.13.132ed — Confirm before archive (frictionless restore
    // doesn't need one). `window.confirm` keeps the FE dependency
    // surface flat; a proper modal is a future polish task.
    // eslint-disable-next-line no-alert
    if (!window.confirm('Archive this record?')) return;
    try {
      const res = await api.post(`${apiPath}/${r.id}/archive`);
      const batch = res.data?.batch_id;
      // Optimistic update: mark archived in place (or evict if the
      // toggle is currently OFF).
      setItems?.((prev) => {
        if (!Array.isArray(prev)) return prev;
        if (!showArchived) return prev.filter((x) => x.id !== r.id);
        return prev.map((x) => (
          x.id === r.id
            ? { ...x, archived_at: new Date().toISOString(), archive_batch_id: batch }
            : x
        ));
      });
      toast.success('Record archived', {
        description: 'Toggle Show archived to see it.',
      });
      // v58.13.132ee — refetch so `X-Total-Count` + `X-Archived-Count`
      // headers pick up the new state and the count chips re-hydrate.
      refetch?.();
    } catch (e) {
      toast.error('Archive failed', {
        description: e?.response?.data?.detail || e.message,
      });
      refetch?.();
    }
  }, [apiPath, setItems, showArchived, refetch]);

  const onUnarchive = useCallback(async (r) => {
    if (!r?.id) return;
    try {
      await api.post(`${apiPath}/${r.id}/unarchive`);
      setItems?.((prev) => {
        if (!Array.isArray(prev)) return prev;
        return prev.map((x) => (
          x.id === r.id
            ? { ...x, archived_at: null, archive_batch_id: null }
            : x
        ));
      });
      toast.success('Record restored');
      // v58.13.132ee — refetch to refresh count chips.
      refetch?.();
    } catch (e) {
      toast.error('Restore failed', {
        description: e?.response?.data?.detail || e.message,
      });
      refetch?.();
    }
  }, [apiPath, setItems, refetch]);

  return { showArchived, setShowArchived, onArchive, onUnarchive };
}
