import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, Loader2, Plus, Trash2, UploadCloud } from 'lucide-react';
import { toast } from 'sonner';
import api, { API_BASE, apiError } from '../lib/api';
import { getUser } from '../lib/auth';
import { PageHeader, NewButton, BackButton, PrimaryButton, GhostButton, Field, inputClass, EmptyState, StatusBadge } from '../components/capture/Ui';

const BACKEND = process.env.REACT_APP_BACKEND_URL;

export default function HazardsList() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { api.get('/hazards').then((r) => setItems(r.data)).finally(() => setLoading(false)); }, []);

  return (
    <div className="max-w-6xl mx-auto" data-testid="hazards-list">
      <PageHeader crumb="Capture / Hazard Reports" title="Hazard Reports"
        subtitle="Snap a hazard — AI classifies severity and drafts the report."
        action={<NewButton to="/app/hazards/new" label="Report hazard" testid="hazard-create-btn" />} />
      {loading ? <div className="text-sm text-slate-500">Loading…</div>
       : items.length === 0 ? <EmptyState title="No hazards reported" body="Report your first hazard with a photo and AI classification." action={<NewButton to="/app/hazards/new" label="Report hazard" testid="hazard-empty-create" />} />
       : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((h) => (
            <div key={h.id} className="rounded-2xl border border-slate-200 bg-white overflow-hidden" data-testid={`hazard-card-${h.id}`}>
              <div className="aspect-video bg-slate-100 flex items-center justify-center text-slate-300">
                {h.photo_url ? <img src={h.photo_url.startsWith('http') ? h.photo_url : `${BACKEND}${h.photo_url}`} alt={h.title} className="w-full h-full object-cover" />
                  : <Camera size={32} />}
              </div>
              <div className="p-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-display font-semibold text-sm truncate">{h.title}</h3>
                  <StatusBadge value={h.severity} />
                </div>
                <p className="text-xs text-slate-500 mt-1 line-clamp-2">{h.description}</p>
                <div className="mt-3 flex items-center justify-between"><StatusBadge value={h.status} /><span className="text-[10px] text-slate-400">{(h.created_at || '').slice(0, 10)}</span></div>
              </div>
            </div>
          ))}
        </div>
       )}
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
      const { data } = await api.post('/ai/hazard-vision', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
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
