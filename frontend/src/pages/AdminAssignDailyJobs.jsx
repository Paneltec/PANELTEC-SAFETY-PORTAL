// v58.13.132cf — Ad-hoc Job Assignments (was Assign Daily Jobs).
//
// Route: `/app/mobile/assign-daily-jobs` (kept for backwards-compat with
// bookmarks + the .132ab sidebar entry). Access: `admin` role only —
// mirrored on both the FE gate below and the strict `_require_admin`
// gate in `backend/mobile_daily_jobs*.py`.
//
// Layout:
//   Left panel     — assignee list (filtered to 3 role_ids), search,
//                    role-id chip filter, per-row role chip.
//   Center + Right — Date bar (Popover Calendar + ±1 arrows + Today),
//                    today's assignments, PDF drag-drop, form with
//                    Worker row at top, editable preamble, notes,
//                    Assign button.
//
// Backend endpoints used (all under `/api/mobile/`):
//   GET  /daily-jobs/admin/workers?q=&role_id=          → users filtered by target role_ids
//   GET  /daily-jobs/admin/sites?q=                     → distinct site names from simpro_jobs
//   GET  /daily-jobs/admin/assignments?date=YYYY-MM-DD  → today's rows (Sydney)
//   POST /daily-jobs/parse-pdf  (multipart)             → AI-parsed prefill
//   POST /daily-jobs                                    → create the row

import { useEffect, useMemo, useRef, useState } from 'react';
import api from '@/lib/api';
import { toast } from 'sonner';
import { getUser } from '@/lib/auth';
import {
  Loader2, Search, MapPin, User, Calendar as CalendarIcon,
  CheckCircle2, AlertTriangle, ChevronLeft, ChevronRight,
  Upload, Sparkles, FileText, X as XIcon, Trash2, RotateCcw,
} from 'lucide-react';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

// Sydney-local YYYY-MM-DD helper. Matches the backend `_today_iso()`
// change in `.132cf` so FE + BE always agree on "today".
function sydneyTodayIso() {
  // en-CA formats as YYYY-MM-DD; toLocaleDateString honours the TZ.
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' });
}

function isoAddDays(iso, delta) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

function fmtNiceDate(iso) {
  if (!iso) return '—';
  try {
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.toLocaleDateString('en-AU', {
      weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    });
  } catch { return iso; }
}

const ROLE_LABELS = {
  paneltec_civil:      'Paneltec Civil',
  viatec_traffic:      'Viatec Traffic',
  external_contractor: 'External Contractor',
};

const ROLE_CHIP_CLASS = {
  paneltec_civil:      'bg-orange-50 text-orange-800 border-orange-200',
  viatec_traffic:      'bg-blue-50 text-blue-800 border-blue-200',
  external_contractor: 'bg-slate-50 text-slate-700 border-slate-200',
};

export default function AdminAssignDailyJobs() {
  const user = getUser() || {};
  const role = (user?.role || '').toLowerCase();
  const isAdmin = role === 'admin';

  const [date, setDate] = useState(sydneyTodayIso());
  const [datePickerOpen, setDatePickerOpen] = useState(false);

  const [workers, setWorkers] = useState([]);
  const [workerQuery, setWorkerQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [selectedWorker, setSelectedWorker] = useState(null);
  const [loadingWorkers, setLoadingWorkers] = useState(true);

  const [sites, setSites] = useState([]);
  const [siteQuery, setSiteQuery] = useState('');
  const [siteName, setSiteName] = useState('');
  const [siteAddress, setSiteAddress] = useState('');
  const [notes, setNotes] = useState('');

  // v58.13.132cf — new state
  const [preamble, setPreamble] = useState(
    'You have been assigned the job attached. Please review before starting.'
  );
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfMeta, setPdfMeta] = useState(null); // {pdf_id, pdf_url, filename}
  const [prefilledFields, setPrefilledFields] = useState({}); // {date: true, site_name: true, ...}
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  const [assignments, setAssignments] = useState([]);
  const [loadingAssignments, setLoadingAssignments] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmOverride, setConfirmOverride] = useState(false);
  // v58.13.132ds — Show soft-deleted PDF attachments + confirm modal
  // for per-row PDF delete. Local reload counter fires the fetch
  // effect after a mutation without needing to touch `date`.
  const [showDeletedPdfs, setShowDeletedPdfs] = useState(false);
  const [confirmDelPdf, setConfirmDelPdf] = useState(null); // assignment row
  const [pdfReloadTick, setPdfReloadTick] = useState(0);

  // Load workers (filtered by target role_ids server-side).
  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoadingWorkers(true);
      try {
        const params = { limit: 200 };
        if (workerQuery.trim()) params.q = workerQuery.trim();
        if (roleFilter && roleFilter !== 'all') params.role_id = roleFilter;
        const r = await api.get('/mobile/daily-jobs/admin/workers', { params });
        if (!cancelled) setWorkers(r.data.rows || []);
      } catch (_e) {
        if (!cancelled) toast.error('Failed to load workers');
      } finally {
        if (!cancelled) setLoadingWorkers(false);
      }
    }
    run();
    return () => { cancelled = true; };
  }, [workerQuery, roleFilter]);

  // Load assignments for the current date.
  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoadingAssignments(true);
      try {
        const params = { date };
        if (showDeletedPdfs) params.include_deleted = true;
        const r = await api.get('/mobile/daily-jobs/admin/assignments', {
          params,
        });
        if (!cancelled) setAssignments(r.data.rows || []);
      } catch (_e) {
        if (!cancelled) setAssignments([]);
      } finally {
        if (!cancelled) setLoadingAssignments(false);
      }
    }
    run();
    return () => { cancelled = true; };
  }, [date, submitting, showDeletedPdfs, pdfReloadTick]);

  // v58.13.132ds — soft-delete + undelete of the PDF attachment on an
  // assignment. Admin-only server-side; the FE mirror is implicit
  // (the whole page is admin-gated).
  const doDeleteAssignmentPdf = async (assignment) => {
    try {
      await api.delete(`/mobile/daily-jobs/admin/${assignment.id}/pdf`);
      toast.success('PDF hidden from view');
      setConfirmDelPdf(null);
      setPdfReloadTick((t) => t + 1);
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Delete failed');
    }
  };
  const doUndeleteAssignmentPdf = async (assignment) => {
    try {
      await api.post(`/mobile/daily-jobs/admin/${assignment.id}/pdf/undelete`);
      toast.success('PDF restored');
      setPdfReloadTick((t) => t + 1);
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Undelete failed');
    }
  };

  // Load sites once + on query change.
  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        const params = { limit: 200 };
        if (siteQuery.trim()) params.q = siteQuery.trim();
        const r = await api.get('/mobile/daily-jobs/admin/sites', { params });
        if (!cancelled) setSites(r.data.rows || []);
      } catch (_e) {
        if (!cancelled) setSites([]);
      }
    }
    run();
    return () => { cancelled = true; };
  }, [siteQuery]);

  const existingAssignmentForSelected = useMemo(() => {
    if (!selectedWorker) return null;
    return assignments.find(a => a.worker_id === selectedWorker.id) || null;
  }, [assignments, selectedWorker]);

  async function handlePdfUpload(file) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
      toast.error('Only PDF files are supported'); return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error('PDF exceeds 10 MB limit'); return;
    }
    setPdfBusy(true);
    setPrefilledFields({});
    try {
      const fd = new FormData();
      fd.append('file', file, file.name);
      const r = await api.post('/mobile/daily-jobs/parse-pdf', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const parsed = r.data?.parsed || {};
      setPdfMeta({
        pdf_id: r.data?.pdf_id,
        pdf_url: r.data?.pdf_url,
        filename: file.name,
      });
      const filled = {};
      if (parsed.date) { setDate(parsed.date); filled.date = true; }
      if (parsed.site_name) { setSiteName(parsed.site_name); filled.site_name = true; }
      if (parsed.site_address) { setSiteAddress(parsed.site_address); filled.site_address = true; }
      if (parsed.notes) { setNotes(parsed.notes); filled.notes = true; }
      // worker_name → fuzzy pick from the loaded worker list.
      if (parsed.worker_name) {
        const nm = String(parsed.worker_name).trim().toLowerCase();
        const match = workers.find(w => w.name?.toLowerCase() === nm)
          || workers.find(w => w.name?.toLowerCase().includes(nm))
          || workers.find(w => nm.includes(w.name?.toLowerCase() || ''));
        if (match) {
          setSelectedWorker(match);
          filled.worker = true;
        }
      }
      setPrefilledFields(filled);
      const filledCount = Object.keys(filled).length;
      if (filledCount > 0) {
        toast.success(`AI parsed ${filledCount} field${filledCount === 1 ? '' : 's'} — please verify`);
      } else {
        toast.message('PDF attached — no fields could be extracted automatically');
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Could not parse PDF');
    } finally {
      setPdfBusy(false);
    }
  }

  async function handleAssign() {
    if (!selectedWorker) { toast.error('Pick a worker first'); return; }
    if (!siteName.trim()) { toast.error('Pick a site or type a site name'); return; }
    const override = !!existingAssignmentForSelected;
    if (override && !confirmOverride) {
      setConfirmOverride(true);
      toast(`This worker already has a job today. Click Assign again to override.`);
      return;
    }
    setSubmitting(true);
    try {
      let coords = null;
      if (siteAddress.trim()) {
        try {
          const g = await api.get('/mobile/geocode', {
            params: { q: siteAddress.trim() },
          });
          if (g.data?.lat && g.data?.lng) coords = { lat: g.data.lat, lng: g.data.lng };
        } catch (_) { /* geocode optional */ }
      }
      const body = {
        worker_id: selectedWorker.id,
        site_id: siteName.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 60),
        site_name: siteName.trim(),
        site_address: siteAddress.trim() || null,
        site_coords: coords,
        date,
        notes: notes.trim() || null,
        preamble: preamble.trim() || null,
        pdf_id: pdfMeta?.pdf_id || null,
        pdf_url: pdfMeta?.pdf_url || null,
        override,
      };
      await api.post('/mobile/daily-jobs', body);
      toast.success(`Assigned ${selectedWorker.name} → ${siteName.trim()}`);
      setSiteName(''); setSiteAddress(''); setNotes('');
      setPdfMeta(null); setPrefilledFields({});
      setPreamble('You have been assigned the job attached. Please review before starting.');
      setConfirmOverride(false);
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Failed to assign job');
    } finally {
      setSubmitting(false);
    }
  }

  if (!isAdmin) {
    return (
      <div className="p-8" data-testid="assign-daily-jobs-gate">
        <div className="max-w-md mx-auto bg-amber-50 border border-amber-200 rounded-xl p-6 text-center">
          <AlertTriangle className="mx-auto mb-3 text-amber-600" size={28} />
          <h2 className="font-semibold text-slate-800 mb-1">Admin access required</h2>
          <p className="text-sm text-slate-600">
            Ad-hoc Job Assignments is admin-only. Ask your organisation admin to
            open this screen.
          </p>
        </div>
      </div>
    );
  }

  const filledPill = (field) => prefilledFields[field] ? (
    <span
      data-testid={`ai-parsed-pill-${field}`}
      className="ml-2 inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-700 border border-violet-200"
      title="AI-parsed — please verify"
    >
      <Sparkles size={9} /> AI-parsed
    </span>
  ) : null;

  return (
    <div className="p-6 max-w-[1400px] mx-auto" data-testid="assign-daily-jobs-page">
      <header className="mb-4">
        <h1 className="text-2xl font-bold text-slate-900" data-testid="page-title">
          Ad-hoc Job Assignments
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Dispatch a worker to a site for the day. The worker receives an
          in-app alert on their mobile home screen (SMS deferred until Comms
          Safe Mode lifts).
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
        {/* ── Left: Worker list ───────────────────────────────────────── */}
        <aside
          className="md:col-span-4 bg-white border border-slate-200 rounded-2xl p-4"
          data-testid="worker-panel"
        >
          <div className="flex items-center gap-2 mb-3">
            <User size={16} className="text-slate-500" />
            <h2 className="font-semibold text-slate-800">Workers</h2>
            <span className="ml-auto text-xs text-slate-400">
              {workers.length}
            </span>
          </div>
          <div className="relative mb-2">
            <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
            <input
              data-testid="worker-search"
              className="w-full pl-8 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400"
              placeholder="Search name, email or phone"
              value={workerQuery}
              onChange={(e) => setWorkerQuery(e.target.value)}
            />
          </div>
          {/* v58.13.132cf — three fixed role_id chips + `all`. Excludes admin. */}
          <div className="flex flex-wrap gap-1 mb-3" data-testid="role-filter-row">
            {['all', 'paneltec_civil', 'viatec_traffic', 'external_contractor'].map(r => (
              <button
                key={r}
                data-testid={`role-filter-${r}`}
                onClick={() => setRoleFilter(r)}
                className={`text-xs px-2.5 py-1 rounded-full border transition ${
                  roleFilter === r
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                }`}
              >
                {r === 'all' ? 'all' : ROLE_LABELS[r]}
              </button>
            ))}
          </div>
          <div className="divide-y divide-slate-100 max-h-[520px] overflow-y-auto -mx-4">
            {loadingWorkers && (
              <div className="p-6 flex items-center justify-center text-slate-400">
                <Loader2 className="animate-spin mr-2" size={16} /> Loading…
              </div>
            )}
            {!loadingWorkers && workers.length === 0 && (
              <div className="p-6 text-center text-sm text-slate-400">
                No workers match.
              </div>
            )}
            {workers.map(w => {
              const has = assignments.some(a => a.worker_id === w.id);
              const isSel = selectedWorker?.id === w.id;
              const roleClass = ROLE_CHIP_CLASS[w.role_id] || 'bg-slate-50 text-slate-700 border-slate-200';
              return (
                <button
                  key={w.id}
                  data-testid={`worker-row-${w.id}`}
                  onClick={() => { setSelectedWorker(w); setConfirmOverride(false); }}
                  className={`w-full text-left px-4 py-2.5 hover:bg-blue-50 transition ${
                    isSel ? 'bg-blue-50' : ''
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-slate-800 truncate">
                        {w.name}
                      </div>
                      <div className="text-xs text-slate-500 truncate flex items-center gap-1.5 flex-wrap">
                        {w.phone ? (
                          <a
                            href={`tel:${w.phone}`}
                            onClick={(e) => e.stopPropagation()}
                            data-testid={`worker-row-phone-${w.id}`}
                            className="text-slate-500 hover:text-blue-700 hover:underline"
                          >
                            {w.phone}
                          </a>
                        ) : (
                          <span data-testid={`worker-row-phone-${w.id}`} className="text-slate-400">—</span>
                        )}
                        <span
                          data-testid={`worker-role-chip-${w.id}`}
                          className={`inline-flex items-center px-1.5 py-0 rounded-full text-[9px] uppercase font-bold tracking-wider border ${roleClass}`}
                        >
                          {ROLE_LABELS[w.role_id] || w.role_id || 'no role'}
                        </span>
                      </div>
                    </div>
                    {has && (
                      <span
                        className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200"
                        data-testid={`worker-has-job-${w.id}`}
                      >
                        ASSIGNED
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        {/* ── Center + Right: Assignment form ─────────────────────────── */}
        <section className="md:col-span-8 space-y-4">
          {/* Date bar with ±1 arrows + Today + Popover Calendar */}
          <div className="bg-white border border-slate-200 rounded-2xl p-4" data-testid="date-bar">
            <div className="flex items-center gap-3 flex-wrap">
              <CalendarIcon size={16} className="text-slate-500" />
              <h2 className="font-semibold text-slate-800">Date</h2>
              <div className="flex items-center gap-1 ml-auto">
                <button
                  type="button"
                  data-testid="date-prev-btn"
                  onClick={() => setDate(isoAddDays(date, -1))}
                  className="p-1.5 rounded-md border border-slate-200 hover:bg-slate-50"
                  title="Previous day"
                >
                  <ChevronLeft size={14} />
                </button>
                <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      data-testid="date-picker-btn"
                      className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg font-medium min-w-[190px] text-center hover:bg-slate-50"
                    >
                      {fmtNiceDate(date)}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="end">
                    <Calendar
                      mode="single"
                      selected={(() => {
                        const [y, m, d] = date.split('-').map(Number);
                        return new Date(y, m - 1, d);
                      })()}
                      onSelect={(d) => {
                        if (!d) return;
                        const y = d.getFullYear();
                        const m = String(d.getMonth() + 1).padStart(2, '0');
                        const dd = String(d.getDate()).padStart(2, '0');
                        setDate(`${y}-${m}-${dd}`);
                        setDatePickerOpen(false);
                      }}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
                <button
                  type="button"
                  data-testid="date-next-btn"
                  onClick={() => setDate(isoAddDays(date, 1))}
                  className="p-1.5 rounded-md border border-slate-200 hover:bg-slate-50"
                  title="Next day"
                >
                  <ChevronRight size={14} />
                </button>
                <button
                  type="button"
                  data-testid="date-today-btn"
                  onClick={() => setDate(sydneyTodayIso())}
                  className="px-2.5 py-1.5 text-xs font-semibold rounded-md border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700"
                >
                  Today
                </button>
              </div>
            </div>
            <div className="text-xs text-slate-500 mt-2 flex items-center gap-3 flex-wrap">
              <span data-testid="assignment-count">
                {loadingAssignments
                  ? 'Loading assignments…'
                  : `${assignments.length} assignment${assignments.length === 1 ? '' : 's'} on this date (Australia/Sydney)`}
              </span>
              {/* v58.13.132ds — Show soft-deleted PDF attachments. */}
              <label
                className="ml-auto inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500 cursor-pointer select-none"
                data-testid="assignments-show-deleted-pdfs"
                title="Include soft-deleted PDF attachments"
              >
                <input
                  type="checkbox"
                  checked={showDeletedPdfs}
                  onChange={(e) => setShowDeletedPdfs(e.target.checked)}
                  className="h-3 w-3"
                />
                Show deleted
              </label>
            </div>
            {assignments.length > 0 && (
              <div className="mt-2 divide-y divide-slate-100 max-h-56 overflow-y-auto">
                {assignments.map(a => {
                  const pdfDeleted = !!a.pdf_deleted_at;
                  return (
                  <div
                    key={a.id}
                    className="py-2 flex items-center gap-2 text-sm flex-wrap"
                    data-testid={`assignment-row-${a.id}`}
                  >
                    <CheckCircle2
                      size={14}
                      className={
                        a.status === 'accepted' ? 'text-emerald-600'
                          : a.status === 'declined' ? 'text-red-500'
                          : 'text-amber-500'
                      }
                    />
                    <span className="font-medium text-slate-700">{a.worker_name || '(worker removed)'}</span>
                    {a.worker_phone ? (
                      <a
                        href={`tel:${a.worker_phone}`}
                        data-testid={`assignment-phone-${a.id}`}
                        className="text-xs text-slate-500 hover:text-blue-700 hover:underline"
                      >
                        {a.worker_phone}
                      </a>
                    ) : (
                      <span data-testid={`assignment-phone-${a.id}`} className="text-xs text-slate-400">—</span>
                    )}
                    <span className="text-slate-500">→ {a.site_name || a.site_id}</span>
                    {a.assigned_by_name && (
                      <span className="text-xs text-slate-400 italic">by {a.assigned_by_name}</span>
                    )}
                    {/* v58.13.132ds — Attached PDF affordance. Trash
                        soft-deletes, undelete restores. Only surfaces
                        on rows that actually have a pdf_id (post-mask). */}
                    {a.pdf_id && !pdfDeleted && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-slate-500" data-testid={`assignment-pdf-${a.id}`}>
                        <FileText size={11} className="text-emerald-600" />
                        <a
                          href={`${(process.env.REACT_APP_BACKEND_URL || '').replace(/\/$/, '')}${a.pdf_url}`}
                          target="_blank"
                          rel="noreferrer noopener"
                          data-testid={`assignment-pdf-link-${a.id}`}
                          className="hover:text-emerald-800 underline"
                        >
                          PDF
                        </a>
                        <button
                          type="button"
                          onClick={() => setConfirmDelPdf(a)}
                          data-testid={`assignment-pdf-delete-${a.id}`}
                          aria-label="Delete PDF"
                          title="Hide PDF from view (soft-delete, preserves audit)"
                          className="inline-flex items-center justify-center w-5 h-5 rounded text-slate-400 hover:text-red-600 hover:bg-red-50"
                        >
                          <Trash2 size={11} />
                        </button>
                      </span>
                    )}
                    {pdfDeleted && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-400 line-through italic" data-testid={`assignment-pdf-deleted-${a.id}`}>
                        <FileText size={10} /> PDF hidden
                        <button
                          type="button"
                          onClick={() => doUndeleteAssignmentPdf(a)}
                          data-testid={`assignment-pdf-undelete-${a.id}`}
                          className="ml-1 no-underline not-italic inline-flex items-center gap-0.5 text-emerald-700 hover:text-emerald-900 px-1.5 py-0.5 rounded hover:bg-emerald-50 font-semibold"
                          title="Restore PDF to the visible list"
                        >
                          <RotateCcw size={10} /> Undelete
                        </button>
                      </span>
                    )}
                    <span className="ml-auto text-xs text-slate-400 uppercase">
                      {a.status}
                    </span>
                  </div>
                  );
                })}
              </div>
            )}
            {confirmDelPdf && (
              <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4" data-testid="assignment-pdf-delete-confirm">
                <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
                  <h3 className="font-display font-semibold text-lg mb-2 flex items-center gap-2">
                    <AlertTriangle size={16} className="text-amber-500" /> Delete this attached PDF?
                  </h3>
                  <p className="text-sm text-slate-700 mb-4">
                    Are you sure you want to delete this attached PDF? It will be hidden from view but preserved in the audit trail. Continue?
                  </p>
                  <div className="text-[11px] text-slate-500 mb-4 font-mono truncate">
                    {confirmDelPdf.worker_name || '(worker)'} · {confirmDelPdf.site_name || confirmDelPdf.site_id || '(no site)'}
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setConfirmDelPdf(null)}
                      data-testid="assignment-pdf-delete-confirm-cancel"
                      className="px-3 py-1.5 text-xs font-semibold border border-slate-300 rounded-lg hover:bg-slate-50 text-slate-700"
                    >Cancel</button>
                    <button
                      type="button"
                      onClick={() => doDeleteAssignmentPdf(confirmDelPdf)}
                      data-testid="assignment-pdf-delete-confirm-ok"
                      className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700"
                    >Delete</button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Assignment form */}
          <div
            className="bg-white border border-slate-200 rounded-2xl p-4"
            data-testid="assign-form"
          >
            <div className="flex items-center gap-2 mb-3">
              <MapPin size={16} className="text-slate-500" />
              <h2 className="font-semibold text-slate-800">Assign to</h2>
            </div>

            {!selectedWorker && (
              <div className="text-sm text-slate-500 bg-slate-50 rounded-lg p-4 text-center">
                Pick a worker from the left panel to start — or drop a job PDF below and we&rsquo;ll try to match one.
              </div>
            )}

            {selectedWorker && (
              <>
                {/* v58.13.132cf — visible Worker row at the top of the form. */}
                <div
                  className="mb-3 p-3 rounded-lg border border-slate-200 bg-slate-50 flex items-center gap-3"
                  data-testid="worker-row-header"
                >
                  <div className="w-9 h-9 rounded-full bg-white border border-slate-200 flex items-center justify-center shrink-0">
                    <User size={16} className="text-slate-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-slate-900 flex items-center gap-2 flex-wrap">
                      <span data-testid="worker-header-name">{selectedWorker.name}</span>
                      <span
                        data-testid="worker-header-role-chip"
                        className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] uppercase font-bold tracking-wider border ${ROLE_CHIP_CLASS[selectedWorker.role_id] || 'bg-slate-100 text-slate-700 border-slate-200'}`}
                      >
                        {ROLE_LABELS[selectedWorker.role_id] || selectedWorker.role_id || 'no role'}
                      </span>
                      {filledPill('worker')}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {selectedWorker.phone ? (
                        <a
                          href={`tel:${selectedWorker.phone}`}
                          data-testid="worker-header-phone"
                          className="text-slate-600 hover:text-blue-700 hover:underline font-medium"
                        >
                          {selectedWorker.phone}
                        </a>
                      ) : (
                        <span data-testid="worker-header-phone" className="text-slate-400">no phone on record</span>
                      )}
                      {selectedWorker.email && ` · ${selectedWorker.email}`}
                    </div>
                  </div>
                </div>

                {existingAssignmentForSelected && (
                  <div
                    className="mb-3 text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-2 flex gap-2"
                    data-testid="override-banner"
                  >
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    <span>
                      {selectedWorker.name} already has a job today
                      ({existingAssignmentForSelected.site_name || '—'}).
                      Assigning will replace it.
                    </span>
                  </div>
                )}

                {/* v58.13.132cf — PDF drag-drop with AI parse. */}
                <div
                  data-testid="pdf-dropzone"
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    const f = e.dataTransfer.files?.[0];
                    if (f) handlePdfUpload(f);
                  }}
                  onClick={() => fileInputRef.current?.click()}
                  className={`mb-3 rounded-lg border-2 border-dashed p-3 text-sm cursor-pointer transition ${
                    dragOver ? 'border-violet-400 bg-violet-50'
                      : pdfMeta ? 'border-emerald-300 bg-emerald-50'
                      : 'border-slate-300 bg-slate-50 hover:bg-slate-100'
                  }`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/pdf,.pdf"
                    className="hidden"
                    data-testid="pdf-file-input"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handlePdfUpload(f);
                      e.target.value = '';
                    }}
                  />
                  <div className="flex items-center gap-3">
                    {pdfBusy ? (
                      <Loader2 className="animate-spin text-violet-600" size={20} />
                    ) : pdfMeta ? (
                      <FileText className="text-emerald-600" size={20} />
                    ) : (
                      <Upload className="text-slate-500" size={20} />
                    )}
                    <div className="flex-1 min-w-0">
                      {pdfBusy ? (
                        <div className="font-semibold text-violet-700">Parsing PDF with AI…</div>
                      ) : pdfMeta ? (
                        <>
                          <div className="font-semibold text-emerald-800 truncate" data-testid="pdf-filename">
                            {pdfMeta.filename}
                          </div>
                          <div className="text-xs text-emerald-700">
                            AI-parsed — verify prefilled fields below, then Assign.
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="font-semibold text-slate-800">Drop a job PDF here or click to browse</div>
                          <div className="text-xs text-slate-500">
                            AI extracts worker · date · site · address · notes. PDF stays with the assignment. Max 10 MB.
                          </div>
                        </>
                      )}
                    </div>
                    {pdfMeta && !pdfBusy && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setPdfMeta(null); setPrefilledFields({}); }}
                        data-testid="pdf-clear-btn"
                        className="p-1 rounded-md hover:bg-emerald-100"
                        title="Remove PDF"
                      >
                        <XIcon size={14} className="text-emerald-700" />
                      </button>
                    )}
                  </div>
                </div>

                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Site {filledPill('site_name')}
                </label>
                <input
                  data-testid="site-name-input"
                  list="site-suggestions"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg mb-3 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400"
                  placeholder="Type site name or pick from list"
                  value={siteName}
                  onChange={(e) => {
                    setSiteName(e.target.value);
                    setSiteQuery(e.target.value);
                  }}
                />
                <datalist id="site-suggestions">
                  {sites.map(s => (<option key={s.site_name} value={s.site_name} />))}
                </datalist>

                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Site address (optional — used for the map) {filledPill('site_address')}
                </label>
                <input
                  data-testid="site-address-input"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg mb-3 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400"
                  placeholder="e.g. 27 Cypress Street Newstead TAS"
                  value={siteAddress}
                  onChange={(e) => setSiteAddress(e.target.value)}
                />

                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Message to worker <span className="text-slate-400">({preamble.length}/500)</span>
                </label>
                <textarea
                  data-testid="preamble-input"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg mb-3 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400"
                  rows={2}
                  maxLength={500}
                  placeholder="Preamble shown at the top of the worker's job card"
                  value={preamble}
                  onChange={(e) => setPreamble(e.target.value)}
                />

                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Notes (optional) {filledPill('notes')}
                </label>
                <textarea
                  data-testid="notes-input"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg mb-4 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400"
                  rows={3}
                  placeholder="Special instructions for the worker (visible in mobile app)"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />

                <button
                  data-testid="assign-submit-btn"
                  onClick={handleAssign}
                  disabled={submitting || !siteName.trim()}
                  className="w-full inline-flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-semibold py-2.5 rounded-lg transition"
                >
                  {submitting && <Loader2 className="animate-spin" size={16} />}
                  {existingAssignmentForSelected
                    ? (confirmOverride ? 'Confirm override' : 'Assign (will override)')
                    : 'Assign'}
                </button>
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
