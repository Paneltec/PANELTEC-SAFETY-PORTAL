// v58.13.132p0 — Issue Today's Job (allocation officer's batch console).
//
// Phase 1 of the mobile job flow rebuild. Locked to the SEVEN SMS
// fields Stephen's whiteboard emits — nothing invented.
//
// Route: `/app/mobile/issue-job`  (Compliance sidebar entry).
//
// Backend endpoints (all under `/api/`):
//   POST /daily-jobs/bulk-create          batch create (7 SMS fields)
//   GET  /daily-jobs/today?date=YYYY-MM-DD admin view (left list)
//   GET  /daily-jobs/admin/trucks?q=      truck-name suggestion feed
//   GET  /daily-jobs/admin/sites?q=       site suggestion feed
//   GET  /daily-jobs/admin/workers?q=     worker picker
//   POST /mobile/sms/parse                shared SMS parser
//
// Layout:
//   Left  (35 %) — Today's assignments list, auto-refresh every 15 s.
//   Right (65 %) — Form + "Paste SMS" pre-fill button.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api, { apiError } from '@/lib/api';
import { toast } from 'sonner';
import {
  Loader2, Search, X as XIcon, Send, CheckCircle2,
  Clock, XCircle, Truck as TruckIcon, MapPin, Users,
  StickyNote, Building2, ChevronDown, RefreshCw,
  ClipboardPaste,
} from 'lucide-react';

// Sydney-local YYYY-MM-DD helper (matches backend `today_iso_sydney()`).
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
  const s = (row.status || '').toLowerCase();
  if (s === 'declined' || row.declined_at) {
    return { label: 'Declined', bg: '#FEF2F2', fg: '#B91C1C', Icon: XCircle };
  }
  if (s === 'accepted' || s === 'signed_on' || s === 'completed' || row.accepted_at) {
    return { label: 'Accepted', bg: '#ECFDF5', fg: '#047857', Icon: CheckCircle2 };
  }
  return { label: 'Issued', bg: '#FEF3C7', fg: '#B45309', Icon: Clock };
}

// ─────────────── Page ───────────────

export default function IssueJob() {
  const today = useMemo(() => sydneyTodayIso(), []);
  // .132p0 form state: seven SMS fields + workers[] + trialRun.
  const [form, setForm] = useState({
    date: today,
    truck: '',           // single string (SMS shape: "Cappellotto 2 - Volvo - XT48AK")
    siteName: '',
    address: '',
    customer: '',
    staff: '',           // comma-separated tokens; split at submit
    notes: '',
    workers: [],         // array of {id, name, ...}
    trialRun: false,
  });
  const [sending, setSending] = useState(false);
  const [showPasteSms, setShowPasteSms] = useState(false);
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
  const canSend = form.workers.length > 0 && (form.siteName.trim() || form.address.trim());

  const handleSend = async () => {
    if (!canSend || sending) return;
    setSending(true);
    try {
      // Split staff — either the officer typed a comma-separated
      // list, or we use the picked workers' names as a fallback.
      const staffFromForm = form.staff
        .split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
      const staffFallback = form.workers.map((w) => (w.name || '').toUpperCase());
      const staff = staffFromForm.length > 0 ? staffFromForm : staffFallback;

      const payload = {
        date: form.date,
        truck: form.truck.trim() || null,
        site_name: form.siteName.trim() || null,
        address: form.address.trim() || null,
        customer: form.customer.trim() || null,
        staff,
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
      // Reset. Keep date + truck for the next batch.
      setForm((f) => ({
        ...f,
        siteName: '', address: '', customer: '',
        staff: '', notes: '',
        workers: [],
        trialRun: false,
      }));
      loadRecent();
    } catch (err) {
      toast.error(apiError(err) || 'Send failed');
    } finally {
      setSending(false);
    }
  };

  // ─── SMS paste pre-fill ───
  const handleSmsParsed = (parsed) => {
    setForm((f) => ({
      ...f,
      truck:    parsed.truck    || f.truck,
      date:     parsed.date     || f.date,
      siteName: parsed.site_name || f.siteName,
      address:  parsed.address  || f.address,
      customer: parsed.customer || f.customer,
      staff:    (parsed.staff && parsed.staff.length > 0)
                    ? parsed.staff.join(', ')
                    : f.staff,
      notes:    parsed.notes    || f.notes,
    }));
    setShowPasteSms(false);
    toast.success('SMS fields pre-filled — pick workers and hit Send.');
  };

  return (
    <div className="p-6" data-testid="issue-job-page">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900" data-testid="issue-job-h1">
            Issue Today's Job
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Locked to the 7 SMS fields — truck, date, site, address, customer, staff, notes.
            Every worker gets their own copy on their phone.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowPasteSms(true)}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-700 hover:bg-slate-50 shrink-0"
          data-testid="issue-job-paste-sms-btn"
        >
          <ClipboardPaste className="w-3.5 h-3.5" />
          Paste SMS
        </button>
      </div>

      {showPasteSms && (
        <PasteSmsModal
          onClose={() => setShowPasteSms(false)}
          onParsed={handleSmsParsed}
        />
      )}

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
                        {r.site_name || r.address || '—'}
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        Issued {fmtTime(r.issued_at)}
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
              {/* Truck — single string, matches SMS shape */}
              <div className="col-span-2 md:col-span-1">
                <Label icon={TruckIcon} text="Truck" />
                <input
                  type="text"
                  value={form.truck}
                  onChange={(e) => setForm((f) => ({ ...f, truck: e.target.value }))}
                  placeholder="Cappellotto 2 - Volvo - XT48AK"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  data-testid="issue-job-truck-input"
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  Full SMS shape — vehicle name and rego on one line.
                </p>
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
              {/* Site name */}
              <div className="col-span-2 md:col-span-1">
                <Label icon={MapPin} text="Site" />
                <input
                  type="text"
                  value={form.siteName}
                  onChange={(e) => setForm((f) => ({ ...f, siteName: e.target.value }))}
                  placeholder="78 Corin Street West Launceston"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  data-testid="issue-job-site-input"
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
                  placeholder="78 Corin Street West Launceston, TAS 7250"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  data-testid="issue-job-address-input"
                />
              </div>
              {/* Staff on this job — SMS names, comma-separated */}
              <div className="col-span-2">
                <Label icon={Users} text="Staff names (as they appear on the SMS)" />
                <input
                  type="text"
                  value={form.staff}
                  onChange={(e) => setForm((f) => ({ ...f, staff: e.target.value }))}
                  placeholder="DANIEL BUTLER, JARROD TARGETT, JASON DONNELLAN"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  data-testid="issue-job-staff-input"
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  Optional — falls back to the picked workers' names below if left blank.
                </p>
              </div>
              {/* Workers picker — who actually receives the job on their phone */}
              <div className="col-span-2">
                <Label icon={Users} text="Send to (workers)" required />
                <WorkerMultiPicker
                  value={form.workers}
                  onChange={(v) => setForm((f) => ({ ...f, workers: v }))}
                />
              </div>
              {/* Notes */}
              <div className="col-span-2">
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
                    ? <><strong>{form.workers.length}</strong> worker{form.workers.length === 1 ? '' : 's'} selected{form.trialRun ? ' + trial mirror' : ''} · {form.siteName || form.address || 'no site'}</>
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

// ─────────────── Paste SMS modal ───────────────

function PasteSmsModal({ onClose, onParsed }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      const { data } = await api.post('/mobile/sms/parse', { sms: text });
      onParsed(data.parsed || {});
    } catch (err) {
      toast.error(apiError(err) || 'Parse failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4"
      data-testid="paste-sms-modal"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-900">Paste SMS</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-slate-100 text-slate-500"
            aria-label="Close"
            data-testid="paste-sms-close-btn"
          >
            <XIcon className="w-4 h-4" />
          </button>
        </div>
        <p className="text-xs text-slate-500 mb-3">
          Paste the entire SMS (truck, date, site, address, customer, staff line, notes).
          The parser handles both labeled and plain formats.
        </p>
        <textarea
          rows={10}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={`Cappellotto 2 - Volvo - XT48AK
15-09-26
78 Corin Street West Launceston
78 Corin Street West Launceston, TAS 7250
Shaw
Staff: DANIEL BUTLER, JARROD TARGETT, JASON DONNELLAN
Kroll to site to expose main, ring Jason to complete tapping when exposed`}
          className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono resize-y"
          data-testid="paste-sms-textarea"
        />
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-700 hover:bg-slate-50"
            data-testid="paste-sms-cancel-btn"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!text.trim() || busy}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold disabled:bg-slate-300"
            data-testid="paste-sms-submit-btn"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Parse & pre-fill
          </button>
        </div>
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
