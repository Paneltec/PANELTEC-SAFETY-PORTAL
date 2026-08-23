import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../lib/api';
import CaptureListToolbar from '../components/CaptureListToolbar';
import CaptureCard from '../components/CaptureCard';
import GroupedTilesView from '../components/capture/GroupedTilesView';
import useCaptureDensity from '../lib/useCaptureDensity';
import { getUser } from '../lib/auth';
import { PageHeader, NewButton, BackButton, PrimaryButton, GhostButton, Field, inputClass, EmptyState, StatusBadge } from '../components/capture/Ui';
// Phase 4.17 v134.1 — Dashboard tab.
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import ModuleDashboard from '../components/dashboards/ModuleDashboard';

const CATS = [
  ['near_miss', 'Near miss'], ['first_aid', 'First aid'], ['medical', 'Medical'],
  ['ltc', 'Lost-time'], ['env', 'Environmental'], ['property', 'Property'],
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
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ status: '', category: '' });
  // v160.3.0-adjust-16g — Client-side search from shared toolbar layers
  // on top of the existing status/category selects. The pre-filtered
  // subset feeds into the toolbar; the toolbar then applies text search
  // + sort.
  const [searchFiltered, setSearchFiltered] = useState([]);
  const incidentsDensity = useCaptureDensity('incidents', searchFiltered.length);
  useEffect(() => {
    api.get('/incidents')
      .then((r) => setItems(r.data))
      .finally(() => setLoading(false));
  }, []);

  const evict = (id) => setItems((prev) => prev.filter((x) => x.id !== id));

  const preFiltered = useMemo(
    () => items.filter((i) =>
      (!filter.status || i.follow_up_status === filter.status) &&
      (!filter.category || i.category === filter.category)),
    [items, filter.status, filter.category]
  );

  return (
    <div className="max-w-6xl mx-auto" data-testid="incidents-list">
      <PageHeader crumb="Capture / Incident Reports" title="Incident Reports"
        subtitle="Structured incident capture with witness statements and evidence."
        action={<NewButton to="/app/incidents/new" label="New incident" testid="incident-create-btn" />} />

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
      <div className="flex flex-wrap gap-2 mb-4">
        <select className={inputClass + ' w-auto'} value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })} data-testid="incident-filter-status">
          <option value="">All statuses</option><option value="open">open</option><option value="in_progress">in progress</option><option value="closed">closed</option>
        </select>
        <select className={inputClass + ' w-auto'} value={filter.category} onChange={(e) => setFilter({ ...filter, category: e.target.value })} data-testid="incident-filter-category">
          <option value="">All categories</option>{CATS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>

      {loading ? <div className="text-sm text-slate-500">Loading…</div>
       : preFiltered.length === 0 ? <EmptyState title="No incidents" body="Log your first incident — even a near miss." action={<NewButton to="/app/incidents/new" label="New incident" testid="incident-empty-create" />} />
       : (<>
        <CaptureListToolbar
          items={preFiltered}
          onFiltered={setSearchFiltered}
          testidPrefix="incidents"
          densityMode={incidentsDensity.mode}
          onDensityChange={incidentsDensity.setMode}
        />
        {/* v58.12.7 — Tile format via shared GroupedTilesView. Groups by
            `category` in the fixed CATS escalation order (near_miss →
            property). The status/category selects above still layer into
            `preFiltered`, and CaptureListToolbar adds search on top.
            v58.12.9 — Tile bodies inherit the new CaptureCard-parity
            visual language (rounded-lg, tight padding). The CATS
            escalation banner palette stays via `groupPaletteOverrides`
            — semantically stronger than a `preStartsPalette` map. */}
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
              badges={i.follow_up_status
                ? [<StatusBadge key="fus" value={i.follow_up_status} />]
                : []}
              onDeleted={evict}
            />
          )}
        />
       </>)
      }
        </TabsContent>
      </Tabs>
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
