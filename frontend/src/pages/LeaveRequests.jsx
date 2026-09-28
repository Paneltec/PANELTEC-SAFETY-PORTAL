// Leave Requests — payroll leave emails → review → decision emailed to Pay Officer.
// Backend: backend/leave_requests.py  (routes under /api/leave)
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api, { apiError } from '../lib/api';
import { toast } from 'sonner';

const STATUS = {
  pending:        { label: 'Pending',        cls: 'bg-amber-100 text-amber-800' },
  info_requested: { label: 'Info requested', cls: 'bg-sky-100 text-sky-800' },
  approved:       { label: 'Approved',       cls: 'bg-emerald-100 text-emerald-800' },
  rejected:       { label: 'Not approved',   cls: 'bg-rose-100 text-rose-800' },
  cancelled:      { label: 'Cancelled',      cls: 'bg-slate-200 text-slate-600' },
};
const CAT = {
  annual:       { label: 'Annual',       bar: 'bg-sky-500' },
  sick:         { label: 'Sick / Carer', bar: 'bg-rose-500' },
  long_service: { label: 'Long service', bar: 'bg-violet-500' },
  unpaid:       { label: 'Unpaid',       bar: 'bg-slate-500' },
  other:        { label: 'Other',        bar: 'bg-amber-500' },
};

const iso = (d) => d.toISOString().slice(0, 10);
const fmt = (s) => (s ? new Date(s + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const fmtShort = (s) => new Date(s + 'T00:00:00').toLocaleDateString('en-AU', { day: '2-digit', month: 'short' });

function Pill({ status }) {
  const s = STATUS[status] || STATUS.pending;
  return <span data-testid={`leave-status-pill-${status}`} className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${s.cls}`}>{s.label}</span>;
}

function Kpi({ label, value, tone, onClick, testid }) {
  return (
    <button data-testid={testid} onClick={onClick} className="text-left rounded-xl border border-slate-200 bg-white p-4 hover:border-orange-400 transition focus:outline-none focus:ring-2 focus:ring-orange-400">
      <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{label}</div>
      <div className={`text-3xl font-bold mt-1 ${tone}`}>{value ?? '—'}</div>
    </button>
  );
}

// ── 14-day "who's off" strip ────────────────────────────────────────
function WhosOff({ rows }) {
  const days = useMemo(() => {
    const out = []; const d = new Date(); d.setHours(0, 0, 0, 0);
    for (let i = 0; i < 14; i++) { out.push(iso(d)); d.setDate(d.getDate() + 1); }
    return out;
  }, []);
  const people = rows.filter((r) => ['approved', 'pending', 'info_requested'].includes(r.status)
    && r.end_date >= days[0] && r.start_date <= days[13]);
  if (!people.length) return <div data-testid="leave-whos-off-empty" className="text-sm text-slate-500 p-4">Nobody is off in the next 14 days.</div>;
  return (
    <div className="overflow-x-auto" data-testid="leave-whos-off-table">
      <table className="w-full text-xs">
        <thead>
          <tr>
            <th className="text-left p-2 w-44 font-semibold text-slate-500">Employee</th>
            {days.map((d) => {
              const dt = new Date(d + 'T00:00:00'); const wk = dt.getDay() === 0 || dt.getDay() === 6;
              return <th key={d} className={`p-1 font-medium ${wk ? 'text-slate-300' : 'text-slate-500'}`}>{dt.toLocaleDateString('en-AU', { weekday: 'narrow' })}<br />{dt.getDate()}</th>;
            })}
          </tr>
        </thead>
        <tbody>
          {people.map((r) => (
            <tr key={r.id} className="border-t border-slate-100">
              <td className="p-2 font-medium text-slate-800 truncate">{r.employee_name}</td>
              {days.map((d) => {
                const on = d >= r.start_date && d <= r.end_date;
                const bar = (CAT[r.category] || CAT.other).bar;
                return (
                  <td key={d} className="p-0.5">
                    {on && <div title={`${r.leave_type} (${STATUS[r.status]?.label})`}
                      className={`h-5 rounded ${bar} ${r.status !== 'approved' ? 'opacity-40 border border-dashed border-slate-700' : ''}`} />}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex gap-4 px-2 pt-2 text-[11px] text-slate-500">
        {Object.entries(CAT).map(([k, v]) => <span key={k} className="flex items-center gap-1"><span className={`w-3 h-3 rounded ${v.bar}`} />{v.label}</span>)}
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-slate-400 opacity-40 border border-dashed border-slate-700" />Not yet approved</span>
      </div>
    </div>
  );
}

// ── Detail drawer with decision ─────────────────────────────────────
function Drawer({ id, onClose, onChanged }) {
  const [row, setRow] = useState(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get(`/leave/${id}`).then(({ data }) => setRow(data)).catch((e) => toast.error(apiError(e)));
  }, [id]);

  const decide = async (decision) => {
    setBusy(true);
    try {
      await api.post(`/leave/${id}/decision`, { decision, comment: comment || null });
      toast.success(decision === 'approve' ? 'Approved — Pay Officer emailed' : decision === 'reject' ? 'Not approved — Pay Officer emailed' : 'Info requested — Pay Officer emailed');
      onChanged(); onClose();
    } catch (e) { toast.error(apiError(e)); } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/30" onClick={onClose} data-testid="leave-detail-drawer-overlay">
      <div className="w-full max-w-md bg-white shadow-xl overflow-y-auto mt-16" style={{ maxHeight: 'calc(100vh - 4rem)' }} onClick={(e) => e.stopPropagation()} data-testid="leave-detail-drawer">
        {!row ? <div className="p-6 text-slate-500">Loading…</div> : (
          <div className="p-6 space-y-5">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-lg font-bold text-slate-900" data-testid="leave-detail-name">{row.employee_name}</div>
                <div className="text-sm text-slate-500" data-testid="leave-detail-type">{row.leave_type}</div>
              </div>
              <Pill status={row.status} />
            </div>
            {!row.worker_id && <div data-testid="leave-detail-unmatched-warning" className="text-xs rounded-lg bg-amber-50 border border-amber-200 text-amber-800 p-2">Not matched to a worker record — check the name in Workers.</div>}
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-slate-500 text-xs">From</dt><dd className="font-medium" data-testid="leave-detail-from">{fmt(row.start_date)}</dd></div>
              <div><dt className="text-slate-500 text-xs">To</dt><dd className="font-medium" data-testid="leave-detail-to">{fmt(row.end_date)}</dd></div>
              <div><dt className="text-slate-500 text-xs">Hours</dt><dd className="font-medium" data-testid="leave-detail-hours">{row.hours}</dd></div>
              <div><dt className="text-slate-500 text-xs">Balance on start</dt><dd className="font-medium" data-testid="leave-detail-balance">{row.balance_hours != null ? `${row.balance_hours} h` : '—'}</dd></div>
            </dl>
            {row.employee_note && <div data-testid="leave-detail-note" className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm italic text-slate-700">&ldquo;{row.employee_note}&rdquo;</div>}
            {row.flags?.length > 0 && (
              <div className="space-y-1" data-testid="leave-detail-flags">
                <div className="text-xs font-bold text-slate-500 uppercase">OH&amp;S flags</div>
                {row.flags.map((f) => <div key={f.code} data-testid={`leave-flag-${f.code}`} className="text-sm rounded-lg bg-orange-50 border border-orange-200 text-orange-900 p-2">⚠ {f.label}</div>)}
              </div>
            )}
            {row.decision && (
              <div className="text-xs text-slate-500" data-testid="leave-detail-decision">Decision by {row.decision.by_name} · {new Date(row.decision.at).toLocaleString('en-AU')} · email {row.decision.email_status || 'queued'}
                {row.decision.comment && <div className="mt-1 text-slate-700">&ldquo;{row.decision.comment}&rdquo;</div>}</div>
            )}
            {row.status !== 'cancelled' && (
              <div className="space-y-2 border-t border-slate-100 pt-4">
                <label htmlFor="leave-comment" className="text-xs font-bold text-slate-500 uppercase">Comment to Pay Officer (optional)</label>
                <textarea id="leave-comment" data-testid="leave-decision-comment" value={comment} onChange={(e) => setComment(e.target.value)} rows={3}
                  className="w-full rounded-lg border border-slate-300 bg-slate-50 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" placeholder="e.g. OK — covered by Jack on the excavator" />
                <div className="grid grid-cols-3 gap-2">
                  <button data-testid="leave-approve-btn" disabled={busy} onClick={() => decide('approve')} className="rounded-lg bg-emerald-600 text-white py-2 text-sm font-semibold disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-emerald-400">Approve</button>
                  <button data-testid="leave-more-info-btn" disabled={busy} onClick={() => decide('more_info')} className="rounded-lg bg-sky-600 text-white py-2 text-sm font-semibold disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-sky-400">Need info</button>
                  <button data-testid="leave-reject-btn" disabled={busy} onClick={() => decide('reject')} className="rounded-lg bg-rose-600 text-white py-2 text-sm font-semibold disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-rose-400">Not approve</button>
                </div>
                <p className="text-[11px] text-slate-500">Your decision is emailed to the Pay Officer, who actions it in payroll.</p>
              </div>
            )}
            <div>
              <div className="text-xs font-bold text-slate-500 uppercase mb-1">History</div>
              <ul className="text-xs text-slate-600 space-y-1" data-testid="leave-detail-history">
                {(row.history || []).slice().reverse().map((h, i) => (
                  <li key={i}>{new Date(h.at).toLocaleString('en-AU')} — {h.event.replace('decision:', 'decision: ')} <span className="text-slate-400">({h.source}{h.by ? `, ${h.by}` : ''})</span></li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Modals ──────────────────────────────────────────────────────────
function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 pt-20" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl space-y-4 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 8rem)' }} onClick={(e) => e.stopPropagation()}>
        <div className="text-lg font-bold text-slate-900">{title}</div>
        {children}
      </div>
    </div>
  );
}

function PasteModal({ onClose, onDone }) {
  const [subject, setSubject] = useState('Leave Request Updated');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try { const { data } = await api.post('/leave/import-email', { subject, body }); toast.success(`${data.employee_name} — ${data.created ? 'added' : 'updated'}`); onDone(); onClose(); }
    catch (e) { toast.error(apiError(e)); } finally { setBusy(false); }
  };
  return (
    <Modal title="Paste a leave email" onClose={onClose}>
      <input data-testid="leave-paste-subject" value={subject} onChange={(e) => setSubject(e.target.value)} className="w-full rounded-lg border border-slate-300 bg-slate-50 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" placeholder="Email subject" />
      <textarea data-testid="leave-paste-body" value={body} onChange={(e) => setBody(e.target.value)} rows={10} className="w-full rounded-lg border border-slate-300 bg-slate-50 p-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-orange-400" placeholder="Paste the whole email here…" />
      <div className="flex justify-end gap-2">
        <button data-testid="leave-paste-cancel-btn" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-400">Cancel</button>
        <button data-testid="leave-paste-import-btn" disabled={busy || body.length < 20} onClick={go} className="px-4 py-2 text-sm rounded-lg bg-orange-500 text-white font-semibold disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-orange-400">Import</button>
      </div>
    </Modal>
  );
}

function SettingsField({ label, k, ph, s, setS }) {
  return (
    <label className="block text-sm"><span className="text-xs font-bold text-slate-500 uppercase">{label}</span>
      <input data-testid={`leave-settings-${k}`} value={s[k] || ''} onChange={(e) => setS({ ...s, [k]: e.target.value })} placeholder={ph} className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-50 p-2 focus:outline-none focus:ring-2 focus:ring-orange-400" /></label>
  );
}

function SettingsModal({ onClose }) {
  const [s, setS] = useState(null);
  useEffect(() => { api.get('/leave/settings').then(({ data }) => setS(data)).catch((e) => toast.error(apiError(e))); }, []);
  const save = async () => {
    try { await api.put('/leave/settings', { pay_officer_email: s.pay_officer_email || null, inbox_mailbox: s.inbox_mailbox || null, auto_poll_enabled: !!s.auto_poll_enabled, subject_filter: s.subject_filter || 'Leave Request' }); toast.success('Saved'); onClose(); }
    catch (e) { toast.error(apiError(e)); }
  };
  if (!s) return <Modal title="Leave settings" onClose={onClose}><div className="text-slate-500">Loading…</div></Modal>;
  return (
    <Modal title="Leave settings" onClose={onClose}>
      <SettingsField label="Pay Officer email" k="pay_officer_email" ph="payroll@paneltec.com.au" s={s} setS={setS} />
      <SettingsField label="Leave inbox (Microsoft 365 mailbox)" k="inbox_mailbox" ph="leave@paneltec.com.au" s={s} setS={setS} />
      <SettingsField label="Only read emails whose subject contains" k="subject_filter" ph="Leave Request" s={s} setS={setS} />
      <label className="flex items-center gap-2 text-sm"><input data-testid="leave-settings-auto-poll" type="checkbox" checked={!!s.auto_poll_enabled} onChange={(e) => setS({ ...s, auto_poll_enabled: e.target.checked })} /> Check the inbox automatically every 10 minutes</label>
      {s.last_polled_at && <div className="text-xs text-slate-500">Last checked {new Date(s.last_polled_at).toLocaleString('en-AU')}</div>}
      <div className="flex justify-end gap-2">
        <button data-testid="leave-settings-cancel-btn" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-400">Cancel</button>
        <button data-testid="leave-settings-save-btn" onClick={save} className="px-4 py-2 text-sm rounded-lg bg-orange-500 text-white font-semibold focus:outline-none focus:ring-2 focus:ring-orange-400">Save</button>
      </div>
    </Modal>
  );
}

// ── Page ────────────────────────────────────────────────────────────
const TABS = [
  { k: 'pending', label: 'Needs decision', filter: (r) => ['pending', 'info_requested'].includes(r.status) },
  { k: 'upcoming', label: 'Upcoming', filter: (r, t) => r.end_date >= t && r.status === 'approved' },
  { k: 'flagged', label: 'OH&S flags', filter: (r) => r.flags?.length > 0 && r.status !== 'cancelled' },
  { k: 'all', label: 'All', filter: () => true },
];

export default function LeaveRequests() {
  const [rows, setRows] = useState([]);
  const [sum, setSum] = useState({});
  const [tab, setTab] = useState('pending');
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState(null);
  const [modal, setModal] = useState(null);
  const [polling, setPolling] = useState(false);
  const today = iso(new Date());

  const load = useCallback(async () => {
    try {
      const from = iso(new Date(Date.now() - 180 * 864e5));
      const [a, b] = await Promise.all([api.get('/leave', { params: { from } }), api.get('/leave/summary')]);
      setRows(a.data); setSum(b.data);
    } catch (e) { toast.error(apiError(e)); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const poll = async () => {
    setPolling(true);
    try { const { data } = await api.post('/leave/poll-inbox'); toast.success(`Inbox checked — ${data.created} new, ${data.updated} updated`); load(); }
    catch (e) { toast.error(apiError(e)); } finally { setPolling(false); }
  };

  const t = TABS.find((x) => x.k === tab);
  const shown = rows.filter((r) => t.filter(r, today) && (!q || r.employee_name.toLowerCase().includes(q.toLowerCase())));

  return (
    <div className="p-6 space-y-6 bg-slate-50 min-h-full" data-testid="leave-requests-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900" data-testid="leave-page-title">Leave Requests</h1>
          <p className="text-sm text-slate-500">From payroll emails · decisions go to the Pay Officer</p>
        </div>
        <div className="flex gap-2">
          <button data-testid="leave-poll-inbox-btn" onClick={poll} disabled={polling} className="px-3 py-2 text-sm rounded-lg bg-orange-500 text-white font-semibold disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-orange-400">{polling ? 'Checking…' : 'Check inbox now'}</button>
          <button data-testid="leave-paste-email-btn" onClick={() => setModal('paste')} className="px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-slate-400">Paste email</button>
          <button data-testid="leave-settings-btn" onClick={() => setModal('settings')} className="px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-slate-400">Settings</button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi testid="leave-kpi-pending" label="Needs decision" value={sum.pending} tone="text-amber-600" onClick={() => setTab('pending')} />
        <Kpi testid="leave-kpi-off-today" label="Off today" value={sum.off_today} tone="text-slate-900" onClick={() => setTab('upcoming')} />
        <Kpi testid="leave-kpi-off-7d" label="Off next 7 days" value={sum.off_next_7_days} tone="text-sky-700" onClick={() => setTab('upcoming')} />
        <Kpi testid="leave-kpi-flagged" label="OH&S flags" value={sum.flagged} tone="text-orange-600" onClick={() => setTab('flagged')} />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white" data-testid="leave-whos-off-section">
        <div className="px-4 pt-4 text-sm font-bold text-slate-700">Who&apos;s off — next 14 days</div>
        <WhosOff rows={rows} />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white" data-testid="leave-table-section">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4">
          <div className="flex">
            {TABS.map((x) => (
              <button key={x.k} data-testid={`leave-tab-${x.k}`} onClick={() => setTab(x.k)}
                className={`px-3 py-3 text-sm font-semibold border-b-2 focus:outline-none ${tab === x.k ? 'border-orange-500 text-slate-900' : 'border-transparent text-slate-500'}`}>{x.label}</button>
            ))}
          </div>
          <input data-testid="leave-search-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name…" className="my-2 rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
        </div>
        <table className="w-full text-sm" data-testid="leave-table">
          <thead className="text-xs text-slate-500 uppercase">
            <tr><th className="text-left p-3">Employee</th><th className="text-left p-3">Type</th><th className="text-left p-3">Dates</th><th className="text-right p-3">Hours</th><th className="text-left p-3">Status</th><th className="p-3" /></tr>
          </thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-slate-500" data-testid="leave-table-empty">Nothing here.</td></tr>}
            {shown.map((r) => (
              <tr key={r.id} data-testid={`leave-row-${r.id}`} onClick={() => setOpenId(r.id)} className="border-t border-slate-100 hover:bg-orange-50/40 cursor-pointer">
                <td className="p-3 font-medium text-slate-900">{r.employee_name}</td>
                <td className="p-3"><span className="inline-flex items-center gap-1.5"><span className={`w-2 h-2 rounded-full ${(CAT[r.category] || CAT.other).bar}`} />{r.leave_type}</span></td>
                <td className="p-3 text-slate-600">{fmtShort(r.start_date)} – {fmtShort(r.end_date)}</td>
                <td className="p-3 text-right tabular-nums">{r.hours}</td>
                <td className="p-3"><Pill status={r.status} /></td>
                <td className="p-3 text-right">{r.flags?.length > 0 && <span title={r.flags.map((f) => f.label).join('\n')} className="text-orange-500">⚠</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {openId && <Drawer id={openId} onClose={() => setOpenId(null)} onChanged={load} />}
      {modal === 'paste' && <PasteModal onClose={() => setModal(null)} onDone={load} />}
      {modal === 'settings' && <SettingsModal onClose={() => setModal(null)} />}
    </div>
  );
}
