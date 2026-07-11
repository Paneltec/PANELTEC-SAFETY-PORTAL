// Risk Assessments — Capture sub-tab. v160.3.0-adjust-13.
// Modelled on Inspections.jsx (same shape, same PdfActions/EmailButton
// row, same zebra table). Reads from /risk-assessments which unions
// native rows (empty for now) with form_submissions where
// template_category_snapshot === "risk_assessment".
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
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
            <table className="zebra-list w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                <tr>
                  <th className="text-left px-4 py-3">Template</th>
                  <th className="text-left px-4 py-3">Date</th>
                  <th className="text-left px-4 py-3">Operator</th>
                  <th className="text-right px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => {
                  const title = it.template_name || it.template_name_snapshot || 'Risk assessment';
                  return (
                    <tr
                      key={it.id}
                      className="border-t border-slate-100 hover:bg-slate-50"
                      data-testid={`risk-assessment-row-${it.id}`}
                    >
                      <td className="px-4 py-3 font-medium">{title}</td>
                      <td className="px-4 py-3 text-slate-500">{it.date}</td>
                      <td className="px-4 py-3 text-slate-500">{it.operator || it.created_by_name || ''}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex gap-1 items-center">
                          <PdfActions
                            resourceKind="risk-assessments"
                            recordId={it.id}
                            source={it.source}
                            title={title}
                            size="sm"
                          />
                          <EmailButton
                            resourceKind="risk-assessments"
                            recordId={it.id}
                            source={it.source}
                            subject={`Risk Assessment: ${title} — ${it.date}`}
                            body={`Risk assessment.\n\nTemplate: ${title}\nDate: ${it.date}`}
                            variant="row"
                            size="sm"
                            label="Email"
                          />
                          <DeleteRecordButton
                            resourceKind="risk-assessments"
                            apiPath="risk-assessments"
                            recordId={it.id}
                            source={it.source}
                            label="Risk assessment"
                            recordTitle={`${title} · ${it.date}`}
                            onDeleted={(id) => setItems((prev) => prev.filter((x) => x.id !== id))}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
