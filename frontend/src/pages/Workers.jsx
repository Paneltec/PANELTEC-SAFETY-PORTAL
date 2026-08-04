// Workers (Phase 1 + 2) — field-ops directory.
// Phase 1: identity, contact, Simpro sync, manual CRUD, soft delete.
// Phase 2: Personal section (birth date + address), Availability scheduler,
// Clients multi-select from Simpro customers, plus table chips (state + clients).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, Award, Calendar, CheckSquare, ChevronDown, ChevronRight, Download as DownloadLucide, FileText, HardHat, Loader2, MapPin, Plug, Smartphone, Square, UploadCloud, Users, X, ZoomIn } from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../lib/api';
import DismissibleHint from '../components/DismissibleHint';
import { getUser } from '../lib/auth';
import { useCan } from '../lib/permissions';
import { stashInlinePdf } from '../lib/pdfStash';
import { summariseCertifications, personalFilledCount } from '../lib/workerSectionSummary';
// v160.3.7k — Inoculation sweep: lock body scroll while ClientPicker or
// EditModal is open on the Workers page.
import useLockBodyScroll from '../lib/useLockBodyScroll';
import { loadListSort, saveListSort } from '../lib/listSort';
import { filesUrl } from '../lib/downloadUrl';
import { PageHeader, EmptyState } from '../components/capture/Ui';
// v160.3.9.32-4c.1 — Rehomed from UsersManagement. This is the compliance-
// document ingester (photos + cert/licence/induction PDFs + HR docs).
import { BulkSimproZipModal } from '../components/workers/BulkSimproZipModal';
import InductionsMatrix from '../components/InductionsMatrix';
import WorkerInductionsCard from '../components/WorkerInductionsCard';
// Phase 4.7.1 — surface password/access controls on the Workers list.
import AccessKebab from '../components/auth/AccessKebab';
// v160.2.2 — Read-only worker profile drawer (eye icon).
import WorkerViewModal from '../components/workers/WorkerViewModal';
import ImageLightbox from '../components/ImageLightbox';

// Phase 3.20 Wave 2 — lucide row-action/toolbar icons swapped
// to @fluentui/react-icons. Aliased back to the original lucide
// names so existing JSX call sites don't need to change.
import {
  Add20Regular as Plus,
  ArrowDownload20Regular as Download,
  ArrowSync20Regular as RefreshCw,
  ArrowUpload20Regular as Upload,
  Delete20Regular as Trash2,
  Edit20Regular as Edit3,
  Eye20Regular as EyeIcon,
  Mail20Regular as Mail,
  Print20Regular as Printer,
  QrCode20Regular as QrCode,
  Search20Regular as Search,
  Tag20Regular as Tag,
} from '@fluentui/react-icons';

// v160.3.9.29-2c — Legacy set retained; authoritative gate is useCan below.
const WRITE_ROLES = new Set(['admin', 'hseq_lead']);
const SYNC_OPTIONS = [
  { value: 'paneltec', label: 'Paneltec only' },
  { value: 'viatec',   label: 'Viatec only' },
  { value: 'both',     label: 'Paneltec + Viatec' },
];
const DAYS = [
  { key: 'mon', label: 'Monday' },
  { key: 'tue', label: 'Tuesday' },
  { key: 'wed', label: 'Wednesday' },
  { key: 'thu', label: 'Thursday' },
  { key: 'fri', label: 'Friday' },
  { key: 'sat', label: 'Saturday' },
  { key: 'sun', label: 'Sunday' },
];
const AU_STATES = ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'];
const CLIENT_SOURCES = [
  { value: 'paneltec', label: 'Paneltec', tint: 'bg-[#e6eff9] text-[#1e4a8c] hover:bg-[#d8e6f4]' },
  { value: 'viatec',   label: 'Viatec',   tint: 'bg-[#ece6f4] text-[#4f3a8c] hover:bg-[#e0d8ec]' },
  { value: 'both',     label: 'Both',     tint: 'bg-[#d8ecdd] text-[#1f7a3f] hover:bg-[#c8e0cf]' },
];

function fullName(w) { return `${w.first_name || ''} ${w.last_name || ''}`.trim() || '(unnamed)'; }

// DD/MM/YY — saves ~6 chars vs ISO and matches AU date convention.
function shortDate(iso) {
  if (!iso || iso.length < 10) return '—';
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}`;
}

function emptyAvailability() {
  const a = {};
  DAYS.forEach((d) => { a[d.key] = { enabled: false, start: '07:00', end: '17:00' }; });
  return a;
}

function normaliseAvailability(av) {
  const out = emptyAvailability();
  if (av && typeof av === 'object') {
    DAYS.forEach((d) => {
      const row = av[d.key] || {};
      out[d.key] = {
        enabled: !!row.enabled,
        start: row.start || '07:00',
        end: row.end || '17:00',
      };
    });
  }
  return out;
}

function StatusBadge({ active }) {
  if (active) {
    return <span data-testid="worker-active" className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wider border bg-[#d8ecdd] text-[#1f7a3f] border-[#b6dcbf]">Active</span>;
  }
  return <span data-testid="worker-inactive" className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wider border bg-slate-100 text-slate-600 border-slate-200">Inactive</span>;
}

function CompanyChip({ label }) {
  const tints = {
    Paneltec: 'bg-[#e6eff9] text-[#1e4a8c]',
    Viatec:   'bg-[#ece6f4] text-[#4f3a8c]',
    Manual:   'bg-slate-100 text-slate-600',
  };
  return <span className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full ${tints[label] || tints.Manual}`}>{label}</span>;
}

// v160.3.6a — Sortable table column header. Clickable button showing
// a neutral up-down arrow, an ascending arrow, or a descending arrow.
// Sort state is owned by the parent (URL-persisted via search params).
function SortHeader({ label, k, sortKey, sortDir, onClick, className, title }) {
  const active = sortKey === k;
  const Icon = !active ? ArrowUpDown : sortDir === 'desc' ? ArrowDown : ArrowUp;
  return (
    <th className={className} data-testid={`sort-header-${k}`}>
      <button
        type="button"
        onClick={() => onClick(k)}
        title={title || `Sort by ${label.toLowerCase()}`}
        className={
          'inline-flex items-center gap-1 uppercase tracking-wider text-[10px] font-semibold ' +
          (active ? 'text-[#1e4a8c]' : 'text-slate-500 hover:text-slate-700')
        }
      >
        {label}
        <Icon size={10} className={active ? '' : 'opacity-50'} />
      </button>
    </th>
  );
}

// v160.3.6e — div-based sort header used by the Workers grid layout.
// Behaviour is identical to SortHeader; only the wrapper element differs
// so it can sit inside a CSS Grid header row without table semantics.
function SortHeaderBtn({ label, k, sortKey, sortDir, onClick, title }) {
  const active = sortKey === k;
  const Icon = !active ? ArrowUpDown : sortDir === 'desc' ? ArrowDown : ArrowUp;
  return (
    <button
      type="button"
      data-testid={`sort-header-${k}`}
      onClick={() => onClick(k)}
      title={title || `Sort by ${label.toLowerCase()}`}
      className={
        'inline-flex items-center gap-1 uppercase tracking-wider text-[10px] font-semibold text-left ' +
        (active ? 'text-[#1e4a8c]' : 'text-slate-500 hover:text-slate-700')
      }
    >
      {label}
      <Icon size={10} className={active ? '' : 'opacity-50'} />
    </button>
  );
}

function Section({ icon: Icon, title, badge, badges, defaultOpen = false, testid, children }) {
  const [open, setOpen] = useState(defaultOpen);
  const toggle = () => setOpen((v) => !v);
  // v160.3.6b — Header is a `<div role="button">` rather than a `<button>`.
  // A native `<button>` cannot legally contain other interactive elements
  // (any pill that ever becomes a `<button>`, an `<a>`, or an input); the
  // browser silently reparents the tree and swallows the click. The ID Card
  // section shipped a pill inside the toggle in v160.3.5a and the chevron
  // stopped responding on every worker. Using a div sidesteps the invalid-
  // nesting trap for this and every other Section, regardless of what a
  // caller passes to `badges` in future. Keyboard access is preserved via
  // `tabIndex={0}` + Enter/Space handler + `aria-expanded`.
  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden bg-white" data-testid={testid}>
      <div
        role="button"
        tabIndex={0}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
        }}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-4 py-2.5 bg-slate-50 hover:bg-slate-100 text-left flex-wrap cursor-pointer select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1e4a8c]/40"
        data-testid={`${testid}-toggle`}>
        <Icon size={14} className="text-slate-500" />
        <span className="text-sm font-semibold text-slate-800 mr-1">{title}</span>
        {/* v160.3.4c — richer summary pills via the `badges` node prop. The
             legacy single `badge` string still renders for backwards compat. */}
        {badges}
        {badge ? <span className="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full bg-[#e6eff9] text-[#1e4a8c]">{badge}</span> : null}
        <ChevronDown size={14} className={`text-slate-400 transition-transform ml-auto ${open ? 'rotate-180' : ''}`} />
      </div>
      {open && <div className="px-4 py-4 border-t border-slate-200">{children}</div>}
    </div>
  );
}

// v160.3.4c — Compact chip used in EditModal section headers, mirrors the
// styling of the read-only VIEW modal so both flows look consistent.
function EditSummaryPill({ tone = 'neutral', children, testid, title }) {
  const tones = {
    neutral:  'bg-[#e6eff9] text-[#1e4a8c] border-[#b9d2ec]',
    simpro:   'bg-emerald-50 text-emerald-800 border-emerald-200',
    manual:   'bg-slate-100 text-slate-600 border-slate-200',
    pending:  'bg-amber-50 text-amber-800 border-amber-200',
    expired:  'bg-rose-50 text-rose-700 border-rose-200',
    warn:     'bg-orange-50 text-orange-700 border-orange-200',
    hr:       'bg-sky-50 text-sky-800 border-sky-200',
    violet:   'bg-violet-50 text-violet-800 border-violet-200',
  };
  const cls = tones[tone] || tones.neutral;
  return (
    <span
      title={title}
      data-testid={testid}
      className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full border ${cls}`}
    >
      {children}
    </span>
  );
}

// v160.3.4c — Photo for the EditModal header. Mirrors WorkerViewModal.WorkerPhoto
// so both entry points render the same headshot. Falls back to a monogram tile.
// v160.3.9.34.3 — Edit-modal avatar tile with a clearly labeled
// "Upload Photo" button. Previously this was a display-only 56×56
// thumbnail with no upload affordance — users couldn't find how to
// add a worker photo from the Edit modal. This is now a self-
// contained uploader: avatar preview + <input type="file"> styled as
// an obvious button. Uploads through POST /api/workers/{id}/photo
// (same endpoint as the view drawer). On success the local state
// updates so the avatar refreshes immediately without closing the
// modal.
function EditWorkerPhoto({ worker }) {
  const can = useCan();
  const canEdit = can('workers', 'edit');
  // Local overrides so we can refresh the avatar without waiting for
  // the parent modal to refetch.
  const [photoUrl, setPhotoUrl] = React.useState(worker?.photo_url || null);
  const [photoGridfsId, setPhotoGridfsId] = React.useState(worker?.photo_gridfs_id || null);
  const [src, setSrc] = React.useState(null);
  const [broken, setBroken] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const fileRef = React.useRef(null);

  // Reload the download-token URL whenever the effective photo changes.
  React.useEffect(() => {
    let alive = true;
    setBroken(false);
    if (!photoUrl) { setSrc(null); return () => { alive = false; }; }
    const bust = photoGridfsId ? `?v=${photoGridfsId}` : '';
    filesUrl(`${photoUrl}${bust}`)
      .then((u) => { if (alive) setSrc(u); })
      .catch(() => { if (alive) setBroken(true); });
    return () => { alive = false; };
  }, [photoUrl, photoGridfsId]);

  const doUpload = async (file) => {
    if (!file || busy || !worker?.id) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error('Image too large — max 10MB'); return;
    }
    if (!/^image\/(jpeg|jpg|png|webp)$/i.test(file.type || '')) {
      toast.error('Please upload a JPEG, PNG or WebP image');
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { data } = await api.post(`/workers/${worker.id}/photo`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setPhotoUrl(data.photo_url || null);
      setPhotoGridfsId(data.photo_gridfs_id || null);
      toast.success('Photo updated');
    } catch (e) {
      toast.error(apiError(e));
    } finally { setBusy(false); }
  };

  const onFileChange = (e) => {
    const f = e.target.files?.[0];
    if (f) doUpload(f);
    // Reset so the same file can be re-picked after an error.
    e.target.value = '';
  };

  const hasPhoto = !!photoUrl && !broken;

  return (
    <div className="flex flex-col items-center gap-1.5 shrink-0" data-testid="worker-edit-photo-block">
      {hasPhoto ? (
        <img
          src={src || ''}
          alt=""
          onError={() => setBroken(true)}
          className="w-14 h-14 rounded-xl object-cover shadow-sm border border-white/70 shrink-0 bg-white"
          data-testid="worker-edit-photo"
        />
      ) : (
        <div
          className="w-14 h-14 rounded-xl bg-white/60 border border-white/70 shadow-sm flex items-center justify-center text-[#1e4a8c] font-display font-semibold text-base shrink-0"
          data-testid="worker-edit-photo-placeholder"
        >
          {(worker?.first_name?.[0] || '?')}{(worker?.last_name?.[0] || '')}
        </div>
      )}
      {canEdit && (
        <>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={onFileChange}
            data-testid="worker-edit-photo-file-input"
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            data-testid="worker-edit-upload-photo-btn"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1e4a8c] text-white text-[11px] font-semibold uppercase tracking-wider hover:bg-[#143263] disabled:opacity-60"
          >
            {busy ? (
              <><Loader2 size={12} className="animate-spin" /> Uploading…</>
            ) : (
              <><Upload size={12} /> Upload Photo</>
            )}
          </button>
        </>
      )}
    </div>
  );
}

// v160.3.6c — Compact 40×40 circular photo for the Workers list rows.
// Reuses `filesUrl()` which has an inflight-dedup + 15-min in-memory token
// cache — 68 rows mounting concurrently trigger exactly ONE
// `POST /auth/download-token` request, not 68. Falls back to the same
// initials monogram used everywhere else (ID Card / Edit header / View
// modal) so the missing-photo look is consistent org-wide.
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
        data-testid={`worker-row-photo-placeholder-${worker?.id || 'unknown'}`}
        aria-label={`${worker?.first_name || ''} ${worker?.last_name || ''} — no photo on file`}
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
      data-testid={`worker-row-photo-${worker.id}`}
    />
  );
}

function ClientPicker({ company, onClose, selectedIds, onApply }) {
  useLockBodyScroll();
  const [loading, setLoading] = useState(true);
  const [customers, setCustomers] = useState([]);
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState(() => new Set(selectedIds || []));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data } = await api.get(`/integrations/simpro/customers?company=${company}`);
        if (!cancelled) setCustomers(data.customers || []);
      } catch (e) {
        if (!cancelled) toast.error(apiError(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [company]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) => c.name.toLowerCase().includes(q));
  }, [customers, search]);

  const toggle = (id) => setPicked((p) => {
    const n = new Set(p);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const selectAll = () => setPicked(new Set([...picked, ...filtered.map((c) => c.simpro_customer_id)]));
  const clearAll = () => setPicked(new Set());

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()} data-testid="client-picker">
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden max-h-[80vh] flex flex-col">
        <div className="px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-[0.16em] font-semibold text-slate-500">Simpro customers</div>
            <h3 className="font-display text-base font-semibold text-slate-900">
              Pick clients ({CLIENT_SOURCES.find((s) => s.value === company)?.label || company})
            </h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-slate-200" data-testid="client-picker-close"><X size={14} /></button>
        </div>
        <div className="px-5 py-3 border-b border-slate-200 flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search customers…" data-testid="client-picker-search"
              className="w-full pl-9 pr-3 py-1.5 text-sm border border-slate-300 rounded-lg" />
          </div>
          <div className="text-xs text-slate-500" data-testid="client-picker-count">
            {picked.size} of {customers.length} selected
          </div>
          <button onClick={selectAll} data-testid="client-picker-select-all"
            className="text-xs px-2 py-1 rounded bg-[#e6eff9] text-[#1e4a8c] hover:bg-[#d8e6f4] font-medium">Select filtered</button>
          <button onClick={clearAll} data-testid="client-picker-clear-all"
            className="text-xs px-2 py-1 rounded bg-slate-100 text-slate-600 hover:bg-slate-200 font-medium">Clear all</button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="px-5 py-12 text-center text-sm text-slate-500 inline-flex items-center gap-2 w-full justify-center">
              <Loader2 size={14} className="animate-spin" /> Loading customers from Simpro…
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-5 py-12 text-center text-sm text-slate-500">No customers match.</div>
          ) : filtered.slice(0, 500).map((c) => {
            const checked = picked.has(c.simpro_customer_id);
            return (
              <button type="button" key={`${c.simpro_company_id}-${c.simpro_customer_id}`}
                onClick={() => toggle(c.simpro_customer_id)}
                data-testid={`client-row-${c.simpro_customer_id}`}
                className={`w-full px-5 py-2.5 flex items-center gap-3 text-left border-b border-slate-100 ${checked ? 'bg-[#e6eff9]' : 'hover:bg-slate-50'}`}>
                {checked ? <CheckSquare size={15} className="text-[#1e4a8c]" /> : <Square size={15} className="text-slate-400" />}
                <span className="flex-1 text-sm text-slate-800">{c.name}</span>
                <CompanyChip label={c.company_label} />
              </button>
            );
          })}
          {!loading && filtered.length > 500 && (
            <div className="px-5 py-2 text-[11px] text-slate-400">Showing first 500 — refine search to narrow.</div>
          )}
        </div>
        <div className="px-5 py-3 border-t border-slate-200 flex justify-end gap-2 bg-slate-50">
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-100" data-testid="client-picker-cancel">Cancel</button>
          <button onClick={() => onApply([...picked])} data-testid="client-picker-apply"
            className="px-3 py-1.5 rounded-lg bg-[#1e4a8c] text-white text-sm font-semibold hover:bg-[#143263]">
            Apply {picked.size} selection{picked.size === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────── Certifications ───────────────────

const STATUS_BADGES = {
  valid:         { bg: 'bg-[#d8ecdd]', ink: 'text-[#1f7a3f]', border: 'border-[#b6dcbf]' },
  expiring_soon: { bg: 'bg-[#f7eed1]', ink: 'text-[#8c6a1a]', border: 'border-[#e6d995]' },
  expired:       { bg: 'bg-[#f7d8dc]', ink: 'text-[#a8324c]', border: 'border-[#e69aa3]' },
  no_expiry:     { bg: 'bg-[#d8e6f4]', ink: 'text-[#1e4a8c]', border: 'border-[#b9d2ec]' },
  // Butter pastel so a worker with no file uploaded reads as a warning, not neutral.
  missing_file:  { bg: 'bg-[#f7eed1]', ink: 'text-[#8c6a1a]', border: 'border-[#e6d995]' },
};

function StatusBadgeCert({ status }) {
  const cfg = STATUS_BADGES[status?.key] || STATUS_BADGES.missing_file;
  const Icon = status?.key === 'missing_file' ? AlertTriangle : null;
  return (
    <span data-testid={`cert-status-${status?.key}`}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider border ${cfg.bg} ${cfg.ink} ${cfg.border}`}>
      {Icon && <Icon size={9} />} {status?.label || '—'}
    </span>
  );
}

function CertificationsPanel({ workerId, canEdit }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const fileInputRef = useRef(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/workers/${workerId}/certifications`);
      setRows(data || []);
    } catch (e) { toast.error(apiError(e)); }
    finally { setLoading(false); }
  };
  // v160.3.4c — preload the cert list so the collapsed header can show
  // accurate source/status pills without waiting for the panel to expand.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [workerId]);

  // v160.3.5 — same helper as EditModal & WorkerViewModal.
  const certAgg = useMemo(() => summariseCertifications(rows), [rows]);

  const upload = async (fileList) => {
    if (!fileList || !fileList.length) return;
    setUploading(true);
    try {
      let lastCertId = null;
      for (const f of Array.from(fileList)) {
        const form = new FormData();
        form.append('file', f);
        const { data } = await api.post(
          `/workers/${workerId}/certifications/upload`,
          form,
          { headers: { 'Content-Type': 'multipart/form-data' } },
        );
        lastCertId = data?.cert?.id;
      }
      toast.success(`${fileList.length} certification${fileList.length === 1 ? '' : 's'} uploaded`);
      await load();
      // Auto-open inline edit on the last upload so the user fills in dates.
      if (lastCertId) setEditingId(lastCertId);
    } catch (e) { toast.error(apiError(e)); }
    finally { setUploading(false); }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (!canEdit) return;
    if (e.dataTransfer.files?.length) upload(e.dataTransfer.files);
  };

  const addManual = async () => {
    try {
      const { data } = await api.post(`/workers/${workerId}/certifications`,
        { name: 'New certification' });
      await load();
      setEditingId(data.id);
    } catch (e) { toast.error(apiError(e)); }
  };

  const removeCert = async (cert) => {
    try {
      await api.delete(`/workers/certifications/${cert.id}`);
      toast.success(`${cert.name} removed`);
      await load();
    } catch (e) { toast.error(apiError(e)); }
  };

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden bg-white" data-testid="section-certifications">
      <button type="button" onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-2.5 bg-slate-50 hover:bg-slate-100 text-left flex-wrap"
        data-testid="section-certifications-toggle">
        <Award size={14} className="text-slate-500" />
        <span className="text-sm font-semibold text-slate-800 mr-1">Certifications</span>
        {/* v160.3.4c — rich summary pills mirroring WorkerViewModal. */}
        {certAgg.total === 0 ? (
          <EditSummaryPill tone="manual" testid="certs-panel-empty">No items</EditSummaryPill>
        ) : (
          <EditSummaryPill testid="certs-panel-total">{certAgg.total} items</EditSummaryPill>
        )}
        {certAgg.simpro > 0 && (
          <EditSummaryPill tone="simpro" testid="certs-panel-simpro">Simpro · {certAgg.simpro}</EditSummaryPill>
        )}
        {certAgg.manual > 0 && (
          <EditSummaryPill tone="manual" testid="certs-panel-manual">Manual · {certAgg.manual}</EditSummaryPill>
        )}
        {certAgg.pending > 0 && (
          <EditSummaryPill tone="pending" testid="certs-panel-pending">Pending · {certAgg.pending}</EditSummaryPill>
        )}
        {certAgg.missing > 0 && (
          <EditSummaryPill tone="warn" testid="certs-panel-missing"
            title={`${certAgg.missing} cert(s) have no attached file`}>
            <AlertTriangle size={10} /> {certAgg.missing} missing file
          </EditSummaryPill>
        )}
        {certAgg.expired > 0 && (
          <EditSummaryPill tone="expired" testid="certs-panel-expired">
            {certAgg.expired} expired
          </EditSummaryPill>
        )}
        {certAgg.expiringSoon > 0 && (
          <EditSummaryPill tone="pending" testid="certs-panel-expiring">
            {certAgg.expiringSoon} expiring
          </EditSummaryPill>
        )}
        <ChevronDown size={14} className={`text-slate-400 transition-transform ml-auto ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-4 py-4 border-t border-slate-200 space-y-3">
          {/* Drop zone */}
          {canEdit && (
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              data-testid="cert-dropzone"
              className={`cursor-pointer rounded-xl border-2 border-dashed px-4 py-5 text-center transition-colors ${
                dragOver ? 'border-[#1e4a8c] bg-[#e6eff9]' : 'border-[#b9d2ec] bg-[#e6eff9]/40 hover:bg-[#e6eff9]'
              }`}
            >
              <UploadCloud size={22} className="mx-auto text-[#1e4a8c] mb-1.5" />
              <div className="text-sm font-medium text-[#1e4a8c]">
                {uploading ? 'Uploading…' : 'Drop certification files here (PDF, JPG, PNG) or click to browse'}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">Up to 50MB · auto-files to Document Library &quot;Licences &amp; Tickets&quot;</div>
              <input
                ref={fileInputRef} type="file" multiple
                accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                onChange={(e) => upload(e.target.files)}
                className="hidden" data-testid="cert-file-input"
              />
            </div>
          )}

          {canEdit && (
            <div className="flex justify-end">
              <button type="button" onClick={addManual} data-testid="cert-add-manual"
                className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50">
                <Plus /> Add certification (no file)
              </button>
            </div>
          )}

          {/* Table */}
          {loading ? (
            <div className="text-sm text-slate-500 inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading…</div>
          ) : rows.length === 0 ? (
            <div className="text-center py-6 text-sm text-slate-400 italic" data-testid="cert-empty">
              No certifications recorded yet. Drop a file above to add one.
            </div>
          ) : (
            <div className="border border-slate-200 rounded-lg overflow-x-auto">
              <table className="zebra-list w-full text-xs" data-testid="cert-table">
                <thead className="bg-slate-50 text-slate-500 text-[10px] uppercase tracking-wider">
                  <tr>
                    <th className="text-left px-3 py-2">Name</th>
                    <th className="text-left px-3 py-2 hidden md:table-cell">Issuer</th>
                    <th className="text-left px-3 py-2 hidden lg:table-cell whitespace-nowrap">Issued</th>
                    <th className="text-left px-3 py-2 whitespace-nowrap">Expiry</th>
                    <th className="text-left px-3 py-2 whitespace-nowrap">Status</th>
                    <th className="text-center px-3 py-2 w-12">File</th>
                    <th className="px-3 py-2 w-20"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    editingId === c.id
                      ? <CertEditRow key={c.id} cert={c}
                          onSaved={() => { setEditingId(null); load(); }}
                          onCancel={() => setEditingId(null)} />
                      : (
                        <tr key={c.id} className="border-t border-slate-100" data-testid={`cert-row-${c.id}`}>
                          <td className="px-3 py-2 font-semibold text-slate-900 break-words max-w-[220px]">{c.name}</td>
                          <td className="px-3 py-2 text-slate-600 hidden md:table-cell break-words max-w-[180px]">{c.issuer || '—'}</td>
                          <td className="px-3 py-2 text-slate-500 hidden lg:table-cell whitespace-nowrap">{shortDate(c.issue_date)}</td>
                          <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{shortDate(c.expiry_date)}</td>
                          <td className="px-3 py-2 whitespace-nowrap"><StatusBadgeCert status={c.status} /></td>
                          <td className="px-3 py-2 text-center">
                            {c.doc_file_id ? (
                              <button type="button"
                                 onClick={async () => {
                                   try {
                                     const u = await filesUrl(`/workers/${workerId}/certifications/${c.id}/file`);
                                     window.open(u, '_blank', 'noopener,noreferrer');
                                   } catch (_e) { toast.error('Unable to open file'); }
                                 }}
                                 title="View file"
                                 data-testid={`cert-file-${c.id}`}
                                 className="inline-flex items-center justify-center w-6 h-6 rounded bg-[#e6eff9] text-[#1e4a8c] hover:bg-[#d8e6f4]">
                                <FileText size={11} />
                              </button>
                            ) : <span className="text-[10px] text-slate-400 italic" title="no file">—</span>}
                          </td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">
                            {canEdit && (
                              <div className="inline-flex gap-1 items-center">
                                <button type="button" onClick={() => setEditingId(c.id)} data-testid={`cert-edit-${c.id}`}
                                  title="Edit"
                                  className="inline-flex items-center justify-center w-6 h-6 rounded bg-[#e6eff9] text-[#1e4a8c] hover:bg-[#d8e6f4]"><Edit3 /></button>
                                <button type="button" onClick={() => removeCert(c)} data-testid={`cert-delete-${c.id}`}
                                  title="Delete"
                                  className="inline-flex items-center justify-center w-6 h-6 rounded bg-[#fbe4e7] text-[#7a1f33] hover:bg-[#f4c7cd]"><Trash2 /></button>
                              </div>
                            )}
                          </td>
                        </tr>
                      )
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CertEditRow({ cert, onSaved, onCancel }) {
  const [f, setF] = useState({
    name: cert.name || '',
    issuer: cert.issuer || '',
    issue_date: cert.issue_date || '',
    expiry_date: cert.expiry_date || '',
    notes: cert.notes || '',
  });
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!f.name.trim()) { toast.error('Name is required'); return; }
    setSaving(true);
    try {
      await api.patch(`/workers/certifications/${cert.id}`, {
        name: f.name.trim(),
        issuer: f.issuer.trim(),
        issue_date: f.issue_date || null,
        expiry_date: f.expiry_date || null,
        notes: f.notes,
      });
      toast.success('Certification updated');
      onSaved();
    } catch (e) { toast.error(apiError(e)); }
    finally { setSaving(false); }
  };
  return (
    <tr className="border-t border-slate-100 bg-[#e6eff9]/40" data-testid={`cert-edit-row-${cert.id}`}>
      <td colSpan={7} className="px-3 py-3">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <label className="col-span-2 lg:col-span-1"><span className="block text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-1">Name *</span>
            <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })}
              data-testid="cert-form-name" className="w-full px-2 py-1.5 text-sm border border-slate-300 rounded" /></label>
          <label><span className="block text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-1">Issuer</span>
            <input value={f.issuer} onChange={(e) => setF({ ...f, issuer: e.target.value })}
              data-testid="cert-form-issuer" className="w-full px-2 py-1.5 text-sm border border-slate-300 rounded" /></label>
          <label><span className="block text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-1">Issue date</span>
            <input type="date" value={f.issue_date} onChange={(e) => setF({ ...f, issue_date: e.target.value })}
              data-testid="cert-form-issue-date" className="w-full px-2 py-1.5 text-sm border border-slate-300 rounded" /></label>
          <label><span className="block text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-1">Expiry date</span>
            <input type="date" value={f.expiry_date} onChange={(e) => setF({ ...f, expiry_date: e.target.value })}
              data-testid="cert-form-expiry-date" className="w-full px-2 py-1.5 text-sm border border-slate-300 rounded" /></label>
          <label className="col-span-2 lg:col-span-4"><span className="block text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-1">Notes</span>
            <textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })}
              data-testid="cert-form-notes" className="w-full px-2 py-1.5 text-sm border border-slate-300 rounded" /></label>
        </div>
        <div className="mt-2 flex justify-end gap-2">
          <button type="button" onClick={onCancel} data-testid="cert-form-cancel"
            className="px-3 py-1 text-xs border border-slate-300 bg-white rounded text-slate-700 hover:bg-slate-50">Cancel</button>
          <button type="button" onClick={save} disabled={saving} data-testid="cert-form-save"
            className="px-3 py-1 text-xs bg-[#1e4a8c] text-white rounded font-semibold uppercase tracking-wider hover:bg-[#143263] disabled:opacity-60">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </td>
    </tr>
  );
}


// ────────────────── Phase 4.1 — ID Card / NFC ──────────────────

const LAYOUTS = [
  { value: 'wallet',  label: 'Wallet card',  hint: '85.6 × 54 mm · ID-1' },
  { value: 'lanyard', label: 'Lanyard',      hint: '100 × 150 mm portrait' },
  { value: 'avery',   label: 'Avery A4',     hint: '10 wallet cards on A4' },
];

// v160.3.5a — Larger photo tile scoped to the ID Card section. Same
// download-token + fallback logic as EditWorkerPhoto but sized for a
// printable-card feel (128×128).
// v160.3.9.34.2 — Accepts optional `onExpand(src)` prop. When set AND
// a photo is resolved, the image becomes tap-to-expand with hover ring
// + magnifier overlay.
function IdCardPhoto({ worker, onExpand }) {
  const [src, setSrc] = React.useState(null);
  const [broken, setBroken] = React.useState(false);
  React.useEffect(() => {
    let alive = true;
    if (!worker?.photo_url) { setSrc(null); return () => { alive = false; }; }
    filesUrl(worker.photo_url)
      .then((u) => { if (alive) setSrc(u); })
      .catch(() => { if (alive) setBroken(true); });
    return () => { alive = false; };
  }, [worker?.photo_url]);
  const initials = `${(worker?.first_name?.[0] || '?').toUpperCase()}${(worker?.last_name?.[0] || '').toUpperCase()}`;
  if (!worker?.photo_url || broken) {
    return (
      <div
        className="w-32 h-32 rounded-lg bg-[#e6eff9] border border-[#b9d2ec] flex items-center justify-center text-[#1e4a8c] font-display font-bold text-4xl"
        data-testid="id-card-photo-placeholder"
      >
        {initials}
      </div>
    );
  }
  const canExpand = !!(onExpand && src);
  return (
    <button
      type="button"
      onClick={canExpand ? () => onExpand(src) : undefined}
      disabled={!canExpand}
      data-testid="id-card-photo-expand-btn"
      title={canExpand ? 'Click to expand' : undefined}
      className={`relative group block p-0 border-0 bg-transparent ${canExpand ? 'cursor-pointer' : 'cursor-default'}`}
    >
      <img
        src={src || ''}
        alt=""
        onError={() => setBroken(true)}
        className={`w-32 h-32 rounded-lg object-cover border border-slate-200 bg-white transition ${canExpand ? 'group-hover:ring-2 group-hover:ring-[#1e4a8c]/50 group-hover:brightness-95' : ''}`}
        data-testid="id-card-photo-img"
      />
      {canExpand && (
        <span
          aria-hidden="true"
          className="absolute bottom-1 right-1 w-6 h-6 rounded-full bg-slate-900/70 text-white grid place-items-center opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <ZoomIn size={12} />
        </span>
      )}
    </button>
  );
}

function IdCardSection({ worker, canEdit }) {
  // MUST have a server-side worker (i.e. not the unsaved `{}` new-form). Token
  // is filled lazily by the backend if missing, so we always trust the server
  // GET below.
  const [layout, setLayout] = useState('wallet');
  const [printing, setPrinting] = useState(false);
  const [nfc, setNfc] = useState(worker.nfc_uid || '');
  const [savingNfc, setSavingNfc] = useState(false);
  const [paired, setPaired] = useState(!!worker.nfc_uid);
  // v160.3.9.34.2 — Shared lightbox for the ID Card visual tiles (photo + QR).
  // `expand.src` is the image URL, `expand.title` populates the caption.
  const [expand, setExpand] = useState(null);
  const closeExpand = () => setExpand(null);
  // v160.3.9.34.3 — Inline "Upload Photo" button beneath the ID card
  // photo tile. Local override state so the tile refreshes immediately
  // on successful upload without waiting for the parent modal to
  // refetch. Reuses the same POST /workers/{id}/photo endpoint as the
  // edit-modal header uploader.
  const [photoUrlOverride, setPhotoUrlOverride] = useState(null);
  const [photoGridfsIdOverride, setPhotoGridfsIdOverride] = useState(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const photoFileRef = React.useRef(null);
  const effectiveWorker = {
    ...worker,
    photo_url: photoUrlOverride ?? worker.photo_url,
    photo_gridfs_id: photoGridfsIdOverride ?? worker.photo_gridfs_id,
  };
  const uploadIdCardPhoto = async (file) => {
    if (!file || photoUploading || !worker?.id) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error('Image too large — max 10MB'); return;
    }
    if (!/^image\/(jpeg|jpg|png|webp)$/i.test(file.type || '')) {
      toast.error('Please upload a JPEG, PNG or WebP image'); return;
    }
    setPhotoUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { data } = await api.post(`/workers/${worker.id}/photo`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setPhotoUrlOverride(data.photo_url || null);
      setPhotoGridfsIdOverride(data.photo_gridfs_id || null);
      toast.success('Photo updated');
    } catch (e) {
      toast.error(apiError(e));
    } finally { setPhotoUploading(false); }
  };
  const onIdCardPhotoFileChange = (e) => {
    const f = e.target.files?.[0];
    if (f) uploadIdCardPhoto(f);
    e.target.value = '';
  };
  // scan_token is server-seeded; the list endpoint returns it. Lazy backfill
  // in the PDF endpoint covers any edge case where a worker has no token yet.
  const token = worker.scan_token || '';

  // Fetch QR as a blob so the axios interceptor can attach the bearer token.
  const [qrUrl, setQrUrl] = useState(null);
  useEffect(() => {
    if (!worker.id) return;
    let url = null;
    let alive = true;
    api.get(`/workers/${worker.id}/qr.png`, { responseType: 'blob' })
      .then((r) => {
        if (!alive) return;
        url = URL.createObjectURL(r.data);
        setQrUrl(url);
      })
      .catch(() => setQrUrl(null));
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [worker.id]);

  const openPdf = async (action) => {
    if (!token) { toast.error('Worker has no scan token yet.'); return; }

    // v160.3.9.7 — "Print preview" now opens a small centred popup window
    // pointing at the standalone /print/worker-id-card/:workerId route so
    // the admin gets a compact preview instead of a full browser tab.
    // "Download" keeps the direct-blob path — no popup needed for a save.
    if (action === 'print') {
      const w = 520;
      const h = 780;
      const left = Math.max(0, Math.round((window.screen.width  - w) / 2));
      const top  = Math.max(0, Math.round((window.screen.height - h) / 2));
      const features = `width=${w},height=${h},left=${left},top=${top},`
        + 'resizable=yes,scrollbars=yes,menubar=no,toolbar=no,location=no,status=no';
      const url = `/print/worker-id-card/${worker.id}?layout=${encodeURIComponent(layout)}`;
      const popup = window.open(url, 'paneltec_id_card_preview', features);
      if (!popup) {
        // Popup-blocker path — fall back to a normal new tab and tell the user.
        window.open(url, '_blank');
        toast.error('Popup blocked — opened in a new tab instead. Allow popups from this site for a smaller preview window.');
      } else {
        try { popup.focus(); } catch (_) { /* noop */ }
      }
      return;
    }

    // Download path — unchanged from v148 (stashed blob → anchor click).
    setPrinting(true);
    try {
      const r = await api.get(`/workers/${worker.id}/id-card.pdf`, {
        params: { layout },
        responseType: 'blob',
      });
      const filename = `worker-${worker.id.slice(0, 8)}-${layout}.pdf`;
      const { src } = await stashInlinePdf(r.data, filename);
      const a = document.createElement('a');
      a.href = src; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
    } catch (e) { toast.error(apiError(e)); }
    finally { setPrinting(false); }
  };

  const pairNfc = async () => {
    const uid = nfc.trim().toUpperCase();
    if (uid.length < 4) { toast.error('NFC UID must be at least 4 chars'); return; }
    setSavingNfc(true);
    try {
      await api.post(`/workers/${worker.id}/nfc-pair`, { nfc_uid: uid });
      toast.success(`NFC paired · ${uid}`);
      setNfc(uid); setPaired(true);
    } catch (e) { toast.error(apiError(e)); }
    finally { setSavingNfc(false); }
  };
  const unpairNfc = async () => {
    setSavingNfc(true);
    try {
      await api.delete(`/workers/${worker.id}/nfc-pair`);
      toast.success('NFC unpaired');
      setNfc(''); setPaired(false);
    } catch (e) { toast.error(apiError(e)); }
    finally { setSavingNfc(false); }
  };

  // v160.3.9.34.4 — Bespoke collapsible header for the ID Card section.
  // Mirrors the shared `<Section>` visual pattern (same header row, same
  // chevron rotation, same badge slot, same open/closed transition) but
  // adds `touch-action: manipulation` to the header row so the FIRST
  // tap registers on touch devices. Rationale: the ID Card section is
  // the last section in the modal, so its collapsed header sits at the
  // scroll boundary of the modal's `overflow-y-auto` body. iOS Safari
  // introduces a 300ms tap-delay + tap-vs-scroll ambiguity for
  // `role="button"` divs at that boundary, so the first tap is often
  // consumed as an inertia-scroll and the section refuses to open until
  // a second tap. `touch-action: manipulation` disables the delay and
  // eliminates the ambiguity, so a single tap toggles the section
  // identically to the siblings above it. No other section is touched.
  const [open, setOpen] = React.useState(false);
  const toggle = () => setOpen((v) => !v);
  // v160.3.9.34.5 — Auto-scroll on expand. When the section transitions
  // from collapsed → open, place the section header near the top of the
  // modal's scroll area so the revealed content (photo, QR, Upload
  // Photo, Print layout, NFC) is visible above the sticky footer.
  // Coupled with the extra `pb-24` on the modal scroll container this
  // guarantees the last-child section is never hidden behind the
  // Save/Cancel bar regardless of viewport height.
  const wrapRef = React.useRef(null);
  React.useEffect(() => {
    if (!open || !wrapRef.current) return;
    // Defer to next tick so the expanded content has actually rendered
    // and its height is measurable before we scroll.
    const t = setTimeout(() => {
      try {
        wrapRef.current.scrollIntoView({ block: 'start', behavior: 'smooth' });
      } catch { /* older browsers ignore options — fall through */ }
    }, 50);
    return () => clearTimeout(t);
  }, [open]);

  return (
    <div
      ref={wrapRef}
      className="border border-slate-200 rounded-xl overflow-hidden bg-white"
      style={{ scrollMarginBlockEnd: '96px' }}
      data-testid="section-id-card"
    >
      <div
        role="button"
        tabIndex={0}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
        }}
        aria-expanded={open}
        style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}
        className="w-full flex items-center gap-2 px-4 py-2.5 bg-slate-50 hover:bg-slate-100 text-left flex-wrap cursor-pointer select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1e4a8c]/40"
        data-testid="section-id-card-toggle"
      >
        <QrCode size={14} className="text-slate-500" />
        <span className="text-sm font-semibold text-slate-800 mr-1">ID Card</span>
        {token
          ? <EditSummaryPill testid="id-card-token-pill" title={`Full token: ${token}`}>
              Token {token.slice(0, 6)}…
            </EditSummaryPill>
          : <EditSummaryPill tone="manual" testid="id-card-token-pending">
              Awaiting token
            </EditSummaryPill>}
        <ChevronDown size={14} className={`text-slate-400 transition-transform ml-auto ${open ? 'rotate-180' : ''}`} />
      </div>
      {open && (
      <div className="px-4 py-4 border-t border-slate-200">
      <div className="grid md:grid-cols-[160px_160px_1fr] gap-4">
        {/* v160.3.5a — printable-ID look: worker photo on the left, QR on the right */}
        {/* v160.3.9.34.2 — Photo tile now tap-to-expand into a lightbox */}
        {/* v160.3.9.34.3 — Inline "Upload Photo" button under the photo tile */}
        <div className="rounded-xl bg-white border border-slate-200 p-3 flex flex-col items-center justify-center gap-1.5"
             data-testid="id-card-photo">
          <IdCardPhoto
            worker={effectiveWorker}
            onExpand={(src) => setExpand({
              src,
              alt: `${[worker.first_name, worker.last_name].filter(Boolean).join(' ') || 'Worker'} photo`,
              title: `${[worker.first_name, worker.last_name].filter(Boolean).join(' ') || 'Worker'} · ID card photo`,
            })}
          />
          <div className="text-[10px] uppercase tracking-wider text-slate-400">Photo</div>
          <div className="text-[10px] text-slate-600 font-semibold text-center truncate max-w-[8rem]"
               title={[worker.first_name, worker.last_name].filter(Boolean).join(' ')}>
            {[worker.first_name, worker.last_name].filter(Boolean).join(' ') || '—'}
          </div>
          {canEdit && (
            <>
              <input
                ref={photoFileRef}
                type="file"
                accept="image/*"
                onChange={onIdCardPhotoFileChange}
                data-testid="id-card-photo-file-input"
                className="hidden"
              />
              <button
                type="button"
                onClick={() => photoFileRef.current?.click()}
                disabled={photoUploading}
                data-testid="id-card-upload-photo-btn"
                className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1e4a8c] text-white text-[10px] font-semibold uppercase tracking-wider hover:bg-[#143263] disabled:opacity-60"
              >
                {photoUploading ? (
                  <><Loader2 size={11} className="animate-spin" /> Uploading…</>
                ) : (
                  <><Upload size={11} /> Upload Photo</>
                )}
              </button>
            </>
          )}
        </div>
        {/* QR preview tile — v160.3.9.34.2 tap-to-expand */}
        <div className="rounded-xl bg-white border border-slate-200 p-3 flex flex-col items-center justify-center gap-1.5"
          data-testid="id-card-qr">
          {qrUrl ? (
            <button
              type="button"
              onClick={() => setExpand({
                src: qrUrl,
                alt: 'Worker QR code',
                title: `${[worker.first_name, worker.last_name].filter(Boolean).join(' ') || 'Worker'} · QR code`,
              })}
              data-testid="id-card-qr-expand-btn"
              title="Click to expand"
              className="relative group p-0 border-0 bg-transparent cursor-pointer"
            >
              <img src={qrUrl} alt="Worker QR"
                   className="w-32 h-32 transition group-hover:ring-2 group-hover:ring-[#1e4a8c]/50 group-hover:brightness-95 rounded-md" />
              <span aria-hidden="true"
                    className="absolute bottom-1 right-1 w-6 h-6 rounded-full bg-slate-900/70 text-white grid place-items-center opacity-0 group-hover:opacity-100 transition-opacity">
                <ZoomIn size={12} />
              </span>
            </button>
          ) : (
            <div className="w-32 h-32 grid place-items-center text-slate-300"><QrCode /></div>
          )}
          <div className="text-[10px] uppercase tracking-wider text-slate-400">Worker QR</div>
          <div className="text-[10px] font-mono text-slate-500">{token || '—'}</div>
        </div>

        <div className="space-y-3">
          {/* Layout picker */}
          <div>
            <div className="text-xs font-medium text-slate-700 mb-1.5">Print layout</div>
            <div className="grid grid-cols-3 gap-2">
              {LAYOUTS.map((l) => (
                <button key={l.value} type="button" onClick={() => setLayout(l.value)}
                  data-testid={`layout-${l.value}`}
                  className={`text-left px-3 py-2 rounded-lg border text-xs transition ${
                    layout === l.value
                      ? 'border-[#1e4a8c] bg-[#e6eff9] text-[#1e4a8c] font-semibold ring-1 ring-[#1e4a8c]/30'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}>
                  <div className="font-bold">{l.label}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">{l.hint}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button type="button" onClick={() => openPdf('print')} disabled={printing || !token}
              data-testid="id-card-print"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#1e4a8c] text-white text-xs font-semibold uppercase tracking-wider hover:bg-[#143263] disabled:opacity-60">
              {printing ? <Loader2 size={12} className="animate-spin" /> : <Printer />} Print preview
            </button>
            <button type="button" onClick={() => openPdf('download')} disabled={printing || !token}
              data-testid="id-card-download"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">
              <Download /> Download PDF
            </button>
          </div>

          {/* NFC pairing */}
          {canEdit && (
            <div className="pt-2 border-t border-slate-100">
              <div className="text-xs font-medium text-slate-700 mb-1.5 inline-flex items-center gap-1.5"><Smartphone size={12} /> NFC tag</div>
              <div className="flex items-center gap-2 flex-wrap">
                <input value={nfc} onChange={(e) => setNfc(e.target.value.toUpperCase().replace(/[^A-F0-9:]/g, ''))}
                  placeholder="04:A1:B2:C3:D4:E5" maxLength={32}
                  data-testid="nfc-input"
                  className="px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg flex-1 min-w-[12rem]" />
                {paired ? (
                  <button type="button" onClick={unpairNfc} disabled={savingNfc}
                    data-testid="nfc-unpair"
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#e69aa3] bg-[#fbe4e7] text-[#7a1f33] text-xs font-semibold hover:bg-[#f4c7cd] disabled:opacity-60">
                    Unpair
                  </button>
                ) : null}
                <button type="button" onClick={pairNfc} disabled={savingNfc || nfc.length < 4}
                  data-testid="nfc-pair"
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#1e4a8c] text-white text-xs font-semibold uppercase tracking-wider hover:bg-[#143263] disabled:opacity-60">
                  {savingNfc ? <Loader2 size={12} className="animate-spin" /> : <Tag />} Pair
                </button>
              </div>
              <p className="mt-1.5 text-[11px] text-slate-500">
                Optional. UHF/NFC readers will resolve the worker by tag UID when QR isn&apos;t practical.
              </p>
            </div>
          )}
        </div>
      </div>
      {/* v160.3.9.34.2 — Tap-to-expand lightbox for the photo + QR tiles. */}
      <ImageLightbox
        open={!!expand}
        src={expand?.src}
        alt={expand?.alt}
        title={expand?.title}
        onClose={closeExpand}
      />
      </div>
      )}
    </div>
  );
}




function EditModal({ worker, onClose, onSaved }) {
  useLockBodyScroll();
  const isNew = !worker.id;
  const isSimpro = worker.source === 'simpro';
  const [f, setF] = useState({
    first_name: worker.first_name || '',
    last_name:  worker.last_name  || '',
    email:      worker.email      || '',
    phone:      worker.phone      || '',
    mobile:     worker.mobile     || '',
    position:   worker.position   || '',
    active:     worker.active !== false,
    birth_date:     worker.birth_date     || '',
    country:        worker.country        || 'Australia',
    state:          worker.state          || '',
    street_address: worker.street_address || '',
    suburb:         worker.suburb         || '',
    postal_code:    worker.postal_code    || '',
    additional_notes: worker.additional_notes || '',
    availability: normaliseAvailability(worker.availability),
    client_ids: Array.isArray(worker.client_ids) ? worker.client_ids : [],
  });
  const [saving, setSaving] = useState(false);
  const [pickerCompany, setPickerCompany] = useState(null);
  const [clientCache, setClientCache] = useState({});  // {id: {name, company_label}}

  // Validate availability: every enabled day must have end > start.
  const availabilityError = useMemo(() => {
    for (const d of DAYS) {
      const row = f.availability[d.key];
      if (row.enabled && row.start >= row.end) {
        return `${d.label}: end time must be after start time`;
      }
    }
    return null;
  }, [f.availability]);

  // Hydrate client cache for any already-selected IDs we don't have names for.
  useEffect(() => {
    const missing = f.client_ids.filter((id) => !clientCache[id]);
    if (!missing.length) return;
    (async () => {
      try {
        const { data } = await api.get('/integrations/simpro/customers?company=both');
        const cache = {};
        (data.customers || []).forEach((c) => {
          cache[c.simpro_customer_id] = { name: c.name, company_label: c.company_label };
        });
        setClientCache((prev) => ({ ...prev, ...cache }));
      } catch (e) { /* silent — chips will fall back to raw id */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.client_ids.length]);

  const submit = async (e) => {
    e?.preventDefault();
    if (!f.first_name.trim()) return;
    if (availabilityError) { toast.error(availabilityError); return; }
    if (f.postal_code && !/^\d{4}$/.test(f.postal_code)) { toast.error('Postal code must be 4 digits'); return; }
    setSaving(true);
    try {
      const body = {
        ...f,
        // Compact availability — only send rows that are enabled OR have non-default times.
        availability: f.availability,
      };
      if (isNew) {
        await api.post('/workers', body);
        toast.success('Worker added');
      } else {
        await api.patch(`/workers/${worker.id}`, body);
        toast.success('Worker updated');
      }
      onSaved();
    } catch (err) { toast.error(apiError(err)); }
    finally { setSaving(false); }
  };

  const dayRow = (d) => {
    const row = f.availability[d.key];
    const setRow = (patch) => setF({ ...f, availability: { ...f.availability, [d.key]: { ...row, ...patch } } });
    const enabled = row.enabled;
    const invalid = enabled && row.start >= row.end;
    return (
      <div key={d.key}
        className={`flex items-center gap-3 px-3 py-2 rounded-lg ${enabled ? 'bg-[#e6eff9]' : 'bg-slate-50'} ${invalid ? 'ring-1 ring-[#e69aa3]' : ''}`}
        data-testid={`availability-${d.key}`}>
        <label className="inline-flex items-center gap-2 w-28 cursor-pointer">
          <input type="checkbox" checked={enabled} onChange={(e) => setRow({ enabled: e.target.checked })}
            data-testid={`availability-${d.key}-toggle`}
            className="w-4 h-4 rounded text-[#1e4a8c]" />
          <span className={`text-sm font-medium ${enabled ? 'text-[#1e4a8c]' : 'text-slate-500'}`}>{d.label}</span>
        </label>
        <input type="time" value={row.start} onChange={(e) => setRow({ start: e.target.value })}
          disabled={!enabled} data-testid={`availability-${d.key}-start`}
          className="px-2 py-1 text-sm border border-slate-300 rounded disabled:bg-slate-100 disabled:text-slate-400" />
        <span className="text-xs text-slate-400">to</span>
        <input type="time" value={row.end} onChange={(e) => setRow({ end: e.target.value })}
          disabled={!enabled} data-testid={`availability-${d.key}-end`}
          className="px-2 py-1 text-sm border border-slate-300 rounded disabled:bg-slate-100 disabled:text-slate-400" />
        {invalid && <span className="text-[11px] text-[#7a1f33] font-medium">End must be after start</span>}
      </div>
    );
  };

  const enabledDayCount = Object.values(f.availability).filter((r) => r.enabled).length;

  // v160.3.4c — Aggregate data for the section summary chips. Mirrors the
  // treatment on the read-only VIEW modal so admins get the same at-a-glance
  // signal from either entry point.
  const [aggCerts, setAggCerts] = useState(null);
  const [aggHr, setAggHr] = useState(null);
  const [aggUnmatched, setAggUnmatched] = useState(null);
  useEffect(() => {
    if (!worker?.id) return;
    let alive = true;
    api.get(`/workers/${worker.id}/certifications`)
      .then((r) => { if (alive) setAggCerts(r.data || []); })
      .catch(() => { if (alive) setAggCerts([]); });
    api.get(`/workers/${worker.id}/hr-documents`)
      .then((r) => { if (alive) setAggHr((r.data?.documents || []).length); })
      .catch(() => { if (alive) setAggHr(null); });
    api.get(`/workers/${worker.id}/unmatched-documents`)
      .then((r) => { if (alive) setAggUnmatched((r.data?.documents || []).length); })
      .catch(() => { if (alive) setAggUnmatched(null); });
    return () => { alive = false; };
  }, [worker?.id]);
  const certAgg = useMemo(() => summariseCertifications(aggCerts || []), [aggCerts]);

  const personalFilled = personalFilledCount(f);

  const certBadges = (
    <>
      {certAgg.total === 0 ? (
        <EditSummaryPill tone="manual" testid="edit-section-certs-empty">No items</EditSummaryPill>
      ) : (
        <EditSummaryPill testid="edit-section-certs-total">{certAgg.total} items</EditSummaryPill>
      )}
      {certAgg.simpro > 0 && (
        <EditSummaryPill tone="simpro" testid="edit-section-certs-simpro">Simpro · {certAgg.simpro}</EditSummaryPill>
      )}
      {certAgg.manual > 0 && (
        <EditSummaryPill tone="manual" testid="edit-section-certs-manual">Manual · {certAgg.manual}</EditSummaryPill>
      )}
      {certAgg.pending > 0 && (
        <EditSummaryPill tone="pending" testid="edit-section-certs-pending">Pending · {certAgg.pending}</EditSummaryPill>
      )}
      {certAgg.missing > 0 && (
        <EditSummaryPill tone="warn" testid="edit-section-certs-missing"
          title={`${certAgg.missing} cert(s) have no attached file`}>
          <AlertTriangle size={10} /> {certAgg.missing} missing file
        </EditSummaryPill>
      )}
      {certAgg.expired > 0 && (
        <EditSummaryPill tone="expired" testid="edit-section-certs-expired">
          {certAgg.expired} expired
        </EditSummaryPill>
      )}
      {certAgg.expiringSoon > 0 && (
        <EditSummaryPill tone="pending" testid="edit-section-certs-expiring">
          {certAgg.expiringSoon} expiring
        </EditSummaryPill>
      )}
    </>
  );
  const inductionsBadges = (
    <>
      {certAgg.inductions === 0 ? (
        <EditSummaryPill tone="manual" testid="edit-section-inductions-empty">No content</EditSummaryPill>
      ) : (
        <EditSummaryPill tone="violet" testid="edit-section-inductions-count">
          {certAgg.inductions} inductions
        </EditSummaryPill>
      )}
      {Object.entries(certAgg.inductionsByFolder)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([folder, n]) => {
          const label = folder.length > 20 ? folder.slice(0, 18) + '…' : folder;
          return (
            <EditSummaryPill
              key={folder}
              tone="neutral"
              testid={`edit-section-inductions-folder-${folder.replace(/\s+/g, '-').toLowerCase()}`}
              title={folder}
            >
              {label} · {n}
            </EditSummaryPill>
          );
        })}
    </>
  );
  const personalBadges = (
    <>
      {personalFilled > 0 ? (
        <EditSummaryPill testid="edit-section-personal-filled">
          {personalFilled} / 5 fields set
        </EditSummaryPill>
      ) : (
        <EditSummaryPill tone="manual" testid="edit-section-personal-empty">Not set</EditSummaryPill>
      )}
      {aggHr != null && aggHr > 0 && (
        <EditSummaryPill tone="hr" testid="edit-section-personal-hr">
          HR docs · {aggHr}
        </EditSummaryPill>
      )}
      {aggUnmatched != null && aggUnmatched > 0 && (
        <EditSummaryPill tone="warn" testid="edit-section-personal-unmatched"
          title="Documents awaiting triage on the read-only view">
          <AlertTriangle size={10} /> Unmatched · {aggUnmatched}
        </EditSummaryPill>
      )}
    </>
  );
  const availabilityBadges = (
    enabledDayCount === 0
      ? <EditSummaryPill tone="manual" testid="edit-section-avail-empty">Not set</EditSummaryPill>
      : <EditSummaryPill testid="edit-section-avail-count">{enabledDayCount} day{enabledDayCount === 1 ? '' : 's'}</EditSummaryPill>
  );
  const clientsBadges = (
    (f.client_ids || []).length === 0
      ? <EditSummaryPill tone="manual" testid="edit-section-clients-empty">0</EditSummaryPill>
      : <EditSummaryPill testid="edit-section-clients-count">{f.client_ids.length} assigned</EditSummaryPill>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/30 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()} data-testid="worker-edit-modal">
      <form onSubmit={submit} className="w-full max-w-5xl bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden max-h-[92vh] flex flex-col">
        <div className="px-6 py-4 border-b border-slate-200 bg-[#e6eff9]">
          <div className="flex items-start gap-3">
            {/* v160.3.4c — photo mirrored from the read-only VIEW modal */}
            {!isNew && <EditWorkerPhoto worker={worker} />}
            <div className="min-w-0 flex-1">
              <div className="text-[10px] uppercase tracking-[0.16em] font-semibold text-[#1e4a8c]">{isNew ? 'New worker' : 'Edit worker'}</div>
              <h2 className="font-display text-xl font-semibold text-slate-900 mt-0.5">{isNew ? 'Add worker' : fullName(worker)}</h2>
              {!isNew && (
                <p className="mt-1.5 text-xs text-slate-600/80 leading-relaxed max-w-3xl">
                  Manage identity, address, availability, client assignments and certifications.
                  Personal details and cert files are safe to edit here — Simpro-synced fields refresh on next sync.
                </p>
              )}
            </div>
          </div>
        </div>
        {isSimpro && (
          <div className="px-6 py-2 text-xs text-[#1e4a8c] bg-[#e6eff9]/60 border-b border-[#b9d2ec] flex items-center gap-1.5">
            <Plug size={12} /> Synced from Simpro — name, email and phone get refreshed on the next sync. Personal, availability and client assignments are safe to edit here.
          </div>
        )}

        {/* v160.3.9.34.5 — Extra bottom padding on the modal's scroll
            container so the LAST collapsible section (ID Card) can
            fully scroll into view above the sticky footer. Previous
            `scroll-margin-block-end: 96px` on the section alone was
            insufficient — the browser would honour it during focus
            scroll but not during our own auto-scroll on expand.
            Combined with the new `scrollIntoView` effect in
            `IdCardSection`, this guarantees photo + QR + Upload Photo
            + Print layout are all revealed above the footer. */}
        <div
          className="px-6 py-4 pb-24 overflow-y-auto space-y-3 text-sm flex-1"
          data-testid="worker-edit-modal-scroll"
        >
          {/* Identity — always-on */}
          <div className="border border-slate-200 rounded-xl px-4 py-4 bg-white" data-testid="section-identity">
            <div className="flex items-center gap-2 mb-3 text-slate-800 font-semibold text-sm"><HardHat size={14} className="text-slate-500" /> Identity & contact</div>
            <div className="grid grid-cols-2 gap-3">
              <label><span className="block text-xs font-medium text-slate-700 mb-1">First name *</span>
                <input value={f.first_name} onChange={(e) => setF({ ...f, first_name: e.target.value })}
                  data-testid="worker-first-name" className="w-full px-3 py-2 border border-slate-300 rounded-lg" required /></label>
              <label><span className="block text-xs font-medium text-slate-700 mb-1">Last name</span>
                <input value={f.last_name} onChange={(e) => setF({ ...f, last_name: e.target.value })}
                  data-testid="worker-last-name" className="w-full px-3 py-2 border border-slate-300 rounded-lg" /></label>
              <label className="col-span-2"><span className="block text-xs font-medium text-slate-700 mb-1">Email</span>
                <input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })}
                  data-testid="worker-email" className="w-full px-3 py-2 border border-slate-300 rounded-lg" /></label>
              <label><span className="block text-xs font-medium text-slate-700 mb-1">Phone</span>
                <input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })}
                  data-testid="worker-phone" className="w-full px-3 py-2 border border-slate-300 rounded-lg" /></label>
              <label><span className="block text-xs font-medium text-slate-700 mb-1">Mobile</span>
                <input value={f.mobile} onChange={(e) => setF({ ...f, mobile: e.target.value })}
                  data-testid="worker-mobile" className="w-full px-3 py-2 border border-slate-300 rounded-lg" /></label>
              <label className="col-span-2"><span className="block text-xs font-medium text-slate-700 mb-1">Position</span>
                <input value={f.position} onChange={(e) => setF({ ...f, position: e.target.value })}
                  data-testid="worker-position" className="w-full px-3 py-2 border border-slate-300 rounded-lg" /></label>
              <label className="col-span-2 inline-flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={!!f.active} onChange={(e) => setF({ ...f, active: e.target.checked })}
                  data-testid="worker-active-toggle" className="w-4 h-4 rounded text-emerald-500" />
                <span className="text-sm text-slate-700">Active</span>
              </label>
            </div>
          </div>

          {/* Personal */}
          <Section icon={MapPin} title="Personal" testid="section-personal"
            badges={personalBadges}
            defaultOpen={false}>
            <div className="grid grid-cols-2 gap-3">
              <label><span className="block text-xs font-medium text-slate-700 mb-1">Birth date</span>
                <input type="date" value={f.birth_date} onChange={(e) => setF({ ...f, birth_date: e.target.value })}
                  data-testid="worker-birth-date" className="w-full px-3 py-2 border border-slate-300 rounded-lg" /></label>
              <label><span className="block text-xs font-medium text-slate-700 mb-1">Country</span>
                <select value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })}
                  data-testid="worker-country" className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white">
                  <option value="Australia">Australia</option>
                  <option value="Other">Other</option>
                </select></label>
              <label><span className="block text-xs font-medium text-slate-700 mb-1">State</span>
                <select value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })}
                  data-testid="worker-state" className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white">
                  <option value="">—</option>
                  {AU_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select></label>
              <label><span className="block text-xs font-medium text-slate-700 mb-1">Postal code</span>
                <input value={f.postal_code} maxLength={4}
                  onChange={(e) => setF({ ...f, postal_code: e.target.value.replace(/\D/g, '').slice(0, 4) })}
                  data-testid="worker-postal-code" placeholder="2000"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg" /></label>
              <label className="col-span-2"><span className="block text-xs font-medium text-slate-700 mb-1">Street address</span>
                <input value={f.street_address} onChange={(e) => setF({ ...f, street_address: e.target.value })}
                  data-testid="worker-street-address" className="w-full px-3 py-2 border border-slate-300 rounded-lg" /></label>
              <label className="col-span-2"><span className="block text-xs font-medium text-slate-700 mb-1">Suburb</span>
                <input value={f.suburb} onChange={(e) => setF({ ...f, suburb: e.target.value })}
                  data-testid="worker-suburb" className="w-full px-3 py-2 border border-slate-300 rounded-lg" /></label>
            </div>
          </Section>

          {/* Availability */}
          <Section icon={Calendar} title="Availability" testid="section-availability"
            badges={availabilityBadges}
            defaultOpen={false}>
            <div className="space-y-1.5">
              {DAYS.map(dayRow)}
            </div>
            {availabilityError && (
              <div className="mt-2 text-xs text-[#7a1f33] font-medium" data-testid="availability-error">{availabilityError}</div>
            )}
          </Section>

          {/* Clients */}
          <Section icon={Users} title="Clients" testid="section-clients"
            badges={clientsBadges}
            defaultOpen={false}>
            <div className="text-xs text-slate-500 mb-2">Populate from SimPRO:</div>
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              {CLIENT_SOURCES.map((s) => (
                <button key={s.value} type="button" onClick={() => setPickerCompany(s.value)}
                  data-testid={`populate-${s.value}`}
                  className={`text-xs font-semibold uppercase tracking-wider px-3 py-1.5 rounded-full ${s.tint}`}>
                  {s.label}
                </button>
              ))}
            </div>
            {f.client_ids.length === 0 ? (
              <div className="text-xs text-slate-400 italic">No clients assigned yet.</div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {f.client_ids.map((id) => {
                  const meta = clientCache[id];
                  return (
                    <span key={id} data-testid={`client-chip-${id}`}
                      className="inline-flex items-center gap-1.5 px-2 py-1 bg-slate-100 border border-slate-200 rounded-full text-xs">
                      <span className="text-slate-700">{meta?.name || `Customer #${id}`}</span>
                      {meta?.company_label && <CompanyChip label={meta.company_label} />}
                      <button type="button" onClick={() => setF({ ...f, client_ids: f.client_ids.filter((x) => x !== id) })}
                        data-testid={`client-chip-remove-${id}`}
                        className="text-slate-400 hover:text-[#7a1f33]"><X size={11} /></button>
                    </span>
                  );
                })}
              </div>
            )}
          </Section>

          {/* Certifications */}
          {!isNew && (
            <CertificationsPanel workerId={worker.id} canEdit={true} />
          )}

          {/* Phase 3.11 — Inductions snapshot from the live matrix */}
          {!isNew && (
            <Section icon={Award} title="Inductions" testid="section-inductions"
              badges={inductionsBadges}>
              <WorkerInductionsCard workerId={worker.id} workerName={[worker.first_name, worker.last_name].filter(Boolean).join(' ')} />
            </Section>
          )}

          {/* Phase 4.1 — ID Card (printable wallet/lanyard PDFs + NFC pairing). */}
          {!isNew && (
            <IdCardSection worker={worker} canEdit={true} />
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-200 flex justify-between items-center gap-2 bg-slate-50" data-testid="worker-edit-modal-footer">
          <div className="text-[11px] text-slate-400">{availabilityError ? availabilityError : ''}</div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-100" data-testid="modal-cancel">Cancel</button>
            <button type="submit" disabled={saving || !!availabilityError} data-testid="modal-save"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1e4a8c] text-white text-sm font-semibold uppercase tracking-wider hover:bg-[#143263] disabled:opacity-60 disabled:cursor-not-allowed">
              {saving ? <Loader2 size={14} className="animate-spin" /> : null} {isNew ? 'Create' : 'Update'}
            </button>
          </div>
        </div>
      </form>

      {pickerCompany && (
        <ClientPicker company={pickerCompany} selectedIds={f.client_ids}
          onClose={() => setPickerCompany(null)}
          onApply={(ids) => { setF({ ...f, client_ids: ids }); setPickerCompany(null); }} />
      )}
    </div>
  );
}

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function exportCsv(rows) {
  const headers = ['first_name', 'last_name', 'email', 'phone', 'mobile', 'position',
                   'company_label', 'state', 'suburb', 'active', 'simpro_employee_id', 'clients_count'];
  const lines = [headers.join(',')];
  for (const r of rows) {
    const enriched = { ...r, clients_count: (r.client_ids || []).length };
    lines.push(headers.map((h) => csvCell(enriched[h])).join(','));
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `workers-export-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

export default function Workers() {
  const user = getUser();
  // v160.3.9.29-2c — Migrated from WRITE_ROLES to granular workers tokens.
  const can = useCan();
  const canEdit = can('workers', 'edit');
  // v160.3.9.32-4c.1 — Rehomed BulkSimproZipModal state.
  const [bulkZipOpen, setBulkZipOpen] = useState(false);
  const canDelete = can('workers', 'delete');
  void user; void WRITE_ROLES; void canDelete;

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [viewingId, setViewingId] = useState(null); // v160.2.2 — read-only drawer
  const [viewingDefaultTab, setViewingDefaultTab] = useState(null); // v160.3.4a — deep-link from Dashboard triage tile
  // Deep-link from Dashboard triage tile: `?open=<id>&tab=unmatched`
  const [sp, setSp] = useSearchParams();
  useEffect(() => {
    const openId = sp.get('open');
    if (openId) {
      setViewingId(openId);
      setViewingDefaultTab(sp.get('tab') || 'profile');
      // Consume the query param so a page refresh doesn't re-open.
      const next = new URLSearchParams(sp);
      next.delete('open'); next.delete('tab');
      setSp(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [search, setSearch] = useState('');
  const [syncOpen, setSyncOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [selected, setSelected] = useState(new Set());
  // Phase 3.11 — Directory + Inductions Matrix tabs.
  const [tab, setTab] = useState('directory');
  // Per-worker induction-status chip map (loaded once with the matrix call).
  const [chipByWorker, setChipByWorker] = useState({});
  // v160.3.6 — Per-worker Simpro-ZIP application status. Powers the
  // "ZIP APPLIED / ZIP MISSING / MANUAL" row chip so admins can spot
  // the ZIP-missing backlog at a glance.
  const [zipStatusByWorker, setZipStatusByWorker] = useState({});
  // Phase 4.7.1 — map of email → { id, status } so we can render the
  // AccessKebab on linked rows or a "Create login" button otherwise.
  const [userByEmail, setUserByEmail] = useState({});

  const loadUsers = async () => {
    if (!canEdit) return; // worker-role view doesn't need this
    try {
      const { data } = await api.get('/users');
      const map = {};
      (data || []).forEach((u) => {
        if (u.email) map[u.email.toLowerCase()] = u; // Phase 4.7.2 — keep the full record so the pill can derive from invite_pending/is_locked
      });
      setUserByEmail(map);
    } catch (_) { /* silent — non-admins get 403, expected */ }
  };

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/workers');
      setRows(data || []);
      // Best-effort: also fetch the matrix to decorate rows with status chips.
      // Worker role still gets 200 here; if it fails we just skip chips.
      try {
        const mx = await api.get('/workers/inductions/matrix');
        const m = {}; (mx.data?.rows || []).forEach((r) => { m[r.id] = r.chip; });
        setChipByWorker(m);
      } catch (_) { /* silent */ }
      // v160.3.6 — pull ZIP status alongside so the chip row can render
      // ZIP APPLIED / MISSING / MANUAL. Admin-gated on the server.
      try {
        const z = await api.get('/integrations/simpro/workers/zip-status');
        setZipStatusByWorker(z.data?.workers || {});
      } catch (_) { /* worker/supervisor may 403 — expected */ }
    } catch (e) { toast.error(apiError(e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); loadUsers(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // v160.3.6a — sortable column headers on the Directory tab.
  // Persisted in `?sortk=<col>&sortd=asc|desc`. Default: name asc.
  // v160.3.7aj — When the URL has no `sortk`/`sortd` we fall back to
  // the last remembered choice from `paneltec_list_sort:workers` so a
  // fresh visit to /app/settings/workers restores the operator's
  // preference. Clicks still update BOTH the URL (for share/bookmark)
  // AND the localStorage cache (for next fresh visit).
  const _workerSortDefault = loadListSort('workers', { key: 'name', dir: 'asc' });
  const sortKey = sp.get('sortk') || _workerSortDefault.key;
  const sortDir = (sp.get('sortd') === 'desc' || sp.get('sortd') === 'asc')
    ? sp.get('sortd')
    : _workerSortDefault.dir;
  const setSort = (nextKey) => {
    const next = new URLSearchParams(sp);
    let nextDir;
    if (sortKey === nextKey) {
      nextDir = sortDir === 'asc' ? 'desc' : 'asc';
      next.set('sortd', nextDir);
    } else {
      nextDir = 'asc';
      next.set('sortk', nextKey);
      next.set('sortd', nextDir);
    }
    saveListSort('workers', nextKey, nextDir);
    setSp(next, { replace: true });
  };
  const _zipRank = (w) => {
    // Sort weight: MISSING (0) → APPLIED (1) → MANUAL (2). Puts the
    // admin's backlog at the top of an ascending sort.
    const zs = zipStatusByWorker[w.id];
    if (!zs) return 3;
    if (!zs.simpro_sourced) return 2;
    return zs.zip_applied ? 1 : 0;
  };
  const _statusRank = (w) => {
    const u = w.email ? userByEmail[w.email.toLowerCase()] : null;
    if (u?.is_locked) return 3;
    if (u?.invite_pending && u?.status !== 'disabled') return 2;
    if (u?.status === 'disabled') return 4;
    return w.active ? 0 : 1;
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = rows;
    if (q) {
      list = rows.filter((r) => {
        const blob = `${fullName(r)} ${r.email || ''} ${r.phone || ''} ${r.mobile || ''} ${r.suburb || ''} ${r.state || ''}`.toLowerCase();
        return blob.includes(q);
      });
    }
    // Apply sort AFTER filtering — searching + sorting compose.
    const dir = sortDir === 'desc' ? -1 : 1;
    const key = sortKey;
    const strCmp = (a, b) => String(a || '').toLowerCase().localeCompare(String(b || '').toLowerCase());
    const sorted = [...list].sort((a, b) => {
      let cmp = 0;
      if (key === 'name') cmp = strCmp(fullName(a), fullName(b));
      else if (key === 'email') cmp = strCmp(a.email, b.email);
      else if (key === 'phone') cmp = strCmp(a.mobile || a.phone, b.mobile || b.phone);
      else if (key === 'company') cmp = strCmp(a.company_label, b.company_label);
      else if (key === 'profile') cmp = _zipRank(a) - _zipRank(b);
      else if (key === 'status') cmp = _statusRank(a) - _statusRank(b);
      // Stable secondary sort by name to avoid flicker between equal keys.
      if (cmp === 0) cmp = strCmp(fullName(a), fullName(b));
      return cmp * dir;
    });
    return sorted;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, search, sortKey, sortDir, zipStatusByWorker, userByEmail]);

  const sync = async (company) => {
    setSyncOpen(false);
    setSyncing(true);
    try {
      const { data } = await api.post('/workers/sync-from-simpro', { company });
      toast.success(`Sync complete · ${data.created} new, ${data.updated} updated, ${data.skipped} skipped`);
      await load();
    } catch (e) { toast.error(apiError(e)); }
    finally { setSyncing(false); }
  };

  const remove = async (w) => {
    try {
      await api.delete(`/workers/${w.id}`);
      toast.success(`${fullName(w)} removed`);
      setConfirmDelete(null);
      await load();
    } catch (e) { toast.error(apiError(e)); }
  };

  // Phase 4.7.1 — admin "Create login" for a worker without a linked user
  // account. Defaults role=worker and no workspace assignments (admin can
  // refine later via Users admin). Returns the new user.id which we splice
  // into userByEmail so the kebab shows up immediately.
  const createLogin = async (w) => {
    if (!w.email) { toast.error('Worker has no email — add one first.'); return; }
    try {
      const { data } = await api.post('/users', {
        email: w.email, name: fullName(w), role: 'worker', workspace_ids: [],
      });
      setUserByEmail((m) => ({ ...m, [w.email.toLowerCase()]: data }));
      toast.success('Login created — use the kebab to send the invite.');
    } catch (e) { toast.error(apiError(e)); }
  };

  const toggleSel = (id) => setSelected((p) => {
    const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

  // Phase 4.1 — one-click wallet PDF from the row. Opens in a new tab so the
  // user can hit Cmd-P / Ctrl-P from the browser preview.
  const printWalletCard = async (w) => {
    try {
      const r = await api.get(`/workers/${w.id}/id-card.pdf`, {
        params: { layout: 'wallet' }, responseType: 'blob',
      });
      // v148 — stashInlinePdf → same-origin URL (ad-blocker-safe).
      const { src } = await stashInlinePdf(r.data, `worker-${w.id.slice(0, 8)}-wallet.pdf`);
      const win = window.open(src, '_blank');
      if (!win) toast.error('Pop-up blocked — open the worker drawer and use Download instead.');
    } catch (e) { toast.error(apiError(e)); }
  };

  return (
    <div className="max-w-7xl mx-auto" data-testid="workers-page">
      <PageHeader crumb="Settings / Workers" title="Workers"
        subtitle="Your field crew — synced from Simpro or added manually."
        action={canEdit ? (
          <button
            type="button"
            onClick={() => setBulkZipOpen(true)}
            title="Uploads certification tickets, licence PDFs, inductions, HR documents, and photos exported from Simpro."
            data-testid="workers-bulk-zip-btn"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-700 text-white text-sm font-semibold hover:bg-emerald-800 shadow-sm"
          >
            <DownloadLucide size={14} /> Import Simpro worker files
          </button>
        ) : null}
      />
      {/* v160.3.9.32-4c.2 — Simpro attachment help note, moved from
          UsersManagement.jsx (that page no longer has a ZIP affordance). */}
      {canEdit && (
        <div className="mt-2 text-xs text-slate-500" data-testid="simpro-import-guide-link">
          Need help importing Simpro attachments?{' '}
          <Link to="/app/settings/help/simpro-import" className="text-blue-600 hover:underline">
            See the Simpro import guide →
          </Link>
        </div>
      )}
      {/* v160.3.9.33.2 — photo reminder banner (mirrors the one on Users) */}
      {canEdit && (
        <DismissibleHint
          storageKey="paneltec.hint.workers-zip-photos-v33_2"
          testId="workers-photo-hint"
          text="Missing photos on your users? A fresh Simpro ZIP export uploaded here will populate worker photos + link them to Users."
        />
      )}

      {/* Phase 3.11 — tab switcher: Directory vs Inductions Matrix.
          v160.3.6z — Reverted to EQUAL-WEIGHT segmented pill (v6h look).
          Both tabs read as first-class buttons: same size, same font, both
          get the filled Paneltec-blue capsule when active. Directory and
          Inductions Matrix are equally important on this page — no hero/
          secondary hierarchy. (The 7 list-heavy pages keep their v6p
          hero treatment; only Workers uses this equal-weight variant.) */}
      <div
        className="mb-4 inline-flex h-10 items-center gap-1 rounded-full bg-white/90 border border-slate-200 p-1 shadow-sm"
        data-testid="workers-tabs"
        role="tablist"
      >
        <button
          type="button"
          onClick={() => setTab('directory')}
          data-testid="tab-directory"
          role="tab"
          aria-selected={tab === 'directory'}
          className={[
            'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider transition-all cursor-pointer',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1e4a8c]/40',
            tab === 'directory'
              ? 'bg-[#1e4a8c] text-white shadow'
              : 'text-slate-700 hover:bg-slate-100',
          ].join(' ')}
        >
          Directory
        </button>
        <button
          type="button"
          onClick={() => setTab('matrix')}
          data-testid="tab-matrix"
          role="tab"
          aria-selected={tab === 'matrix'}
          className={[
            'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider transition-all cursor-pointer',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1e4a8c]/40',
            tab === 'matrix'
              ? 'bg-[#1e4a8c] text-white shadow'
              : 'text-slate-700 hover:bg-slate-100',
          ].join(' ')}
        >
          Inductions Matrix
        </button>
      </div>

      {tab === 'matrix' ? (
        <InductionsMatrix onWorkerClick={(w) => {
          // Look up the full worker row (matrix payload only has a slim view).
          const full = rows.find((r) => r.id === w.id);
          if (full) setEditing(full);
        }} />
      ) : (
      <>
      <div className="mb-4 flex items-center gap-2 flex-wrap" data-testid="workers-toolbar">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email, phone or state…" data-testid="search-input"
            className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/30" />
        </div>
        <button onClick={() => exportCsv(filtered)} disabled={filtered.length === 0} data-testid="export-csv"
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          <Download /> Export CSV
        </button>
        {canEdit && (
          <div className="relative">
            <button onClick={() => setSyncOpen((v) => !v)} disabled={syncing} data-testid="sync-dropdown"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#0093D0] text-white text-sm font-semibold border border-[#0093D0] hover:bg-[#0079AB] hover:border-[#0079AB] focus:outline-none focus:ring-2 focus:ring-[#0093D0]/40 disabled:opacity-60 shadow-sm">
              {syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw />} Sync from Simpro <ChevronDown size={12} />
            </button>
            {syncOpen && (
              <div className="absolute right-0 z-20 mt-1 w-48 bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden">
                {SYNC_OPTIONS.map((o) => (
                  <button key={o.value} onClick={() => sync(o.value)} data-testid={`sync-${o.value}`}
                    className="block w-full text-left px-3 py-2 text-sm hover:bg-[#e6eff9] hover:text-[#1e4a8c]">
                    {o.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="flex-1" />
        {/* v160.3.9.34.1 — Manual "Add worker" affordance removed. Workers now
            come exclusively from Simpro (ZIP import + delta sync). The
            public `POST /api/workers` endpoint returns 410 Gone. */}
      </div>

      {loading ? (
        <div className="text-sm text-slate-500 inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading workers…</div>
      ) : filtered.length === 0 ? (
        <EmptyState title={search ? 'No workers match' : 'No workers yet'}
          body={search
            ? 'Try a different search term.'
            : 'Workers come from Simpro. Upload the ZIP export via "Import Simpro worker files" above.'}
          action={null} />
      ) : (
        // v160.3.6e — Card-row grid layout. The previous <table> was
        // overflowing (STATUS clipped to "AC...", ACTION icons ghosting
        // outside the row). Every row now shares the same
        // grid-template-columns as the sort header, so widths cannot drift.
        // Column budget (~970px min): 40 identity 220 phone 110 company 90
        // chips 200 status 120 action 190. Fits in ≥1280 viewports without
        // horizontal scroll; below that a scrollbar appears via overflow-x-auto.
        <div className="rounded-2xl border border-slate-200 bg-white overflow-x-auto" data-testid="workers-table">
          <div className="min-w-[980px]">
            {/* Sort header row */}
            <div
              className="grid items-center bg-slate-50 border-b border-slate-200 text-slate-500 text-[10px] uppercase tracking-wider px-3 py-3 gap-3"
              style={{ gridTemplateColumns: '40px minmax(220px, 2.4fr) minmax(110px, 1fr) 90px minmax(200px, 1.8fr) 120px 190px' }}
            >
              <div />
              <SortHeaderBtn label="Name" k="name" sortKey={sortKey} sortDir={sortDir} onClick={setSort} />
              <SortHeaderBtn label="Phone" k="phone" sortKey={sortKey} sortDir={sortDir} onClick={setSort} />
              <SortHeaderBtn label="Company" k="company" sortKey={sortKey} sortDir={sortDir} onClick={setSort} />
              <SortHeaderBtn label="Profile" k="profile" sortKey={sortKey} sortDir={sortDir} onClick={setSort} title="Sort by Simpro ZIP status" />
              <SortHeaderBtn label="Status" k="status" sortKey={sortKey} sortDir={sortDir} onClick={setSort} />
              <div className="text-right">Action</div>
            </div>

            {filtered.map((w) => {
              const clientsCount = (w.client_ids || []).length;
              return (
                <div
                  key={w.id}
                  data-testid={`worker-row-${w.id}`}
                  className="grid items-center border-t border-slate-100 hover:bg-slate-50 px-3 py-3 gap-3"
                  style={{ gridTemplateColumns: '40px minmax(220px, 2.4fr) minmax(110px, 1fr) 90px minmax(200px, 1.8fr) 120px 190px' }}
                >
                  {/* Selection */}
                  <div>
                    <input type="checkbox" checked={selected.has(w.id)} onChange={() => toggleSel(w.id)}
                      data-testid={`select-${w.id}`}
                      className="w-3.5 h-3.5 cursor-pointer" />
                  </div>

                  {/* Identity — photo + name / role / email stacked */}
                  <div className="flex items-center gap-2.5 min-w-0">
                    <WorkerRowPhoto worker={w} />
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900 truncate">{fullName(w)}</div>
                      {w.position && <div className="text-[11px] text-slate-500 mt-0.5 truncate">{w.position}</div>}
                      {w.email && <div className="text-[11px] text-slate-500 truncate" title={w.email}>{w.email}</div>}
                    </div>
                  </div>

                  {/* Phone */}
                  <div className="text-xs text-slate-500 truncate" title={w.mobile || w.phone || ''}>
                    {w.mobile || w.phone || '—'}
                  </div>

                  {/* Company */}
                  <div className="min-w-0"><CompanyChip label={w.company_label} /></div>

                  {/* Profile chips — QR / ZIP / CERTS / state / clients / NFC / induction */}
                  <div className="flex flex-wrap items-center gap-1 min-w-0">
                    {w.state ? (
                      <span data-testid={`chip-state-${w.id}`}
                        className="inline-flex items-center gap-0.5 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                        <MapPin size={9} /> {w.state}
                      </span>
                    ) : null}
                    {clientsCount > 0 ? (
                      <span data-testid={`chip-clients-${w.id}`}
                        className="inline-flex items-center gap-0.5 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#e6eff9] text-[#1e4a8c]">
                        <Users size={9} /> {clientsCount}
                      </span>
                    ) : null}
                    {w.nfc_uid ? (
                      <span data-testid={`chip-nfc-${w.id}`} title={`NFC: ${w.nfc_uid}`}
                        className="inline-flex items-center gap-0.5 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#f5f3ff] text-[#5b21b6]">
                        <Smartphone size={9} /> NFC
                      </span>
                    ) : null}
                    {w.scan_token ? (
                      <span data-testid={`chip-qr-${w.id}`} title={`QR token: ${w.scan_token}`}
                        className="inline-flex items-center gap-0.5 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700">
                        <QrCode /> QR
                      </span>
                    ) : null}
                    {(() => {
                      const zs = zipStatusByWorker[w.id];
                      if (!zs) return null;
                      if (!zs.simpro_sourced) {
                        return (
                          <span data-testid={`chip-zip-${w.id}`}
                            title="Worker added manually — Simpro ZIP not applicable"
                            className="inline-flex items-center gap-0.5 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 border border-slate-200">
                            MANUAL
                          </span>
                        );
                      }
                      if (zs.zip_applied) {
                        return (
                          <span data-testid={`chip-zip-${w.id}`}
                            title={`Simpro ZIP imported — ${zs.cert_count} cert(s) on file`}
                            className="inline-flex items-center gap-0.5 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-200">
                            ZIP
                          </span>
                        );
                      }
                      return (
                        <span data-testid={`chip-zip-${w.id}`}
                          title="Simpro-sourced worker with NO ZIP imported yet — click Edit → Upload Simpro ZIP"
                          className="inline-flex items-center gap-0.5 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300">
                          ZIP MISSING
                        </span>
                      );
                    })()}
                    {(() => {
                      const v = chipByWorker[w.id];
                      const zs = zipStatusByWorker[w.id];
                      const certCount = zs?.cert_count || 0;
                      if (!v || v === 'unknown') {
                        if (certCount > 0) {
                          return (
                            <span data-testid={`chip-induction-${w.id}`}
                              title={`${certCount} cert(s) on file — matrix column mapping pending`}
                              className="inline-flex items-center gap-0.5 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#e6eff9] text-[#1e4a8c] border border-[#b9d2ec]">
                              <Award size={9} /> {certCount} CERTS
                            </span>
                          );
                        }
                        return (
                          <span data-testid={`chip-induction-${w.id}`}
                            title="No certifications on file"
                            className="inline-flex items-center gap-0.5 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-50 text-slate-400 border border-dashed border-slate-200">
                            <Award size={9} /> 0 CERTS
                          </span>
                        );
                      }
                      const labelMap = { current: 'OK', expiring: 'SOON', expiring_90: '90d', expired: 'EXP', invalid_date: 'INV', not_held: 'N/H', held_no_expiry: 'HELD' };
                      const fullMap  = { current: 'All current', expiring: 'Expiring 30d', expiring_90: 'Expiring 90d', expired: 'Has expired item(s)', invalid_date: 'Invalid date(s)', not_held: 'Not held', held_no_expiry: 'Held (no expiry)' };
                      return (
                        <span data-testid={`chip-induction-${w.id}`}
                          title={`Inductions: ${fullMap[v] || v}`}
                          className={`inline-flex items-center gap-0.5 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                            v === 'current' || v === 'held_no_expiry' ? 'bg-[#d8ecdd] text-[#1f7a3f]' :
                            v === 'expiring' ? 'bg-[#fef3c7] text-[#92400e]' :
                            v === 'expired' || v === 'invalid_date' ? 'bg-[#fbe4e7] text-[#7a1f33]' :
                            'bg-slate-100 text-slate-500'
                          }`}>
                          <Award size={9} /> {labelMap[v] || v.toUpperCase()}
                        </span>
                      );
                    })()}
                    {!w.state && clientsCount === 0 && !w.nfc_uid && !w.scan_token && !chipByWorker[w.id] && <span className="text-[11px] text-slate-300">—</span>}
                  </div>

                  {/* Status stack — Active + login-derived pill on their own lines */}
                  <div className="flex flex-col items-start gap-1 min-w-0">
                    <StatusBadge active={w.active} />
                    {(() => {
                      const u = w.email ? userByEmail[w.email.toLowerCase()] : null;
                      if (!u) return null;
                      let key = 'active', label = 'Active';
                      if (u.is_locked) { key = 'locked'; label = 'Locked'; }
                      else if (u.invite_pending && u.status !== 'disabled') { key = 'invited'; label = 'Invite pending'; }
                      else if (u.status === 'disabled') { key = 'disabled'; label = 'Disabled'; }
                      else if (u.status === 'invited') { key = 'invited'; label = 'Invite pending'; }
                      const map = {
                        active:   'bg-emerald-50 text-emerald-700 border border-emerald-200',
                        invited:  'bg-amber-50 text-amber-700 border border-amber-200',
                        locked:   'bg-rose-50 text-rose-700 border border-rose-200',
                        disabled: 'bg-slate-100 text-slate-600 border border-slate-200',
                      };
                      return (
                        <div className={`inline-flex items-center text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${map[key]}`}
                          data-testid={`worker-login-pill-${w.id}`}>
                          {label}
                        </div>
                      );
                    })()}
                  </div>

                  {/* Action icons — kept inside the row's white surface */}
                  <div className="flex justify-end">
                    {canEdit && confirmDelete !== w.id && (
                      <div className="inline-flex gap-1 items-center flex-wrap justify-end">
                        {(() => {
                          const u = w.email ? userByEmail[w.email.toLowerCase()] : null;
                          if (u) return (
                            <AccessKebab userId={u.id} canEdit={canEdit}
                              testIdSuffix={`worker-${w.id}`}
                              onAfterAction={loadUsers} />
                          );
                          if (w.email) return (
                            <button onClick={() => createLogin(w)} title="Create login account"
                              data-testid={`create-login-${w.id}`}
                              className="inline-flex items-center px-2 h-7 rounded bg-orange-50 text-orange-700 hover:bg-orange-100 text-[10px] font-semibold uppercase tracking-wider">
                              + Login
                            </button>
                          );
                          return null;
                        })()}
                        <button onClick={() => printWalletCard(w)} title="Print wallet card" data-testid={`print-${w.id}`}
                          className="inline-flex items-center justify-center w-7 h-7 rounded bg-[#f5f3ff] text-[#5b21b6] hover:bg-[#ece6f4]"><Printer /></button>
                        <button onClick={() => setViewingId(w.id)} title="View profile" data-testid={`view-${w.id}`}
                          className="inline-flex items-center justify-center w-7 h-7 rounded bg-slate-100 text-slate-700 hover:bg-slate-200"><EyeIcon /></button>
                        <button onClick={() => setEditing(w)} title="Edit" data-testid={`edit-${w.id}`}
                          className="inline-flex items-center justify-center w-7 h-7 rounded bg-[#e6eff9] text-[#1e4a8c] hover:bg-[#d8e6f4]"><Edit3 /></button>
                        <button onClick={() => setConfirmDelete(w.id)} title="Delete" data-testid={`delete-${w.id}`}
                          className="inline-flex items-center justify-center w-7 h-7 rounded bg-[#fbe4e7] text-[#7a1f33] hover:bg-[#f4c7cd]"><Trash2 /></button>
                      </div>
                    )}
                    {canEdit && confirmDelete === w.id && (
                      <span className="inline-flex items-center gap-1 bg-[#fbe4e7] border border-[#e69aa3] rounded px-2 py-1">
                        <span className="text-[10px] font-semibold text-[#7a1f33] uppercase tracking-wider">Delete?</span>
                        <button onClick={() => remove(w)} data-testid={`delete-confirm-${w.id}`} className="text-[10px] font-semibold text-[#7a1f33] hover:underline">Yes</button>
                        <button onClick={() => setConfirmDelete(null)} className="text-[10px] text-slate-500 hover:underline">No</button>
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      </>
      )}

      {/* EditModal lives OUTSIDE the tab conditional so it renders for both
          Directory and Inductions Matrix worker-click flows. */}
      {editing && (
        <EditModal worker={editing} onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }} />
      )}
      {/* v160.2.2 — Read-only worker profile drawer (eye icon). */}
      {viewingId && (
        <WorkerViewModal workerId={viewingId} defaultTab={viewingDefaultTab} onClose={() => { setViewingId(null); setViewingDefaultTab(null); }} />
      )}
      {/* v160.3.9.32-4c.1 — BulkSimproZipModal rehomed here from UsersManagement. */}
      {bulkZipOpen && (
        <BulkSimproZipModal
          onClose={() => setBulkZipOpen(false)}
          onDone={() => { load(); setBulkZipOpen(false); }}
        />
      )}
    </div>
  );
}
