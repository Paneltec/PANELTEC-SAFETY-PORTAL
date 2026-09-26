// v58.13.132n7 — Issue Job (allocation officer's batch assignment console).
//
// Route: `/app/mobile/issue-job`  (Compliance section sidebar entry,
// sits right next to "Ad-hoc Jobs" per the ship brief).
//
// Purpose: one form, N workers, ONE `Send Job` action → creates one
// `daily_job_assignments` doc per worker sharing a `job_batch_id`.
// This is the fast-flow complement to `AdminAssignDailyJobs.jsx`'s
// per-worker PDF-parse flow — no PDFs, no SMS, just the SMS-style
// batch payload straight into the mobile "Today's Assignment" tile.
//
// Backend endpoints (all under `/api/`):
//   POST /daily-jobs/bulk-create               batch create
//   GET  /daily-jobs/today?date=YYYY-MM-DD     admin view (left list)
//   GET  /daily-jobs/admin/trucks?q=           picker
//   GET  /daily-jobs/admin/sites?q=            picker (db.sites)
//   GET  /daily-jobs/admin/workers?q=&role_id= picker
//
// Layout:
//   Left  (35 %) — Today's Assignments list, auto-refresh every 15 s,
//                  per-row status pill (pending / accepted / declined).
//   Right (65 %) — Form. Sticky bottom-right green "Send Job" CTA.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api, { apiError } from '@/lib/api';
import { toast } from 'sonner';
import {
  Loader2, Search, X as XIcon, Send, CheckCircle2,
  Clock, XCircle, Truck as TruckIcon, MapPin, Users,
  ClipboardList, StickyNote, Building2,
  ChevronDown, RefreshCw,
} from 'lucide-react';

// Sydney-local YYYY-MM-DD helper (matches backend `_today_iso()`).
function sydneyTodayIso() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' });
}

function fmtTime(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString('en-AU', {
      hour: '2-digit', minute: '2-digit', timeZone: 'Australia/Sydney',
    });
  } catch (_) { return ''; }
}

function statusPill(row) {
  if (row.declined_at) {
    return { label: 'Declined', bg: '#FEF2F2', fg: '#B91C1C', Icon: XCircle };
  }
  if (row.accepted_at) {
    return { label: 'Accepted', bg: '#ECFDF5', fg: '#047857', Icon: CheckCircle2 };
  }
  return { label: 'Pending',  bg: '#FEF3C7', fg: '#B45309', Icon: Clock };
}

// ─────────────── Page ───────────────

export default function IssueJob() {
  const today = useMemo(() => sydneyTodayIso(), []);
  const [form, setForm] = useState({
    date: today,
    truck: null,             // {id, name, rego}
    site: null,              // {id, name, address_full}
    siteFreeform: '',
    address: '',
    customer: '',
    workers: [],             // array of worker rows
    notes: '',
    task: '',
    trialRun: false,         // v58.13.132n7a — "also send a copy to my phone"
  });
  const [sending, setSending] = useState(false);
  const [recent, setRecent] = useState({ loading: true, rows: [], error: null });

  // ─── auto-refresh left panel every 15 s ───
  const loadRecent = useCallback(async () => {
    try {
      const { data } = await api.get('/daily-jobs/today', {
        params: { date: form.date, limit: 10 },
      });
      setRecent({ loading: false, rows: data.rows || [], error: null });
    } catch (err) {
      setRecent((s) => ({ ...s, loading: false, error: apiError(err) || 'Load failed' }));
    }
  }, [form.date]);

  useEffect(() => {
    loadRecent();
    const t = setInterval(loadRecent, 15000);
    return () => clearInterval(t);
  }, [loadRecent]);

  // ─── submit ───
  const canSend = form.workers.length > 0 && (form.site || form.siteFreeform.trim());

  const handleSend = async () => {
    if (!canSend || sending) return;
    setSending(true);
    try {
      const payload = {
        date: form.date,
        truck_id: form.truck?.id || null,
        truck_name: form.truck?.name || null,
        truck_reg: form.truck?.rego || null,
        site_id: form.site?.id || null,
        site_freeform: form.site ? null : (form.siteFreeform.trim() || null),
        address: form.address.trim() || null,
        customer: form.customer.trim() || null,
        task: form.task.trim() || null,
        notes: form.notes.trim() || null,
        worker_ids: form.workers.map((w) => w.id),
        override: false,
        trial_run: form.trialRun,
      };
      const { data } = await api.post('/daily-jobs/bulk-create', payload);
      const createdN = data.created.length;
      const conflictsN = data.conflicts.length;
      const notFoundN = data.not_found.length;
      if (createdN > 0) {
        toast.success(
          `Job issued to ${createdN} worker${createdN === 1 ? '' : 's'}${conflictsN ? ` · ${conflictsN} already had an assignment for this date` : ''}`,
          { duration: 5000 },
        );
      }
      if (conflictsN > 0 && createdN === 0) {
        toast.warning(
          `All ${conflictsN} selected worker${conflictsN === 1 ? ' has' : 's have'} an assignment for this date already. Turn on Replace to overwrite.`,
        );
      }
      if (notFoundN > 0) {
        toast.error(`${notFoundN} worker id${notFoundN === 1 ? '' : 's'} could not be resolved`);
      }
      // Reset the form (keep date + truck for the next batch).
      // Trial-run is deliberately reset — officer must opt in per batch.
      setForm((f) => ({
        ...f,
        site: null, siteFreeform: '', address: '', customer: '',
        workers: [], notes: '', task: '',
        trialRun: false,
      }));
      loadRecent();
    } catch (err) {
      toast.error(apiError(err) || 'Send failed');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="p-6" data-testid="issue-job-page">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900" data-testid="issue-job-h1">
          Issue Today's Job
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Send today's job to one or more workers — appears on their phone
          immediately, no SMS. Complements Ad-hoc Jobs for the fast batch flow.
        </p>
      </div>

      <div className="grid grid-cols-12 gap-6">
        {/* ─── Left panel: today's assignments ─── */}
        <aside className="col-span-12 lg:col-span-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm sticky top-6"
               data-testid="issue-job-recent-panel">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
              <div className="text-xs uppercase tracking-wide text-slate-500 font-semibold flex-1">
                Today's assignments · {form.date}
              </div>
              <button
                type="button"
                onClick={loadRecent}
                className="p-1 rounded hover:bg-slate-100 text-slate-500"
                aria-label="Refresh"
                data-testid="issue-job-recent-refresh-btn"
              >
                {recent.loading
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <RefreshCw className="w-3.5 h-3.5" />}
              </button>
            </div>
            <div className="max-h-[560px] overflow-auto">
              {recent.error && (
                <div className="px-4 py-4 text-sm text-rose-700 bg-rose-50">
                  {recent.error}
                </div>
              )}
              {!recent.error && !recent.loading && recent.rows.length === 0 && (
                <div className="px-4 py-8 text-center text-sm text-slate-500"
                     data-testid="issue-job-recent-empty">
                  No jobs issued yet today. Fill in the form on the right and
                  hit <strong>Send Job</strong>.
                </div>
              )}
              {recent.rows.map((r, i) => {
                const p = statusPill(r);
                return (
                  <div
                    key={r.id}
                    className="px-4 py-3 border-b border-slate-100 last:border-0 flex gap-3"
                    data-testid={`issue-job-recent-row-${i}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-slate-900 truncate">
                        {r.worker_name}
                      </div>
                      <div className="text-xs text-slate-500 truncate">
                        {r.site_name || r.site_freeform || '—'}
                        {r.task ? ` · ${r.task}` : ''}
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        Issued {fmtTime(r.issued_at || r.assigned_at)}
                        {r.customer ? ` · ${r.customer}` : ''}
                      </div>
                    </div>
                    <div
                      className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium h-fit"
                      style={{ backgroundColor: p.bg, color: p.fg }}
                      data-testid={`issue-job-recent-row-${i}-status`}
                    >
                      <p.Icon className="w-3 h-3" />
                      {p.label}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </aside>

        {/* ─── Right panel: form ─── */}
        <section className="col-span-12 lg:col-span-8">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6"
               data-testid="issue-job-form">
            <div className="grid grid-cols-2 gap-4">
              {/* Truck */}
              <div className="col-span-2 md:col-span-1">
                <Label icon={TruckIcon} text="Truck" />
                <TruckPicker
                  value={form.truck}
                  onChange={(v) => setForm((f) => ({ ...f, truck: v }))}
                />
              </div>
              {/* Date */}
              <div className="col-span-2 md:col-span-1">
                <Label text="Date" />
                <input
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  data-testid="issue-job-date-input"
                />
              </div>
              {/* Site */}
              <div className="col-span-2 md:col-span-1">
                <Label icon={MapPin} text="Site" />
                <SitePicker
                  value={form.site}
                  freeform={form.siteFreeform}
                  onChange={(site, freeform) => setForm((f) => ({
                    ...f,
                    site,
                    siteFreeform: freeform,
                    // Auto-populate address on site pick (editable).
                    address: site
                      ? [site.address_full, site.suburb, site.state].filter(Boolean).join(', ')
                      : f.address,
                  }))}
                />
              </div>
              {/* Customer */}
              <div className="col-span-2 md:col-span-1">
                <Label icon={Building2} text="Customer" />
                <input
                  type="text"
                  value={form.customer}
                  onChange={(e) => setForm((f) => ({ ...f, customer: e.target.value }))}
                  placeholder="e.g. TasWater"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  data-testid="issue-job-customer-input"
                />
              </div>
              {/* Address */}
              <div className="col-span-2">
                <Label text="Address" />
                <input
                  type="text"
                  value={form.address}
                  onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                  placeholder="Auto-filled when a site is selected; editable."
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  data-testid="issue-job-address-input"
                />
              </div>
              {/* Staff on this job */}
              <div className="col-span-2">
                <Label icon={Users} text="Staff on this job" required />
                <WorkerMultiPicker
                  value={form.workers}
                  onChange={(v) => setForm((f) => ({ ...f, workers: v }))}
                />
              </div>
              {/* Task (col-span-1 — v58.13.132n7a: supervisor slot removed) */}
              <div className="col-span-2 md:col-span-1">
                <Label icon={ClipboardList} text="Task" optional />
                <input
                  type="text"
                  value={form.task}
                  onChange={(e) => setForm((f) => ({ ...f, task: e.target.value }))}
                  placeholder="e.g. Trench excavation and pipe laying"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  data-testid="issue-job-task-input"
                />
              </div>
              {/* Notes */}
              <div className="col-span-2 md:col-span-1">
                <Label icon={StickyNote} text="Notes" />
                <textarea
                  rows={3}
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder="Kroll to site to expose main, ring Jason to complete tapping when exposed…"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm resize-y"
                  data-testid="issue-job-notes-input"
                />
              </div>
            </div>

            {/* Send bar */}
            <div className="mt-6 pt-4 border-t border-slate-100">
              {/* v58.13.132n7a — Trial-run checkbox. Ticking it appends
                  the calling admin's own user id to `worker_ids` so a
                  mirror doc lands on their phone. Handy for the officer
                  to preview exactly what the crew will see. */}
              <label
                className="flex items-center gap-2 mb-3 text-xs text-slate-700 cursor-pointer select-none"
                data-testid="issue-job-trial-run-label"
              >
                <input
                  type="checkbox"
                  checked={form.trialRun}
                  onChange={(e) => setForm((f) => ({ ...f, trialRun: e.target.checked }))}
                  className="w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  data-testid="issue-job-trial-run-checkbox"
                />
                <span>
                  <strong>Trial run</strong> — also send a copy to my own phone (adds a mirror assignment for you).
                </span>
              </label>
              <div className="flex items-center justify-between">
                <div className="text-xs text-slate-500">
                  {form.workers.length > 0
                    ? <><strong>{form.workers.length}</strong> worker{form.workers.length === 1 ? '' : 's'} selected{form.trialRun ? ' + trial mirror' : ''} · {form.site ? form.site.name : (form.siteFreeform || 'no site')}</>
                    : 'Pick at least one worker and a site to send.'}
                </div>
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={!canSend || sending}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-white text-sm font-semibold shadow-sm transition"
                  style={{
                    backgroundColor: canSend && !sending ? '#10B981' : '#94A3B8',
                    cursor: canSend && !sending ? 'pointer' : 'not-allowed',
                  }}
                  data-testid="issue-job-send-btn"
                >
                  {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  Send Job
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

// ─────────────── Field label ───────────────

function Label({ icon: Icon, text, required, optional }) {
  return (
    <div className="flex items-center gap-1.5 text-xs font-medium text-slate-700 mb-1.5">
      {Icon && <Icon className="w-3.5 h-3.5 text-slate-400" />}
      <span>
        {text}
        {required && <span className="text-rose-500 ml-0.5">*</span>}
        {optional && <span className="text-slate-400 ml-1 font-normal">(optional)</span>}
      </span>
    </div>
  );
}

// ─────────────── Truck picker (single, searchable) ───────────────

function TruckPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const ref = useRef(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await api.get('/daily-jobs/admin/trucks', {
          params: { q: q || undefined, limit: 50 },
        });
        if (alive) setRows(data.rows || []);
      } catch (_) { /* silent */ }
    })();
    return () => { alive = false; };
  }, [q]);

  useEffect(() => {
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white text-left"
        data-testid="issue-job-truck-picker"
      >
        <span className={value ? 'text-slate-900' : 'text-slate-400'}>
          {value ? value.name : 'Pick a truck or plant…'}
        </span>
        <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-72 overflow-hidden">
          <div className="p-2 border-b border-slate-100 relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input
              autoFocus
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search trucks / plant…"
              className="w-full pl-8 pr-3 py-1.5 text-sm rounded-md border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none"
              data-testid="issue-job-truck-search"
            />
          </div>
          <div className="max-h-56 overflow-auto">
            {rows.length === 0 && (
              <div className="px-3 py-4 text-xs text-slate-500 text-center">No matches</div>
            )}
            {rows.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => { onChange(r); setOpen(false); setQ(''); }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex items-center gap-2"
                data-testid={`issue-job-truck-option-${r.id}`}
              >
                <TruckIcon className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span className="flex-1 truncate">{r.name}</span>
                <span className="text-[10px] text-slate-400 uppercase">{r.kind}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────── Site picker (single + "Other" free-text) ───────────────

function SitePicker({ value, freeform, onChange }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [otherMode, setOtherMode] = useState(!!freeform && !value);
  const ref = useRef(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await api.get('/daily-jobs/admin/sites', {
          params: { q: q || undefined, limit: 100 },
        });
        if (alive) setRows(data.rows || []);
      } catch (_) { /* silent */ }
    })();
    return () => { alive = false; };
  }, [q]);

  useEffect(() => {
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  if (otherMode) {
    return (
      <div className="flex gap-2">
        <input
          type="text"
          value={freeform}
          onChange={(e) => onChange(null, e.target.value)}
          placeholder="Type site name…"
          className="flex-1 px-3 py-2 rounded-lg border border-amber-300 bg-amber-50 text-sm"
          data-testid="issue-job-site-freeform-input"
        />
        <button
          type="button"
          onClick={() => { setOtherMode(false); onChange(null, ''); }}
          className="px-3 py-2 rounded-lg border border-slate-300 text-xs text-slate-600 hover:bg-slate-50"
          data-testid="issue-job-site-back-to-list-btn"
        >
          List
        </button>
      </div>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white text-left"
        data-testid="issue-job-site-picker"
      >
        <span className={value ? 'text-slate-900' : 'text-slate-400'}>
          {value ? value.name : 'Pick a site…'}
        </span>
        <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-72 overflow-hidden">
          <div className="p-2 border-b border-slate-100 relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input
              autoFocus
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search sites…"
              className="w-full pl-8 pr-3 py-1.5 text-sm rounded-md border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none"
              data-testid="issue-job-site-search"
            />
          </div>
          <div className="max-h-56 overflow-auto">
            {rows.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => { onChange(r, ''); setOpen(false); setQ(''); }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50"
                data-testid={`issue-job-site-option-${r.id}`}
              >
                <div className="font-medium text-slate-900 truncate">{r.name}</div>
                <div className="text-[11px] text-slate-500 truncate">
                  {[r.address_full, r.suburb, r.state].filter(Boolean).join(', ')}
                </div>
              </button>
            ))}
            <button
              type="button"
              onClick={() => { setOtherMode(true); onChange(null, ''); setOpen(false); }}
              className="w-full text-left px-3 py-2 text-sm text-amber-700 bg-amber-50 hover:bg-amber-100 border-t border-slate-100"
              data-testid="issue-job-site-other-btn"
            >
              + Other (type it in)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────── Worker multi-picker (chips + search) ───────────────

function WorkerMultiPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const ref = useRef(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await api.get('/daily-jobs/admin/workers', {
          params: { q: q || undefined, limit: 100 },
        });
        if (alive) setRows(data.rows || []);
      } catch (_) { /* silent */ }
    })();
    return () => { alive = false; };
  }, [q]);

  useEffect(() => {
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const selectedIds = new Set(value.map((w) => w.id));
  const filtered = rows.filter((r) => !selectedIds.has(r.id));

  const toggle = (w) => {
    if (selectedIds.has(w.id)) {
      onChange(value.filter((x) => x.id !== w.id));
    } else {
      onChange([...value, w]);
    }
  };
  const remove = (id) => onChange(value.filter((w) => w.id !== id));

  return (
    <div ref={ref} className="relative">
      <div
        className="min-h-[42px] w-full px-2 py-1.5 rounded-lg border border-slate-300 bg-white flex flex-wrap gap-1.5 items-center cursor-text"
        onClick={() => setOpen(true)}
        data-testid="issue-job-workers-picker"
      >
        {value.length === 0 && !open && (
          <span className="text-slate-400 text-sm px-1">Pick workers…</span>
        )}
        {value.map((w) => (
          <span
            key={w.id}
            className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-medium"
            data-testid={`issue-job-worker-chip-${w.id}`}
          >
            {w.name}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); remove(w.id); }}
              className="p-0.5 rounded-full hover:bg-emerald-100"
              aria-label={`Remove ${w.name}`}
              data-testid={`issue-job-worker-chip-${w.id}-remove`}
            >
              <XIcon className="w-3 h-3" />
            </button>
          </span>
        ))}
      </div>
      {open && (
        <div className="absolute z-30 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-72 overflow-hidden">
          <div className="p-2 border-b border-slate-100 relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input
              autoFocus
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search workers…"
              className="w-full pl-8 pr-3 py-1.5 text-sm rounded-md border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none"
              data-testid="issue-job-workers-search"
            />
          </div>
          <div className="max-h-56 overflow-auto">
            {filtered.length === 0 && (
              <div className="px-3 py-4 text-xs text-slate-500 text-center">
                {rows.length === 0 ? 'No matches' : 'All matches already selected'}
              </div>
            )}
            {filtered.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => toggle(r)}
                className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50"
                data-testid={`issue-job-worker-option-${r.id}`}
              >
                <div className="font-medium text-slate-900 truncate">{r.name}</div>
                <div className="text-[11px] text-slate-500 truncate">
                  {r.role_id || '—'}
                  {r.phone ? ` · ${r.phone}` : ''}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

