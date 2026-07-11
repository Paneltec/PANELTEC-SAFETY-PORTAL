// Risk Assessments — Capture sub-tab. v160.3.0-adjust-16a.
// Card layout matching Hazards / Pre-Starts patterns:
//   • Template name in bold
//   • LEGACY pill for imported rows (adjust-15 pattern)
//   • Operator name (`submitted_by_name`)
//   • SUBMITTED status + date pill row
//   • Open report + trash-icon delete
//   • No photo placeholder when no photo attached (adjust-16a pattern)
import React, { useEffect, useState } from 'react';
import api from '../lib/api';
import EmailButton from '../components/EmailButton';
import PdfActions from '../components/PdfActions';
import DeleteRecordButton from '../components/DeleteRecordButton';
import { PageHeader, EmptyState } from '../components/capture/Ui';

export default function RiskAssessments() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/risk-assessments')
      .then((r) => setItems(r.data))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-6xl mx-auto" data-testid="risk-assessments-list">
      <PageHeader
        crumb="Capture / Risk Assessments"
        title="Risk Assessments"
        subtitle="SSRAs, TTM registers and other site risk assessments — captured on the phone, surfaced here."
      />
      <div className="mt-6">
        {loading ? (
          <div className="text-sm text-slate-500">Loading…</div>
        ) : items.length === 0 ? (
          <EmptyState
            title="No risk assessments yet"
            body="Workers submit a Risk Assessment from the mobile Forms Library (TTM Register, Construction & Excavation SSRA, Viatec Traffic Solutions SSRA). They land here."
          />
        ) : (<>
          <CaptureListToolbar items={items} onFiltered={setFiltered} testidPrefix="risk-assessments" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((r) => {
              const title = r.template_name_snapshot || r.template_name || 'Risk assessment';
              const operator = r.submitted_by_name || r.operator || r.created_by_name || '';
              return (
                <div
                  key={r.id}
                  className="rounded-2xl border border-slate-200 bg-white overflow-hidden"
                  data-testid={`risk-assessment-card-${r.id}`}
                >
                  <div className="p-4">
                    <h3 className="font-display font-semibold text-sm truncate">{title}</h3>
                    {r.imported && (
                      <div className="mt-1">
                        <span
                          className="inline-flex items-center text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 ring-1 ring-slate-300"
                          title="Imported from legacy Simpro record"
                          data-testid={`risk-assessment-legacy-badge-${r.id}`}
                        >
                          Legacy
                        </span>
                      </div>
                    )}
                    <p className="text-xs text-slate-500 mt-1 line-clamp-2">{operator || '—'}</p>
                    <div className="mt-3 flex items-center justify-between text-xs">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 font-semibold uppercase tracking-wider text-[10px]">
                        Submitted
                      </span>
                      <span className="text-slate-500">{r.date || (r.submitted_at || '').substring(0, 10)}</span>
                    </div>
                    <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
                      <div className="inline-flex gap-1 items-center">
                        <PdfActions
                          resourceKind="risk-assessments"
                          recordId={r.id}
                          source={r.source}
                          title={title}
                          size="sm"
                        />
                        <EmailButton
                          resourceKind="risk-assessments"
                          recordId={r.id}
                          source={r.source}
                          subject={`Risk Assessment: ${title} — ${r.date || ''}`}
                          body={`Risk assessment.\n\nTemplate: ${title}\nDate: ${r.date || ''}`}
                          variant="row"
                          size="sm"
                          label="Email"
                        />
                      </div>
                      <DeleteRecordButton
                        resourceKind="risk-assessments"
                        apiPath="risk-assessments"
                        recordId={r.id}
                        source={r.source}
                        label="Risk assessment"
                        recordTitle={`${title} · ${r.date || ''}`}
                        onDeleted={(id) => setItems((prev) => prev.filter((x) => x.id !== id))}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div></>
        )}
      </div>
    </div>
  );
}
