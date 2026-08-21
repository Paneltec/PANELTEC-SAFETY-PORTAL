// Risk Assessments — Capture sub-tab. v160.3.9.15.
// Four-tab surface: Submissions, Master Risks, List Forms, Incident Root
// Causes.
// v58.13.12 — CS Incident tab REMOVED. It now lives at
// `/app/submissions/cs-incidents` (dedicated tile-list page). Old
// bookmarks landing here with `?tab=cs_incident` get a client-side
// soft redirect to preserve link continuity.
import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { TOKEN_KEY, USER_KEY } from '../lib/api';
import CaptureListToolbar from '../components/CaptureListToolbar';
import CaptureCard, { CaptureCardGrid, CaptureSticky } from '../components/CaptureCard';
import { PageHeader, EmptyState } from '../components/capture/Ui';
import MasterRisksTab from './MasterRisksTab';
import ListFormsTab from './ListFormsTab';
import IncidentRootCausesTab from './IncidentRootCausesTab';
import ListRolesTab from './ListRolesTab';
import CompletedTrainingTab from './CompletedTrainingTab';
import CompaniesTab from './CompaniesTab';

const TABS = [
  { key: 'submissions',   label: 'Submissions' },
  { key: 'master',        label: 'Master Risks' },
  { key: 'list_forms',    label: 'List Forms' },
  { key: 'root_causes',   label: 'Incident Root Causes' },
  { key: 'list_roles',    label: 'List Roles' },
  { key: 'completed_training', label: 'My Completed Training' },
  { key: 'companies',     label: 'Companies' },
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

  // v58.13.12 — Soft-redirect old CS Incident bookmarks that hit this
  // page with `?tab=cs_incident` to the new dedicated route. Effect
  // runs on mount + on `search` change; `replace` so the old URL
  // doesn't linger in the back-stack.
  const navigate = useNavigate();
  const { search } = useLocation();
  useEffect(() => {
    const params = new URLSearchParams(search);
    if (params.get('tab') === 'cs_incident') {
      navigate('/app/submissions/cs-incidents', { replace: true });
    }
  }, [search, navigate]);

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
        {tab === 'list_roles' && <ListRolesTab user={user} />}
        {tab === 'completed_training' && <CompletedTrainingTab user={user} />}
        {tab === 'companies' && <CompaniesTab user={user} />}
      </div>
    </div>
  );
}
