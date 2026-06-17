import React, { useEffect, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../lib/api';
import EmailButton from '../components/EmailButton';
import { useWorkspace, wsParams } from '../lib/workspace';
import { PageHeader, PrimaryButton, GhostButton, Field, inputClass, EmptyState } from '../components/capture/Ui';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';

const INCLUDE_OPTIONS = [
  ['swms', 'SWMS'], ['pre_starts', 'Pre-starts'], ['site_diary', 'Site diary'],
  ['hazards', 'Hazards'], ['incidents', 'Incidents'], ['inspections', 'Inspections'],
  ['contractors', 'Contractors'],
];

const BACKEND = process.env.REACT_APP_BACKEND_URL;

function fmtBytes(n) { if (!n) return '0 B'; const k = 1024, u = ['B', 'KB', 'MB', 'GB']; const i = Math.floor(Math.log(n) / Math.log(k)); return `${(n / Math.pow(k, i)).toFixed(1)} ${u[i]}`; }

export default function AuditExports() {
  const { workspaceId } = useWorkspace();
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const today = new Date().toISOString().slice(0, 10);
  const ninetyAgo = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  const [form, setForm] = useState({
    title: '', date_from: ninetyAgo, date_to: today,
    include: INCLUDE_OPTIONS.map(([k]) => k), format: 'pdf',
  });

  const load = () => api.get('/audit-exports').then((r) => setItems(r.data));
  useEffect(() => { load(); }, []);

  const toggleInclude = (k) => setForm((f) => ({ ...f, include: f.include.includes(k) ? f.include.filter((x) => x !== k) : [...f.include, k] }));

  const generate = async () => {
    if (form.include.length === 0) { toast.error('Select at least one entity'); return; }
    setBusy(true);
    try {
      const payload = { ...form, ...wsParams(workspaceId) };
      await api.post('/audit-exports', payload);
      toast.success('Export generated');
      setOpen(false);
      load();
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="max-w-6xl mx-auto" data-testid="audit-exports">
      <PageHeader crumb="Compliance / Audit Exports" title="Audit Exports"
        subtitle="Generate signed evidence packs for Comcare, SafeWork and client audits."
        action={<button onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-brand-blue text-white text-sm font-medium hover:bg-blue-600" data-testid="export-create-btn">+ New export</button>} />

      {items.length === 0 ? <EmptyState title="No exports yet" body="Generate your first audit pack." />
       : (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider"><tr><th className="text-left px-4 py-3">Title</th><th className="text-left px-4 py-3">Period</th><th className="text-left px-4 py-3">Format</th><th className="text-left px-4 py-3">Size</th><th className="text-left px-4 py-3">SHA-256</th><th className="px-4 py-3"></th></tr></thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} className="border-t border-slate-100" data-testid={`export-row-${it.id}`}>
                  <td className="px-4 py-3"><div className="font-medium">{it.title}</div><div className="text-xs text-slate-500">{it.scope}</div></td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{it.date_from} → {it.date_to}</td>
                  <td className="px-4 py-3 uppercase text-xs font-semibold text-brand-blue">{it.format}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{fmtBytes(it.size_bytes)}</td>
                  <td className="px-4 py-3 text-slate-400 text-[10px] font-mono">{(it.sha256 || '').slice(0, 12)}…</td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex gap-1 items-center">
                      <EmailButton
                        resourceKind="audit_exports"
                        recordId={it.id}
                        subject={`Audit Export: ${it.scope || it.title} (${it.date_from} to ${it.date_to})`}
                        body={`Please find attached the requested audit export for ${it.date_from} → ${it.date_to}.\n\nScope: ${it.scope || ''}\nFormat: ${(it.format || '').toUpperCase()}`}
                        attachments={[{ file_url: `${BACKEND}${it.file_url}`, label: `${it.title}.${it.format}` }]}
                        variant="row"
                        size="sm"
                        label="Email"
                      />
                      <a href={`${BACKEND}${it.file_url}`} target="_blank" rel="noreferrer" data-testid={`export-download-${it.id}`}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-brand-ink text-white text-xs font-medium hover:bg-slate-800"><Download size={12} /> Download</a>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
       )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="export-modal" className="max-w-lg">
          <DialogHeader><DialogTitle className="font-display">New audit export</DialogTitle><DialogDescription>Includes all matching records in the date range.</DialogDescription></DialogHeader>
          <div className="space-y-3 pt-2">
            <Field label="Title (optional)"><input className={inputClass} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Q2 SafeWork audit pack" data-testid="export-title" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="From"><input type="date" className={inputClass} value={form.date_from} onChange={(e) => setForm({ ...form, date_from: e.target.value })} data-testid="export-date-from" /></Field>
              <Field label="To"><input type="date" className={inputClass} value={form.date_to} onChange={(e) => setForm({ ...form, date_to: e.target.value })} data-testid="export-date-to" /></Field>
            </div>
            <Field label="Include">
              <div className="grid grid-cols-2 gap-1 mt-1">
                {INCLUDE_OPTIONS.map(([k, l]) => (
                  <label key={k} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={form.include.includes(k)} onChange={() => toggleInclude(k)} data-testid={`export-include-${k}`} /> {l}
                  </label>
                ))}
              </div>
            </Field>
            <Field label="Format">
              <div className="flex gap-2 mt-1">
                {['pdf', 'csv', 'json'].map((f) => (
                  <label key={f} className={`px-3 py-1.5 rounded-lg border text-xs font-semibold uppercase cursor-pointer ${form.format === f ? 'bg-brand-blue text-white border-brand-blue' : 'border-slate-300 text-slate-600'}`}>
                    <input type="radio" name="format" className="hidden" checked={form.format === f} onChange={() => setForm({ ...form, format: f })} data-testid={`export-format-${f}`} /> {f === 'csv' ? 'CSV (ZIP)' : f}
                  </label>
                ))}
              </div>
            </Field>
          </div>
          <DialogFooter>
            <GhostButton onClick={() => setOpen(false)}>Cancel</GhostButton>
            <PrimaryButton onClick={generate} busy={busy} testid="export-generate">{busy ? 'Generating…' : 'Generate export'}</PrimaryButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
