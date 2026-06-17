import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import api, { apiError } from '../lib/api';
import EmailButton from '../components/EmailButton';
import PdfActions from '../components/PdfActions';
import { getUser } from '../lib/auth';
import { PageHeader, NewButton, BackButton, PrimaryButton, AiButton, Field, inputClass, EmptyState, GhostButton } from '../components/capture/Ui';

export default function SiteDiaryList() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { api.get('/site-diary').then((r) => setItems(r.data)).finally(() => setLoading(false)); }, []);

  return (
    <div className="max-w-6xl mx-auto" data-testid="sitediary-list">
      <PageHeader crumb="Capture / Site Diary" title="Site Diary"
        subtitle="Capture raw notes — AI structures them into activities, delays, deliveries and weather."
        action={<NewButton to="/app/site-diary/new" label="New diary entry" testid="diary-create-btn" />} />
      {loading ? <div className="text-sm text-slate-500">Loading…</div>
       : items.length === 0 ? <EmptyState title="No diary entries yet" body="Capture your first daily diary entry." action={<NewButton to="/app/site-diary/new" label="New entry" testid="diary-empty-create" />} />
       : (
        <div className="space-y-3">
          {items.map((d) => (
            <div key={d.id} className="rounded-2xl border border-slate-200 bg-white p-4" data-testid={`diary-row-${d.id}`}>
              <div className="flex items-center justify-between mb-1">
                <div className="text-xs text-slate-500">{d.date}</div>
                {d.structured_log && <span className="text-[10px] px-2 py-0.5 rounded-full bg-brand-violet-soft text-brand-violet font-semibold uppercase tracking-wider">AI structured</span>}
              </div>
              <p className="text-sm text-slate-700 line-clamp-2">{d.raw_notes}</p>
              <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between gap-2 flex-wrap">
                <PdfActions resourceKind="site_diary" recordId={d.id} title={`Site Diary ${d.date}`} size="sm" />
                <EmailButton resourceKind="site_diary" recordId={d.id}
                  subject={`Site Diary — ${d.date}`}
                  body={`Site diary entry for ${d.date}.\n\n${d.raw_notes || ''}`}
                  variant="row" size="sm" label="Email" />
              </div>
            </div>
          ))}
        </div>
       )}
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
