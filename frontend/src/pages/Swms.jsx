import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  FileText, Loader2, Plus, Trash2, Download, ChevronDown,
  AlertTriangle, ArrowUpRight, ShieldAlert, Layers,
} from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../lib/api';
import EmailButton from '../components/EmailButton';
import PdfActions from '../components/PdfActions';
import DeleteRecordButton from '../components/DeleteRecordButton';
import { getUser, getToken } from '../lib/auth';
import {
  PageHeader, NewButton, BackButton, AiButton, PrimaryButton, GhostButton,
  Field, inputClass, EmptyState, StatusBadge,
} from '../components/capture/Ui';

const API_BASE = process.env.REACT_APP_BACKEND_URL + '/api';

// ----------------------- LIST -----------------------
export default function SwmsList() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/swms').then((r) => setItems(r.data)).catch(() => toast.error('Could not load SWMS')).finally(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-6xl mx-auto" data-testid="swms-list">
      <PageHeader crumb="Capture / AI SWMS" title="Safe Work Method Statements"
        subtitle="Draft, review and approve SWMS across your workspaces."
        action={<NewButton to="/app/swms/new" label="Create SWMS" testid="swms-create-btn" />} />
      {loading ? <div className="text-sm text-slate-500">Loading…</div>
       : items.length === 0 ? <EmptyState title="No SWMS yet" body="Draft your first Safe Work Method Statement with the AI assistant."
            action={<NewButton to="/app/swms/new" label="Create SWMS" testid="swms-empty-create" />} />
       : (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
              <tr><th className="text-left px-4 py-3">Title</th><th className="text-left px-4 py-3">Status</th><th className="text-left px-4 py-3">Version</th><th className="text-left px-4 py-3">Created</th></tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link to={`/app/swms/${s.id}`} className="font-medium text-slate-900 hover:text-brand-blue" data-testid={`swms-row-${s.id}`}>{s.title}</Link>
                    <div className="text-xs text-slate-500 mt-0.5 line-clamp-1">{s.job_description}</div>
                  </td>
                  <td className="px-4 py-3"><StatusBadge value={s.status} /></td>
                  <td className="px-4 py-3 text-slate-500">v{s.version || 1}</td>
                  <td className="px-4 py-3 text-slate-500">{(s.created_at || '').slice(0, 10)}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex gap-1 items-center">
                      <PdfActions resourceKind="swms" recordId={s.id} title={s.title} size="sm" />
                      <EmailButton resourceKind="swms" recordId={s.id}
                        subject={`SWMS for Review: ${s.title} v${s.version || 1}`}
                        body={`Please review the attached SWMS.\n\nTitle: ${s.title}\nStatus: ${s.status}`}
                        variant="row" size="sm" label="Email" />
                      <DeleteRecordButton resourceKind="swms" apiPath="swms" recordId={s.id} label="SWMS" recordTitle={s.title} onDeleted={(id) => setItems((prev) => prev.filter((x) => x.id !== id))} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
       )}
    </div>
  );
}

// ----------------------- NEW (2-step wizard) -----------------------
export function SwmsNew() {
  const navigate = useNavigate();
  const user = getUser();
  const wsId = user?.workspace_ids?.[0];
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [aiError, setAiError] = useState('');
  const [form, setForm] = useState({
    title: '', job_description: '', location: '',
    tasks: [], hazards: [], controls: [], ppe: [],
  });

  const generate = async () => {
    if (!form.job_description.trim()) { toast.error('Add a job description first'); return; }
    setBusy(true); setAiError('');
    try {
      const { data } = await api.post('/ai/swms-draft', {
        job_description: form.job_description, location: form.location || undefined,
      });
      setForm((f) => ({
        ...f, tasks: data.tasks || [], hazards: data.hazards || [],
        controls: data.controls || [], ppe: data.ppe || [],
        title: f.title || data.tasks?.[0]?.description?.slice(0, 60) || 'New SWMS',
      }));
      setStep(2);
      toast.success('Draft generated', { description: 'Edit and submit for review.' });
    } catch (e) {
      const msg = apiError(e);
      setAiError(msg);
      toast.error('AI could not draft — falling back to manual entry', { description: msg });
      setStep(2);
    } finally { setBusy(false); }
  };

  const save = async (status) => {
    if (!form.title) { toast.error('Title is required'); return; }
    setBusy(true);
    try {
      await api.post('/swms', { ...form, workspace_id: wsId, status });
      toast.success(status === 'submitted' ? 'Submitted for review' : 'Saved as draft');
      navigate('/app/swms');
    } catch (e) {
      toast.error(apiError(e));
    } finally { setBusy(false); }
  };

  const updArr = (key, idx, patch) =>
    setForm((f) => ({ ...f, [key]: f[key].map((it, i) => i === idx ? { ...it, ...patch } : it) }));
  const addArr = (key, item) => setForm((f) => ({ ...f, [key]: [...f[key], item] }));
  const delArr = (key, idx) => setForm((f) => ({ ...f, [key]: f[key].filter((_, i) => i !== idx) }));

  return (
    <div className="max-w-4xl mx-auto" data-testid="swms-new">
      <BackButton to="/app/swms" />
      <PageHeader crumb="Capture / AI SWMS / New" title="Create SWMS"
        subtitle={step === 1 ? 'Step 1 of 2 — describe the job in plain English.' : 'Step 2 of 2 — review and edit the AI-drafted SWMS.'} />

      {step === 1 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4">
          <Field label="Title" required>
            <input data-testid="swms-title" className={inputClass} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Install steel handrail at level 2 slab edge" />
          </Field>
          <Field label="Location (optional)">
            <input data-testid="swms-location" className={inputClass} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="e.g. Sydney Metro bridge deck" />
          </Field>
          <Field label="Job description" required hint="2-4 sentences works best. Mention plant, height, duration, crew size.">
            <textarea data-testid="swms-job-description" rows={6} className={inputClass} value={form.job_description}
              onChange={(e) => setForm({ ...form, job_description: e.target.value })}
              placeholder="Install steel handrail along eastern slab edge at level 2 using an EWP. Two workers, 4 hour duration." />
          </Field>
          <div className="flex items-center justify-end gap-2 pt-2">
            <GhostButton onClick={() => setStep(2)} testid="swms-skip-ai">Skip AI →</GhostButton>
            <AiButton onClick={generate} busy={busy} testid="swms-generate-ai" />
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          {aiError && <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-800 px-4 py-2.5 text-sm">AI fallback: {aiError}. Fill in manually below.</div>}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
            <Field label="Title" required><input className={inputClass} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} data-testid="swms-step2-title" /></Field>
            <Field label="Job description"><textarea className={inputClass} rows={3} value={form.job_description} onChange={(e) => setForm({ ...form, job_description: e.target.value })} /></Field>
          </div>

          <RepeaterBlock title="Tasks" testid="tasks" items={form.tasks} onAdd={() => addArr('tasks', { step: String(form.tasks.length + 1), description: '' })} onDel={(i) => delArr('tasks', i)}
            renderRow={(it, i) => (
              <>
                <input className={`${inputClass} w-16`} value={it.step} onChange={(e) => updArr('tasks', i, { step: e.target.value })} />
                <input className={inputClass} value={it.description} onChange={(e) => updArr('tasks', i, { description: e.target.value })} placeholder="Task description" />
              </>
            )} />

          <RepeaterBlock title="Hazards" testid="hazards" items={form.hazards} onAdd={() => addArr('hazards', { label: '', risk: 'medium' })} onDel={(i) => delArr('hazards', i)}
            renderRow={(it, i) => (
              <>
                <input className={inputClass} value={it.label} onChange={(e) => updArr('hazards', i, { label: e.target.value })} placeholder="Hazard label" />
                <select className={`${inputClass} w-32`} value={it.risk} onChange={(e) => updArr('hazards', i, { risk: e.target.value })}>
                  <option value="low">low</option><option value="medium">medium</option><option value="high">high</option>
                </select>
              </>
            )} />

          <RepeaterBlock title="Controls" testid="controls" items={form.controls} onAdd={() => addArr('controls', { label: '', method: 'administrative' })} onDel={(i) => delArr('controls', i)}
            renderRow={(it, i) => (
              <>
                <input className={inputClass} value={it.label} onChange={(e) => updArr('controls', i, { label: e.target.value })} placeholder="Control label" />
                <select className={`${inputClass} w-40`} value={it.method} onChange={(e) => updArr('controls', i, { method: e.target.value })}>
                  {['elimination', 'substitution', 'engineering', 'administrative', 'ppe'].map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </>
            )} />

          <RepeaterBlock title="PPE" testid="ppe" items={form.ppe} onAdd={() => addArr('ppe', '')} onDel={(i) => delArr('ppe', i)}
            renderRow={(it, i) => (
              <input className={inputClass} value={it} onChange={(e) => setForm((f) => ({ ...f, ppe: f.ppe.map((x, j) => j === i ? e.target.value : x) }))} placeholder="e.g. Hard hat" />
            )} />

          <div className="flex items-center justify-between gap-2 pt-2">
            <GhostButton onClick={() => setStep(1)} testid="swms-back">← Back</GhostButton>
            <div className="flex gap-2">
              <GhostButton onClick={() => save('draft')} testid="swms-save-draft">Save as draft</GhostButton>
              <PrimaryButton onClick={() => save('submitted')} busy={busy} testid="swms-submit">Submit for review</PrimaryButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RepeaterBlock({ title, items, onAdd, onDel, renderRow, testid }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5" data-testid={`swms-${testid}`}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-display font-semibold">{title} <span className="text-slate-400 text-sm font-normal">· {items.length}</span></h3>
        <button onClick={onAdd} className="inline-flex items-center gap-1 text-sm text-brand-blue hover:underline"><Plus size={14} /> Add</button>
      </div>
      <div className="space-y-2">
        {items.length === 0 && <div className="text-sm text-slate-400 italic">Nothing yet — click Add.</div>}
        {items.map((it, i) => (
          <div key={i} className="flex items-center gap-2">
            {renderRow(it, i)}
            <button onClick={() => onDel(i)} className="p-2 text-slate-400 hover:text-brand-red" aria-label="Delete"><Trash2 size={14} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ----------------------- DETAIL -----------------------
export function SwmsDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const user = getUser();
  const [doc, setDoc] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get(`/swms/${id}`).then((r) => setDoc(r.data)).catch(() => { toast.error('SWMS not found'); navigate('/app/swms'); });
  }, [id, navigate]);

  if (!doc) return <div className="text-sm text-slate-500">Loading…</div>;

  const review = async (action) => {
    setBusy(true);
    try {
      const { data } = await api.post(`/swms/${id}/review`, { action });
      setDoc(data);
      toast.success(`SWMS ${action.replace('_', ' ')}d`);
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };

  const isReviewer = ['hseq_lead', 'admin'].includes(user?.role);

  return (
    <div className="max-w-4xl mx-auto" data-testid="swms-detail">
      <BackButton to="/app/swms" />
      <div className="mb-6 flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="text-xs text-slate-500 mb-1">Capture / AI SWMS / {doc.title}</div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">{doc.title}</h1>
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <StatusBadge value={doc.status} />
            {doc.code && <span className="text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">{doc.code}</span>}
            <span className="text-xs text-slate-500">v{doc.version || 1} · {doc.created_at?.slice(0, 10)}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <SwmsDownloadButton doc={doc} />
          {isReviewer && doc.status === 'submitted' && (
            <>
              <GhostButton onClick={() => review('request_changes')} testid="swms-request-changes">Request changes</GhostButton>
              <GhostButton onClick={() => review('reject')} testid="swms-reject">Reject</GhostButton>
              <PrimaryButton onClick={() => review('approve')} busy={busy} testid="swms-approve">Approve</PrimaryButton>
            </>
          )}
        </div>
      </div>

      {/* Version chain banners — superseded_by / supersedes */}
      <SwmsVersionBanner doc={doc} />

      <div className="rounded-2xl border border-slate-200 bg-white p-5 mb-4">
        <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-2">Job description</div>
        <p className="text-sm text-slate-700">{doc.job_description}</p>
      </div>

      <DetailList title="Tasks" items={(doc.tasks || []).map((t) => `${t.step}. ${t.description}`)} />
      <DetailList title="Hazards" items={(doc.hazards || []).map((h) => `${h.label} (${h.risk})`)} />
      <DetailList title="Controls" items={(doc.controls || []).map((c) => `${c.label} — ${c.method}`)} />
      <DetailList title="PPE" items={doc.ppe || []} />

      {/* Phase 3.10 — SWMS-06 rich sections */}
      {(doc.codes_practices || []).length > 0 && (
        <DetailList title="Codes & Practices" items={doc.codes_practices} />
      )}
      {(doc.equipment_required || []).length > 0 && (
        <DetailList title="Equipment required" items={doc.equipment_required} />
      )}
      {doc.emergency_procedures && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 mb-4" data-testid="swms-emergency">
          <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-3 flex items-center gap-1.5">
            <ShieldAlert size={12} className="text-amber-500" /> Emergency procedures
          </div>
          {Object.entries(doc.emergency_procedures).map(([k, v]) => (
            <div key={k} className="mb-3 last:mb-0">
              <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 mb-0.5">{k.replace(/_/g, ' ')}</div>
              <p className="text-sm text-slate-700">{v}</p>
            </div>
          ))}
        </div>
      )}
      {doc.applies_to && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 mb-4" data-testid="swms-applies-to">
          <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-2 flex items-center gap-1.5">
            <Layers size={12} /> Applies to
          </div>
          <AppliesTo applies_to={doc.applies_to} />
        </div>
      )}
    </div>
  );
}

function AppliesTo({ applies_to }) {
  const chunks = [];
  if ((applies_to.asset_kinds || []).length) chunks.push(['Asset kinds', applies_to.asset_kinds]);
  if ((applies_to.asset_types || []).length) chunks.push(['Asset types', applies_to.asset_types]);
  if ((applies_to.roles || []).length) chunks.push(['Roles', applies_to.roles.map((r) => r.role || r)]);
  if ((applies_to.worker_ids || []).length) chunks.push(['Workers', [`${applies_to.worker_ids.length} specific worker(s)`]]);
  if ((applies_to.companies || []).length) chunks.push(['Companies', applies_to.companies]);
  if (chunks.length === 0) return <p className="text-sm text-slate-400 italic">Not yet assigned. Use Form Assignments → SWMS to scope this document.</p>;
  return (
    <div className="space-y-2">
      {chunks.map(([label, items]) => (
        <div key={label} className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 mr-1.5">{label}:</span>
          {items.map((it, i) => (
            <span key={i} className="inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded bg-[#e6eff9] text-[#1e4a8c]">
              {String(it).replace(/_/g, ' ')}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

function SwmsVersionBanner({ doc }) {
  if (!doc.superseded_by && !doc.supersedes) return null;
  return (
    <div className="mb-4 space-y-2">
      {doc.superseded_by && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-center gap-3" data-testid="swms-superseded-banner">
          <AlertTriangle size={16} className="text-amber-600 flex-shrink-0" />
          <div className="flex-1 text-sm text-amber-900">
            This version has been <strong>superseded</strong>. The current approved version is available below.
          </div>
          <Link to={`/app/swms/${doc.superseded_by}`}
            className="inline-flex items-center gap-1 text-sm font-semibold text-amber-900 hover:underline">
            Open current <ArrowUpRight size={12} />
          </Link>
        </div>
      )}
      {doc.supersedes && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 flex items-center gap-3" data-testid="swms-supersedes-banner">
          <Layers size={16} className="text-blue-600 flex-shrink-0" />
          <div className="flex-1 text-sm text-blue-900">
            This version <strong>supersedes</strong> an earlier draft. Previous versions are archived for audit trail.
          </div>
          <Link to={`/app/swms/${doc.supersedes}`}
            className="inline-flex items-center gap-1 text-sm font-semibold text-blue-900 hover:underline">
            View previous <ArrowUpRight size={12} />
          </Link>
        </div>
      )}
    </div>
  );
}

function SwmsDownloadButton({ doc }) {
  const [open, setOpen] = useState(false);
  const hasOriginal = !!(doc.source_file?.url);

  const downloadCivil = async () => {
    setOpen(false);
    try {
      const { data } = await api.post('/pdf-token', {
        resource: 'swms', record_id: doc.id, action: 'download',
      });
      window.open(data.url, '_blank');
    } catch (e) { toast.error(apiError(e)); }
  };

  const downloadOriginal = () => {
    setOpen(false);
    if (!hasOriginal) return;
    window.open(doc.source_file.url, '_blank');
  };

  return (
    <div className="relative inline-flex items-stretch rounded-lg border border-slate-300 bg-white shadow-sm overflow-visible"
         data-testid="swms-download-split">
      <button onClick={downloadCivil}
        data-testid="swms-download-civil"
        className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 rounded-l-lg">
        <Download size={14} /> Civil PDF
      </button>
      <div className="w-px bg-slate-200" />
      <button onClick={() => setOpen((v) => !v)}
        data-testid="swms-download-toggle"
        className="inline-flex items-center px-2 py-2 text-slate-500 hover:bg-slate-50 rounded-r-lg">
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-10 w-56 bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden"
             data-testid="swms-download-menu">
          <button onClick={downloadCivil}
            className="block w-full text-left px-3 py-2 text-sm hover:bg-slate-50">
            <div className="font-medium text-slate-900">Civil PDF</div>
            <div className="text-[11px] text-slate-500">AI-rendered, branded layout</div>
          </button>
          <button onClick={downloadOriginal} disabled={!hasOriginal}
            data-testid="swms-download-original"
            className="block w-full text-left px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed border-t border-slate-100">
            <div className="font-medium text-slate-900">Original document</div>
            <div className="text-[11px] text-slate-500">
              {hasOriginal ? doc.source_file.filename || 'Source .docx' : 'No original on file'}
            </div>
          </button>
        </div>
      )}
    </div>
  );
}

function DetailList({ title, items }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 mb-4">
      <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-2">{title} · {items.length}</div>
      {items.length === 0 ? <div className="text-sm text-slate-400 italic">None</div> : (
        <ul className="space-y-1 text-sm text-slate-700">{items.map((it, i) => <li key={i} className="flex gap-2"><span className="text-brand-blue">·</span>{it}</li>)}</ul>
      )}
    </div>
  );
}
