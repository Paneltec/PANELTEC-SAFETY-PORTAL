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
import TotalCountChip from '../components/TotalCountChip';  // v58.13.132eb
import ShowArchivedToggle from '../components/ShowArchivedToggle';  // v58.13.132ec
import ArchiveDialog from '../components/ArchiveDialog';  // v58.13.132ee
import PaginationBar, { usePersistedPageSize } from '../components/PaginationBar';  // v58.13.132eh
import useArchiveActions from '../lib/useArchiveActions';  // v58.13.132ec
import { getUser } from '@/lib/auth';
import useCaptureDensity from '../lib/useCaptureDensity';
import { PageHeader, EmptyState } from '../components/capture/Ui';
import MasterRisksTab from './MasterRisksTab';
import ListFormsTab from './ListFormsTab';
import IncidentRootCausesTab from './IncidentRootCausesTab';
import ListRolesTab from './ListRolesTab';
import CompletedTrainingTab from './CompletedTrainingTab';
import CompaniesTab from './CompaniesTab';

// v58.13.132gl-a — Risk Assessments only owns Submissions + the 3
// risk-related reference libraries. `list_roles`, `completed_training`
// and `companies` are HR/Directory concerns and live on their own
// pages under the Compliance sidebar section — remove them from
// here. The imports above are retained temporarily so the tab
// components stay tree-shaken alongside their pages; a follow-up can
// drop them once every consumer is confirmed on the new nav.
const TABS = [
  { key: 'submissions',   label: 'Submissions' },
  { key: 'master',        label: 'Master Risks' },
  { key: 'list_forms',    label: 'List Forms' },
  { key: 'root_causes',   label: 'Incident Root Causes' },
];

function loadUser() {
  try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); }
  catch { return null; }
}

export default function RiskAssessments() {
  const [tab, setTab] = useState('submissions');
  const [items, setItems] = useState([]);
  const [filtered, setFiltered] = useState([]);
  // v58.13.132eb — total server count from X-Total-Count header
  const [totalCount, setTotalCount] = useState(null);
  // v58.13.132ee — archived count from X-Archived-Count header.
  const [archivedCount, setArchivedCount] = useState(null);
  const [loading, setLoading] = useState(true);
  // v58.13.132ec — Archive lifecycle. Admin-only.
  const isAdmin = (getUser()?.role || '').toLowerCase() === 'admin';
  // v58.13.132ee — Bulk archive dialog state (Admin only).
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  // v58.13.132eh — Load-more pagination.
  const [pageSize, setPageSize] = usePersistedPageSize('risk-assessments:pageSize', 5000);
  const [user] = useState(loadUser);
  const density = useCaptureDensity('risk-assessments', filtered.length);
  // Reference to TOKEN_KEY to keep tree-shaking honest on the named import.
  void TOKEN_KEY;

  // v58.13.132ee — Shared loader.
  const load = React.useCallback(async (includeArchived, offset = 0, size = 5000, append = false) => {
    setLoading(true);
    try {
      const r = await api.get('/risk-assessments', {
        params: { include_archived: includeArchived, limit: size, offset },
      });
      setItems((prev) => (append ? [...prev, ...(r.data || [])] : r.data || []));
      setFiltered((prev) => (append ? [...prev, ...(r.data || [])] : r.data || []));
      const t = r.headers?.['x-total-count'];
      setTotalCount(t != null ? Number(t) : r.data?.length ?? 0);
      const a = r.headers?.['x-archived-count'];
      setArchivedCount(a != null ? Number(a) : null);
    } finally { setLoading(false); }
  }, []);
  const { showArchived, setShowArchived, onArchive, onUnarchive } =
    useArchiveActions('/risk-assessments', setItems, () => load(showArchived, 0, pageSize, false));
  const onLoadMore = React.useCallback(() => {
    load(showArchived, items.length, pageSize, true);
  }, [load, showArchived, items.length, pageSize]);

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
    load(showArchived, 0, pageSize, false);
  }, [tab, showArchived, pageSize, load]);

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
          action={
            isAdmin && tab === 'submissions' ? (
              <button type="button" onClick={() => setArchiveDialogOpen(true)}
                      data-testid="risk-assessments-archive-header-btn"
                      className="text-sm px-3 py-1.5 rounded border border-slate-300 text-slate-700 hover:bg-slate-50">
                Archive…
              </button>
            ) : null
          }
        />
        {/* v58.13.132ee — Bulk archive dialog (Admin only, Submissions tab). */}
        {isAdmin && tab === 'submissions' && (
          <ArchiveDialog open={archiveDialogOpen} onClose={() => setArchiveDialogOpen(false)}
            apiPath="/risk-assessments" moduleLabel="risk assessments"
            knownStatuses={[]}
            knownCategories={[]}
            onArchived={() => load(showArchived)} />
        )}

        {/* v58.13.132eb — total-count chip. Only shown on the
            Submissions tab (the other tabs are reference libraries
            with their own count semantics). */}
        {tab === 'submissions' && (
          <div className="mt-1 flex items-center gap-2">
            <TotalCountChip
              showing={filtered.length}
              total={totalCount}
              testid="risk-assessments-total-count-chip"
            />
            {/* v58.13.132ec — Admin-only archive visibility toggle. */}
            {isAdmin && (
              <ShowArchivedToggle
                value={showArchived}
                onChange={setShowArchived}
                count={archivedCount}
                testid="risk-assessments-show-archived-toggle"
              />
            )}
          </div>
        )}

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
          <CaptureListToolbar
            items={items} onFiltered={setFiltered} testidPrefix="risk-assessments"
            densityMode={density.mode} onDensityChange={density.setMode}
          />
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
              <CaptureCardGrid testid="risk-assessments-grid" gridClass={density.gridClass}>
                {filtered.map((r) => (
                  <CaptureCard
                    key={r.id}
                    record={r}
                    resourceKind="risk_assessments"
                    apiPath="risk-assessments"
                    subject={`Risk Assessment: ${r.template_name_snapshot || 'Risk assessment'} — ${r.date || ''}`}
                    body={`Risk assessment.\n\nTemplate: ${r.template_name_snapshot || ''}\nDate: ${r.date || ''}`}
                    subtitleLines={density.subtitleLines}
                    minH={density.cardMinH}
                    onDeleted={evict}
                    onArchive={isAdmin ? onArchive : undefined}
                    onUnarchive={isAdmin ? onUnarchive : undefined}
                  />
                ))}
              </CaptureCardGrid>
            )}
            {/* v58.13.132eh — Load-more pager. */}
            {tab === 'submissions' && !loading && items.length > 0 && (
              <PaginationBar
                showing={items.length}
                total={totalCount ?? items.length}
                pageSize={pageSize}
                onPageSize={setPageSize}
                onLoadMore={onLoadMore}
                loading={loading}
                testidPrefix="risk-assessments"
                storageKey="risk-assessments:pageSize"
              />
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
