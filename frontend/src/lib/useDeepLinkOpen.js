// v58.13.119 — Shared `?open=<id>` deep-link helper for capture / list pages.
//
// Ask Intelligence citations render as `<Link to="/app/incidents?open=<id>">`
// (see v58.13.115 `_build_deep_link` in backend/ask.py). Each list page
// consumes this hook to:
//   1. Read `?open=<id>` from useSearchParams on mount.
//   2. Return the id as `deepLinkId` so the page can key its detail
//      drawer / SubmissionViewer / CaptureCard's `openInitially` prop
//      on it.
//   3. Immediately strip `open` (and any additional params the caller
//      passes) from the URL via `setSearchParams({}, {replace: true})`
//      so a back/forward navigation doesn't re-open the drawer and a
//      page reload doesn't either.
//   4. Once `items` load, if `deepLinkId` isn't found among them, fire
//      a single Sonner error toast so the operator knows the link was
//      valid but the record has moved / been deleted / is off-scope.
//
// USAGE:
//   const { deepLinkId, clearDeepLink } = useDeepLinkOpen({
//     items,
//     loading,
//     notFoundMessage: 'Linked incident not found',
//     extraParams: ['tab'],   // optional additional params to strip
//   });
//
// The caller passes `openInitially={row.id === deepLinkId}` to its
// card / drawer trigger, and calls `clearDeepLink()` when the drawer
// closes so the same deep-link id can't re-open a freshly closed
// drawer during subsequent re-renders.
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

export default function useDeepLinkOpen({
  items,
  loading,
  notFoundMessage = 'Linked record not found',
  extraParams = [],
} = {}) {
  const [sp, setSp] = useSearchParams();
  const [deepLinkId, setDeepLinkId] = useState(() => sp.get('open') || null);

  // Strip `open` (+ any extra params) from URL on mount. Empty deps
  // — the initial useState already captured the value so we never
  // need to re-read after this.
  useEffect(() => {
    if (!sp.get('open')) return;
    const next = new URLSearchParams(sp);
    next.delete('open');
    for (const k of extraParams) next.delete(k);
    setSp(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Not-found toast once items settle.
  useEffect(() => {
    if (!deepLinkId || loading) return;
    if (Array.isArray(items) && !items.some((i) => i && i.id === deepLinkId)) {
      toast.error(notFoundMessage, {
        description: `id=${deepLinkId.slice(0, 8)}…`,
      });
      setDeepLinkId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkId, items, loading]);

  const clearDeepLink = () => setDeepLinkId(null);

  return { deepLinkId, clearDeepLink };
}
