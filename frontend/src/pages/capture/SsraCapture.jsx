// v58.13.132hz — SSRA capture — dedicated page.
//
// Rationale: SSRAs (Site Specific Risk Assessments) previously lived
// under the generic "Risk Assessments" surface alongside TTM registers
// and Master Risks. Stephen asked for a dedicated Capture entry point
// specifically for SSRA-shape submissions so admins can list, upload
// and view them without wading through the sibling reference tabs.
//
// Data source: `/api/risk-assessments` (same endpoint as the parent
// Risk Assessments page). Client-side filter to submissions whose
// `template_name_snapshot` matches /SSRA/i so we don't need a new
// backend query — future ships can add a server-side `?kind=ssra`
// param if the client-side filter proves expensive at scale.
//
// Upload PDF: reuses the existing `PdfImportModal` (POST /api/imports/pdf).
// The `_FILENAME_MATCHERS` list in imports.py already covers Drain
// Cleaning SSRA + Viatec SSRA + Excavation Permit; unmatched SSRA
// files fall through to title-token matching against the existing
// Construction & Excavation SSRA / Viatec Traffic Solutions SSRA
// templates.
//
// View original document: shows a "View original" link on any card
// carrying `imported_from_pdf` — opens the shared file preview modal
// via `filesUrl`. Records without an imported source hide the link.
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Upload, FileText } from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError, USER_KEY } from '../../lib/api';
import CaptureListToolbar from '../../components/CaptureListToolbar';
import CaptureCard, { CaptureCardGrid, CaptureSticky } from '../../components/CaptureCard';
import TotalCountChip from '../../components/TotalCountChip';
import ShowArchivedToggle from '../../components/ShowArchivedToggle';
import PaginationBar, { usePersistedPageSize } from '../../components/PaginationBar';
import useArchiveActions from '../../lib/useArchiveActions';
import useCaptureDensity from '../../lib/useCaptureDensity';
import ViewOriginalPdfButton from '../../components/ViewOriginalPdfButton';  // v58.13.132ki
import { PageHeader, EmptyState } from '../../components/capture/Ui';
import PdfImportModal from '../../components/imports/PdfImportModal';
import { getUser } from '@/lib/auth';

function loadUser() {
  try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); }
  catch { return null; }
}

// v58.13.132hz — Client-side SSRA classifier. Matches:
//   · "SSRA" substring in the template name (case-insensitive)
//   · Known SSRA-family template names (from live form_templates grep)
// Kept as a function so the pytest source-pin can grep for the
// regex and confirm the same shape ships across releases.
const SSRA_RE = /ssra|site[\s_-]*specific[\s_-]*risk/i;

export default function SsraCapture() {
  const [items, setItems] = useState([]);
  const [totalCount, setTotalCount] = useState(null);
  const [archivedCount, setArchivedCount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [importOpen, setImportOpen] = useState(false);
  const isAdmin = (getUser()?.role || '').toLowerCase() === 'admin';
  const [pageSize, setPageSize] = usePersistedPageSize('capture-ssra:pageSize', 5000);
  const [user] = useState(loadUser);

  const load = React.useCallback(async (includeArchived, offset = 0, size = 5000, append = false) => {
    setLoading(true);
    try {
      const r = await api.get('/risk-assessments', {
        params: { include_archived: includeArchived, limit: size, offset },
      });
      const rows = r.data || [];
      setItems((prev) => (append ? [...prev, ...rows] : rows));
      const t = r.headers?.['x-total-count'];
      setTotalCount(t != null ? Number(t) : rows.length);
      const a = r.headers?.['x-archived-count'];
      setArchivedCount(a != null ? Number(a) : null);
    } catch (e) {
      toast.error(apiError(e));
    } finally { setLoading(false); }
  }, []);

  const { showArchived, setShowArchived, onArchive, onUnarchive } =
    useArchiveActions('/risk-assessments', setItems, () => load(showArchived, 0, pageSize, false));

  useEffect(() => {
    load(showArchived, 0, pageSize, false);
  }, [showArchived, pageSize, load]);

  const ssraItems = useMemo(() => (
    items.filter((r) => SSRA_RE.test(r.template_name_snapshot || ''))
  ), [items]);

  // Toolbar-filtered subset (search + status chips).
  const [filtered, setFiltered] = useState([]);
  useEffect(() => { setFiltered(ssraItems); }, [ssraItems]);

  const density = useCaptureDensity('capture-ssra', filtered.length);

  const evict = (id) => setItems((prev) => prev.filter((x) => x.id !== id));

  const onLoadMore = React.useCallback(() => {
    load(showArchived, items.length, pageSize, true);
  }, [load, showArchived, items.length, pageSize]);

  return (
    <div className="max-w-7xl mx-auto" data-testid="capture-ssra-page">
      <CaptureSticky testid="capture-ssra-sticky">
        <PageHeader
          crumb="Capture / SSRA"
          title="SSRA"
          subtitle="Site Specific Risk Assessments — upload legacy PDFs or list submissions from the field."
          action={
            isAdmin ? (
              <button
                type="button"
                onClick={() => setImportOpen(true)}
                data-testid="capture-ssra-upload-pdf-btn"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1e4a8c] text-white text-sm font-semibold hover:bg-[#143263]"
              >
                <Upload size={14} /> Upload PDF
              </button>
            ) : null
          }
        />

        <div className="mt-1 flex items-center gap-2">
          <TotalCountChip
            showing={filtered.length}
            total={ssraItems.length}
            testid="capture-ssra-total-count-chip"
          />
          {isAdmin && (
            <ShowArchivedToggle
              value={showArchived}
              onChange={setShowArchived}
              count={archivedCount}
              testid="capture-ssra-show-archived-toggle"
            />
          )}
          <Link to="/app/risk-assessments"
            data-testid="capture-ssra-parent-link"
            className="text-xs text-slate-500 hover:text-slate-800 hover:underline ml-auto">
            All Risk Assessments →
          </Link>
        </div>

        {ssraItems.length > 0 && (
          <CaptureListToolbar
            items={ssraItems} onFiltered={setFiltered} testidPrefix="capture-ssra"
            densityMode={density.mode} onDensityChange={density.setMode}
          />
        )}
      </CaptureSticky>

      <div className="mt-3">
        {loading ? (
          <div className="text-sm text-slate-500">Loading…</div>
        ) : ssraItems.length === 0 ? (
          <EmptyState
            title="No SSRAs yet"
            body="Upload a legacy SSRA PDF via the Upload PDF button, or workers can submit one from the mobile Forms Library (Drain Cleaning SSRA, Viatec Traffic Solutions SSRA, Construction & Excavation SSRA)."
          />
        ) : (
          <CaptureCardGrid testid="capture-ssra-grid" gridClass={density.gridClass}>
            {filtered.map((r) => (
              <div key={r.id} data-testid={`capture-ssra-card-wrap-${r.id}`}>
                <CaptureCard
                  record={r}
                  resourceKind="risk_assessments"
                  apiPath="risk-assessments"
                  subject={`SSRA: ${r.template_name_snapshot || 'SSRA'} — ${r.date || ''}`}
                  body={`Site Specific Risk Assessment.\n\nTemplate: ${r.template_name_snapshot || ''}\nDate: ${r.date || ''}`}
                  subtitleLines={density.subtitleLines}
                  minH={density.cardMinH}
                  onDeleted={evict}
                  onArchive={isAdmin ? onArchive : undefined}
                  onUnarchive={isAdmin ? onUnarchive : undefined}
                />
                {r.imported_from_pdf && (
                  <div className="mt-1 text-[10px] text-slate-500 truncate flex items-center gap-1"
                    data-testid={`capture-ssra-original-doc-${r.id}`}
                    title={r.imported_from_pdf}>
                    <FileText size={10} className="shrink-0 text-slate-400" />
                    <span className="truncate">Source: {r.imported_from_pdf}</span>
                  </div>
                )}
                {/* v58.13.132ki — View original PDF (opens the source
                    upload in a new tab). Shown on every imported row;
                    404 surfaces a friendly toast for the backfill case. */}
                {r.imported && (
                  <div className="mt-0.5 flex">
                    <ViewOriginalPdfButton
                      submissionId={r.id}
                      testid={`capture-ssra-view-original-${r.id}`}
                    />
                  </div>
                )}
              </div>
            ))}
          </CaptureCardGrid>
        )}
        {!loading && ssraItems.length > 0 && (
          <PaginationBar
            showing={items.length}
            total={totalCount ?? items.length}
            pageSize={pageSize}
            onPageSize={setPageSize}
            onLoadMore={onLoadMore}
            loading={loading}
            testidPrefix="capture-ssra"
            storageKey="capture-ssra:pageSize"
          />
        )}
      </div>

      <PdfImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={() => load(showArchived, 0, pageSize, false)}
      />
      {/* Keep `user` referenced so ESLint no-unused-vars stays green
          even though we don't render user-specific chrome yet. */}
      {void user}
    </div>
  );
}
