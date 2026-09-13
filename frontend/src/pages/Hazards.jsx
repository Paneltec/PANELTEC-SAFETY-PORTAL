import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, Loader2, Plus, Trash2, UploadCloud } from 'lucide-react';
import { toast } from 'sonner';
import api, { API_BASE, apiError } from '../lib/api';
import AuthedImage from '../components/AuthedImage'; // v42 · SEC-004 image wrapper
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
import { PageHeader, NewButton, BackButton, PrimaryButton, GhostButton, Field, inputClass, EmptyState, StatusBadge } from '../components/capture/Ui';
import HowThisWorks from '../components/help/HowThisWorks';
// Phase 4.17 v134.1 — Dashboard tab (analytics) + List tab (existing UI).
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import ModuleDashboard from '../components/dashboards/ModuleDashboard';

const BACKEND = process.env.REACT_APP_BACKEND_URL;

export default function HazardsList() {
  const [items, setItems] = useState([]);
  const [filtered, setFiltered] = useState([]);
  // v58.13.132eb — total from X-Total-Count header
  const [totalCount, setTotalCount] = useState(null);
  // v58.13.132ee — archived count from X-Archived-Count header.
  const [archivedCount, setArchivedCount] = useState(null);
  const [loading, setLoading] = useState(true);
  const density = useCaptureDensity('hazards', filtered.length);
  // v58.13.132ec — Archive lifecycle. Admin-only.
  const isAdmin = (getUser()?.role || '').toLowerCase() === 'admin';
  // v58.13.132ee — Bulk archive dialog + search-sees-archived.
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  // v58.13.119 — Ask Intelligence deep-link (`?open=<id>`).
  const { deepLinkId } = useDeepLinkOpen({
    items, loading, notFoundMessage: 'Linked hazard not found',
  });
  // v58.13.132eh — Load-more pagination.
  const [pageSize, setPageSize] = usePersistedPageSize('hazards:pageSize', 5000);
  // v58.13.132ee — Shared loader: refetches items + both count headers.
  const load = React.useCallback(async (includeArchived, offset = 0, size = 5000, append = false) => {
    setLoading(true);
    try {
      const r = await api.get('/hazards', {
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
    useArchiveActions('/hazards', setItems, () => load(showArchived, 0, pageSize, false));
  useEffect(() => { load(showArchived, 0, pageSize, false); }, [showArchived, pageSize, load]);
  const onLoadMore = React.useCallback(() => {
    load(showArchived, items.length, pageSize, true);
  }, [load, showArchived, items.length, pageSize]);
  const evict = (id) => {
    setItems((prev) => prev.filter((x) => x.id !== id));
    setFiltered((prev) => prev.filter((x) => x.id !== id));
  };

  return (
    <div className="max-w-7xl mx-auto" data-testid="hazards-list">
      <CaptureSticky testid="hazards-sticky">
        <PageHeader crumb="Capture / Hazard Reports" title="Hazard Reports"
          subtitle="Snap a hazard — AI classifies severity and drafts the report."
          action={
            <div className="flex items-center gap-2">
              {isAdmin && (
                <button type="button" onClick={() => setArchiveDialogOpen(true)}
                        data-testid="hazards-archive-header-btn"
                        className="text-sm px-3 py-1.5 rounded border border-slate-300 text-slate-700 hover:bg-slate-50">
                  Archive…
                </button>
              )}
              <NewButton to="/app/hazards/new" label="Report hazard" testid="hazard-create-btn" />
            </div>
          } />
        {/* v58.13.132ee — Bulk archive dialog. */}
        {isAdmin && (
          <ArchiveDialog open={archiveDialogOpen} onClose={() => setArchiveDialogOpen(false)}
            apiPath="/hazards" moduleLabel="hazards"
            knownStatuses={['open', 'in_progress', 'closed']}
            knownCategories={['hazard', 'near_miss', 'risk_assessment']}
            onArchived={() => load(showArchived)} />
        )}
        {/* v58.13.132eb — total-count chip (reads `.132ea` header). */}
        {/* v58.13.132ec — Admin-only Show-archived toggle beside it. */}
        <div className="mt-1 flex items-center gap-2">
          <TotalCountChip
            showing={filtered.length}
            total={totalCount}
            testid="hazards-total-count-chip"
          />
          {isAdmin && (
            <ShowArchivedToggle
              value={showArchived}
              onChange={setShowArchived}
              count={archivedCount}
              testid="hazards-show-archived-toggle"
            />
          )}
        </div>
        {items.length > 0 && (
          <CaptureListToolbar
            items={items} onFiltered={setFiltered} testidPrefix="hazards"
            densityMode={density.mode} onDensityChange={density.setMode}
          />
        )}
      </CaptureSticky>
      <Tabs defaultValue="list" className="mt-2" data-testid="hazards-tabs">
        <TabsList variant="pill-pair">
          <TabsTrigger variant="pill-pair" emphasis="secondary" value="dashboard" data-testid="hazards-tab-dashboard">Dashboard</TabsTrigger>
          <TabsTrigger variant="pill-pair" emphasis="primary" value="list" data-testid="hazards-tab-list">
            List <span className="ml-1.5 text-[10px] text-slate-500 tabular-nums">{items.length}</span>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="dashboard" className="mt-4">
          <ModuleDashboard
            module="hazards" title="Hazards"
            tagline="Photo-first hazard capture with AI-classified severity, tracked from open through closure."
            moduleColour="amber"
            quickActions={[{ label: 'Report hazard', route: '/app/hazards/new' }]}
          />
        </TabsContent>
        <TabsContent value="list" className="mt-4">
      {loading ? <div className="text-sm text-slate-500">Loading…</div>
       : items.length === 0 ? <EmptyState title="No hazards reported" body="Report your first hazard with a photo and AI classification." action={<NewButton to="/app/hazards/new" label="Report hazard" testid="hazard-empty-create" />} />
       : (<>
          <CaptureCardGrid testid="hazards-grid" gridClass={density.gridClass}>
            {filtered.map((h) => {
              // v160.3.0-adjust-17b — Real hazard reports (not legacy)
              // with a photo still get the photo header; legacy SSRA
              // imports render compact CaptureCard only. Both share the
              // same colour stripe + delete/view icons.
              const withPhoto = !h.imported && h.photo_url;
              const extraBadges = h.severity ? [<StatusBadge key="sev" value={h.severity} />] : [];
              if (withPhoto) {
                return (
                  <div key={h.id} className="rounded-xl border border-slate-200 bg-white overflow-hidden" data-testid={`hazard-card-photo-${h.id}`}>
                    <div className="aspect-video bg-slate-100">
                      <AuthedImage
                        rawSrc={h.photo_url}
                        alt={h.title}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <CaptureCard
                      record={h}
                      resourceKind="hazards"
                      apiPath="hazards"
                      subtitle={h.description}
                      subtitleLines={density.subtitleLines}
                      minH={density.cardMinH}
                      badges={extraBadges}
                      onDeleted={evict}
                      onArchive={isAdmin ? onArchive : undefined}
                      onUnarchive={isAdmin ? onUnarchive : undefined}
                      openInitially={deepLinkId === h.id}
                    />
                  </div>
                );
              }
              return (
                <CaptureCard
                  key={h.id}
                  record={h}
                  resourceKind="hazards"
                  apiPath="hazards"
                  subtitle={h.description || null}
                  subtitleLines={density.subtitleLines}
                  minH={density.cardMinH}
                  badges={extraBadges}
                  onDeleted={evict}
                  onArchive={isAdmin ? onArchive : undefined}
                  onUnarchive={isAdmin ? onUnarchive : undefined}
                  openInitially={deepLinkId === h.id}
                />
              );
            })}
          </CaptureCardGrid>
       </>)}
       {/* v58.13.132eh — Load-more pager. */}
       {!loading && items.length > 0 && (
         <PaginationBar
           showing={items.length}
           total={totalCount ?? items.length}
           pageSize={pageSize}
           onPageSize={setPageSize}
           onLoadMore={onLoadMore}
           loading={loading}
           testidPrefix="hazards"
           storageKey="hazards:pageSize"
         />
       )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

export function HazardNew() {
  const navigate = useNavigate();
  const user = getUser();
  const wsId = user?.workspace_ids?.[0];
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [photoUrl, setPhotoUrl] = useState(null);
  const [preview, setPreview] = useState(null);
  const [form, setForm] = useState({
    title: '', description: '', location: '', severity: 'medium',
    controls: [], status: 'open',
  });
  const [aiAnalysis, setAiAnalysis] = useState(null);

  const onFile = async (file) => {
    if (!file || !file.type.startsWith('image/')) { toast.error('Pick an image'); return; }
    setPreview(URL.createObjectURL(file));
    setAiBusy(true);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const { data } = await api.post('/ai/hazard-vision', fd);
      setAiAnalysis(data);
      setPhotoUrl(data.photo_url);
      setForm((f) => ({
        ...f,
        title: f.title || (data.identified_hazards?.[0] || 'Hazard'),
        description: f.description || data.summary || '',
        severity: data.severity || 'medium',
        controls: data.suggested_controls?.length ? data.suggested_controls : f.controls,
      }));
      toast.success('AI classified the hazard', { description: data.summary || 'Review and save.' });
    } catch (e) {
      toast.error('AI vision failed — fill in manually', { description: apiError(e) });
    } finally { setAiBusy(false); }
  };

  const addControl = () => setForm((f) => ({ ...f, controls: [...f.controls, ''] }));
  const updControl = (i, v) => setForm((f) => ({ ...f, controls: f.controls.map((x, j) => j === i ? v : x) }));
  const delControl = (i) => setForm((f) => ({ ...f, controls: f.controls.filter((_, j) => j !== i) }));

  const save = async () => {
    if (!form.title) { toast.error('Title required'); return; }
    setBusy(true);
    try {
      await api.post('/hazards', {
        ...form, workspace_id: wsId, photo_url: photoUrl, ai_analysis: aiAnalysis,
        controls: form.controls.filter(Boolean),
      });
      toast.success('Hazard reported');
      navigate('/app/hazards');
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="max-w-4xl mx-auto" data-testid="hazard-new">
      <BackButton to="/app/hazards" />
      <PageHeader crumb="Capture / Hazard Reports / New" title="Report a hazard" subtitle="Upload a photo — AI will draft the title, severity and suggested controls." />

      <div className="grid lg:grid-cols-2 gap-5">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-2">Photo</div>
          <div
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); onFile(e.dataTransfer.files?.[0]); }}
            className="aspect-video rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 flex items-center justify-center cursor-pointer hover:border-brand-blue hover:bg-brand-blue-soft/30 overflow-hidden"
            data-testid="hazard-dropzone"
          >
            {preview ? <img src={preview} alt="Preview" className="w-full h-full object-cover" />
             : aiBusy ? <div className="flex flex-col items-center gap-2 text-slate-500"><Loader2 size={20} className="animate-spin" /><span className="text-sm">AI is analysing the photo…</span></div>
             : <div className="flex flex-col items-center gap-2 text-slate-500"><UploadCloud size={28} /><span className="text-sm">Click or drag-drop a photo (JPG/PNG)</span></div>}
          </div>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} data-testid="hazard-file-input" />
          {aiAnalysis && (
            <div className="mt-4 rounded-xl border border-violet-200 bg-brand-violet-soft p-3 text-xs space-y-1.5" data-testid="hazard-ai-analysis">
              <div className="text-brand-violet font-semibold uppercase tracking-wider">AI analysis</div>
              <div><span className="font-semibold">Identified:</span> {(aiAnalysis.identified_hazards || []).join(' · ') || '—'}</div>
              <div><span className="font-semibold">Severity:</span> {aiAnalysis.severity}</div>
              <div className="text-slate-700">{aiAnalysis.summary}</div>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
          <Field label="Title" required><input data-testid="hazard-title" className={inputClass} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
          <Field label="Description"><textarea data-testid="hazard-description" rows={3} className={inputClass} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Location"><input data-testid="hazard-location" className={inputClass} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></Field>
            <Field label="Severity">
              <select data-testid="hazard-severity" className={inputClass} value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
                {['low', 'medium', 'high', 'critical'].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <div className="text-sm font-medium text-slate-700">Suggested controls</div>
              <button type="button" onClick={addControl} className="inline-flex items-center gap-1 text-sm text-brand-blue hover:underline"><Plus size={14} /> Add</button>
            </div>
            <div className="space-y-2">
              {form.controls.length === 0 && <div className="text-sm text-slate-400 italic">None yet — AI suggestions appear here.</div>}
              {form.controls.map((c, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input className={inputClass} value={c} onChange={(e) => updControl(i, e.target.value)} placeholder="Control" />
                  <button type="button" onClick={() => delControl(i)} className="p-2 text-slate-400 hover:text-brand-red"><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2 mt-5">
        <GhostButton onClick={() => navigate('/app/hazards')} testid="hazard-cancel">Cancel</GhostButton>
        <PrimaryButton onClick={save} busy={busy} testid="hazard-submit">Save hazard</PrimaryButton>
      </div>
    </div>
  );
}
