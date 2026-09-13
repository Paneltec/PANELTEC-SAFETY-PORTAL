import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../lib/api';
import CaptureListToolbar from '../components/CaptureListToolbar';
import GroupedTilesView from '../components/capture/GroupedTilesView';
import CaptureCard, { CaptureSticky } from '../components/CaptureCard';
import TotalCountChip from '../components/TotalCountChip';  // v58.13.132eb
import ShowArchivedToggle from '../components/ShowArchivedToggle';  // v58.13.132ec
import ArchiveDialog from '../components/ArchiveDialog';  // v58.13.132ee
import PaginationBar, { usePersistedPageSize } from '../components/PaginationBar';  // v58.13.132eh
import useArchiveActions from '../lib/useArchiveActions';  // v58.13.132ec
// v58.13.45 — `paletteForType` no longer imported here. Group palette
// (via ctx.stripeHex from GroupedTilesView) is the single stripe
// source; the legacy per-template fallback was removed together with
// GroupedTilesView's outer stripe to fix the double-stripe bug.
import useCaptureDensity from '../lib/useCaptureDensity';
import useDeepLinkOpen from '../lib/useDeepLinkOpen';
import { getUser } from '../lib/auth';
import { PageHeader, NewButton, BackButton, PrimaryButton, GhostButton, Field, inputClass, EmptyState } from '../components/capture/Ui';
// Phase 4.17 v134.1 — Dashboard tab.
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import ModuleDashboard from '../components/dashboards/ModuleDashboard';

const TEMPLATES = {
  'Site walk': [
    'Emergency egress routes clear', 'First aid kit stocked and accessible',
    'Fire extinguishers in date', 'Edge protection in place',
    'Housekeeping in laydown areas', 'Hi-vis worn by all on site',
    'SWMS available at work face', 'Toolbox talk record complete',
  ],
  'Plant inspection': [
    'Operator licence sighted', 'Pre-start log completed', 'Hydraulic leaks — none',
    'Mirrors and cameras clean', 'Reversing alarm operational',
    'Fire extinguisher on board', 'Tyres / tracks in good condition', 'Service log up to date',
  ],
  'Working at height': [
    'EWP pre-start completed', 'Anchor points certified', 'Harnesses inspected and in date',
    'Rescue plan documented', 'Exclusion zone established', 'Tools tethered',
    'Weather conditions acceptable', 'Permit issued',
  ],
};

export default function InspectionsList() {
  const [items, setItems] = useState([]);
  const [filtered, setFiltered] = useState([]);
  // v58.13.132eb — total server count from X-Total-Count header
  const [totalCount, setTotalCount] = useState(null);
  // v58.13.132ee — archived count from X-Archived-Count header.
  const [archivedCount, setArchivedCount] = useState(null);
  const [loading, setLoading] = useState(true);
  const inspectionsDensity = useCaptureDensity('inspections', filtered.length);
  // v58.13.132ec — Archive lifecycle. Admin-only.
  const isAdmin = (getUser()?.role || '').toLowerCase() === 'admin';
  // v58.13.132ee — Bulk archive dialog state (Admin only).
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  // v58.13.119 — Ask Intelligence deep-link (`?open=<id>`).
  const { deepLinkId } = useDeepLinkOpen({
    items, loading, notFoundMessage: 'Linked inspection not found',
  });
  // v58.13.132eh — Load-more pagination.
  const [pageSize, setPageSize] = usePersistedPageSize('inspections:pageSize', 5000);
  // v58.13.132ee — Shared loader.
  const load = React.useCallback(async (includeArchived, offset = 0, size = 5000, append = false) => {
    setLoading(true);
    try {
      const r = await api.get('/inspections', {
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
    useArchiveActions('/inspections', setItems, () => load(showArchived, 0, pageSize, false));
  useEffect(() => { load(showArchived, 0, pageSize, false); }, [showArchived, pageSize, load]);
  const onLoadMore = React.useCallback(() => {
    load(showArchived, items.length, pageSize, true);
  }, [load, showArchived, items.length, pageSize]);

  return (
    <div className="max-w-6xl mx-auto" data-testid="inspections-list">
      <PageHeader crumb="Capture / Inspection Reports" title="Inspection Reports"
        subtitle="Scheduled inspections — site walk, plant, working at height."
        action={
          <div className="flex items-center gap-2">
            {isAdmin && (
              <button type="button" onClick={() => setArchiveDialogOpen(true)}
                      data-testid="inspections-archive-header-btn"
                      className="text-sm px-3 py-1.5 rounded border border-slate-300 text-slate-700 hover:bg-slate-50">
                Archive…
              </button>
            )}
            <NewButton to="/app/inspections/new" label="New inspection" testid="inspection-create-btn" />
          </div>
        } />
      {/* v58.13.132ee — Bulk archive dialog. */}
      {isAdmin && (
        <ArchiveDialog open={archiveDialogOpen} onClose={() => setArchiveDialogOpen(false)}
          apiPath="/inspections" moduleLabel="inspections"
          knownStatuses={[]}
          knownCategories={['Site walk', 'Plant inspection', 'Working at height']}
          onArchived={() => load(showArchived)} />
      )}
      {/* v58.13.132eb — total-count chip. */}
      {/* v58.13.132ec — Admin-only Show-archived toggle. */}
      <div className="mt-2 mb-1 flex items-center gap-2">
        <TotalCountChip
          showing={filtered.length}
          total={totalCount}
          testid="inspections-total-count-chip"
        />
        {isAdmin && (
          <ShowArchivedToggle
            value={showArchived}
            onChange={setShowArchived}
            count={archivedCount}
            testid="inspections-show-archived-toggle"
          />
        )}
      </div>
      <Tabs defaultValue="list" className="mt-2" data-testid="inspections-tabs">
        <TabsList variant="pill-pair">
          <TabsTrigger variant="pill-pair" emphasis="secondary" value="dashboard" data-testid="inspections-tab-dashboard">Dashboard</TabsTrigger>
          <TabsTrigger variant="pill-pair" emphasis="primary" value="list" data-testid="inspections-tab-list">
            List <span className="ml-1.5 text-[10px] text-slate-500 tabular-nums">{items.length}</span>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="dashboard" className="mt-4">
          <ModuleDashboard
            module="inspections" title="Inspections"
            tagline="Site walk, plant, working at height — pass rate trended and every fail surfaced."
            moduleColour="emerald"
            quickActions={[{ label: 'New inspection', route: '/app/inspections/new' }]}
          />
        </TabsContent>
        <TabsContent value="list" className="mt-4">
      {loading ? <div className="text-sm text-slate-500">Loading…</div>
       : items.length === 0 ? <EmptyState title="No inspections yet" body="Run your first inspection." action={<NewButton to="/app/inspections/new" label="New inspection" testid="inspection-empty-create" />} />
       : (<>
        <CaptureListToolbar
          items={items}
          onFiltered={setFiltered}
          testidPrefix="inspections"
          densityMode={inspectionsDensity.mode}
          onDensityChange={inspectionsDensity.setMode}
        />
        {/* v58.12.7 — Tile format via shared GroupedTilesView. Groups by
            `template_name`; sorts groups alphabetically; sorts rows
            within each group by `date` DESC. Toolbar filter above still
            layers its result into `filtered` — the tile view reads that.
            v58.12.9 — `getStripeType` drives Hazards-parity tile stripes
            + first-card-tint group banners via `preStartsPalette`. */}
        <GroupedTilesView
          items={filtered}
          density={inspectionsDensity}
          groupBy={(it) => it.template_name || 'Deleted template'}
          getStripeType={(it) => it.template_name || ''}
          testidPrefix="inspection"
          page="inspections"
          pageKey="inspections"
          dateFn={(it) => it.date || it.created_at || ''}
          emptyMessage="No matching inspections."
          renderTile={(it, ctx = {}) => {
            const total = it.checklist_items?.length || 0;
            const passed = it.checklist_items?.filter((c) => c.response === 'pass').length || 0;
            const failed = it.checklist_items?.filter((c) => c.response === 'fail').length || 0;
            const evict = (id) => {
              setItems((prev) => prev.filter((x) => x.id !== id));
              setFiltered((prev) => prev.filter((x) => x.id !== id));
            };
            // v58.13.45 — group palette (ctx.stripeHex) is the sole
            // stripe source. Legacy `paletteForType(template_name)`
            // fallback removed to match the other 3 grouped pages
            // and prevent any future colour-drift between banner
            // and tile stripe.
            return (
              <CaptureCard
                record={{
                  ...it,
                  template_name_snapshot: it.template_name || 'Deleted template',
                  date: it.date,
                }}
                resourceKind="inspections"
                apiPath="inspections"
                subtitle={`${passed} pass · ${failed} fail · ${total - passed - failed} N/A`}
                subtitleLines={ctx.subtitleLines}
                minH={ctx.minH}
                stripeStyle={ctx.stripeHex ? { background: ctx.stripeHex } : undefined}
                onDeleted={evict}
                onArchive={isAdmin ? onArchive : undefined}
                onUnarchive={isAdmin ? onUnarchive : undefined}
                openInitially={deepLinkId === it.id}
              />
            );
          }}
        />
       {/* v58.13.132eh — Load-more pager. */}
       {!loading && items.length > 0 && (
         <PaginationBar
           showing={items.length}
           total={totalCount ?? items.length}
           pageSize={pageSize}
           onPageSize={setPageSize}
           onLoadMore={onLoadMore}
           loading={loading}
           testidPrefix="inspections"
           storageKey="inspections:pageSize"
         />
       )}
       </>)
      }
        </TabsContent>
      </Tabs>
    </div>
  );
}

export function InspectionNew() {
  const navigate = useNavigate();
  const user = getUser();
  const wsId = user?.workspace_ids?.[0];
  const [busy, setBusy] = useState(false);
  const [tpl, setTpl] = useState('');
  const [form, setForm] = useState({ date: new Date().toISOString().slice(0, 10), checklist_items: [], notes: '' });

  const pickTpl = (name) => {
    setTpl(name);
    setForm((f) => ({ ...f, checklist_items: TEMPLATES[name].map((label) => ({ label, response: 'pass', notes: '' })) }));
  };

  const updItem = (i, patch) => setForm((f) => ({ ...f, checklist_items: f.checklist_items.map((c, j) => j === i ? { ...c, ...patch } : c) }));

  const save = async () => {
    if (!tpl) { toast.error('Pick a template first'); return; }
    setBusy(true);
    try {
      await api.post('/inspections', { ...form, workspace_id: wsId, template_name: tpl });
      toast.success('Inspection saved');
      navigate('/app/inspections');
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };

  const summary = useMemo(() => {
    const c = form.checklist_items;
    return { pass: c.filter((x) => x.response === 'pass').length, fail: c.filter((x) => x.response === 'fail').length, na: c.filter((x) => x.response === 'na').length };
  }, [form.checklist_items]);

  return (
    <div className="max-w-3xl mx-auto" data-testid="inspection-new">
      <BackButton to="/app/inspections" />
      <PageHeader crumb="Capture / Inspection Reports / New" title="New inspection" />
      {!tpl ? (
        <div className="grid sm:grid-cols-3 gap-3" data-testid="template-picker">
          {Object.keys(TEMPLATES).map((name) => (
            <button key={name} onClick={() => pickTpl(name)} data-testid={`tpl-${name.replace(/\s/g, '-').toLowerCase()}`}
              className="rounded-2xl border border-slate-200 bg-white p-5 text-left hover:border-brand-blue hover:shadow-card transition-all">
              <h3 className="font-display text-lg font-semibold">{name}</h3>
              <p className="text-xs text-slate-500 mt-1">{TEMPLATES[name].length} checklist items</p>
            </button>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 flex items-center justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Template</div>
              <div className="font-display font-semibold">{tpl}</div>
            </div>
            <button onClick={() => { setTpl(''); setForm((f) => ({ ...f, checklist_items: [] })); }} className="text-sm text-slate-500 hover:underline">Change</button>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <Field label="Date" required><input data-testid="insp-date" type="date" className={inputClass} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white divide-y divide-slate-100">
            {form.checklist_items.map((item, i) => (
              <div key={i} className="p-4" data-testid={`insp-item-${i}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="font-medium text-sm flex-1">{item.label}</div>
                  <div className="flex gap-1 shrink-0">
                    {['pass', 'fail', 'na'].map((r) => (
                      <button key={r} type="button" onClick={() => updItem(i, { response: r })}
                        data-testid={`insp-${i}-${r}`}
                        className={`px-2.5 py-1 rounded-md text-xs font-semibold uppercase tracking-wider transition-colors ${
                          item.response === r
                            ? r === 'pass' ? 'bg-brand-green-mint text-emerald-700 border border-emerald-300'
                              : r === 'fail' ? 'bg-red-50 text-red-700 border border-red-300'
                              : 'bg-slate-100 text-slate-700 border border-slate-300'
                            : 'bg-white text-slate-400 border border-slate-200 hover:text-slate-700'}`}>
                        {r === 'na' ? 'N/A' : r}
                      </button>
                    ))}
                  </div>
                </div>
                {item.response !== 'pass' && (
                  <input className={`${inputClass} mt-2 text-sm`} placeholder="Notes (required for fail)" value={item.notes || ''} onChange={(e) => updItem(i, { notes: e.target.value })} data-testid={`insp-${i}-notes`} />
                )}
              </div>
            ))}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <Field label="Inspector notes"><textarea className={inputClass} rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          </div>

          <div className="flex items-center justify-between bg-white border border-slate-200 rounded-2xl p-4">
            <div className="text-sm text-slate-600"><span className="text-emerald-700 font-medium">{summary.pass}</span> pass · <span className={summary.fail > 0 ? 'text-red-700 font-medium' : ''}>{summary.fail}</span> fail · {summary.na} N/A</div>
            <div className="flex gap-2">
              <GhostButton onClick={() => navigate('/app/inspections')} testid="insp-cancel">Cancel</GhostButton>
              <PrimaryButton onClick={save} busy={busy} testid="insp-submit">Save inspection</PrimaryButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
