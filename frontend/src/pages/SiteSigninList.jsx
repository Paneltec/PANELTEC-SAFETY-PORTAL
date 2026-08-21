// v58.13.6 — Site Sign-In / Visitor Register dedicated Capture page.
// Renders submissions of the fixed template id via the shared
// `GroupedTilesView` (same look as Inspections + Incidents from v58.12.9).
// Groups by `submitted_by_name` — one section per person who signed in.
//
// Backend endpoint: `GET /api/forms/templates/{template_id}/submissions`
// (existing since v160.0, no backend edit for this ship).
import React, { useCallback, useEffect, useState } from 'react';
import api, { apiError } from '../lib/api';
import GroupedTilesView from '../components/capture/GroupedTilesView';
import { PageHeader } from '../components/capture/Ui';
import { toast } from 'sonner';

// The template id is stable across orgs — installed by the migration in
// v160.3.0 as a global default. If the user's org has a rename, they'd
// still target this id (deleted_at:null on the doc).
const TEMPLATE_ID = 'e8873f7e-6fd4-44c9-961a-d68e6ffecd8d';

export default function SiteSigninList() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.get(`/forms/templates/${TEMPLATE_ID}/submissions`);
      setItems(Array.isArray(r.data) ? r.data : (r.data?.submissions || []));
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const renderTile = (rec) => (
    <div className="text-xs">
      <div className="font-semibold text-slate-900">
        {rec.submitted_by_name || 'Unknown signer'}
      </div>
      <div className="text-slate-500 mt-0.5">
        {rec.submitted_at ? new Date(rec.submitted_at).toLocaleString() : '—'}
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
    </div>
  );
}
