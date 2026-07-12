// Global Certifications view — Settings → Certifications.
// Lists every cert across every worker in the org with status filter chips,
// search, CSV export, and the same Send Reminder action available in the
// Worker edit modal.
import React, { useEffect, useMemo, useState } from 'react';
import { Award, ClipboardList, Loader2, ArrowUpDown, ArrowUp, ArrowDown, FileText, FileWarning, Package } from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../lib/api';
import { getUser } from '../lib/auth';
import { PageHeader } from '../components/capture/Ui';
// Phase 4.17 v134.2 — Dashboard/List tabs.
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import ModuleDashboard from '../components/dashboards/ModuleDashboard';
import PdfPreviewModal from '../components/PdfPreviewModal';
import CertEditModal from '../components/certifications/CertEditModal';
import CertDeleteConfirm from '../components/certifications/CertDeleteConfirm';

// Phase 3.20 Wave 2 — lucide row-action/toolbar icons swapped
// to @fluentui/react-icons. Aliased back to the original lucide
// names so existing JSX call sites don't need to change.
import {
  ArrowDownload20Regular as Download,
  Delete20Regular as Trash2,
  Edit20Regular as Pencil,
  Eye20Regular as Eye,
  Mail20Regular as Mail,
  Search20Regular as Search,
} from '@fluentui/react-icons';

const WRITE_ROLES = new Set(['admin', 'hseq_lead']);

const STATUS_FILTERS = [
  { key: 'all',           label: 'All',            cls: 'bg-slate-100 text-slate-700' },
  { key: 'expired',       label: 'Expired',        cls: 'bg-[#f7d8dc] text-[#a8324c]' },
  { key: 'expiring_soon', label: 'Expiring soon',  cls: 'bg-[#f7eed1] text-[#8c6a1a]' },
  { key: 'missing_file',  label: 'Missing file',   cls: 'bg-[#f7eed1] text-[#8c6a1a]' },
  { key: 'valid',         label: 'Valid',          cls: 'bg-[#d8ecdd] text-[#1f7a3f]' },
  { key: 'no_expiry',     label: 'No expiry',      cls: 'bg-[#d8e6f4] text-[#1e4a8c]' },
];

const STATUS_RANK = { expired: 0, expiring_soon: 1, missing_file: 2, valid: 3, no_expiry: 4 };

const STATUS_CHIP = {
  valid:         'bg-[#d8ecdd] text-[#1f7a3f] border-[#b6dcbf]',
  expiring_soon: 'bg-[#f7eed1] text-[#8c6a1a] border-[#e6d995]',
  expired:       'bg-[#f7d8dc] text-[#a8324c] border-[#e69aa3]',
  no_expiry:     'bg-[#d8e6f4] text-[#1e4a8c] border-[#b9d2ec]',
  missing_file:  'bg-[#f7eed1] text-[#8c6a1a] border-[#e6d995]',
};

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// v160.3.6f — Div-based sort header (twin of Workers page SortHeaderBtn).
// Reused across the org-wide Certifications list so the grid row + header
// share one gridTemplateColumns string.
function SortHeaderBtn({ label, k, sortKey, sortDir, onClick, title, align = 'left' }) {
  const active = sortKey === k;
  const Icon = !active ? ArrowUpDown : sortDir === 'desc' ? ArrowDown : ArrowUp;
  return (
    <button
      type="button"
      data-testid={`cert-sort-${k}`}
      onClick={() => onClick(k)}
      title={title || `Sort by ${label.toLowerCase()}`}
      className={
        'inline-flex items-center gap-1 uppercase tracking-wider text-[10px] font-semibold ' +
        (align === 'right' ? 'justify-end ' : '') +
        (active ? 'text-[#1e4a8c]' : 'text-slate-500 hover:text-slate-700')
      }
    >
      {label}
      <Icon size={10} className={active ? '' : 'opacity-50'} />
    </button>
  );
}

// v160.3.6f — client-side "days until expiry" derivation. Used to render
// a compact relative-time chip next to the raw ISO date so admins can
// eyeball urgency without doing the maths.
function daysUntilExpiry(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffMs = d.setHours(0, 0, 0, 0) - today.getTime();
  return Math.round(diffMs / 86400000);
}

function exportCsv(rows) {
  const headers = ['worker', 'name', 'issuer', 'issue_date', 'expiry_date', 'status', 'seed_folder'];
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push([
      `${r.worker_first_name} ${r.worker_last_name}`.trim(),
      r.name, r.issuer || '', r.issue_date || '', r.expiry_date || '',
      r.status?.key || '', r.doc_seed_folder || '',
    ].map(csvCell).join(','));
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `certifications-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

export default function Certifications() {
  const user = getUser();
  const canEdit = WRITE_ROLES.has(user?.role);
  const isAdmin = user?.role === 'admin';
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [sendingId, setSendingId] = useState(null);
  // v160.3.6f — sortable column state. Default is `attention` (status
  // rank first, then expiry) — preserves the pre-6f behaviour so the
  // "compliance attention queue" reads the same on page load.
  const [sortKey, setSortKey] = useState('attention');
  const [sortDir, setSortDir] = useState('asc');
  const toggleSort = (k) => {
    if (sortKey === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(k); setSortDir('asc'); }
  };
  // Phase 3.17 — row actions
  const [previewCert, setPreviewCert] = useState(null);   // 👁  View PDF
  const [editCert, setEditCert] = useState(null);         // ✏️ Edit
  const [deleteCert, setDeleteCert] = useState(null);     // 🗑 Delete (admin)

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/workers/certifications/all');
      setRows(data || []);
    } catch (e) { toast.error(apiError(e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const counts = useMemo(() => {
    const c = { all: rows.length, expired: 0, expiring_soon: 0, missing_file: 0, valid: 0, no_expiry: 0 };
    for (const r of rows) {
      const k = r.status?.key;
      if (k && k in c) c[k]++;
    }
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const ranked = rows
      .filter((r) => filter === 'all' ? true : r.status?.key === filter)
      .filter((r) => {
        if (!q) return true;
        const blob = `${r.worker_first_name} ${r.worker_last_name} ${r.name} ${r.issuer || ''} ${r.doc_seed_folder || ''}`.toLowerCase();
        return blob.includes(q);
      });
    // v160.3.6f — pluggable sort. `attention` = pre-existing status-rank
    // + expiry compound ordering; the rest are per-column simple sorts.
    const dir = sortDir === 'desc' ? -1 : 1;
    const cmp = (a, b, get) => {
      const va = get(a), vb = get(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    };
    const sorted = ranked.slice();
    if (sortKey === 'attention') {
      sorted.sort((a, b) => {
        const ra = STATUS_RANK[a.status?.key] ?? 9;
        const rb = STATUS_RANK[b.status?.key] ?? 9;
        if (ra !== rb) return (ra - rb) * dir;
        return ((a.expiry_date || 'z').localeCompare(b.expiry_date || 'z')) * dir;
      });
    } else if (sortKey === 'worker') {
      sorted.sort((a, b) => cmp(a, b, (r) => `${r.worker_last_name || ''} ${r.worker_first_name || ''}`.trim().toLowerCase()));
    } else if (sortKey === 'cert') {
      sorted.sort((a, b) => cmp(a, b, (r) => (r.name || '').toLowerCase()));
    } else if (sortKey === 'expiry') {
      sorted.sort((a, b) => cmp(a, b, (r) => r.expiry_date || null));
    } else if (sortKey === 'status') {
      sorted.sort((a, b) => cmp(a, b, (r) => STATUS_RANK[r.status?.key] ?? 9));
    } else if (sortKey === 'source') {
      sorted.sort((a, b) => cmp(a, b, (r) => (r.doc_seed_folder ? `1_${r.doc_seed_folder}` : '2_manual')));
    }
    return sorted;
  }, [rows, filter, search, sortKey, sortDir]);

  const sendReminder = async (cert) => {
    setSendingId(cert.id);
    try {
      const { data } = await api.post(`/workers/certifications/${cert.id}/send-reminder`);
      const sms = (data.sms_to || []).length;
      const email = (data.email_to || []).length;
      toast.success(`Reminder sent · ${email} email${email === 1 ? '' : 's'}${sms ? ` + ${sms} SMS` : ''}`);
    } catch (e) { toast.error(apiError(e)); }
    finally { setSendingId(null); }
  };

  return (
    <div className="max-w-7xl mx-auto" data-testid="certifications-page">
      <PageHeader crumb="Settings / Certifications" title="Certifications"
        subtitle="Every certification across your crew, ranked by what needs attention." />

      {/* Butter banner */}
      <div className="mb-5 rounded-2xl border border-[#e6d995] bg-[#fffaeb] px-4 py-3 flex items-center gap-3"
        data-testid="cert-banner">
        <div className="rounded-xl bg-[#f7eed1] p-2.5"><ClipboardList size={20} className="text-[#8c6a1a]" /></div>
        <div className="flex-1">
          <div className="text-sm font-semibold text-[#5c4810]">Compliance attention queue</div>
          <div className="text-xs text-[#7a611a] mt-0.5">Expired, expiring-soon and missing-file certs are listed first.
            Use Send Reminder to nudge admins immediately, or wait for the daily auto-reminder.</div>
        </div>
      </div>

      <Tabs defaultValue="dashboard" className="mt-2" data-testid="certifications-tabs">
        <TabsList className="bg-slate-100 border border-slate-200">
          <TabsTrigger value="dashboard" data-testid="certifications-tab-dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="list" data-testid="certifications-tab-list">
            List <span className="ml-1.5 text-[10px] text-slate-500 tabular-nums">{rows.length}</span>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="dashboard" className="mt-4" data-testid="certifications-tab-dashboard-content">
          <ModuleDashboard
            module="certifications" title="Certifications"
            tagline="Every certification across your crew — ranked by what's expiring or expired."
            moduleColour="amber"
            quickActions={[{ label: 'View list', route: '/app/certifications' }]}
          />
        </TabsContent>
        <TabsContent value="list" className="mt-4" data-testid="certifications-tab-list-content">

      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5" data-testid="cert-filter-chips">
          {STATUS_FILTERS.map((f) => (
            <button key={f.key} onClick={() => setFilter(f.key)} data-testid={`filter-${f.key}`}
              className={`text-xs font-semibold uppercase tracking-wider px-3 py-1.5 rounded-full transition ${
                filter === f.key ? `${f.cls} ring-2 ring-offset-1 ring-[#1e4a8c]/30` : `${f.cls} opacity-70 hover:opacity-100`
              }`}>
              {f.label} <span className="ml-1 opacity-70">{counts[f.key] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search worker, cert or issuer…" data-testid="cert-search"
            className="pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg bg-white w-72" />
        </div>
        <button onClick={() => exportCsv(filtered)} disabled={filtered.length === 0}
          data-testid="cert-export-csv"
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          <Download /> Export CSV
        </button>
      </div>

      {loading ? (
        <div className="text-sm text-slate-500 inline-flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" /> Loading certifications…
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center" data-testid="cert-empty">
          <Award size={28} className="mx-auto text-slate-300 mb-2" />
          <div className="text-sm font-medium text-slate-700">
            {rows.length === 0 ? 'No certifications yet' : 'No matches for this filter'}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            {rows.length === 0
              ? 'Add them via Workers → individual Edit Worker → Certifications tab.'
              : 'Try a different filter or clear your search.'}
          </div>
        </div>
      ) : (
        // v160.3.6f — Grid card-row layout (Path B pattern from Workers v6e).
        // Header + rows share one gridTemplateColumns so columns cannot drift.
        // Column budget (~940px min): 190 worker · 240 cert · 150 expiry ·
        // 130 status · 150 source · 220 action. Fits at 1280 with room to spare.
        <div className="rounded-2xl border border-slate-200 bg-white overflow-x-auto" data-testid="cert-table">
          <div className="min-w-[950px]">
            {/* Sort header row */}
            <div
              className="grid items-center bg-slate-50 border-b border-slate-200 text-slate-500 text-[10px] uppercase tracking-wider px-3 py-3 gap-3"
              style={{ gridTemplateColumns: 'minmax(190px, 1.5fr) minmax(240px, 2fr) minmax(150px, 1.2fr) minmax(130px, 1fr) minmax(150px, 1.2fr) 220px' }}
            >
              <SortHeaderBtn label="Worker"        k="worker" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <SortHeaderBtn label="Certification" k="cert"   sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <SortHeaderBtn label="Expiry"        k="expiry" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} title="Sort by expiry date — earliest first ascending" />
              <SortHeaderBtn label="Status"        k="status" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} title="Sort by status urgency — Expired at top ascending" />
              <SortHeaderBtn label="Source"        k="source" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} title="Sort by source — Simpro first ascending" />
              <div className="text-right">Action</div>
            </div>

            {filtered.map((c) => {
              const days = daysUntilExpiry(c.expiry_date);
              const hasFile = !!c.doc_file_id;
              const source = c.doc_seed_folder ? 'simpro' : 'manual';
              return (
                <div
                  key={c.id}
                  data-testid={`cert-row-${c.id}`}
                  className="grid items-center border-t border-slate-100 hover:bg-slate-50 px-3 py-3 gap-3"
                  style={{ gridTemplateColumns: 'minmax(190px, 1.5fr) minmax(240px, 2fr) minmax(150px, 1.2fr) minmax(130px, 1fr) minmax(150px, 1.2fr) 220px' }}
                >
                  {/* Worker */}
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-900 truncate">
                      {c.worker_first_name} {c.worker_last_name}
                    </div>
                  </div>

                  {/* Certification — name + issuer subtitle */}
                  <div className="min-w-0">
                    <div className="font-medium text-slate-900 truncate" title={c.name}>{c.name}</div>
                    {c.issuer && (
                      <div className="text-[11px] text-slate-500 truncate" title={c.issuer}>{c.issuer}</div>
                    )}
                  </div>

                  {/* Expiry — ISO date + relative-days chip */}
                  <div className="min-w-0 text-xs">
                    <div className="text-slate-700">{c.expiry_date || '—'}</div>
                    {c.expiry_date && days !== null && (
                      <div
                        data-testid={`cert-days-${c.id}`}
                        className={`inline-flex items-center gap-0.5 mt-0.5 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                          days < 0
                            ? 'bg-[#fbe4e7] text-[#7a1f33] border border-[#e69aa3]'
                            : days <= 30
                              ? 'bg-[#fef3c7] text-[#92400e] border border-[#f6d99e]'
                              : days <= 90
                                ? 'bg-[#e6eff9] text-[#1e4a8c] border border-[#b9d2ec]'
                                : 'bg-slate-100 text-slate-500 border border-slate-200'
                        }`}
                      >
                        {days < 0 ? `${Math.abs(days)}d ago` : days === 0 ? 'today' : `in ${days}d`}
                      </div>
                    )}
                  </div>

                  {/* Status */}
                  <div className="min-w-0">
                    <span data-testid={`status-${c.status?.key}-${c.id}`}
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider border ${STATUS_CHIP[c.status?.key] || STATUS_CHIP.missing_file}`}>
                      {c.status?.label}
                    </span>
                  </div>

                  {/* Source + file-present chips */}
                  <div className="flex flex-wrap items-center gap-1 min-w-0">
                    {source === 'simpro' ? (
                      <span
                        title={`Imported from Simpro folder: ${c.doc_seed_folder}`}
                        data-testid={`cert-source-simpro-${c.id}`}
                        className="inline-flex items-center gap-0.5 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-200 max-w-[130px]"
                      >
                        <Package size={9} />
                        <span className="truncate">{c.doc_seed_folder}</span>
                      </span>
                    ) : (
                      <span
                        title="Added manually — not from a Simpro ZIP import"
                        data-testid={`cert-source-manual-${c.id}`}
                        className="inline-flex items-center gap-0.5 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 border border-slate-200"
                      >
                        MANUAL
                      </span>
                    )}
                    {hasFile ? (
                      <span
                        title="Certificate file uploaded"
                        data-testid={`cert-file-yes-${c.id}`}
                        className="inline-flex items-center gap-0.5 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#e6eff9] text-[#1e4a8c] border border-[#b9d2ec]"
                      >
                        <FileText size={9} /> FILE
                      </span>
                    ) : (
                      <span
                        title="No certificate file — request one from the worker"
                        data-testid={`cert-file-no-${c.id}`}
                        className="inline-flex items-center gap-0.5 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#fef3c7] text-[#92400e] border border-[#f6d99e]"
                      >
                        <FileWarning size={9} /> NO FILE
                      </span>
                    )}
                  </div>

                  {/* Action icons */}
                  <div className="flex items-center justify-end gap-1 flex-wrap">
                    <button
                      onClick={() => setPreviewCert(c)}
                      disabled={!c.doc_file_id}
                      title={c.doc_file_id ? 'View PDF' : 'No file uploaded'}
                      data-testid={`cert-view-${c.id}`}
                      className="inline-flex items-center justify-center w-8 h-7 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-blue-700 disabled:opacity-40 disabled:hover:bg-white disabled:hover:text-slate-600"
                    ><Eye /></button>
                    {canEdit && (
                      <button
                        onClick={() => setEditCert(c)}
                        title="Edit"
                        data-testid={`cert-edit-${c.id}`}
                        className="inline-flex items-center justify-center w-8 h-7 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-blue-700"
                      ><Pencil /></button>
                    )}
                    {isAdmin && (
                      <button
                        onClick={() => setDeleteCert(c)}
                        title="Delete"
                        data-testid={`cert-delete-${c.id}`}
                        className="inline-flex items-center justify-center w-8 h-7 rounded-lg border border-rose-200 bg-white text-rose-600 hover:bg-rose-50"
                      ><Trash2 /></button>
                    )}
                    {canEdit && (
                      <button onClick={() => sendReminder(c)} disabled={sendingId === c.id}
                        data-testid={`send-reminder-${c.id}`}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#fbe4e7] text-[#7a1f33] text-[10px] font-semibold uppercase tracking-wider hover:bg-[#f4c7cd] disabled:opacity-60">
                        {sendingId === c.id ? <Loader2 size={11} className="animate-spin" /> : <Mail />}
                        Remind
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
        </TabsContent>
      </Tabs>

      {/* Phase 3.17 — row action modals */}
      {previewCert && (
        <PdfPreviewModal
          file={previewCert.doc_file_id
            ? { id: previewCert.doc_file_id, filename: `${previewCert.name} — ${previewCert.worker_first_name} ${previewCert.worker_last_name}` }
            : null}
          onClose={() => setPreviewCert(null)}
        />
      )}
      {editCert && (
        <CertEditModal
          cert={editCert}
          onClose={() => setEditCert(null)}
          onSaved={(updated) => {
            setRows((rs) => rs.map((r) => r.id === updated.id
              ? { ...r, ...updated, worker_first_name: r.worker_first_name, worker_last_name: r.worker_last_name }
              : r));
            // Status may have changed (e.g. new expiry_date) — reload to recompute.
            load();
          }}
        />
      )}
      {deleteCert && (
        <CertDeleteConfirm
          cert={deleteCert}
          onClose={() => setDeleteCert(null)}
          onDeleted={(id) => setRows((rs) => rs.filter((r) => r.id !== id))}
        />
      )}
    </div>
  );
}
