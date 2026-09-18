/**
 * v58.13.132ic — Inductions panel: worker profile Inductions tab.
 *
 * Mirrors `LicencesPanel` structure (which mirrors `CertificationsPanel`
 * in `pages/Workers.jsx`). Filters `worker_certifications` to rows with
 * `category === 'site_induction'` — the same category `.132gv` writes
 * when the induction-matrix import + inductions cert-kinds engine
 * pick up an induction column.
 *
 * Columns: Name / Issuer / Issued / Expiry / Status / File / Actions.
 * Actions per row: Edit (opens shared `CertEditModal`), Delete (soft-
 * delete via `DELETE /workers/certifications/{cert_id}`). Full-panel
 * affordances: drop-zone upload + `+ Add induction` (creates a manual
 * row with `category: 'site_induction'` so the newly-created cert lands
 * in this list and not in Certifications).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, BookOpenCheck, ChevronDown, Edit3, Loader2, Plus,
  Trash2, UploadCloud,
} from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../../lib/api';
import { filesUrl } from '../../lib/downloadUrl';
import OpenAsPdfButton from '../OpenAsPdfButton';
import CertEditModal from '../certifications/CertEditModal';

function useCollapseState(storageKey) {
  const [open, setOpen] = useState(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw === null) return true;
      return raw === '1';
    } catch (_e) { return true; }
  });
  const toggle = () => {
    setOpen((prev) => {
      const next = !prev;
      try { window.localStorage.setItem(storageKey, next ? '1' : '0'); } catch (_e) { /* quota */ }
      return next;
    });
  };
  return [open, toggle];
}

function dayDiff(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return Math.floor((d.getTime() - Date.now()) / 86400000);
}

function expiryTone(iso) {
  const d = dayDiff(iso);
  if (d === null) return null;
  if (d < 0) return 'expired';
  if (d <= 30) return 'expiring';
  return 'valid';
}

function shortDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: '2-digit' });
  } catch (_) { return iso; }
}

function StatusBadgeCert({ status, tone }) {
  const cls = tone === 'expired' ? 'bg-[#fbe4e7] text-[#7a1f33]'
    : tone === 'expiring' ? 'bg-[#fef3c7] text-[#92400e]'
    : tone === 'valid' ? 'bg-[#d8ecdd] text-[#1f7a3f]'
    : 'bg-slate-100 text-slate-500';
  return (
    <span className={`inline-flex items-center text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded ${cls}`}>
      {status || 'unknown'}
    </span>
  );
}

// v58.13.132ic — `worker_certifications` rows for inductions carry
// `category: 'site_induction'`. We match on category first (preferred),
// then fall back to a name-substring heuristic for legacy rows that
// pre-date the category migration.
const INDUCTION_CATEGORY = 'site_induction';
const INDUCTION_NAME_RE = /\b(induction|orient(ation)?|site[\s-]*safety[\s-]*brief)\b/i;

export default function InductionsPanel({ workerId }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [open, toggle] = useCollapseState(`paneltec:inductions:open:${workerId}`);
  const [editing, setEditing] = useState(null);
  const fileInputRef = useRef(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/workers/${workerId}/certifications`);
      const all = Array.isArray(data) ? data : (data?.rows || data?.items || []);
      const inductionsOnly = all.filter((r) => {
        if ((r.category || '').toLowerCase() === INDUCTION_CATEGORY) return true;
        return INDUCTION_NAME_RE.test(r.name || '');
      });
      inductionsOnly.sort((a, b) => {
        const rank = { expired: 0, expiring: 1, valid: 2, [null]: 3 };
        return (rank[expiryTone(a.expiry_date)] ?? 3) - (rank[expiryTone(b.expiry_date)] ?? 3);
      });
      setRows(inductionsOnly);
    } catch (e) { toast.error(apiError(e)); }
    finally { setLoading(false); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [workerId]);

  const summary = useMemo(() => {
    const s = { total: rows.length, expired: 0, expiring: 0, valid: 0, missing: 0 };
    for (const r of rows) {
      const t = expiryTone(r.expiry_date);
      if (t) s[t] += 1;
      if (!r.doc_file_id) s.missing += 1;
    }
    return s;
  }, [rows]);

  const upload = async (fileList) => {
    if (!fileList || !fileList.length) return;
    setUploading(true);
    try {
      let lastCertId = null;
      for (const f of Array.from(fileList)) {
        const form = new FormData();
        form.append('file', f);
        // v58.13.132ic — Hint the backend that this upload belongs on
        // the Inductions tab. When the cert-kind engine can't classify
        // the filename it falls back to `category` from the form field
        // (see backend/workers.py::upload_certification).
        form.append('category', INDUCTION_CATEGORY);
        const { data } = await api.post(
          `/workers/${workerId}/certifications/upload`, form,
        );
        lastCertId = data?.cert?.id;
      }
      toast.success(`${fileList.length} induction${fileList.length === 1 ? '' : 's'} uploaded`);
      await load();
      if (lastCertId) setEditing(rows.find((r) => r.id === lastCertId) || { id: lastCertId });
    } catch (e) { toast.error(apiError(e)); }
    finally { setUploading(false); }
  };

  const addManual = async () => {
    try {
      const { data } = await api.post(`/workers/${workerId}/certifications`,
        { name: 'New induction', category: INDUCTION_CATEGORY });
      await load();
      setEditing(data);
    } catch (e) { toast.error(apiError(e)); }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) upload(e.dataTransfer.files);
  };

  const removeRow = async (r) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Delete "${r.name || 'induction'}"? Recoverable for 30 days.`)) return;
    try {
      await api.delete(`/workers/certifications/${r.id}`);
      toast.success(`${r.name || 'Induction'} removed`);
      await load();
    } catch (e) { toast.error(apiError(e)); }
  };

  const openOriginal = async (r) => {
    if (!r.doc_file_id) return;
    try {
      const u = await filesUrl(`/workers/${workerId}/certifications/${r.id}/file`);
      window.open(u, '_blank', 'noopener,noreferrer');
    } catch (_e) { toast.error('Unable to open file'); }
  };

  const SummaryPill = ({ tone, children, testid, title }) => {
    const map = {
      total:    'bg-slate-100 text-slate-700 border border-slate-200',
      simpro:   'bg-[#e6eff9] text-[#1e4a8c] border border-[#b9d2ec]',
      manual:   'bg-slate-100 text-slate-500 border border-slate-200',
      warn:     'bg-amber-50 text-amber-800 border border-amber-200',
      expired:  'bg-rose-100 text-rose-800 border border-rose-200',
      pending:  'bg-amber-100 text-amber-800 border border-amber-200',
      violet:   'bg-[#f5f3ff] text-[#5b21b6] border border-[#ddd6fe]',
    };
    const cls = map[tone || 'total'] || map.total;
    return (
      <span data-testid={testid} title={title}
        className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded ${cls}`}>
        {children}
      </span>
    );
  };

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden bg-white"
      data-testid="section-inductions">
      <button type="button"
        onClick={toggle}
        aria-expanded={open}
        data-testid="section-inductions-toggle"
        className="w-full flex items-center gap-2 px-4 py-2.5 bg-slate-50 border-b border-slate-100 flex-wrap text-left hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1e4a8c]/40">
        <BookOpenCheck size={14} className="text-slate-500" />
        <span className="text-sm font-semibold text-slate-800 mr-1">Inductions</span>
        {summary.total === 0 ? (
          <SummaryPill tone="manual" testid="inductions-panel-empty">No items</SummaryPill>
        ) : (
          <SummaryPill testid="inductions-panel-total">{summary.total} items</SummaryPill>
        )}
        {summary.missing > 0 && (
          <SummaryPill tone="warn" testid="inductions-panel-missing"
            title={`${summary.missing} induction(s) have no attached file`}>
            <AlertTriangle size={10} /> {summary.missing} missing file
          </SummaryPill>
        )}
        {summary.expired > 0 && (
          <SummaryPill tone="expired" testid="inductions-panel-expired">
            {summary.expired} expired
          </SummaryPill>
        )}
        {summary.expiring > 0 && (
          <SummaryPill tone="pending" testid="inductions-panel-expiring">
            {summary.expiring} expiring
          </SummaryPill>
        )}
        <ChevronDown size={14}
          className={`text-slate-400 transition-transform ml-auto ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
      <div className="px-4 py-4 border-t border-slate-200 space-y-3" data-testid="section-inductions-body">
        {/* Drop-zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          data-testid="induction-dropzone"
          className={`cursor-pointer rounded-xl border-2 border-dashed px-4 py-5 text-center transition-colors ${
            dragOver ? 'border-[#5b21b6] bg-[#f5f3ff]' : 'border-[#ddd6fe] bg-[#f5f3ff]/40 hover:bg-[#f5f3ff]'
          }`}
        >
          <UploadCloud size={22} className="mx-auto text-[#5b21b6] mb-1.5" />
          <div className="text-sm font-medium text-[#5b21b6]">
            {uploading ? 'Uploading…' : 'Drop a new induction here (creates a new row)'}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            For inductions not already in the list. Up to 50MB. PDF / JPG / PNG.
          </div>
          <input
            ref={fileInputRef} type="file" multiple
            accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
            onChange={(e) => upload(e.target.files)}
            className="hidden" data-testid="induction-file-input"
          />
        </div>

        <div className="flex justify-end">
          <button type="button" onClick={addManual} data-testid="induction-add-manual"
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50">
            <Plus size={12} /> Add induction (no file)
          </button>
        </div>

        {loading ? (
          <div className="text-sm text-slate-500 inline-flex items-center gap-2">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center py-6 text-sm text-slate-400 italic" data-testid="inductions-empty">
            No inductions recorded yet.
          </div>
        ) : (
          <div className="border border-slate-200 rounded-lg overflow-x-auto">
            <table className="zebra-list w-full text-xs" data-testid="inductions-table">
              <thead className="bg-slate-50 text-slate-500 text-[10px] uppercase tracking-wider">
                <tr>
                  <th className="text-left px-3 py-2">Name</th>
                  <th className="text-left px-3 py-2 hidden md:table-cell">Issuer</th>
                  <th className="text-left px-3 py-2 hidden lg:table-cell whitespace-nowrap">Issued</th>
                  <th className="text-left px-3 py-2 whitespace-nowrap">Expiry</th>
                  <th className="text-left px-3 py-2 whitespace-nowrap">Status</th>
                  <th className="text-center px-3 py-2 w-12">File</th>
                  <th className="px-3 py-2 w-24"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const tone = expiryTone(r.expiry_date);
                  const d = dayDiff(r.expiry_date);
                  const statusLabel = tone === 'expired' ? `Expired ${-d}d ago`
                    : tone === 'expiring' ? `Expires in ${d}d`
                    : tone === 'valid' ? 'Valid'
                    : 'No expiry';
                  return (
                    <tr key={r.id}
                      className="border-t border-slate-100"
                      data-testid={`induction-row-${r.id}`}
                      data-expiry-tone={tone || 'none'}>
                      <td className="px-3 py-2 font-semibold text-slate-900 break-words max-w-[220px]">
                        {r.name || '—'}
                      </td>
                      <td className="px-3 py-2 text-slate-600 hidden md:table-cell break-words max-w-[180px]">
                        {r.issuer || '—'}
                      </td>
                      <td className="px-3 py-2 text-slate-500 hidden lg:table-cell whitespace-nowrap">
                        {shortDate(r.issue_date)}
                      </td>
                      <td className="px-3 py-2 text-slate-500 whitespace-nowrap">
                        {shortDate(r.expiry_date)}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <StatusBadgeCert status={statusLabel} tone={tone} />
                      </td>
                      <td className="px-3 py-2 text-center">
                        {r.doc_file_id ? (
                          <OpenAsPdfButton
                            source="cert_file"
                            refObj={{ worker_id: workerId, cert_id: r.id }}
                            filename={r.name || 'induction'}
                            onDownloadOriginal={() => openOriginal(r)}
                            variant="icon"
                            data-testid={`induction-file-${r.id}`}
                            className="!bg-[#f5f3ff] !text-[#5b21b6] hover:!bg-[#ede9fe] !w-6 !h-6"
                          />
                        ) : (
                          <span className="text-[10px] text-slate-400 italic" title="no file">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <button type="button"
                            onClick={() => setEditing(r)}
                            data-testid={`induction-edit-${r.id}`}
                            title="Edit induction"
                            className="inline-flex items-center justify-center w-6 h-6 rounded bg-[#f5f3ff] text-[#5b21b6] hover:bg-[#ede9fe]">
                            <Edit3 size={13} />
                          </button>
                          <button type="button"
                            onClick={() => removeRow(r)}
                            data-testid={`induction-delete-${r.id}`}
                            title="Delete induction (30-day recoverable)"
                            className="inline-flex items-center justify-center w-6 h-6 rounded bg-rose-50 text-rose-700 hover:bg-rose-100">
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      )}
      {editing && (
        <CertEditModal
          cert={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}
