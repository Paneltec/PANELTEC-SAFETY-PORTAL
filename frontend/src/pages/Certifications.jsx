// Global Certifications view — Settings → Certifications.
// Lists every cert across every worker in the org with status filter chips,
// search, CSV export, and the same Send Reminder action available in the
// Worker edit modal.
import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Award, ClipboardList, Loader2, ArrowUpDown, ArrowUp, ArrowDown, FileText, FileWarning, Package, ChevronRight, ChevronDown as ChevronDownIcon, AlertTriangle, Clock } from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../lib/api';
import { filesUrl } from '../lib/downloadUrl';
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

// v160.3.6h — 40×40 worker photo with initials fallback. Twin of the
// component in Workers.jsx v160.3.6c; kept inline here to avoid churning
// two files with a new shared component when the code is a dozen lines.
// `filesUrl()` has inflight-dedup + 15-min token cache so N concurrent
// renders trigger exactly one `POST /auth/download-token`.
function WorkerRowPhoto({ worker }) {
  const [src, setSrc] = React.useState(null);
  const [broken, setBroken] = React.useState(false);
  React.useEffect(() => {
    let alive = true;
    if (!worker?.photo_url) { setSrc(null); setBroken(false); return () => { alive = false; }; }
    setBroken(false);
    filesUrl(worker.photo_url)
      .then((u) => { if (alive) setSrc(u); })
      .catch(() => { if (alive) setBroken(true); });
    return () => { alive = false; };
  }, [worker?.photo_url]);
  const initials = `${(worker?.first_name?.[0] || '?').toUpperCase()}${(worker?.last_name?.[0] || '').toUpperCase()}`;
  if (!worker?.photo_url || broken) {
    return (
      <div
        className="w-10 h-10 rounded-full bg-[#e6eff9] border border-[#b9d2ec] flex items-center justify-center text-[#1e4a8c] font-semibold text-xs shrink-0 select-none"
        aria-label={`${worker?.first_name || ''} ${worker?.last_name || ''} — no photo`}
      >
        {initials}
      </div>
    );
  }
  return (
    <img
      src={src || ''}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setBroken(true)}
      className="w-10 h-10 rounded-full object-cover border border-slate-200 bg-white shrink-0"
    />
  );
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
  // v160.3.6g — sort keys re-scoped to WORKER-LEVEL aggregates.
  // v160.3.6h — default flipped to alphabetical (worker) per user feedback.
  const [sortKey, setSortKey] = useState('worker');
  const [sortDir, setSortDir] = useState('asc');
  const toggleSort = (k) => {
    if (sortKey === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(k); setSortDir('asc'); }
  };
  // v160.3.6g — persist expanded worker rows in ?open= so refresh keeps them.
  const [urlParams, setUrlParams] = useSearchParams();
  const initialOpen = new Set(
    (urlParams.get('open') || '').split(',').map((s) => s.trim()).filter(Boolean)
  );
  const [expanded, setExpanded] = useState(initialOpen);
  const toggleExpanded = (workerId) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(workerId)) next.delete(workerId); else next.add(workerId);
      const csv = Array.from(next).join(',');
      const nextParams = new URLSearchParams(urlParams);
      if (csv) nextParams.set('open', csv); else nextParams.delete('open');
      setUrlParams(nextParams, { replace: true });
      return next;
    });
  };
  // Phase 3.17 — row actions
  const [previewCert, setPreviewCert] = useState(null);   // 👁  View PDF
  const [editCert, setEditCert] = useState(null);         // ✏️ Edit
  const [deleteCert, setDeleteCert] = useState(null);     // 🗑 Delete (admin)
  // v160.3.6h — left-join workers so (a) zero-cert workers still appear as
  // rows, and (b) we can render their real photo instead of just initials.
  const [workers, setWorkers] = useState([]);

  const load = async () => {
    setLoading(true);
    try {
      // Parallel fetch: cert list + workers directory. Workers is authoritative
      // for the roster (80 today); certs list only contains people with ≥1 cert.
      const [certs, ws] = await Promise.all([
        api.get('/workers/certifications/all'),
        api.get('/workers'),
      ]);
      setRows(certs.data || []);
      setWorkers(ws.data || []);
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

  const filteredCerts = useMemo(() => {
    // v160.3.6g — the FLAT filtered cert list (used for CSV export). Kept
    // separate from the grouped view so downstream consumers (CSV, tests)
    // still see one row per cert.
    const q = search.trim().toLowerCase();
    return rows
      .filter((r) => filter === 'all' ? true : r.status?.key === filter)
      .filter((r) => {
        if (!q) return true;
        const blob = `${r.worker_first_name} ${r.worker_last_name} ${r.name} ${r.issuer || ''} ${r.doc_seed_folder || ''}`.toLowerCase();
        return blob.includes(q);
      });
  }, [rows, filter, search]);

  const workerGroups = useMemo(() => {
    // v160.3.6g — Group by worker_id. For search, a worker qualifies if
    // either their name matches OR any of their certs matches; when a
    // worker qualifies via name, ALL of their certs are shown so the
    // admin still sees the full context. Filter-chip semantics are
    // per-cert: an expanded worker shows only the matching certs.
    // v160.3.6h — LEFT JOIN against the workers directory so workers with
    // zero certs still appear (they're arguably the highest-priority rows
    // — brand new / not inducted / ZIP not applied). Only rendered on the
    // `all` filter — a status filter that requires ≥1 matching cert can't
    // match a worker who has zero certs, and the `filteredCerts` array
    // used by CSV export stays cert-scoped so downstream schema is intact.
    const q = search.trim().toLowerCase();
    const groups = new Map();
    // Seed from the workers directory first so people with 0 certs get a row.
    for (const w of workers) {
      groups.set(w.id, {
        worker_id: w.id,
        first_name: w.first_name || '',
        last_name: w.last_name || '',
        photo_url: w.photo_url || null,
        certs: [],
      });
    }
    // Add / hydrate with certs.
    for (const r of rows) {
      const wid = r.worker_id;
      if (!groups.has(wid)) {
        groups.set(wid, {
          worker_id: wid,
          first_name: r.worker_first_name || '',
          last_name: r.worker_last_name || '',
          photo_url: null,
          certs: [],
        });
      }
      groups.get(wid).certs.push(r);
    }
    const workerNameMatches = (g) =>
      !q || `${g.first_name} ${g.last_name}`.toLowerCase().includes(q);
    const certMatchesSearch = (c) => {
      if (!q) return true;
      const blob = `${c.name} ${c.issuer || ''} ${c.doc_seed_folder || ''}`.toLowerCase();
      return blob.includes(q);
    };
    const certMatchesFilter = (c) => filter === 'all' || c.status?.key === filter;

    const shaped = [];
    for (const g of groups.values()) {
      const nameHit = workerNameMatches(g);
      const displayCerts = g.certs.filter((c) => {
        if (!certMatchesFilter(c)) return false;
        if (!q) return true;
        return nameHit || certMatchesSearch(c);
      });
      // For zero-cert workers: keep them ONLY on the `all` filter, ONLY when
      // the search string is empty OR matches their name. Any status filter
      // requires at least one cert, so zero-cert workers can't satisfy it.
      const zeroCert = g.certs.length === 0;
      if (zeroCert) {
        if (filter !== 'all') continue;
        if (q && !nameHit) continue;
      } else if (displayCerts.length === 0) {
        continue;
      }

      let expired = 0, expiring = 0, missing = 0, valid = 0, noExpiry = 0, simpro = 0, manual = 0;
      let latest = null;
      for (const c of g.certs) {
        const k = c.status?.key;
        if (k === 'expired') expired++;
        else if (k === 'expiring_soon') expiring++;
        else if (k === 'missing_file') missing++;
        else if (k === 'valid') valid++;
        else if (k === 'no_expiry') noExpiry++;
        if (c.doc_seed_folder) simpro++; else manual++;
        if (c.updated_at && (!latest || c.updated_at > latest)) latest = c.updated_at;
      }
      shaped.push({
        ...g,
        displayCerts: displayCerts.sort((a, b) => {
          const ra = STATUS_RANK[a.status?.key] ?? 9;
          const rb = STATUS_RANK[b.status?.key] ?? 9;
          if (ra !== rb) return ra - rb;
          return (a.expiry_date || 'z').localeCompare(b.expiry_date || 'z');
        }),
        counts: { total: g.certs.length, expired, expiring, missing, valid, noExpiry, simpro, manual },
        latest_updated_at: latest,
        zeroCert,
      });
    }

    const dir = sortDir === 'desc' ? -1 : 1;
    const byName = (a, b) => (`${a.last_name} ${a.first_name}`).localeCompare(`${b.last_name} ${b.first_name}`) * dir;
    if (sortKey === 'attention') {
      shaped.sort((a, b) => {
        const aw = a.counts.expired * 100 + a.counts.expiring * 10 + a.counts.missing;
        const bw = b.counts.expired * 100 + b.counts.expiring * 10 + b.counts.missing;
        if (aw !== bw) return (bw - aw) * dir; // higher weight first ASCENDING
        return byName(a, b);
      });
    } else if (sortKey === 'worker')  shaped.sort(byName);
    else if (sortKey === 'total')     shaped.sort((a, b) => (a.counts.total - b.counts.total) * dir || byName(a, b));
    else if (sortKey === 'missing')   shaped.sort((a, b) => (a.counts.missing - b.counts.missing) * dir || byName(a, b));
    else if (sortKey === 'expired')   shaped.sort((a, b) => (a.counts.expired - b.counts.expired) * dir || byName(a, b));
    else if (sortKey === 'updated')   shaped.sort((a, b) => ((a.latest_updated_at || '').localeCompare(b.latest_updated_at || '')) * dir);
    return shaped;
  }, [rows, workers, filter, search, sortKey, sortDir]);

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

      <Tabs defaultValue="list" className="mt-2" data-testid="certifications-tabs">
        <TabsList variant="hero">
          <TabsTrigger variant="hero" emphasis="secondary" value="dashboard" data-testid="certifications-tab-dashboard">Dashboard</TabsTrigger>
          <TabsTrigger variant="hero" emphasis="primary" value="list" data-testid="certifications-tab-list">
            List <span className="ml-1.5 text-[10px] tabular-nums px-1.5 py-0.5 rounded-full bg-slate-200/70 text-slate-700">{workers.length || rows.length}</span>
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
        <button onClick={() => exportCsv(filteredCerts)} disabled={filteredCerts.length === 0}
          data-testid="cert-export-csv"
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          <Download /> Export CSV
        </button>
      </div>

      {loading ? (
        <div className="text-sm text-slate-500 inline-flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" /> Loading certifications…
        </div>
      ) : workerGroups.length === 0 ? (
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
        // v160.3.6g — Grouped-by-worker layout. Worker rows are the primary
        // scannable list; each worker's individual certs expand behind a
        // chevron so the admin doesn't see the same person 7 times in a row.
        <div className="rounded-2xl border border-slate-200 bg-white overflow-x-auto" data-testid="cert-table">
          <div className="min-w-[950px]">
            {/* Sort header row (worker-level) */}
            <div
              className="grid items-center bg-slate-50 border-b border-slate-200 text-slate-500 text-[10px] uppercase tracking-wider px-3 py-3 gap-3"
              style={{ gridTemplateColumns: '28px minmax(220px, 2fr) minmax(300px, 2.5fr) minmax(120px, 1fr) 120px' }}
            >
              <div />
              <SortHeaderBtn label="Worker"       k="worker"  sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <div className="text-slate-500">Summary</div>
              <SortHeaderBtn label="Updated"      k="updated" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} title="Sort by most recent cert change" />
              <div className="text-right">Action</div>
            </div>
            {/* Secondary sort chips row — worker aggregate sorts, kept below the header for discoverability */}
            <div
              className="grid items-center bg-slate-50/60 border-b border-slate-100 text-[10px] uppercase tracking-wider text-slate-400 px-3 py-1.5 gap-3"
              style={{ gridTemplateColumns: '28px minmax(220px, 2fr) minmax(300px, 2.5fr) minmax(120px, 1fr) 120px' }}
            >
              <div />
              <div className="flex items-center gap-2">
                <SortHeaderBtn label="Attention" k="attention" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} title="Highest-risk workers first — expired × 100 + expiring × 10 + missing" />
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <SortHeaderBtn label="Total"       k="total"   sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <SortHeaderBtn label="Missing"     k="missing" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <SortHeaderBtn label="Expired"     k="expired" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              </div>
              <div />
              <div />
            </div>

            {workerGroups.map((g) => {
              const isOpen = expanded.has(g.worker_id);
              return (
                <React.Fragment key={g.worker_id}>
                  <div
                    data-testid={`worker-cert-row-${g.worker_id}`}
                    className={`grid items-center border-t border-slate-100 hover:bg-slate-50 px-3 py-3 gap-3 ${isOpen ? 'bg-[#e6eff9]/40' : ''}`}
                    style={{ gridTemplateColumns: '28px minmax(220px, 2fr) minmax(300px, 2.5fr) minmax(120px, 1fr) 120px' }}
                  >
                    {/* Chevron */}
                    <button
                      type="button"
                      onClick={() => toggleExpanded(g.worker_id)}
                      data-testid={`worker-cert-toggle-${g.worker_id}`}
                      aria-expanded={isOpen}
                      title={isOpen ? 'Collapse' : 'Expand'}
                      className="inline-flex items-center justify-center w-6 h-6 rounded hover:bg-slate-200 text-slate-500"
                    >
                      {isOpen ? <ChevronDownIcon size={14} /> : <ChevronRight size={14} />}
                    </button>

                    {/* Worker identity — v160.3.6h photo + name/count subtitle */}
                    <div className="flex items-center gap-2.5 min-w-0">
                      <WorkerRowPhoto worker={g} />
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-900 truncate">
                          {g.first_name} {g.last_name}
                        </div>
                        <div className="text-[11px] text-slate-500 truncate">
                          {g.zeroCert
                            ? 'No certifications on file'
                            : <>
                                {g.counts.total} cert{g.counts.total === 1 ? '' : 's'}
                                {g.counts.simpro ? ` · Simpro ${g.counts.simpro}` : ''}
                                {g.counts.manual ? ` · Manual ${g.counts.manual}` : ''}
                              </>}
                        </div>
                      </div>
                    </div>

                    {/* Summary chips */}
                    <div className="flex flex-wrap items-center gap-1 min-w-0">
                      {g.zeroCert ? (
                        <span
                          className="inline-flex items-center gap-0.5 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#fef3c7] text-[#92400e] border border-[#f6d99e]"
                          data-testid={`worker-cert-none-${g.worker_id}`}
                          title="This worker has no certifications on record. Either brand new, not inducted, or the Simpro ZIP has not been imported."
                        >
                          <FileWarning size={9} /> NO CERTS
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200"
                          data-testid={`worker-cert-total-${g.worker_id}`}>
                          <Award size={9} /> {g.counts.total}
                        </span>
                      )}
                      {g.counts.expired > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#f7d8dc] text-[#a8324c] border border-[#e69aa3]"
                          data-testid={`worker-cert-expired-${g.worker_id}`}
                          title={`${g.counts.expired} expired`}>
                          <AlertTriangle size={9} /> {g.counts.expired} EXPIRED
                        </span>
                      )}
                      {g.counts.expiring > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#fef3c7] text-[#92400e] border border-[#f6d99e]"
                          data-testid={`worker-cert-expiring-${g.worker_id}`}
                          title={`${g.counts.expiring} expiring within 30 days`}>
                          <Clock size={9} /> {g.counts.expiring} SOON
                        </span>
                      )}
                      {g.counts.missing > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#fef3c7] text-[#92400e] border border-[#f6d99e]"
                          data-testid={`worker-cert-missing-${g.worker_id}`}
                          title={`${g.counts.missing} missing file`}>
                          <FileWarning size={9} /> {g.counts.missing} NO FILE
                        </span>
                      )}
                      {g.counts.valid > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#d8ecdd] text-[#1f7a3f] border border-[#b6dcbf]"
                          data-testid={`worker-cert-valid-${g.worker_id}`}
                          title={`${g.counts.valid} valid`}>
                          {g.counts.valid} VALID
                        </span>
                      )}
                      {g.counts.noExpiry > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#d8e6f4] text-[#1e4a8c] border border-[#b9d2ec]"
                          data-testid={`worker-cert-no-expiry-${g.worker_id}`}
                          title={`${g.counts.noExpiry} no expiry`}>
                          {g.counts.noExpiry} NO EXPIRY
                        </span>
                      )}
                    </div>

                    {/* Latest updated */}
                    <div className="text-[11px] text-slate-500 truncate" title={g.latest_updated_at || ''}>
                      {g.latest_updated_at ? new Date(g.latest_updated_at).toLocaleDateString() : '—'}
                    </div>

                    {/* Row-level action: expand hint */}
                    <div className="flex items-center justify-end">
                      <button
                        type="button"
                        onClick={() => toggleExpanded(g.worker_id)}
                        data-testid={`worker-cert-open-${g.worker_id}`}
                        className="text-[10px] font-semibold uppercase tracking-wider text-[#1e4a8c] hover:underline"
                      >
                        {isOpen ? 'Hide certs' : 'View certs'}
                      </button>
                    </div>
                  </div>

                  {/* Expanded child rows — individual certs */}
                  {isOpen && g.displayCerts.map((c) => {
                    const days = daysUntilExpiry(c.expiry_date);
                    const hasFile = !!c.doc_file_id;
                    const source = c.doc_seed_folder ? 'simpro' : 'manual';
                    return (
                      <div
                        key={c.id}
                        data-testid={`cert-row-${c.id}`}
                        className="grid items-center border-t border-dashed border-slate-100 bg-slate-50/40 px-3 py-2.5 gap-3 pl-10"
                        style={{ gridTemplateColumns: '28px minmax(240px, 2.5fr) minmax(160px, 1.2fr) minmax(120px, 1fr) minmax(160px, 1.2fr) 200px' }}
                      >
                        <div />
                        {/* Cert name + issuer */}
                        <div className="min-w-0">
                          <div className="font-medium text-slate-900 truncate" title={c.name}>{c.name}</div>
                          {c.issuer && <div className="text-[11px] text-slate-500 truncate">{c.issuer}</div>}
                        </div>
                        {/* Expiry */}
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
                        {/* Source + file */}
                        <div className="flex flex-wrap items-center gap-1 min-w-0">
                          {source === 'simpro' ? (
                            <span title={`Imported from Simpro folder: ${c.doc_seed_folder}`}
                              data-testid={`cert-source-simpro-${c.id}`}
                              className="inline-flex items-center gap-0.5 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-200 max-w-[130px]">
                              <Package size={9} />
                              <span className="truncate">{c.doc_seed_folder}</span>
                            </span>
                          ) : (
                            <span title="Added manually"
                              data-testid={`cert-source-manual-${c.id}`}
                              className="inline-flex items-center gap-0.5 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 border border-slate-200">
                              MANUAL
                            </span>
                          )}
                          {hasFile ? (
                            <span title="Certificate file uploaded"
                              data-testid={`cert-file-yes-${c.id}`}
                              className="inline-flex items-center gap-0.5 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#e6eff9] text-[#1e4a8c] border border-[#b9d2ec]">
                              <FileText size={9} /> FILE
                            </span>
                          ) : (
                            <span title="No certificate file"
                              data-testid={`cert-file-no-${c.id}`}
                              className="inline-flex items-center gap-0.5 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#fef3c7] text-[#92400e] border border-[#f6d99e]">
                              <FileWarning size={9} /> NO FILE
                            </span>
                          )}
                        </div>
                        {/* Actions */}
                        <div className="flex items-center justify-end gap-1 flex-wrap">
                          <button
                            onClick={() => setPreviewCert(c)}
                            disabled={!c.doc_file_id}
                            title={c.doc_file_id ? 'View PDF' : 'No file uploaded'}
                            data-testid={`cert-view-${c.id}`}
                            className="inline-flex items-center justify-center w-8 h-7 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-blue-700 disabled:opacity-40 disabled:hover:bg-white disabled:hover:text-slate-600"
                          ><Eye /></button>
                          {canEdit && (
                            <button onClick={() => setEditCert(c)} title="Edit" data-testid={`cert-edit-${c.id}`}
                              className="inline-flex items-center justify-center w-8 h-7 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-blue-700"
                            ><Pencil /></button>
                          )}
                          {isAdmin && (
                            <button onClick={() => setDeleteCert(c)} title="Delete" data-testid={`cert-delete-${c.id}`}
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
                </React.Fragment>
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
