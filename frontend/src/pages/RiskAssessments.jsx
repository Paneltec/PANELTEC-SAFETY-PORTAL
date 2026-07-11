// Risk Assessments — Capture sub-tab. v160.3.0-adjust-17b.
// Uses shared CaptureCard for compact, color-coded, dense grid.
import React, { useEffect, useState } from 'react';
import api from '../lib/api';
import CaptureListToolbar from '../components/CaptureListToolbar';
import CaptureCard, { CaptureCardGrid, CaptureSticky } from '../components/CaptureCard';
import { PageHeader, EmptyState } from '../components/capture/Ui';

export default function RiskAssessments() {
  const [items, setItems] = useState([]);
  const [filtered, setFiltered] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/risk-assessments')
      .then((r) => { setItems(r.data); setFiltered(r.data); })
      .finally(() => setLoading(false));
  }, []);

  const evict = (id) => {
    setItems((prev) => prev.filter((x) => x.id !== id));
    setFiltered((prev) => prev.filter((x) => x.id !== id));
  };

  return (
    <div className="max-w-7xl mx-auto" data-testid="risk-assessments-list">
      <CaptureSticky testid="risk-assessments-sticky">
        <PageHeader
          crumb="Capture / Risk Assessments"
          title="Risk Assessments"
          subtitle="SSRAs, TTM registers and other site risk assessments — captured on the phone, surfaced here."
        />
        {items.length > 0 && (
          <CaptureListToolbar items={items} onFiltered={setFiltered} testidPrefix="risk-assessments" />
        )}
      </CaptureSticky>
      <div className="mt-3">
        {loading ? (
          <div className="text-sm text-slate-500">Loading…</div>
        ) : items.length === 0 ? (
          <EmptyState
            title="No risk assessments yet"
            body="Workers submit a Risk Assessment from the mobile Forms Library (TTM Register, Construction & Excavation SSRA, Viatec Traffic Solutions SSRA). They land here."
          />
        ) : (
          <CaptureCardGrid testid="risk-assessments-grid">
            {filtered.map((r) => (
              <CaptureCard
                key={r.id}
                record={r}
                resourceKind="risk_assessments"
                apiPath="risk-assessments"
                subject={`Risk Assessment: ${r.template_name_snapshot || 'Risk assessment'} — ${r.date || ''}`}
                body={`Risk assessment.\n\nTemplate: ${r.template_name_snapshot || ''}\nDate: ${r.date || ''}`}
                onDeleted={evict}
              />
            ))}
          </CaptureCardGrid>
        )}
      </div>
    </div>
  );
}
