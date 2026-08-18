import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../lib/api';
import CaptureListToolbar from '../components/CaptureListToolbar';
import CaptureCard, { CaptureCardGrid, CaptureSticky } from '../components/CaptureCard';
import { getUser } from '../lib/auth';
import { PageHeader, NewButton, BackButton, PrimaryButton, Field, inputClass, EmptyState, GhostButton } from '../components/capture/Ui';

// v58.9.1 — Group tiles by parent-zip (source contractor batch) with
// a rotating 6-colour palette. The prior single-flat-grid buried
// bulk-imported records; this restores the visual grouping the user
// referenced ("coloured in groups like Viatec Traffic Solutions - SSRA").
const GROUP_PALETTE = [
  { name: 'amber',   heading: '#F5B301', bg: '#FEF3C7', border: '#F5B301' },
  { name: 'coral',   heading: '#F97316', bg: '#FFEDD5', border: '#F97316' },
  { name: 'emerald', heading: '#10B981', bg: '#D1FAE5', border: '#10B981' },
  { name: 'sky',     heading: '#0EA5E9', bg: '#E0F2FE', border: '#0EA5E9' },
  { name: 'violet',  heading: '#8B5CF6', bg: '#EDE9FE', border: '#8B5CF6' },
  { name: 'rose',    heading: '#F43F5E', bg: '#FFE4E6', border: '#F43F5E' },
];

function _deriveGroup(row) {
  // Bulk-import shims carry the parent zip name inside `work_summary`
  // (format: "Imported: <PARENT>.zip::<pdf>.pdf"). Extract that
  // prefix. Fall back to a workspace-based bucket for original rows.
  const ws = row.work_summary || '';
  const m = ws.match(/Imported:\s*([^:]+?)(?:\.zip)?::/i);
  if (m) return m[1].trim();
  if (row.imported) return 'Imported (unlabelled)';
  return 'Original entries';
}

export default function PreStartsList() {
  const [items, setItems] = useState([]);
  const [filtered, setFiltered] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { api.get('/pre-starts', { params: { limit: 5000 } }).then((r) => { setItems(r.data); setFiltered(r.data); }).finally(() => setLoading(false)); }, []);

  const evict = (id) => {
    setItems((prev) => prev.filter((x) => x.id !== id));
    setFiltered((prev) => prev.filter((x) => x.id !== id));
  };

  // v58.9.1 — Group `filtered` rows by derived label, sort each group
  // by date desc, and assign a stable palette entry per group (order
  // by tile-count desc so the largest crew batches get amber first).
  const grouped = useMemo(() => {
    const buckets = new Map();
    for (const row of filtered) {
      const key = _deriveGroup(row);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(row);
    }
    const arr = Array.from(buckets.entries())
      .map(([label, rows]) => ({
        label,
        rows: rows.sort((a, b) => (b.date || '').localeCompare(a.date || '')),
      }))
      .sort((a, b) => b.rows.length - a.rows.length);
    return arr.map((g, i) => ({
      ...g,
      palette: GROUP_PALETTE[i % GROUP_PALETTE.length],
    }));
  }, [filtered]);


  return (
    <div className="max-w-7xl mx-auto" data-testid="prestarts-list">
      <CaptureSticky testid="prestarts-sticky">
        <PageHeader crumb="Capture / Daily Pre-Starts" title="Daily Pre-Starts" subtitle="Crew sign-on and toolbox talk records, by date."
          action={<NewButton to="/app/pre-starts/new" label="New pre-start" testid="prestart-create-btn" />} />
        {items.length > 0 && (
          <CaptureListToolbar items={items} onFiltered={setFiltered} testidPrefix="prestarts" />
        )}
      </CaptureSticky>
      <div className="mt-3">
      {loading ? <div className="text-sm text-slate-500">Loading…</div>
       : items.length === 0 ? <EmptyState title="No pre-starts yet" body="Capture your first daily pre-start with crew sign-ons."
            action={<NewButton to="/app/pre-starts/new" label="New pre-start" testid="prestart-empty-create" />} />
       : (
        <div className="space-y-8" data-testid="prestarts-grouped">
          {grouped.map((g) => (
            <section key={g.label}
                     data-testid={`prestarts-group-${g.label}`}
                     data-color={g.palette.name}
                     className="rounded-2xl border p-4"
                     style={{ background: g.palette.bg, borderColor: g.palette.border + '55' }}>
              <div className="flex items-baseline justify-between mb-3">
                <h2 className="font-display font-semibold text-slate-900 flex items-center gap-2">
                  <span className="inline-block w-2.5 h-2.5 rounded-full"
                        style={{ background: g.palette.heading }} />
                  <span style={{ color: g.palette.heading }}>{g.label}</span>
                  <span className="text-xs font-normal text-slate-500 tabular-nums">
                    · {g.rows.length} record{g.rows.length === 1 ? '' : 's'}
                  </span>
                </h2>
              </div>
              <CaptureCardGrid testid={`prestarts-grid-${g.label}`}>
                {g.rows.map((p) => (
                  <CaptureCard
                    key={p.id}
                    record={p}
                    resourceKind="pre_starts"
                    apiPath="pre-starts"
                    subject={`Daily Pre-Start — ${p.date}${p.crew_lead ? ` — ${p.crew_lead}` : ''}`}
                    body={`Daily pre-start summary.\n\nDate: ${p.date}\nCrew lead: ${p.crew_lead || ''}\nWork: ${p.work_summary || ''}`}
                    subtitle={p.imported ? null : (p.work_summary || (p.sign_ons?.length ? `${p.sign_ons.length} signed on` : null))}
                    onDeleted={evict}
                  />
                ))}
              </CaptureCardGrid>
            </section>
          ))}
        </div>
       )}
      </div>
    </div>
  );
}

export function PreStartNew() {
  const navigate = useNavigate();
  const user = getUser();
  const wsId = user?.workspace_ids?.[0];
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    crew_lead: user?.name || '', work_summary: '', hazards_discussed: '', notes: '',
    linked_swms_ids: [], linked_permits: [],
    sign_ons: [{ name: '', role: '', signature_ts: null }],
  });
  const [swmsList, setSwmsList] = useState([]);
  useEffect(() => { api.get('/swms?status=approved&limit=20').then((r) => setSwmsList(r.data)).catch(() => {}); }, []);

  const updSign = (i, patch) => setForm((f) => ({ ...f, sign_ons: f.sign_ons.map((s, j) => j === i ? { ...s, ...patch } : s) }));
  const addSign = () => setForm((f) => ({ ...f, sign_ons: [...f.sign_ons, { name: '', role: '', signature_ts: null }] }));
  const delSign = (i) => setForm((f) => ({ ...f, sign_ons: f.sign_ons.filter((_, j) => j !== i) }));
  const sign = (i) => updSign(i, { signature_ts: new Date().toISOString() });

  const submit = async (e) => {
    e?.preventDefault();
    if (!form.work_summary || !form.crew_lead) { toast.error('Crew lead and work summary are required'); return; }
    setBusy(true);
    try {
      await api.post('/pre-starts', { ...form, workspace_id: wsId });
      toast.success('Pre-start saved');
      navigate('/app/pre-starts');
    } catch (err) { toast.error(apiError(err)); }
    finally { setBusy(false); }
  };

  const toggleSwms = (id) => setForm((f) => ({ ...f, linked_swms_ids: f.linked_swms_ids.includes(id) ? f.linked_swms_ids.filter((x) => x !== id) : [...f.linked_swms_ids, id] }));

  return (
    <div className="max-w-3xl mx-auto" data-testid="prestart-new">
      <BackButton to="/app/pre-starts" />
      <PageHeader crumb="Capture / Daily Pre-Starts / New" title="New pre-start" />
      <form onSubmit={submit} className="space-y-5">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 grid sm:grid-cols-2 gap-4">
          <Field label="Date" required><input data-testid="ps-date" type="date" className={inputClass} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
          <Field label="Crew lead" required><input data-testid="ps-crew-lead" className={inputClass} value={form.crew_lead} onChange={(e) => setForm({ ...form, crew_lead: e.target.value })} /></Field>
          <div className="sm:col-span-2"><Field label="Work summary" required><textarea data-testid="ps-summary" rows={3} className={inputClass} value={form.work_summary} onChange={(e) => setForm({ ...form, work_summary: e.target.value })} placeholder="What's the crew doing today?" /></Field></div>
          <div className="sm:col-span-2"><Field label="Hazards discussed"><textarea data-testid="ps-hazards" rows={2} className={inputClass} value={form.hazards_discussed} onChange={(e) => setForm({ ...form, hazards_discussed: e.target.value })} placeholder="What did toolbox cover?" /></Field></div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h3 className="font-display font-semibold mb-3">Link SWMS</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto">
            {swmsList.length === 0 && <div className="text-sm text-slate-400 italic">No approved SWMS available.</div>}
            {swmsList.map((s) => (
              <label key={s.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.linked_swms_ids.includes(s.id)} onChange={() => toggleSwms(s.id)} data-testid={`ps-swms-${s.id}`} />
                <span className="truncate">{s.title}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-display font-semibold">Crew sign-ons</h3>
            <button type="button" onClick={addSign} className="inline-flex items-center gap-1 text-sm text-brand-blue hover:underline"><Plus size={14} /> Add row</button>
          </div>
          <div className="space-y-2">
            {form.sign_ons.map((s, i) => (
              <div key={i} className="flex items-center gap-2" data-testid={`ps-signon-${i}`}>
                <input className={inputClass} placeholder="Name" value={s.name} onChange={(e) => updSign(i, { name: e.target.value })} />
                <input className={`${inputClass} w-40`} placeholder="Role" value={s.role || ''} onChange={(e) => updSign(i, { role: e.target.value })} />
                {s.signature_ts
                  ? <span className="text-xs text-emerald-700 bg-brand-green-mint border border-emerald-200 px-2 py-1 rounded-full whitespace-nowrap">Signed {new Date(s.signature_ts).toLocaleTimeString()}</span>
                  : <button type="button" onClick={() => sign(i)} className="text-xs px-3 py-1.5 rounded-lg border border-brand-blue text-brand-blue hover:bg-brand-blue-soft" data-testid={`ps-sign-${i}`}>Sign</button>}
                <button type="button" onClick={() => delSign(i)} className="p-2 text-slate-400 hover:text-brand-red"><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <GhostButton onClick={() => navigate('/app/pre-starts')} testid="ps-cancel">Cancel</GhostButton>
          <PrimaryButton type="submit" busy={busy} testid="ps-submit">Save pre-start</PrimaryButton>
        </div>
      </form>
    </div>
  );
}
