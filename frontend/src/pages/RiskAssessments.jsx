// Risk Assessments — Capture sub-tab. v160.3.9.15.
// Four-tab surface: Submissions, Master Risks, List Forms, Incident Root
// Causes.
import React, { useEffect, useState } from 'react';
import api from '../lib/api';
import { TOKEN_KEY, USER_KEY } from '../lib/api';
import CaptureListToolbar from '../components/CaptureListToolbar';
import CaptureCard, { CaptureCardGrid, CaptureSticky } from '../components/CaptureCard';
import { PageHeader, EmptyState } from '../components/capture/Ui';
import MasterRisksTab from './MasterRisksTab';
import ListFormsTab from './ListFormsTab';
import IncidentRootCausesTab from './IncidentRootCausesTab';
import CsIncidentTab from './CsIncidentTab';

const TABS = [
  { key: 'submissions',   label: 'Submissions' },
  { key: 'master',        label: 'Master Risks' },
  { key: 'list_forms',    label: 'List Forms' },
  { key: 'root_causes',   label: 'Incident Root Causes' },
  { key: 'cs_incident',   label: 'CS Incident' },
];

function loadUser() {
  try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); }
  catch { return null; }
}

export default function RiskAssessments() {
  const [tab, setTab] = useState('submissions');
  const [items, setItems] = useState([]);
  const [filtered, setFiltered] = useState([]);
  const [loading, setLoading] = useState(true);
  const [user] = useState(loadUser);
  // Reference to TOKEN_KEY to keep tree-shaking honest on the named import.
  void TOKEN_KEY;

  useEffect(() => {
    if (tab !== 'submissions') return;
    setLoading(true);
    api.get('/risk-assessments')
      .then((r) => { setItems(r.data); setFiltered(r.data); })
      .finally(() => setLoading(false));
  }, [tab]);

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
          subtitle="Field-captured SSRAs and the Paneltec master risks reference library."
        />

        {/* Tab bar */}
        <div className="flex gap-1 border-b border-slate-200 mt-2" data-testid="risk-assessments-tabs">
          {TABS.map((t) => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                data-testid={`risk-assessments-tab-${t.key}`}
                className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 transition ${active ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                aria-selected={active}
                role="tab"
              >
                {t.label}
              </button>
            );
          })}
        </div>

        {tab === 'submissions' && items.length > 0 && (
          <CaptureListToolbar items={items} onFiltered={setFiltered} testidPrefix="risk-assessments" />
        )}
      </CaptureSticky>

      <div className="mt-3">
        {tab === 'submissions' && (
          <>
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
          </>
        )}

        {tab === 'master' && <MasterRisksTab user={user} />}
        {tab === 'list_forms' && <ListFormsTab user={user} />}
        {tab === 'root_causes' && <IncidentRootCausesTab user={user} />}
        {tab === 'cs_incident' && <CsIncidentTab user={user} />}
      </div>
    </div>
  );
}
