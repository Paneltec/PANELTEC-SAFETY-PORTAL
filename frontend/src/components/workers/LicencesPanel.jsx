/**
 * v58.13.132fi — Licences panel: filtered view over worker_certifications.
 *
 * v58.13.132hx — Layout aligned with the Certifications tab. Columns
 * mirror `CertificationsPanel` in `pages/Workers.jsx` exactly:
 *   Name · Issuer · Issued · Expiry · Status · File · Actions
 * Header summary pills swapped to the same `EditSummaryPill`-style
 * chips the Certifications panel uses (total / expired / expiring)
 * so the two sections read as siblings, not cousins. Retains the
 * licence-family filter over `/workers/{id}/certifications`.
 *
 * v58.13.132ic — Feature-parity with Certifications:
 *   · Drop-zone upload + `+ Add licence (no file)` button.
 *   · Per-row soft-delete (30-day recoverable via
 *     `DELETE /workers/certifications/{cert_id}`).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, ChevronDown, Edit3, IdCard, Loader2, Plus, RotateCcw,
  Trash2, UploadCloud, Archive as ArchiveIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../../lib/api';
import { filesUrl } from '../../lib/downloadUrl';
import OpenAsPdfButton from '../OpenAsPdfButton';
import CertEditModal from '../certifications/CertEditModal';
import {
  splitByArchived, useArchivedOpen, archiveCert, restoreCert,
} from '../../lib/certArchiveHelpers';

// v58.13.132hp — localStorage-per-user persistence for the panel
// open/closed state. Keyed on workerId so each profile remembers
// its own choice. Falls back to `true` (open) on first mount.
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

// Kept in sync with backend/cert_kinds.py — licence-family slugs.
const LICENCE_SLUGS = new Set([
  'hr_licence', 'mr_licence', 'ewp_licence', 'forklift_licence',
  'working_at_heights', 'first_aid', 'white_card', 'trade_certificate',
  'drivers_licence',
]);

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

// v58.13.132hx — Match the Certifications tab formatting exactly.
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

export default function LicencesPanel({ workerId }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [open, toggle] = useCollapseState(`paneltec:licences:open:${workerId}`);
  const [archivedOpen, toggleArchived] = useArchivedOpen('licences', workerId);
  const [editing, setEditing] = useState(null);
  const fileInputRef = useRef(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/workers/${workerId}/certifications`);
      const all = Array.isArray(data) ? data : (data?.rows || data?.items || []);
      const licencesOnly = all.filter((r) => {
        const slug = (r.cert_kind_slug || r.cert_kind || '').toLowerCase();
        const name = (r.name || '').toLowerCase();
        return LICENCE_SLUGS.has(slug) || /licen[cs]e|ticket|white card/.test(name);
      });
      // Sort: expired first (most urgent), then expiring, then valid.
      licencesOnly.sort((a, b) => {
        const rank = { expired: 0, expiring: 1, valid: 2, [null]: 3 };
        return (rank[expiryTone(a.expiry_date)] ?? 3) - (rank[expiryTone(b.expiry_date)] ?? 3);
      });
      setRows(licencesOnly);
    } catch (e) { toast.error(apiError(e)); }
    finally { setLoading(false); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [workerId]);

  const summary = useMemo(() => {
    // v58.13.132ie — Only ACTIVE rows count toward the header pills.
    const active = rows.filter((r) => !r.archived_at);
    const s = { total: active.length, expired: 0, expiring: 0, valid: 0, missing: 0 };
    for (const r of active) {
      const t = expiryTone(r.expiry_date);
      if (t) s[t] += 1;
      if (!r.doc_file_id) s.missing += 1;
    }
    s.archived = rows.length - active.length;
    return s;
  }, [rows]);

  const openOriginal = async (r) => {
    if (!r.doc_file_id) return;
    try {
      const u = await filesUrl(`/workers/${workerId}/certifications/${r.id}/file`);
      window.open(u, '_blank', 'noopener,noreferrer');
    } catch (_e) { toast.error('Unable to open file'); }
  };

  // v58.13.132ie — Row renderer shared between active + archived tables.
  const renderRow = (r, isArchived) => {
    const tone = expiryTone(r.expiry_date);
    const d = dayDiff(r.expiry_date);
    const statusLabel = tone === 'expired' ? `Expired ${-d}d ago`
      : tone === 'expiring' ? `Expires in ${d}d`
      : tone === 'valid' ? 'Valid'
      : 'No expiry';
    return (
      <tr key={r.id}
        className={`border-t border-slate-100 ${isArchived ? 'opacity-75' : ''}`}
        data-testid={`licence-row-${r.id}`}
        data-archived={isArchived ? 'true' : 'false'}
        data-expiry-tone={tone || 'none'}>
        <td className="px-3 py-2 font-semibold text-slate-900 break-words max-w-[220px]">
          {r.name || '—'}
          {r.licence_number && (
            <div className="text-[10px] text-slate-500 font-mono mt-0.5">
              #{r.licence_number}
            </div>
          )}
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
              filename={r.name || 'certificate'}
              onDownloadOriginal={() => openOriginal(r)}
              variant="icon"
              data-testid={`licence-file-${r.id}`}
              className="!bg-[#e6eff9] !text-[#1e4a8c] hover:!bg-[#d8e6f4] !w-6 !h-6"
            />
          ) : (
            <span className="text-[10px] text-slate-400 italic" title="no file">—</span>
          )}
        </td>
        <td className="px-3 py-2 text-right whitespace-nowrap">
          <div className="inline-flex items-center gap-1">
            <button type="button"
              onClick={() => setEditing(r)}
              data-testid={`licence-edit-${r.id}`}
              title="Edit licence"
              className="inline-flex items-center justify-center w-6 h-6 rounded bg-[#e6eff9] text-[#1e4a8c] hover:bg-[#d8e6f4]">
              <Edit3 size={13} />
            </button>
            {isArchived ? (
              <button type="button"
                onClick={() => restoreCert(r, load)}
                data-testid={`licence-restore-${r.id}`}
                title="Restore to active"
                className="inline-flex items-center justify-center w-6 h-6 rounded bg-emerald-50 text-emerald-700 hover:bg-emerald-100">
                <RotateCcw size={12} />
              </button>
            ) : (
              <button type="button"
                onClick={() => archiveCert(r, load)}
                data-testid={`licence-archive-${r.id}`}
                title="Archive (keep for compliance audit, hide from active list)"
                className="inline-flex items-center justify-center w-6 h-6 rounded bg-slate-100 text-slate-600 hover:bg-slate-200">
                <ArchiveIcon size={12} />
              </button>
            )}
            <button type="button"
              onClick={() => removeRow(r)}
              data-testid={`licence-delete-${r.id}`}
              title="Delete licence (30-day recoverable)"
              className="inline-flex items-center justify-center w-6 h-6 rounded bg-rose-50 text-rose-700 hover:bg-rose-100">
              <Trash2 size={12} />
            </button>
          </div>
        </td>
      </tr>
    );
  };

  // v58.13.132ic — Feature-parity with Certifications tab: upload,
  // manual-add, and soft-delete land per-row here too. All three
  // hit the shared `/workers/{id}/certifications*` endpoints — the
  // panel filters by licence-family slug at render time, so a
  // newly-uploaded licence appears here immediately when its
  // classified slug lands in `LICENCE_SLUGS`.
  const upload = async (fileList) => {
    if (!fileList || !fileList.length) return;
    setUploading(true);
    try {
      let lastCertId = null;
      for (const f of Array.from(fileList)) {
        const form = new FormData();
        form.append('file', f);
        // Hint the classifier so an ambiguous filename lands on the
        // Licences tab rather than a generic Certifications bucket.
        form.append('category', 'license');
        const { data } = await api.post(
          `/workers/${workerId}/certifications/upload`, form,
        );
        lastCertId = data?.cert?.id;
      }
      toast.success(`${fileList.length} licence${fileList.length === 1 ? '' : 's'} uploaded`);
      await load();
      if (lastCertId) setEditing(rows.find((r) => r.id === lastCertId) || { id: lastCertId });
    } catch (e) { toast.error(apiError(e)); }
    finally { setUploading(false); }
  };
  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) upload(e.dataTransfer.files);
  };
  const addManual = async () => {
    try {
      const { data } = await api.post(`/workers/${workerId}/certifications`,
        { name: 'New licence', category: 'license' });
      await load();
      setEditing(data);
    } catch (e) { toast.error(apiError(e)); }
  };
  const removeRow = async (r) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Delete "${r.name || 'licence'}"? Recoverable for 30 days.`)) return;
    try {
      await api.delete(`/workers/certifications/${r.id}`);
      toast.success(`${r.name || 'Licence'} removed`);
      await load();
    } catch (e) { toast.error(apiError(e)); }
  };

  // v58.13.132hx — Header summary pills mirror the Certifications tab
  // treatment (`EditSummaryPill` style). Kept inline here (rather than
  // importing) to avoid a cross-file coupling — the shape is 4 lines,
  // and any drift in the Cert panel is a source-pin candidate for the
  // ship pytest, not a runtime problem.
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
      data-testid="section-licences">
      <button type="button"
        onClick={toggle}
        aria-expanded={open}
        data-testid="section-licences-toggle"
        className="w-full flex items-center gap-2 px-4 py-2.5 bg-slate-50 border-b border-slate-100 flex-wrap text-left hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1e4a8c]/40">
        <IdCard size={14} className="text-slate-500" />
        <span className="text-sm font-semibold text-slate-800 mr-1">Licences</span>
        {summary.total === 0 ? (
          <SummaryPill tone="manual" testid="licences-panel-empty">No items</SummaryPill>
        ) : (
          <SummaryPill testid="licences-panel-total">{summary.total} items</SummaryPill>
        )}
        {summary.missing > 0 && (
          <SummaryPill tone="warn" testid="licences-panel-missing"
            title={`${summary.missing} licence(s) have no attached file`}>
            <AlertTriangle size={10} /> {summary.missing} missing file
          </SummaryPill>
        )}
        {summary.expired > 0 && (
          <SummaryPill tone="expired" testid="licences-panel-expired">
            {summary.expired} expired
          </SummaryPill>
        )}
        {summary.expiring > 0 && (
          <SummaryPill tone="pending" testid="licences-panel-expiring">
            {summary.expiring} expiring
          </SummaryPill>
        )}
        <ChevronDown size={14}
          className={`text-slate-400 transition-transform ml-auto ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
      <div className="px-4 py-4 border-t border-slate-200 space-y-3" data-testid="section-licences-body">
        {/* v58.13.132ic — Drop-zone + Add button (Certifications parity). */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          data-testid="licence-dropzone"
          className={`cursor-pointer rounded-xl border-2 border-dashed px-4 py-5 text-center transition-colors ${
            dragOver ? 'border-[#1e4a8c] bg-[#e6eff9]' : 'border-[#b9d2ec] bg-[#e6eff9]/40 hover:bg-[#e6eff9]'
          }`}
        >
          <UploadCloud size={22} className="mx-auto text-[#1e4a8c] mb-1.5" />
          <div className="text-sm font-medium text-[#1e4a8c]">
            {uploading ? 'Uploading…' : 'Drop a new licence here (creates a new row)'}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            For licences not already in the list. Up to 50MB. PDF / JPG / PNG.
          </div>
          <input
            ref={fileInputRef} type="file" multiple
            accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
            onChange={(e) => upload(e.target.files)}
            className="hidden" data-testid="licence-file-input"
          />
        </div>

        <div className="flex justify-end">
          <button type="button" onClick={addManual} data-testid="licence-add-manual"
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50">
            <Plus size={12} /> Add licence (no file)
          </button>
        </div>

        {loading ? (
          <div className="text-sm text-slate-500 inline-flex items-center gap-2">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </div>
        ) : (() => {
          // v58.13.132ie — Split rows into Active + Archived buckets.
          const { active: activeRows, archived: archivedRows } = splitByArchived(rows);
          return (
            <>
              {activeRows.length === 0 ? (
                <div className="text-center py-6 text-sm text-slate-400 italic" data-testid="licences-empty">
                  No active licences. Add one above.
                </div>
              ) : (
                <div className="border border-slate-200 rounded-lg overflow-x-auto">
                  <table className="zebra-list w-full text-xs" data-testid="licences-table">
                    <thead className="bg-slate-50 text-slate-500 text-[10px] uppercase tracking-wider">
                      <tr>
                        <th className="text-left px-3 py-2">Name</th>
                        <th className="text-left px-3 py-2 hidden md:table-cell">Issuer</th>
                        <th className="text-left px-3 py-2 hidden lg:table-cell whitespace-nowrap">Issued</th>
                        <th className="text-left px-3 py-2 whitespace-nowrap">Expiry</th>
                        <th className="text-left px-3 py-2 whitespace-nowrap">Status</th>
                        <th className="text-center px-3 py-2 w-12">File</th>
                        <th className="px-3 py-2 w-28"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeRows.map((r) => renderRow(r, false))}
                    </tbody>
                  </table>
                </div>
              )}

              {archivedRows.length > 0 && (
                <div className="mt-3 border border-slate-200 rounded-lg overflow-hidden"
                     data-testid="section-licences-archived">
                  <button type="button" onClick={toggleArchived}
                    data-testid="section-licences-archived-toggle"
                    className="w-full flex items-center gap-2 px-3 py-2 bg-slate-50 hover:bg-slate-100 border-b border-slate-100 text-left">
                    <ArchiveIcon size={12} className="text-slate-500" />
                    <span className="text-xs font-semibold text-slate-700">
                      Archived · {archivedRows.length}
                    </span>
                    <span className="ml-1 text-[10px] text-slate-400">
                      (expired licences kept for compliance audit)
                    </span>
                    <ChevronDown size={12}
                      className={`text-slate-400 transition-transform ml-auto ${archivedOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {archivedOpen && (
                    <div className="overflow-x-auto" data-testid="section-licences-archived-body">
                      <table className="zebra-list w-full text-xs">
                        <thead className="bg-white text-slate-400 text-[10px] uppercase tracking-wider">
                          <tr>
                            <th className="text-left px-3 py-2">Name</th>
                            <th className="text-left px-3 py-2 hidden md:table-cell">Issuer</th>
                            <th className="text-left px-3 py-2 hidden lg:table-cell whitespace-nowrap">Issued</th>
                            <th className="text-left px-3 py-2 whitespace-nowrap">Expired</th>
                            <th className="text-left px-3 py-2 whitespace-nowrap">Status</th>
                            <th className="text-center px-3 py-2 w-12">File</th>
                            <th className="px-3 py-2 w-28"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {archivedRows.map((r) => renderRow(r, true))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </>
          );
        })()}
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
