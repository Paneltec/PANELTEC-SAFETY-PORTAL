import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, Upload, FileText } from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../lib/api';
import useDeepLinkOpen from '../lib/useDeepLinkOpen';
import CaptureListToolbar from '../components/CaptureListToolbar';
import CaptureCard from '../components/CaptureCard';
import GroupedTilesView from '../components/capture/GroupedTilesView';
import IncidentsTable, { usePersistedViewMode } from '../components/IncidentsTable';  // v58.13.132en
import TotalCountChip from '../components/TotalCountChip';  // v58.13.132eb
import ShowArchivedToggle from '../components/ShowArchivedToggle';  // v58.13.132ec
import ArchiveDialog from '../components/ArchiveDialog';  // v58.13.132ed
import PaginationBar, { usePersistedPageSize } from '../components/PaginationBar';  // v58.13.132eh
import useArchiveActions from '../lib/useArchiveActions';  // v58.13.132ec
import useCaptureDensity from '../lib/useCaptureDensity';
import { getUser } from '../lib/auth';
import { PageHeader, NewButton, BackButton, PrimaryButton, GhostButton, Field, inputClass, EmptyState, StatusBadge } from '../components/capture/Ui';
// Phase 4.17 v134.1 — Dashboard tab.
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import ModuleDashboard from '../components/dashboards/ModuleDashboard';
// v58.13.132ia — Upload PDF affordance reuses the shared modal.
import PdfImportModal from '../components/imports/PdfImportModal';
import { useSearchParams } from 'react-router-dom';

const CATS = [
  ['near_miss', 'Near miss'], ['first_aid', 'First aid'], ['medical', 'Medical'],
  ['ltc', 'Lost-time'], ['env', 'Environmental'], ['property', 'Property'],
  // v58.13.132ia — Hazards merged into Incidents.
  ['hazard', 'Hazard'],
];

// v58.13.132ia — Type filter chips. `injury` unions first_aid + medical + ltc
// so admins get one grouped bucket for personal-injury records without a
// data migration on the existing category values.
const TYPE_CHIPS = [
  { key: 'all',        label: 'All',           match: null },
  { key: 'hazard',     label: 'Hazard',        match: (c) => c === 'hazard' },
  { key: 'near_miss',  label: 'Near Miss',     match: (c) => c === 'near_miss' },
  { key: 'injury',     label: 'Injury',        match: (c) => c === 'first_aid' || c === 'medical' || c === 'ltc' },
  { key: 'property',   label: 'Property',      match: (c) => c === 'property' },
  { key: 'env',        label: 'Environmental', match: (c) => c === 'env' },
];

// v58.12.7 — Per-CATS-key palette override for GroupedTilesView. Reads
// as an escalation ladder (near_miss → property). Not merged into the
// document-folder-scoped folderColors.js (semantically wrong there).
const INCIDENT_CATEGORY_PALETTE = {
  near_miss: { header: 'bg-amber-50 border-amber-200',     dot: 'bg-amber-500',   chip: 'bg-amber-100 text-amber-800' },
  first_aid: { header: 'bg-rose-50 border-rose-200',       dot: 'bg-rose-500',    chip: 'bg-rose-100 text-rose-800' },
  medical:   { header: 'bg-red-50 border-red-200',         dot: 'bg-red-500',     chip: 'bg-red-100 text-red-800' },
  ltc:       { header: 'bg-violet-50 border-violet-200',   dot: 'bg-violet-500',  chip: 'bg-violet-100 text-violet-800' },
  env:       { header: 'bg-emerald-50 border-emerald-200', dot: 'bg-emerald-500', chip: 'bg-emerald-100 text-emerald-800' },
  property:  { header: 'bg-slate-50 border-slate-200',     dot: 'bg-slate-500',   chip: 'bg-slate-100 text-slate-800' },
};

export default function IncidentsList() {
  const [items, setItems] = useState([]);
  // v58.13.132eb — total server count from `X-Total-Count` header
  // (crud.py list_items has emitted it since .132ea). Used by the
  // TotalCountChip to show "showing · total" when a client-side
  // filter narrows the view.
  const [totalCount, setTotalCount] = useState(null);
  // v58.13.132ee — archived count from `X-Archived-Count` header.
  const [archivedCount, setArchivedCount] = useState(null);
  const [loading, setLoading] = useState(true);
  // v58.13.132ec — Archive lifecycle. Admin-only surface.
  const isAdmin = (getUser()?.role || '').toLowerCase() === 'admin';
  // v58.13.132ed — Search should see archived. When the toolbar
  // reports a non-empty query, refetch with include_archived=true so
  // archived rows enter the client-side search pool.
  const [searchQuery, setSearchQuery] = useState('');
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const [filter, setFilter] = useState({ status: '', category: '' });
  // v58.13.132ia — Type filter chip (client-side over `category` field).
  // Reads from URL param `?type=<chip>` so /app/hazards can redirect here
  // with `?type=hazard` and land on the pre-filtered list.
  const [sp, setSp] = useSearchParams();
  const typeChip = TYPE_CHIPS.some((c) => c.key === sp.get('type')) ? sp.get('type') : 'all';
  const setTypeChip = (k) => {
    const next = new URLSearchParams(sp);
    if (k === 'all') next.delete('type'); else next.set('type', k);
    setSp(next, { replace: true });
  };
  // v58.13.132ia — Upload PDF modal (Admin-only).
  const [importOpen, setImportOpen] = useState(false);
  // v160.3.0-adjust-16g — Client-side search from shared toolbar layers
  // on top of the existing status/category selects. The pre-filtered
  // subset feeds into the toolbar; the toolbar then applies text search
  // + sort.
  const [searchFiltered, setSearchFiltered] = useState([]);
  const incidentsDensity = useCaptureDensity('incidents', searchFiltered.length);
  // v58.13.119 — Ask Intelligence deep-link (`?open=<id>`).
  const { deepLinkId } = useDeepLinkOpen({
    items, loading, notFoundMessage: 'Linked incident not found',
  });
  // v58.13.132eh — Load-more pagination. Page size persists per module.
  const [pageSize, setPageSize] = usePersistedPageSize('incidents:pageSize', 5000);
  // v58.13.132en — Cards | Table view-mode toggle (Incident Reports ONLY).
  const [viewMode, setViewMode] = usePersistedViewMode('incidents.viewMode', 'cards');
  // v58.13.132ee — Shared loader so archive/unarchive flows can refetch
  // and re-hydrate BOTH counts (X-Total-Count + X-Archived-Count).
  const load = React.useCallback(async (includeArchived, offset = 0, size = 5000, append = false) => {
    setLoading(true);
    try {
      const r = await api.get('/incidents', {
        params: { include_archived: includeArchived, limit: size, offset },
      });
      setItems((prev) => (append ? [...prev, ...(r.data || [])] : r.data || []));
      const t = r.headers?.['x-total-count'];
      setTotalCount(t != null ? Number(t) : r.data?.length ?? 0);
      const a = r.headers?.['x-archived-count'];
      setArchivedCount(a != null ? Number(a) : null);
    } finally { setLoading(false); }
  }, []);
  const { showArchived, setShowArchived, onArchive, onUnarchive } =
    useArchiveActions('/incidents', setItems, () => load(showArchived || Boolean(searchQuery), 0, pageSize, false));
  const includeArchivedInFetch = showArchived || Boolean(searchQuery);
  useEffect(() => { load(includeArchivedInFetch, 0, pageSize, false); }, [includeArchivedInFetch, pageSize, load]);
  const onLoadMore = React.useCallback(() => {
    load(includeArchivedInFetch, items.length, pageSize, true);
  }, [load, includeArchivedInFetch, items.length, pageSize]);

  const evict = (id) => setItems((prev) => prev.filter((x) => x.id !== id));

  const preFiltered = useMemo(
    () => items.filter((i) =>
      (!filter.status || i.follow_up_status === filter.status) &&
      (!filter.category || i.category === filter.category) &&
      // v58.13.132ia — Type chip filter (client-side).
      (typeChip === 'all' || (TYPE_CHIPS.find((c) => c.key === typeChip)?.match?.(i.category) ?? true))),
    [items, filter.status, filter.category, typeChip]
  );

  return (
    <div className="max-w-6xl mx-auto" data-testid="incidents-list">
      <PageHeader crumb="Capture / Incident Reports" title="Incident Reports"
        subtitle="Structured incident capture — including hazards, near misses, injuries and property/environmental events."
        action={
          <div className="flex items-center gap-2">
            {isAdmin && (
              <button
                type="button"
                onClick={() => setArchiveDialogOpen(true)}
                data-testid="incidents-archive-header-btn"
                className="text-sm px-3 py-1.5 rounded border border-slate-300 text-slate-700 hover:bg-slate-50"
              >
                Archive…
              </button>
            )}
            {/* v58.13.132ia — "New incident" record button retired from
                the header per Stephen's redesign brief. Field records
                land here via the mobile capture flow + the new
                Upload PDF affordance below. */}
            {isAdmin && (
              <button
                type="button"
                onClick={() => setImportOpen(true)}
                data-testid="incidents-upload-pdf-btn"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1e4a8c] text-white text-sm font-semibold hover:bg-[#143263]"
              >
                <Upload size={14} /> Upload PDF
              </button>
            )}
          </div>
        } />

      {/* v58.13.132ed — Bulk archive dialog (Admin-only). */}
      {isAdmin && (
        <ArchiveDialog
          open={archiveDialogOpen}
          onClose={() => setArchiveDialogOpen(false)}
          apiPath="/incidents"
          moduleLabel="incidents"
          knownStatuses={['open', 'in_progress', 'closed']}
          knownCategories={['near_miss', 'first_aid', 'medical', 'ltc', 'env', 'property']}
          sites={[]}
          onArchived={() => load(includeArchivedInFetch)}
        />
      )}

      {/* v58.13.132eb — surfaces the true DB total so that migrated
          CS-Incident docs aren't invisible when a client-side filter
          narrows the view. Reads the `X-Total-Count` header emitted
          by crud.py since .132ea. */}
      <div className="mt-2 mb-1 flex items-center gap-2">
        <TotalCountChip
          showing={preFiltered.length}
          total={totalCount}
          testid="incidents-total-count-chip"
        />
        {/* v58.13.132ec — Admin-only archive visibility toggle. */}
        {isAdmin && (
          <ShowArchivedToggle
            value={showArchived}
            onChange={setShowArchived}
            count={archivedCount}
            testid="incidents-show-archived-toggle"
          />
        )}
      </div>

      <Tabs defaultValue="list" className="mt-2" data-testid="incidents-tabs">
        <TabsList variant="pill-pair">
          <TabsTrigger variant="pill-pair" emphasis="secondary" value="dashboard" data-testid="incidents-tab-dashboard">Dashboard</TabsTrigger>
          <TabsTrigger variant="pill-pair" emphasis="primary" value="list" data-testid="incidents-tab-list">
            List <span className="ml-1.5 text-[10px] text-slate-500 tabular-nums">{items.length}</span>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="dashboard" className="mt-4">
          <ModuleDashboard
            module="incidents" title="Incidents"
            tagline="Every incident captured with follow-up ownership — from near miss through LTI."
            moduleColour="violet"
            quickActions={[{ label: 'Log incident', route: '/app/incidents/new' }]}
          />
        </TabsContent>
        <TabsContent value="list" className="mt-4">
      {/* v58.13.132ia — Type filter chip row. Client-side filter on
          `category` (see TYPE_CHIPS + preFiltered above). URL-persisted
          via `?type=<chip>`. Admins hidden from the 3 bucketed chips
          are N/A here — the chips group by incident category, not
          role. */}
      <div className="inline-flex items-center rounded-full bg-slate-100 border border-slate-200 p-0.5 mb-3"
        data-testid="incidents-type-filter" role="tablist" aria-label="Filter by incident type">
        {TYPE_CHIPS.map((c) => (
          <button key={c.key} type="button"
            onClick={() => setTypeChip(c.key)}
            data-testid={`incidents-type-filter-${c.key}`}
            role="tab"
            aria-selected={typeChip === c.key}
            className={[
              'px-3 py-1.5 rounded-full text-[11px] font-semibold uppercase tracking-wider transition-colors',
              typeChip === c.key
                ? 'bg-[#1e4a8c] text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900 hover:bg-white/60',
            ].join(' ')}>
            {c.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 mb-4">
        <select className={inputClass + ' w-auto'} value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })} data-testid="incident-filter-status">
          <option value="">All statuses</option><option value="open">open</option><option value="in_progress">in progress</option><option value="closed">closed</option>
        </select>
        <select className={inputClass + ' w-auto'} value={filter.category} onChange={(e) => setFilter({ ...filter, category: e.target.value })} data-testid="incident-filter-category">
          <option value="">All categories</option>{CATS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>

      {loading && items.length === 0 ? <div className="text-sm text-slate-500">Loading…</div>
       : items.length === 0 ? <EmptyState title="No incidents" body="Log your first incident — even a near miss." action={<NewButton to="/app/incidents/new" label="New incident" testid="incident-empty-create" />} />
       : (<>
        {/* v58.13.132hw — Never unmount the toolbar on a subsequent
            search-triggered load. Prior gate was `loading ?
            <Loading /> : preFiltered.length === 0 ? …` which
            unmounted CaptureListToolbar every time `searchQuery`
            flipped `includeArchivedInFetch`, wiping the toolbar's
            local `q` state on the first keystroke. Keeping the
            toolbar mounted preserves the input cursor. */}
        <CaptureListToolbar
          items={preFiltered}
          onFiltered={setSearchFiltered}
          onQueryChange={setSearchQuery}
          testidPrefix="incidents"
          densityMode={incidentsDensity.mode}
          onDensityChange={incidentsDensity.setMode}
        />
        {/* v58.13.132en — [Cards | Table] segmented toggle. Sits between the
            toolbar and the list surface. Persists to `incidents.viewMode`
            via `usePersistedViewMode`. Table view supplied by
            `IncidentsTable.jsx`; Cards branch preserves the existing
            GroupedTilesView chrome untouched. */}
        <div className="mb-3 inline-flex rounded-lg border border-slate-200 overflow-hidden text-xs"
             role="tablist" aria-label="Incident list view mode"
             data-testid="incidents-view-mode-toggle">
          <button type="button"
            role="tab" aria-selected={viewMode === 'cards'}
            onClick={() => setViewMode('cards')}
            data-testid="incidents-view-mode-cards"
            className={
              'px-3 py-1.5 font-semibold ' +
              (viewMode === 'cards' ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50')
            }>Cards</button>
          <button type="button"
            role="tab" aria-selected={viewMode === 'table'}
            onClick={() => setViewMode('table')}
            data-testid="incidents-view-mode-table"
            className={
              'px-3 py-1.5 font-semibold border-l border-slate-200 ' +
              (viewMode === 'table' ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50')
            }>Table</button>
        </div>
        {viewMode === 'table' ? (
          <IncidentsTable
            items={searchFiltered}
            isAdmin={isAdmin}
            onArchive={isAdmin ? onArchive : undefined}
            onUnarchive={isAdmin ? onUnarchive : undefined}
          />
        ) : (
        <GroupedTilesView
          items={searchFiltered}
          density={incidentsDensity}
          groupBy={(i) => i.category || 'other'}
          groupLabels={Object.fromEntries(CATS)}
          groupOrder={CATS.map(([k]) => k)}
          groupPaletteOverrides={INCIDENT_CATEGORY_PALETTE}
          testidPrefix="incident"
          page="incidents"
          pageKey="incidents"
          dateFn={(i) => i.occurred_at || i.created_at || ''}
          emptyMessage="No matching incidents."
          renderTile={(i, ctx = {}) => (
            <div data-testid={`incidents-card-wrap-${i.id}`}>
            <CaptureCard
              record={{
                ...i,
                template_name_snapshot: i.title,
                date: (i.occurred_at || '').slice(0, 10),
              }}
              resourceKind="incidents"
              apiPath="incidents"
              subtitle={i.description || null}
              subtitleLines={ctx.subtitleLines}
              minH={ctx.minH}
              stripeStyle={ctx.stripeHex ? { background: ctx.stripeHex } : undefined}
              zebraTint={ctx.zebraTint}
              badges={i.follow_up_status
                ? [<StatusBadge key="fus" value={i.follow_up_status} />]
                : []}
              onDeleted={evict}
              onArchive={isAdmin ? onArchive : undefined}
              onUnarchive={isAdmin ? onUnarchive : undefined}
              openInitially={deepLinkId === i.id}
            />
            {/* v58.13.132ia — "View original document" affordance.
                Mirrors the .132hz SSRA pattern: show source filename
                inline when the record was ingested via /api/imports/pdf.
                Missing → line hidden. */}
            {i.imported_from_pdf && (
              <div className="mt-1 text-[10px] text-slate-500 truncate flex items-center gap-1"
                data-testid={`incidents-original-doc-${i.id}`}
                title={i.imported_from_pdf}>
                <FileText size={10} className="shrink-0 text-slate-400" />
                <span className="truncate">Source: {i.imported_from_pdf}</span>
              </div>
            )}
            </div>
          )}
        />
        )}
       {/* v58.13.132eh — Load-more pager. */}
       {!loading && items.length > 0 && (
         <PaginationBar
           showing={items.length}
           total={totalCount ?? items.length}
           pageSize={pageSize}
           onPageSize={setPageSize}
           onLoadMore={onLoadMore}
           loading={loading}
           testidPrefix="incidents"
           storageKey="incidents:pageSize"
         />
       )}
       </>)
      }
        </TabsContent>
      </Tabs>

      {/* v58.13.132ia — Upload PDF modal. Reuses shared /api/imports/pdf. */}
      <PdfImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={() => load(includeArchivedInFetch, 0, pageSize, false)}
      />
    </div>
  );
}

export function IncidentNew() {
  const navigate = useNavigate();
  const user = getUser();
  const wsId = user?.workspace_ids?.[0];
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    title: '', occurred_at: new Date().toISOString().slice(0, 16),
    location: '', category: 'near_miss', description: '', immediate_actions: '',
    follow_up_actions: [], follow_up_status: 'open',
  });

  const addAction = () => setForm((f) => ({ ...f, follow_up_actions: [...f.follow_up_actions, { action: '', owner: '', due: '' }] }));
  const updAction = (i, p) => setForm((f) => ({ ...f, follow_up_actions: f.follow_up_actions.map((a, j) => j === i ? { ...a, ...p } : a) }));
  const delAction = (i) => setForm((f) => ({ ...f, follow_up_actions: f.follow_up_actions.filter((_, j) => j !== i) }));

  const save = async () => {
    if (!form.title || !form.description) { toast.error('Title and description required'); return; }
    setBusy(true);
    try {
      await api.post('/incidents', { ...form, workspace_id: wsId, occurred_at: new Date(form.occurred_at).toISOString() });
      toast.success('Incident logged');
      navigate('/app/incidents');
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="max-w-3xl mx-auto" data-testid="incident-new">
      <BackButton to="/app/incidents" />
      <PageHeader crumb="Capture / Incident Reports / New" title="Log incident" />
      <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
        <Field label="Title" required><input data-testid="inc-title" className={inputClass} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="What happened in one line?" /></Field>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Occurred at" required><input data-testid="inc-occurred" type="datetime-local" className={inputClass} value={form.occurred_at} onChange={(e) => setForm({ ...form, occurred_at: e.target.value })} /></Field>
          <Field label="Category">
            <select data-testid="inc-category" className={inputClass} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {CATS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
          <Field label="Location"><input data-testid="inc-location" className={inputClass} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></Field>
          <Field label="Follow-up status">
            <select data-testid="inc-status" className={inputClass} value={form.follow_up_status} onChange={(e) => setForm({ ...form, follow_up_status: e.target.value })}>
              <option value="open">open</option><option value="in_progress">in progress</option><option value="closed">closed</option>
            </select>
          </Field>
        </div>
        <Field label="Description" required><textarea data-testid="inc-description" rows={4} className={inputClass} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        <Field label="Immediate actions taken"><textarea data-testid="inc-immediate" rows={2} className={inputClass} value={form.immediate_actions} onChange={(e) => setForm({ ...form, immediate_actions: e.target.value })} /></Field>

        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-medium text-slate-700">Follow-up actions</div>
            <button type="button" onClick={addAction} className="inline-flex items-center gap-1 text-sm text-brand-blue hover:underline"><Plus size={14} /> Add</button>
          </div>
          <div className="space-y-2">
            {form.follow_up_actions.map((a, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-center" data-testid={`inc-action-${i}`}>
                <input className={`${inputClass} col-span-6`} placeholder="Action" value={a.action} onChange={(e) => updAction(i, { action: e.target.value })} />
                <input className={`${inputClass} col-span-3`} placeholder="Owner" value={a.owner} onChange={(e) => updAction(i, { owner: e.target.value })} />
                <input className={`${inputClass} col-span-2`} type="date" value={a.due} onChange={(e) => updAction(i, { due: e.target.value })} />
                <button type="button" onClick={() => delAction(i)} className="p-2 text-slate-400 hover:text-brand-red col-span-1"><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2 mt-5">
        <GhostButton onClick={() => navigate('/app/incidents')} testid="inc-cancel">Cancel</GhostButton>
        <PrimaryButton onClick={save} busy={busy} testid="inc-submit">Save incident</PrimaryButton>
      </div>
    </div>
  );
}
