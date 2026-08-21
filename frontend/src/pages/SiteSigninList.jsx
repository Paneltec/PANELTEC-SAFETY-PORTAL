// v58.13.6 — Site Sign-In / Visitor Register dedicated Capture page.
// v58.13.7 — Per-tile View + Delete actions (SubmissionViewer +
// DeleteRecordButton reused; zero shared-component modifications).
// v58.13.10 — Fix: View button flashes-and-closes.
//   Root cause: SubmissionViewer's backdrop (`onClick={onClose}`)
//   receives the SAME synthetic-event bubble that opened it. React
//   commits the portal synchronously between the button's `onClick`
//   and the event reaching the root's delegated listener, so the
//   backdrop's `onClick` is registered in time to fire on the same
//   tick. Fix is a 1-line `e.stopPropagation()` on the View trigger,
//   mirroring the pattern DeleteRecordButton uses internally.
//   Zero shared-component edits, zero GroupedTilesView edits.
// Edit action deferred to v58.13.8 (audit-trail design pending).
import React, { useCallback, useEffect, useState } from 'react';
import { Eye } from 'lucide-react';
import api, { apiError } from '../lib/api';
import GroupedTilesView from '../components/capture/GroupedTilesView';
import { PageHeader } from '../components/capture/Ui';
import SubmissionViewer from '../components/SubmissionViewer';
import DeleteRecordButton from '../components/DeleteRecordButton';
import { toast } from 'sonner';

const TEMPLATE_ID = 'e8873f7e-6fd4-44c9-961a-d68e6ffecd8d';

export default function SiteSigninList() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [viewerRec, setViewerRec] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await api.get(`/forms/templates/${TEMPLATE_ID}/submissions`);
      setItems(Array.isArray(r.data) ? r.data : (r.data?.submissions || []));
    } catch (e) { setError(e); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const removeLocal = (id) => setItems((prev) => prev.filter((x) => x.id !== id));

  const renderTile = (rec) => (
    <div className="flex flex-col gap-1.5">
      <div className="text-xs">
        <div className="font-semibold text-slate-900 truncate">
          {rec.submitted_by_name || 'Unknown signer'}
        </div>
        <div className="text-slate-500 mt-0.5">
          {rec.submitted_at ? new Date(rec.submitted_at).toLocaleString() : '—'}
        </div>
      </div>
      {/* v58.13.7 — Per-tile action bar. Mirrors the Inspections.jsx
          pattern (Eye view + DeleteRecordButton). Edit deferred to v58.13.8.
          v58.13.10 — View trigger now stops propagation. Without it the
          same click that sets `viewerRec` bubbles through React's
          synthetic-event tree into the freshly-mounted
          `SubmissionViewer` backdrop (`onClick={onClose}`), closing
          the modal on the same tick — the "flash and close" the user
          reported. DeleteRecordButton already does this internally
          (line 76 of its component), which is why Delete worked and
          View didn't on the same tile. */}
      <div className="flex flex-wrap gap-1 items-center pt-1 border-t border-slate-100">
        <button type="button"
          onClick={(e) => { e.stopPropagation(); setViewerRec(rec); }}
          title="View submission"
          data-testid={`site-signin-view-${rec.id}`}
          className="w-7 h-7 inline-flex items-center justify-center rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100">
          <Eye size={13} />
        </button>
        <DeleteRecordButton
          resourceKind="forms" apiPath="forms/submissions"
          recordId={rec.id} label="Sign-in"
          recordTitle={`${rec.submitted_by_name || 'Unknown'} · ${rec.submitted_at || ''}`}
          onDeleted={removeLocal} />
      </div>
    </div>
  );

  return (
    <div className="max-w-6xl mx-auto p-4 space-y-4" data-testid="site-signin-page">
      <PageHeader title="Site Sign-In / Visitor Register" subtitle="Recent visitor sign-ins across all sites." />
      <GroupedTilesView
        items={items}
        groupBy={(r) => r.submitted_by_name || 'Unknown signer'}
        renderTile={renderTile}
        dateFn={(r) => r.submitted_at || ''}
        loading={loading}
        error={error && apiError(error)}
        onRetry={() => { toast.info('Retrying…'); load(); }}
        emptyMessage="No sign-ins recorded yet."
        testidPrefix="site-signin"
      />
      {viewerRec && (
        <SubmissionViewer record={viewerRec} resourceKind="forms" apiPath="forms/submissions"
          onClose={() => setViewerRec(null)}
          onDeleted={(id) => { removeLocal(id); setViewerRec(null); }} />
      )}
    </div>
  );
}
