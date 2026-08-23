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
import api, { apiError } from '../lib/api';
import GroupedTilesView from '../components/capture/GroupedTilesView';
import { PageHeader } from '../components/capture/Ui';
import CaptureCard from '../components/CaptureCard';
import { toast } from 'sonner';

const TEMPLATE_ID = 'e8873f7e-6fd4-44c9-961a-d68e6ffecd8d';

export default function SiteSigninList() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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

  // v58.13.38 — Canonical tile shell. `CaptureCard` renders the
  // visitor / worker name via the built-in title row (fed by
  // `template_name_snapshot`), the sign-in timestamp via the built-in
  // date row, and the shared Eye + Delete action row. Site/job
  // context lands in the `subtitle` prop. The `record` shape below
  // adapts the `forms/submissions` payload to CaptureCard's expected
  // keys without mutating the source array (zero data change).
  const renderTile = (rec) => (
    <CaptureCard
      record={{
        ...rec,
        template_name_snapshot: rec.submitted_by_name || 'Unknown signer',
        date: rec.submitted_at ? new Date(rec.submitted_at).toISOString().slice(0, 10) : '',
      }}
      resourceKind="forms"
      apiPath="forms/submissions"
      subtitle={rec.site_name || rec.job_label || null}
      hideOperator
      onDeleted={removeLocal}
    />
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
        page="site-signin"
        pageKey="site-signin"
      />
    </div>
  );
}
