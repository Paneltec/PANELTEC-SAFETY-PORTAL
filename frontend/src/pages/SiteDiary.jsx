// Site Diary — Capture sub-tab. v160.3.0-adjust-17b.
// Compact colour-coded CaptureCards for form-submission entries;
// legacy AI-structured notes render inline with a raw-notes preview.
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import api, { apiError } from '../lib/api';
import EmailButton from '../components/EmailButton';
import PdfActions from '../components/PdfActions';
import DeleteRecordButton from '../components/DeleteRecordButton';
import CaptureListToolbar from '../components/CaptureListToolbar';
import CaptureCard, { CaptureCardGrid, CaptureSticky } from '../components/CaptureCard';
import TotalCountChip from '../components/TotalCountChip';  // v58.13.132eb
import ShowArchivedToggle from '../components/ShowArchivedToggle';  // v58.13.132ec
import ArchiveDialog from '../components/ArchiveDialog';  // v58.13.132ee
import PaginationBar, { usePersistedPageSize } from '../components/PaginationBar';  // v58.13.132eh
import useArchiveActions from '../lib/useArchiveActions';  // v58.13.132ec
import useCaptureDensity from '../lib/useCaptureDensity';
import useDeepLinkOpen from '../lib/useDeepLinkOpen';
import { getUser } from '../lib/auth';
import { PageHeader, NewButton, BackButton, PrimaryButton, AiButton, Field, inputClass, EmptyState, GhostButton } from '../components/capture/Ui';

function siteAddress(d) {
  if (d.source !== 'form_submission' || !Array.isArray(d.fields)) return null;
  const f = d.fields.find(
    (x) => x && x.value && typeof x.label === 'string' && /site\s*address/i.test(x.label)
  );
  return f && typeof f.value === 'string' ? f.value : null;
}

export default function SiteDiaryList() {
  const [items, setItems] = useState([]);
  const [filtered, setFiltered] = useState([]);
  const [loading, setLoading] = useState(true);
  // v58.13.132eb — total server count from X-Total-Count header.
  const [totalCount, setTotalCount] = useState(null);
  // v58.13.132ee — archived count from X-Archived-Count header.
  const [archivedCount, setArchivedCount] = useState(null);
  // v58.13.132ee — Archive lifecycle. Admin-only.
  const isAdmin = (getUser()?.role || '').toLowerCase() === 'admin';
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const density = useCaptureDensity('site-diary', filtered.length);
  // v58.13.119 — Ask Intelligence deep-link (`?open=<id>`).
  const { deepLinkId } = useDeepLinkOpen({
    items, loading, notFoundMessage: 'Linked diary entry not found',
  });

  // v58.13.132eh — Load-more pagination.
  const [pageSize, setPageSize] = usePersistedPageSize('site-diary:pageSize', 5000);
  // v58.13.132ee — Shared loader.
  const load = React.useCallback(async (includeArchived, offset = 0, size = 5000, append = false) => {
    setLoading(true);
    try {
      const r = await api.get('/site-diary', {
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
    useArchiveActions('/site-diary', setItems, () => load(showArchived, 0, pageSize, false));
  useEffect(() => { load(showArchived, 0, pageSize, false); }, [showArchived, pageSize, load]);
  const onLoadMore = React.useCallback(() => {
    load(showArchived, items.length, pageSize, true);
  }, [load, showArchived, items.length, pageSize]);

  const evict = (id) => {
    setItems((prev) => prev.filter((x) => x.id !== id));
    setFiltered((prev) => prev.filter((x) => x.id !== id));
  };

  return (
    <div className="max-w-7xl mx-auto" data-testid="sitediary-list">
      <CaptureSticky testid="site-diary-sticky">
        <PageHeader crumb="Capture / Site Diary" title="Site Diary"
          subtitle="Daily site diaries — imported audits from mobile Forms and free-form notes structured by AI."
          action={
            <div className="flex items-center gap-2">
              {isAdmin && (
                <button type="button" onClick={() => setArchiveDialogOpen(true)}
                        data-testid="site-diary-archive-header-btn"
                        className="text-sm px-3 py-1.5 rounded border border-slate-300 text-slate-700 hover:bg-slate-50">
                  Archive…
                </button>
              )}
              <NewButton to="/app/site-diary/new" label="New diary entry" testid="diary-create-btn" />
            </div>
          } />
        {/* v58.13.132ee — Bulk archive dialog. */}
        {isAdmin && (
          <ArchiveDialog open={archiveDialogOpen} onClose={() => setArchiveDialogOpen(false)}
            apiPath="/site-diary" moduleLabel="site diary entries"
            knownStatuses={[]}
            knownCategories={[]}
            onArchived={() => load(showArchived)} />
        )}
        {/* v58.13.132eb — total-count chip + Admin-only show-archived toggle. */}
        <div className="mt-1 flex items-center gap-2">
          <TotalCountChip
            showing={filtered.length}
            total={totalCount}
            testid="site-diary-total-count-chip"
          />
          {isAdmin && (
            <ShowArchivedToggle
              value={showArchived}
              onChange={setShowArchived}
              count={archivedCount}
              testid="site-diary-show-archived-toggle"
            />
          )}
        </div>
        {items.length > 0 && (
          <CaptureListToolbar
            items={items} onFiltered={setFiltered} testidPrefix="site-diary"
            densityMode={density.mode} onDensityChange={density.setMode}
          />
        )}
      </CaptureSticky>
      <div className="mt-3">
      {loading ? <div className="text-sm text-slate-500">Loading…</div>
       : items.length === 0 ? <EmptyState title="No diary entries yet" body="Capture your first daily diary entry." action={<NewButton to="/app/site-diary/new" label="New entry" testid="diary-empty-create" />} />
       : (
        <CaptureCardGrid testid="site-diary-grid" gridClass={density.gridClass}>
          {filtered.map((d) => {
            const isSub = d.source === 'form_submission';
            if (isSub) {
              return (
                <CaptureCard
                  key={d.id}
                  record={d}
                  resourceKind="site_diary"
                  apiPath="site-diary"
                  subject={`Site Diary — ${d.template_name_snapshot || 'entry'} — ${d.date || ''}`}
                  body={`Site diary from ${d.submitted_by_name || 'the field'} on ${d.date || ''}.`}
                  subtitle={siteAddress(d)}
                  subtitleLines={density.subtitleLines}
                  minH={density.cardMinH}
                  onDeleted={evict}
                  onArchive={isAdmin ? onArchive : undefined}
                  onUnarchive={isAdmin ? onUnarchive : undefined}
                  openInitially={deepLinkId === d.id}
                />
              );
            }
            // Legacy AI-structured diary note — dedicated compact tile.
            const dateStr = d.date || '';
            const preview = (d.raw_notes || '').split('\n')[0].slice(0, 80);
            return (
              <div key={d.id} className="group relative rounded-xl bg-white border border-slate-200 overflow-hidden hover:shadow-md hover:border-slate-300 transition-shadow" data-testid={`diary-card-legacy-${d.id}`}>
                <div className="absolute left-0 top-0 bottom-0 w-1 bg-violet-500" aria-hidden />
                <div className="pl-3 pr-2.5 py-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0 flex items-center gap-1.5 flex-wrap">
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-violet-50 text-violet-700">
                        Diary
                      </span>
                      {d.structured_log && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-violet-50 text-violet-700 ring-1 ring-violet-200">
                          AI
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-0.5 opacity-70 group-hover:opacity-100">
                      <PdfActions resourceKind="site_diary" recordId={d.id} source={d.source} title={`Site Diary ${dateStr}`} size="sm" iconOnly />
                      <DeleteRecordButton resourceKind="site_diary" apiPath="site-diary" recordId={d.id} source={d.source} label="Site Diary entry" recordTitle={dateStr} onDeleted={evict} iconOnly />
                    </div>
                  </div>
                  <div className="mt-1.5 font-semibold text-[13px] text-slate-900 leading-tight truncate">
                    {preview || 'Site diary note'}
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-500 truncate">
                    {d.submitted_by_name || d.created_by_name || '—'} <span className="text-slate-300">·</span> {dateStr || '—'}
                  </div>
                </div>
              </div>
            );
          })}
        </CaptureCardGrid>
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
          testidPrefix="site-diary"
          storageKey="site-diary:pageSize"
        />
      )}
      </div>
    </div>
  );
}

export function SiteDiaryNew() {
  const navigate = useNavigate();
  const user = getUser();
  const wsId = user?.workspace_ids?.[0];
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [form, setForm] = useState({ date: new Date().toISOString().slice(0, 10), raw_notes: '' });
  const [structured, setStructured] = useState(null);

  const structure = async () => {
    if (!form.raw_notes.trim()) { toast.error('Add some notes first'); return; }
    setAiBusy(true);
    try {
      const { data } = await api.post('/ai/diary-structure', { raw_notes: form.raw_notes });
      setStructured(data);
      toast.success('Diary structured');
    } catch (e) {
      toast.error('AI could not structure — you can still save raw notes', { description: apiError(e) });
    } finally { setAiBusy(false); }
  };

  const save = async () => {
    if (!form.raw_notes) { toast.error('Notes required'); return; }
    setBusy(true);
    try {
      await api.post('/site-diary', { workspace_id: wsId, date: form.date, raw_notes: form.raw_notes, structured_log: structured });
      toast.success('Diary entry saved');
      navigate('/app/site-diary');
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="max-w-5xl mx-auto" data-testid="diary-new">
      <BackButton to="/app/site-diary" />
      <PageHeader crumb="Capture / Site Diary / New" title="New diary entry" />
      <div className="grid lg:grid-cols-2 gap-5">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
          <Field label="Date" required><input data-testid="diary-date" type="date" className={inputClass} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
          <Field label="Raw notes" required hint="Free-form — the AI will pick out activities, delays, deliveries and weather.">
            <textarea data-testid="diary-raw" rows={12} className={inputClass} value={form.raw_notes} onChange={(e) => setForm({ ...form, raw_notes: e.target.value })}
              placeholder="Started concrete pour 0600 finished 1115 25 cubic metres delivered two delays pump primer 15 min inspector arrived late visitors SafeWork inspector at 1330 light rain after lunch" />
          </Field>
          <div className="flex gap-2"><AiButton onClick={structure} busy={aiBusy} label="Structure with AI" testid="diary-structure-ai" /></div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="text-[10px] uppercase tracking-wider text-brand-violet font-semibold mb-3 flex items-center gap-1">AI structured log</div>
          {!structured ? <div className="text-sm text-slate-400 italic">Click <span className="font-medium">Structure with AI</span> to populate.</div>
           : (
            <div className="space-y-3 text-sm" data-testid="diary-structured">
              {[
                ['Activities', structured.activities], ['Delays', structured.delays],
                ['Deliveries', structured.deliveries], ['Visitors', structured.visitors],
                ['Safety observations', structured.safety_observations],
              ].map(([k, v]) => (
                <div key={k}>
                  <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">{k}</div>
                  {Array.isArray(v) && v.length > 0
                    ? <ul className="mt-1 space-y-0.5">{v.map((x, i) => <li key={i} className="text-slate-700">· {x}</li>)}</ul>
                    : <div className="text-slate-400 italic text-xs">none</div>}
                </div>
              ))}
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Weather</div>
                <div className="text-slate-700 mt-1">{structured.weather || <span className="text-slate-400 italic">—</span>}</div>
              </div>
            </div>
           )}
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <GhostButton onClick={() => navigate('/app/site-diary')} testid="diary-cancel">Cancel</GhostButton>
        <PrimaryButton onClick={save} busy={busy} testid="diary-submit">Save diary entry</PrimaryButton>
      </div>
    </div>
  );
}
