import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import api, { apiError } from '../lib/api';
import { getUser } from '../lib/auth';
import EmailButton from '../components/EmailButton';
import DeleteRecordButton from '../components/DeleteRecordButton';
import { useWorkspace, wsParams } from '../lib/workspace';
import { PageHeader, PrimaryButton, GhostButton, Field, inputClass, EmptyState } from '../components/capture/Ui';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/ui/tooltip';

// Phase 3.20 Wave 2 — fluent icons. Phase 3.23 adds a render-on-demand
// hint chip for any row missing its PDF or JSON sibling.
import {
  ArrowDownload20Regular as Download,
  Warning20Filled as WarnFill,
} from '@fluentui/react-icons';

const INCLUDE_OPTIONS = [
  ['swms', 'SWMS'], ['pre_starts', 'Pre-starts'], ['site_diary', 'Site diary'],
  ['hazards', 'Hazards'], ['incidents', 'Incidents'], ['inspections', 'Inspections'],
  ['contractors', 'Contractors'],
];

const BACKEND = process.env.REACT_APP_BACKEND_URL;

function fmtBytes(n) { if (!n) return '0 B'; const k = 1024, u = ['B', 'KB', 'MB', 'GB']; const i = Math.floor(Math.log(n) / Math.log(k)); return `${(n / Math.pow(k, i)).toFixed(1)} ${u[i]}`; }

// Phase 3.23 — group rows by composite key so PDF + JSON siblings render
// as a single row with inline download links. `scope` is critical to
// avoid cross-workspace collisions (e.g. "Quarterly Pack — All workspaces"
// vs "Quarterly Pack — Sydney Metro" would otherwise merge).
function groupKey(row) {
  return [row.title || '', row.date_from || '', row.date_to || '',
          row.scope || '', row.workspace_id || ''].join('|');
}

// PDF first (human-readable default for auditors), JSON next, CSV last.
const FORMAT_ORDER = { pdf: 0, json: 1, csv: 2 };

function buildGroups(items) {
  const map = new Map();
  for (const it of items) {
    const k = groupKey(it);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(it);
  }
  const groups = [];
  for (const formats of map.values()) {
    formats.sort((a, b) => (FORMAT_ORDER[a.format] ?? 9) - (FORMAT_ORDER[b.format] ?? 9));
    // The "primary" anchor is the first non-PDF row (the canonical data
    // artefact); fall back to whatever's first if the group is PDF-only.
    const primary = formats.find((f) => f.format !== 'pdf') || formats[0];
    const byFormat = Object.fromEntries(formats.map((f) => [f.format, f]));
    groups.push({
      key: groupKey(primary),
      primary,
      formats,
      byFormat,
      hasPdf: !!byFormat.pdf,
      hasJson: !!byFormat.json,
      hasCsv: !!byFormat.csv,
      totalBytes: formats.reduce((a, f) => a + (f.size_bytes || 0), 0),
    });
  }
  // Newest first by primary.created_at.
  groups.sort((a, b) => (b.primary.created_at || '').localeCompare(a.primary.created_at || ''));
  return groups;
}

function FormatLink({ row, primary }) {
  const isPrimary = row.format === primary;
  return (
    <a
      href={`${BACKEND}${row.file_url}`}
      target="_blank"
      rel="noreferrer"
      data-testid={`export-download-${row.format}-${row.id}`}
      className={
        isPrimary
          ? 'inline-flex items-center gap-1 font-semibold text-brand-blue hover:text-blue-700 uppercase'
          : 'inline-flex items-center gap-1 text-slate-500 hover:text-slate-700 uppercase'
      }
      title={`${row.format.toUpperCase()} · ${fmtBytes(row.size_bytes)}`}
    >
      {row.format}
    </a>
  );
}

function MissingFormatHint({ row, missing, isAdmin, onRendered }) {
  const [busy, setBusy] = useState(false);
  const render = async () => {
    if (!isAdmin) return;
    setBusy(true);
    try {
      const r = await api.post(`/audit-exports/${row.id}/render-pdf`);
      toast.success(`PDF rendered for "${row.title}"`);
      onRendered?.(r.data);
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={render}
            disabled={!isAdmin || busy || missing !== 'pdf'}
            data-testid={`export-missing-${missing}-${row.id}`}
            className="inline-flex items-center justify-center w-5 h-5 rounded-full text-amber-600 hover:text-amber-700 hover:bg-amber-50 disabled:opacity-60 disabled:cursor-not-allowed"
            aria-label={`${missing.toUpperCase()} unavailable`}
          >
            <WarnFill className="w-3.5 h-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs max-w-[220px]">
          {missing === 'pdf' && (isAdmin
            ? (busy ? 'Rendering PDF…' : 'PDF unavailable — click to render on demand')
            : 'PDF unavailable — ask an admin to regenerate')}
          {missing === 'json' && 'JSON source unavailable for this PDF — re-export from the source data to recreate.'}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export default function AuditExports() {
  const { workspaceId } = useWorkspace();
  const user = getUser();
  const isAdmin = user?.role === 'admin';
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

  const groups = useMemo(() => buildGroups(items), [items]);

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

  const onSiblingRendered = () => load();

  const removeGroup = async (group) => {
    // Sequential delete so we surface any partial failure clearly.
    setItems((prev) => prev.filter((x) => !group.formats.some((f) => f.id === x.id)));
  };

  return (
    <div className="max-w-6xl mx-auto" data-testid="audit-exports">
      <PageHeader crumb="Compliance / Audit Exports" title="Audit Exports"
        subtitle="Generate signed evidence packs for Comcare, SafeWork and client audits."
        action={<button onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-brand-blue text-white text-sm font-medium hover:bg-blue-600" data-testid="export-create-btn">+ New export</button>} />

      {groups.length === 0 ? <EmptyState title="No exports yet" body="Generate your first audit pack." />
       : (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-3">Title</th>
                <th className="text-left px-4 py-3">Period</th>
                <th className="text-left px-4 py-3">Formats</th>
                <th className="text-left px-4 py-3">Size</th>
                <th className="text-left px-4 py-3">SHA-256</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => {
                // Email/Delete uses the PDF (auditor-friendly) when present,
                // otherwise the canonical primary artefact.
                const anchor = g.byFormat.pdf || g.primary;
                return (
                  <tr key={g.key} className="border-t border-slate-100" data-testid={`export-row-${g.primary.id}`}>
                    <td className="px-4 py-3">
                      <div className="font-medium">{g.primary.title}</div>
                      <div className="text-xs text-slate-500">{g.primary.scope}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{g.primary.date_from} → {g.primary.date_to}</td>
                    <td className="px-4 py-3" data-testid={`export-formats-${g.primary.id}`}>
                      <div className="inline-flex items-center gap-2 text-xs font-semibold">
                        {g.formats.map((row, idx) => (
                          <React.Fragment key={row.id}>
                            {idx > 0 && <span className="text-slate-300">·</span>}
                            <FormatLink row={row} primary={g.primary.format} />
                          </React.Fragment>
                        ))}
                        {/* Missing-format hints — PDF first (admin can render),
                            JSON only as informational (cannot reconstruct). */}
                        {!g.hasPdf && (
                          <MissingFormatHint
                            row={g.primary}
                            missing="pdf"
                            isAdmin={isAdmin}
                            onRendered={onSiblingRendered}
                          />
                        )}
                        {g.hasPdf && !g.hasJson && !g.hasCsv && (
                          <MissingFormatHint row={g.primary} missing="json" isAdmin={isAdmin} />
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{fmtBytes(g.totalBytes)}</td>
                    <td className="px-4 py-3 text-slate-400 text-[10px] font-mono">{(g.primary.sha256 || '').slice(0, 12)}…</td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex gap-1 items-center">
                        <EmailButton
                          resourceKind="audit_exports"
                          recordId={anchor.id}
                          subject={`Audit Export: ${anchor.scope || anchor.title} (${anchor.date_from} to ${anchor.date_to})`}
                          body={`Please find attached the requested audit export for ${anchor.date_from} → ${anchor.date_to}.\n\nScope: ${anchor.scope || ''}\nFormat: ${(anchor.format || '').toUpperCase()}`}
                          attachments={g.formats.map((r) => ({ file_url: `${BACKEND}${r.file_url}`, label: `${r.title}.${r.format}` }))}
                          variant="row"
                          size="sm"
                          label="Email"
                        />
                        <DeleteRecordButton
                          resourceKind="audit_exports"
                          apiPath="audit-exports"
                          recordId={anchor.id}
                          label="Audit export"
                          recordTitle={anchor.title || anchor.scope}
                          onDeleted={() => removeGroup(g)}
                        />
                        <a href={`${BACKEND}${anchor.file_url}`} target="_blank" rel="noreferrer" data-testid={`export-download-${anchor.id}`}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-brand-ink text-white text-xs font-medium hover:bg-slate-800"><Download /> Download</a>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
       )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="export-modal" className="max-w-lg">
          <DialogHeader><DialogTitle className="font-display">New audit export</DialogTitle><DialogDescription>Includes all matching records in the date range. PDF sibling is generated automatically.</DialogDescription></DialogHeader>
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
            <p className="text-xs text-slate-500">JSON and CSV exports automatically generate a PDF sibling for human-readable auditor review.</p>
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
