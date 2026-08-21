// Phase 3 — Service & Maintenance UI surfaces for the AssetDrawer.
// Consolidates the three new tabs (Schedules, Service log, Defects) so the
// AssetDrawer can stay a single file with low churn.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Plus, Loader2, Clock, Gauge, Calendar, Edit3, Trash2, X, Check,
  Wrench, AlertTriangle, ShieldAlert,
} from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../lib/api';
// v160.3.7k — Inoculation sweep: lock body scroll while any of the three
// service-tab modals (ScheduleEditor, DeleteRecordDialog, RecordEditor)
// are open.
import useLockBodyScroll from '../lib/useLockBodyScroll';
// v58.13.14 — Reused for schedule attachments. Same drag-and-drop UI
// the form-submissions FillOutModal renders; parameterised with
// `apiBasePath` / `apiDeletePath` so it can POST/DELETE to
// `/assets/{asset_id}/schedules/{sid}/attachments`.
import { AttachmentField } from './forms/BydaFields';

function statusPill(status) {
  if (status === 'overdue') return ['OVERDUE', 'bg-rose-50 text-rose-700 border-rose-200'];
  if (status === 'due_soon') return ['DUE SOON', 'bg-amber-50 text-amber-700 border-amber-200'];
  return ['OK', 'bg-emerald-50 text-emerald-700 border-emerald-200'];
}

const KIND_ICONS = { hours: Clock, km: Gauge, calendar: Calendar };

// ────────────────── Schedules tab ──────────────────

export function ServiceSchedulesTab({ asset, canEdit }) {
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null); // null = closed, {} = create, {id...} = edit

  const load = useCallback(async () => {
    if (!asset?.id) return;
    setBusy(true);
    try {
      const r = await api.get(`/assets/${asset.id}/schedules`);
      setRows(r.data.schedules || []);
    } catch (e) { toast.error(apiError(e)); } finally { setBusy(false); }
  }, [asset?.id]);
  useEffect(() => { load(); }, [load]);

  const remove = async (s) => {
    if (!window.confirm(`Delete schedule "${s.name}"?`)) return;
    try { await api.delete(`/assets/${asset.id}/schedules/${s.id}`); toast.success('Deleted'); load(); }
    catch (e) { toast.error(apiError(e)); }
  };

  return (
    <div className="space-y-3" data-testid="service-schedules-tab">
      <div className="flex items-center gap-2">
        <h4 className="font-display text-sm font-semibold text-slate-800 flex-1">Service schedules</h4>
        {canEdit && (
          <button onClick={() => setEditing({})}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700"
            data-testid="schedule-add">
            <Plus size={12} /> Add
          </button>
        )}
      </div>
      {busy && <div className="text-xs text-slate-500"><Loader2 size={12} className="inline animate-spin mr-1" /> Loading…</div>}
      {!busy && rows.length === 0 && (
        <div className="px-3 py-6 text-center rounded-xl border border-dashed border-slate-200 text-sm text-slate-500" data-testid="schedules-empty">
          No schedules yet. Add one to start tracking service intervals.
        </div>
      )}
      <ul className="space-y-1.5">
        {rows.map((s) => {
          const [pillLabel, pillCls] = statusPill(s.status_cached || s.status);
          const Icon = KIND_ICONS[s.interval_kind] || Wrench;
          return (
            <li key={s.id} className="px-3 py-2.5 rounded-xl border border-slate-200 bg-white flex items-center gap-2.5" data-testid={`schedule-${s.id}`}>
              <Icon size={16} className="text-slate-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-sm text-slate-900">{s.name}</span>
                  <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider border ${pillCls}`} data-testid={`schedule-status-${s.id}`}>{pillLabel}</span>
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  Every {s.interval_value} {s.interval_kind === 'calendar' ? s.calendar_unit : s.interval_kind}
                  {s.next_due_value != null && <span className="ml-2">· Next at {s.next_due_value}{s.interval_kind === 'hours' ? 'h' : 'km'}</span>}
                  {s.next_due_at && <span className="ml-2">· Next on {new Date(s.next_due_at).toLocaleDateString()}</span>}
                </div>
                {s.secondary_interval && (
                  <div className="text-[11px] text-purple-700 mt-0.5" data-testid={`schedule-secondary-${s.id}`}
                       title="Whichever comes first fires the reminder.">
                    Also every {s.secondary_interval.value} {s.secondary_interval.kind === 'calendar' ? s.secondary_interval.calendar_unit : s.secondary_interval.kind}
                    {s.next_due_value_secondary != null && <span className="ml-2">· Next at {s.next_due_value_secondary}{s.secondary_interval.kind === 'hours' ? 'h' : 'km'}</span>}
                    {s.next_due_at_secondary && <span className="ml-2">· Next on {new Date(s.next_due_at_secondary).toLocaleDateString()}</span>}
                  </div>
                )}
              </div>
              {canEdit && (
                <>
                  <button onClick={() => setEditing(s)} className="p-1.5 rounded hover:bg-slate-100 text-slate-600" data-testid={`schedule-edit-${s.id}`}><Edit3 size={13} /></button>
                  <button onClick={() => remove(s)} className="p-1.5 rounded hover:bg-rose-50 text-rose-600" data-testid={`schedule-delete-${s.id}`}><Trash2 size={13} /></button>
                </>
              )}
            </li>
          );
        })}
      </ul>
      {editing !== null && (
        <ScheduleEditor asset={asset} initial={editing.id ? editing : null}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }} />
      )}
    </div>
  );
}

function ScheduleEditor({ asset, initial, onClose, onSaved }) {
  useLockBodyScroll();
  const isEdit = !!initial;
  const [form, setForm] = useState(() => ({
    name: initial?.name || '', interval_kind: initial?.interval_kind || 'hours',
    interval_value: initial?.interval_value || 250,
    calendar_unit: initial?.calendar_unit || 'days',
    reminder_lead_days: initial?.reminder_lead_days ?? 7,
    reminder_lead_hours: initial?.reminder_lead_hours ?? '',
    reminder_lead_km: initial?.reminder_lead_km ?? '',
    last_done_value: initial?.last_done_value ?? '',
    status: initial?.status || 'active',
    // Phase 3.5 — set "now" as the baseline
    service_done_today: false,
    // v58.12.6 — dual-track (D-2). All local state; only serialised into
    // `secondary_interval` on save when `secondary_enabled === true`.
    secondary_enabled: !!(initial?.secondary_interval),
    secondary_kind: initial?.secondary_interval?.kind
      || ((initial?.interval_kind || 'hours') === 'hours' ? 'km' : 'hours'),
    secondary_value: initial?.secondary_interval?.value ?? 250,
    secondary_calendar_unit: initial?.secondary_interval?.calendar_unit || 'days',
    secondary_last_done_value: initial?.secondary_interval?.last_done_value ?? '',
    secondary_reminder_lead: initial?.secondary_interval?.reminder_lead ?? '',
    secondary_baseline_today: false,
    // v58.13.0-a — Periodic Task Template fields (collapsed "More
    // details" panel below). All optional; legacy schedules parse
    // identically. `entered_by_*` are auto-stamped server-side.
    priority: initial?.priority ?? '',
    task_type: initial?.task_type ?? '',
    task_identification: initial?.task_identification ?? '',
    description_html: initial?.description_html ?? '',
    assigned_to_position: initial?.assigned_to_position ?? '',
    // v58.13.0-b (shipped v58.13.11) — Phase B fields. 5 shipped this
    // turn (phone, reported_by_contact, project_id, assigned_to_worker_*,
    // notes). `attachments` UI is deferred: reusing `AttachmentField`
    // requires a schedule-attachment upload endpoint that doesn't
    // exist yet (see backend `ScheduleIn` comment).
    phone: initial?.phone ?? '',
    reported_by_contact: initial?.reported_by_contact ?? '',
    project_id: initial?.project_id ?? '',
    assigned_to_worker_id: initial?.assigned_to_worker_id ?? '',
    assigned_to_worker_name: initial?.assigned_to_worker_name ?? '',
    notes: initial?.notes ?? '',
  }));
  // v58.13.0-a — Simpro-position dropdown for `assigned_to_position`.
  // Reuses the widened /workers/directory payload (v58.12.10) to
  // derive distinct positions — same source of truth as the Service
  // Log position picker (v58.12.12).
  const [schedTechs, setSchedTechs] = useState([]);
  const [showMoreDetails, setShowMoreDetails] = useState(false);
  useEffect(() => {
    api.get('/workers/directory', { params: { active: true, source: 'simpro' } })
      .then((r) => setSchedTechs(Array.isArray(r.data) ? r.data : []))
      .catch(() => setSchedTechs([]));
  }, []);
  const schedPositions = React.useMemo(
    () => Array.from(new Set((schedTechs || []).map((t) => t.position).filter(Boolean))).sort(),
    [schedTechs],
  );
  // v58.13.0-b (shipped v58.13.11) — Position-filtered worker list
  // for the Phase B `assigned_to_worker` picker. Empty until a
  // position is chosen so the dropdown surfaces a "Select position
  // first" hint instead of a wall of 60+ workers. Client-side filter
  // (same source of truth as `schedPositions`) — no extra network
  // hop needed.
  const filteredAssignWorkers = React.useMemo(
    () => (form.assigned_to_position
      ? (schedTechs || []).filter((t) => (t.position || '') === form.assigned_to_position)
      : []),
    [schedTechs, form.assigned_to_position],
  );
  // v58.13.11 — If the position picker changes to a value that no
  // longer contains the current worker, clear the worker id/name so
  // we don't persist a mismatched pair. Also clears when position
  // itself is cleared.
  useEffect(() => {
    if (!form.assigned_to_worker_id) return;
    const stillValid = filteredAssignWorkers.some(
      (t) => t.id === form.assigned_to_worker_id,
    );
    if (!stillValid) {
      setForm((f) => ({ ...f, assigned_to_worker_id: '', assigned_to_worker_name: '' }));
    }
  }, [form.assigned_to_position, filteredAssignWorkers, form.assigned_to_worker_id]);
  const [saving, setSaving] = useState(false);

  // Phase 3.5 — helper line shows the projected next-due based on the
  // asset's current meter (or today's date) the moment the user changes
  // the interval value.
  const currentMeter = form.interval_kind === 'hours'
    ? asset?.hours_meter
    : form.interval_kind === 'km'
      ? asset?.odo_km
      : null;
  const intervalNum = Number(form.interval_value);
  const helperLine = (() => {
    if (form.interval_kind === 'calendar') {
      if (!intervalNum || isNaN(intervalNum)) return null;
      const now = new Date();
      const dt = new Date(now);
      const unit = form.calendar_unit;
      if (unit === 'days') dt.setDate(dt.getDate() + intervalNum);
      else if (unit === 'weeks') dt.setDate(dt.getDate() + intervalNum * 7);
      else if (unit === 'months') dt.setMonth(dt.getMonth() + intervalNum);
      else if (unit === 'years') dt.setFullYear(dt.getFullYear() + intervalNum);
      return `Currently ${now.toLocaleDateString()} → next due ${dt.toLocaleDateString()}`;
    }
    if (currentMeter == null || isNaN(intervalNum) || intervalNum <= 0) return null;
    const next = Number(currentMeter) + intervalNum;
    const unit = form.interval_kind === 'hours' ? 'hrs' : 'km';
    const fmtCur = Number(currentMeter).toLocaleString(undefined, { maximumFractionDigits: 1 });
    const fmtNext = next.toLocaleString(undefined, { maximumFractionDigits: 1 });
    return `Currently ${fmtCur} ${unit} → next due at ${fmtNext} ${unit}`;
  })();

  // v58.12.6 — secondary axis helper line + reading availability guard.
  const secondaryMeter = form.secondary_kind === 'hours'
    ? asset?.hours_meter
    : form.secondary_kind === 'km'
      ? asset?.odo_km
      : null;
  const secondaryHelperLine = (() => {
    if (!form.secondary_enabled) return null;
    const iv = Number(form.secondary_value);
    if (form.secondary_kind === 'calendar') {
      if (!iv || isNaN(iv)) return null;
      const dt = new Date();
      const u = form.secondary_calendar_unit;
      if (u === 'days') dt.setDate(dt.getDate() + iv);
      else if (u === 'weeks') dt.setDate(dt.getDate() + iv * 7);
      else if (u === 'months') dt.setMonth(dt.getMonth() + iv);
      else if (u === 'years') dt.setFullYear(dt.getFullYear() + iv);
      return `Also: next due ${dt.toLocaleDateString()}`;
    }
    if (secondaryMeter == null || isNaN(iv) || iv <= 0) return null;
    const next = Number(secondaryMeter) + iv;
    const unit = form.secondary_kind === 'hours' ? 'hrs' : 'km';
    return `Also: currently ${Number(secondaryMeter).toLocaleString(undefined, { maximumFractionDigits: 1 })} ${unit} → next due at ${next.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${unit}`;
  })();
  // Which secondary kinds are available for this asset? Primary's kind is
  // always excluded (same-dimension is server-rejected). Hours/km require
  // the corresponding reading on the asset doc.
  const secondaryOptions = ['hours', 'km', 'calendar']
    .filter((k) => k !== form.interval_kind)
    .map((k) => ({
      kind: k,
      disabled: (k === 'hours' && asset?.hours_meter == null)
             || (k === 'km' && asset?.odo_km == null),
    }));

  const save = async () => {
    if (!form.name.trim()) { toast.error('Name is required'); return; }
    setSaving(true);
    try {
      const payload = {
        ...form,
        interval_value: Number(form.interval_value),
        reminder_lead_days: Number(form.reminder_lead_days) || 7,
        reminder_lead_hours: form.reminder_lead_hours === '' ? null : Number(form.reminder_lead_hours),
        reminder_lead_km: form.reminder_lead_km === '' ? null : Number(form.reminder_lead_km),
        last_done_value: form.last_done_value === '' ? null : Number(form.last_done_value),
      };
      // Phase 3.5 — checkbox override: baseline this schedule on today's
      // current meter (or current date for calendar intervals).
      if (form.service_done_today) {
        if (form.interval_kind === 'hours' && asset?.hours_meter != null) {
          payload.last_done_value = Number(asset.hours_meter);
        } else if (form.interval_kind === 'km' && asset?.odo_km != null) {
          payload.last_done_value = Number(asset.odo_km);
        }
        payload.last_done_at = new Date().toISOString();
      }
      // Remove UI-only field before sending
      delete payload.service_done_today;
      // v58.12.6 — assemble secondary_interval iff the toggle is on.
      // The UI-only fields on `form` (`secondary_*`) are stripped either
      // way so they never leak into the payload.
      if (form.secondary_enabled) {
        const sec = {
          kind: form.secondary_kind,
          value: Number(form.secondary_value),
          calendar_unit: form.secondary_kind === 'calendar' ? form.secondary_calendar_unit : null,
          last_done_value: form.secondary_last_done_value === '' ? null : Number(form.secondary_last_done_value),
          reminder_lead: form.secondary_reminder_lead === '' ? null : Number(form.secondary_reminder_lead),
          last_done_at: null,
        };
        if (form.secondary_baseline_today) {
          if (form.secondary_kind === 'hours' && asset?.hours_meter != null) sec.last_done_value = Number(asset.hours_meter);
          else if (form.secondary_kind === 'km' && asset?.odo_km != null) sec.last_done_value = Number(asset.odo_km);
          sec.last_done_at = new Date().toISOString();
        }
        payload.secondary_interval = sec;
      } else {
        payload.secondary_interval = null;
      }
      ['secondary_enabled', 'secondary_kind', 'secondary_value', 'secondary_calendar_unit',
       'secondary_last_done_value', 'secondary_reminder_lead', 'secondary_baseline_today'
      ].forEach((k) => delete payload[k]);
      if (isEdit) await api.put(`/assets/${asset.id}/schedules/${initial.id}`, payload);
      else await api.post(`/assets/${asset.id}/schedules`, payload);
      toast.success(isEdit ? 'Schedule updated' : 'Schedule created');
      onSaved();
    } catch (e) { toast.error(apiError(e)); } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4" onClick={(e) => e.target === e.currentTarget && onClose()} data-testid="schedule-editor">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200">
        <div className="px-5 py-3 border-b flex items-center"><h3 className="font-display font-bold text-slate-900 flex-1">{isEdit ? 'Edit schedule' : 'New schedule'}</h3><button onClick={onClose}><X size={16} /></button></div>
        <div className="px-5 py-4 space-y-3 text-sm">
          <div>
            <label className="block text-xs font-semibold mb-1">Name</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg" data-testid="sch-name" placeholder="e.g. 250hr service" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1">Interval kind</label>
              <select value={form.interval_kind} onChange={(e) => setForm({ ...form, interval_kind: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg" data-testid="sch-kind">
                <option value="hours">Hours</option><option value="km">Kilometres</option><option value="calendar">Calendar</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Interval value</label>
              <input type="number" value={form.interval_value} onChange={(e) => setForm({ ...form, interval_value: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg" data-testid="sch-interval" />
            </div>
          </div>
          {form.interval_kind === 'calendar' && (
            <div>
              <label className="block text-xs font-semibold mb-1">Calendar unit</label>
              <select value={form.calendar_unit} onChange={(e) => setForm({ ...form, calendar_unit: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg" data-testid="sch-unit">
                <option value="days">Days</option><option value="weeks">Weeks</option><option value="months">Months</option><option value="years">Years</option>
              </select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1">Reminder lead (days)</label>
              <input type="number" value={form.reminder_lead_days} onChange={(e) => setForm({ ...form, reminder_lead_days: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg" data-testid="sch-lead-days" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Last done {form.interval_kind === 'calendar' ? 'date' : 'value'}</label>
              <input value={form.last_done_value} onChange={(e) => setForm({ ...form, last_done_value: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg" data-testid="sch-last-done" placeholder={form.interval_kind === 'hours' ? 'e.g. 0' : '—'} />
            </div>
          </div>
          {/* Phase 3.5 — live helper line + service-done-today checkbox */}
          {helperLine && (
            <div className="px-3 py-2 rounded-lg bg-blue-50 border border-blue-200 text-[11px] text-blue-800" data-testid="sch-helper-line">
              {helperLine}
            </div>
          )}
          <label className="flex items-start gap-2 cursor-pointer" data-testid="sch-baseline-today-label">
            <input type="checkbox" checked={form.service_done_today}
              onChange={(e) => setForm({ ...form, service_done_today: e.target.checked })}
              className="mt-0.5 w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              data-testid="sch-baseline-today" />
            <span className="text-xs text-slate-700">
              <span className="font-semibold">Service done today — set this as the baseline</span>
              <span className="block text-[10px] text-slate-500 mt-0.5">
                On save, last-done is set to the current
                {form.interval_kind === 'hours' ? ' engine hours' : form.interval_kind === 'km' ? ' odometer' : ' date'}
                {currentMeter != null && form.interval_kind !== 'calendar' && (
                  <> ({Number(currentMeter).toLocaleString(undefined, { maximumFractionDigits: 1 })}{form.interval_kind === 'hours' ? ' hrs' : ' km'})</>
                )}.
              </span>
            </span>
          </label>
          {/* v58.12.6 — Also-track-by (dual-track schedule) */}
          <div className="pt-1 border-t border-slate-100" data-testid="sch-secondary-section">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.secondary_enabled}
                onChange={(e) => setForm({ ...form, secondary_enabled: e.target.checked })}
                className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                data-testid="sch-secondary-toggle" />
              <span className="text-xs font-semibold text-slate-800">Also track by (second dimension)</span>
            </label>
            {form.secondary_enabled && (
              <div className="mt-2 pl-6 space-y-2" data-testid="sch-secondary-panel">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-semibold mb-1 uppercase tracking-wider text-slate-500">Second kind</label>
                    <select value={form.secondary_kind}
                      onChange={(e) => setForm({ ...form, secondary_kind: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                      data-testid="sch-secondary-kind">
                      {secondaryOptions.map((o) => (
                        <option key={o.kind} value={o.kind} disabled={o.disabled}
                          title={o.disabled ? (o.kind === 'hours' ? 'This asset has no hours_meter reading' : 'This asset has no odometer reading') : ''}>
                          {o.kind === 'hours' ? 'Hours' : o.kind === 'km' ? 'Kilometres' : 'Calendar'}
                          {o.disabled ? ' — unavailable' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold mb-1 uppercase tracking-wider text-slate-500">Second value</label>
                    <input type="number" value={form.secondary_value}
                      onChange={(e) => setForm({ ...form, secondary_value: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                      data-testid="sch-secondary-value" />
                  </div>
                </div>
                {form.secondary_kind === 'calendar' && (
                  <div>
                    <label className="block text-[10px] font-semibold mb-1 uppercase tracking-wider text-slate-500">Second calendar unit</label>
                    <select value={form.secondary_calendar_unit}
                      onChange={(e) => setForm({ ...form, secondary_calendar_unit: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                      data-testid="sch-secondary-unit">
                      <option value="days">Days</option><option value="weeks">Weeks</option>
                      <option value="months">Months</option><option value="years">Years</option>
                    </select>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-semibold mb-1 uppercase tracking-wider text-slate-500">
                      Reminder lead ({form.secondary_kind === 'calendar' ? 'days' : form.secondary_kind === 'hours' ? 'hours' : 'km'})
                    </label>
                    <input type="number" value={form.secondary_reminder_lead}
                      onChange={(e) => setForm({ ...form, secondary_reminder_lead: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                      data-testid="sch-secondary-lead" placeholder="auto" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold mb-1 uppercase tracking-wider text-slate-500">Last done {form.secondary_kind === 'calendar' ? 'date' : 'value'}</label>
                    <input value={form.secondary_last_done_value}
                      onChange={(e) => setForm({ ...form, secondary_last_done_value: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                      data-testid="sch-secondary-last-done" />
                  </div>
                </div>
                {secondaryHelperLine && (
                  <div className="px-3 py-2 rounded-lg bg-purple-50 border border-purple-200 text-[11px] text-purple-800"
                       data-testid="sch-secondary-helper-line">
                    {secondaryHelperLine}
                  </div>
                )}
                <label className="flex items-start gap-2 cursor-pointer text-[11px] text-slate-700">
                  <input type="checkbox" checked={form.secondary_baseline_today}
                    onChange={(e) => setForm({ ...form, secondary_baseline_today: e.target.checked })}
                    className="mt-0.5 w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    data-testid="sch-secondary-baseline-today" />
                  <span>Second baseline = today&apos;s reading</span>
                </label>
              </div>
            )}
          </div>
          {/* v58.13.0-a — Periodic Task Template "More details" panel.
              Collapsed by default so the v58.12.6 fast-flow is preserved.
              5 user-facing fields; entered_by_* are auto-stamped server-side. */}
          <div className="pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setShowMoreDetails((v) => !v)}
              className="text-xs font-semibold text-slate-600 hover:text-slate-900 inline-flex items-center gap-1"
              data-testid="sch-more-details-toggle"
            >
              {showMoreDetails ? '−' : '+'} More details
            </button>
            {showMoreDetails && (
              <div className="mt-3 space-y-3" data-testid="sch-more-details-panel">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold mb-1">Priority</label>
                    <select value={form.priority}
                      onChange={(e) => setForm({ ...form, priority: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                      data-testid="sch-priority">
                      <option value="">— None —</option>
                      <option value="Low">Low</option>
                      <option value="Medium">Medium</option>
                      <option value="High">High</option>
                      <option value="Urgent">Urgent</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1">Task type</label>
                    <select value={form.task_type}
                      onChange={(e) => setForm({ ...form, task_type: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                      data-testid="sch-task-type">
                      <option value="">— None —</option>
                      <option value="Installation">Installation</option>
                      <option value="Repair">Repair</option>
                      <option value="Maintenance">Maintenance</option>
                      <option value="Inspection">Inspection</option>
                      <option value="Service">Service</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Task identification</label>
                  <input value={form.task_identification}
                    onChange={(e) => setForm({ ...form, task_identification: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                    data-testid="sch-task-id"
                    placeholder="e.g. Holden Ute : 6MO / 10,000KM Service" />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Assigned to (position)</label>
                  <select value={form.assigned_to_position}
                    onChange={(e) => setForm({ ...form, assigned_to_position: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                    data-testid="sch-assigned-position">
                    <option value="">— Select position —</option>
                    {schedPositions.map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Description</label>
                  <textarea value={form.description_html}
                    onChange={(e) => setForm({ ...form, description_html: e.target.value })}
                    rows={4}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                    data-testid="sch-description-html"
                    placeholder="Task notes, checklist references, or HTML." />
                </div>
                {/* v58.13.0-b (shipped v58.13.11) — Phase B fields.
                    5 rendered: phone, reported_by_contact, project_id,
                    assigned_to_worker (position-filtered dropdown),
                    notes. `attachments` UI is deferred pending a
                    schedule-attachment upload endpoint — see backend
                    `ScheduleIn` v58.13.11 block for full rationale. */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold mb-1">Phone</label>
                    <input value={form.phone}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                      data-testid="sch-phone"
                      placeholder="e.g. 0400 123 456"
                      type="tel" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1">Reported by (contact)</label>
                    <input value={form.reported_by_contact}
                      onChange={(e) => setForm({ ...form, reported_by_contact: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                      data-testid="sch-reported-by-contact"
                      placeholder="Name or contact reference" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Project ID</label>
                  <input value={form.project_id}
                    onChange={(e) => setForm({ ...form, project_id: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                    data-testid="sch-project-id"
                    placeholder="Free-text project identifier" />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Assigned to (worker)</label>
                  <select value={form.assigned_to_worker_id}
                    disabled={!form.assigned_to_position}
                    onChange={(e) => {
                      const wid = e.target.value;
                      const w = filteredAssignWorkers.find((x) => x.id === wid);
                      setForm({
                        ...form,
                        assigned_to_worker_id: wid,
                        assigned_to_worker_name: w?.name || '',
                      });
                    }}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white text-sm disabled:bg-slate-50 disabled:text-slate-400"
                    data-testid="sch-assigned-worker">
                    <option value="">
                      {form.assigned_to_position
                        ? (filteredAssignWorkers.length === 0
                          ? '— No workers with this position —'
                          : '— Select worker —')
                        : 'Select position first'}
                    </option>
                    {filteredAssignWorkers.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.simpro_employee_id
                          ? `${t.name} · #${t.simpro_employee_id}`
                          : t.name}
                      </option>
                    ))}
                  </select>
                  {!form.assigned_to_position && (
                    <p className="mt-1 text-[11px] text-slate-500"
                       data-testid="sch-assigned-worker-hint">
                      Pick a position above to filter the worker list.
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Notes</label>
                  <textarea value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    rows={3}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                    data-testid="sch-notes"
                    placeholder="Additional notes for this schedule (plain text)." />
                </div>
                {/* v58.13.14 — Attachments (v58.13.11-b endpoint).
                    Only visible in edit mode; new-schedule staging
                    lands in a follow-up (create the schedule first,
                    then attach — same 2-step pattern most SaaS forms
                    use). Reuses the shared BydaFields.AttachmentField
                    with the schedule-scoped POST/DELETE base paths. */}
                {isEdit ? (
                  <div data-testid="sch-attachments">
                    <label className="block text-xs font-semibold mb-1">Attachments</label>
                    <AttachmentField
                      field={{ id: 'attachments', config: { allow_multiple: true } }}
                      value={form.attachments || []}
                      submissionId={initial.id}
                      apiBasePath={`/assets/${asset.id}/schedules`}
                      apiDeletePath={`/assets/${asset.id}/schedules`}
                      onServerFileDeleted={(att) => {
                        setForm((f) => ({
                          ...f,
                          attachments: (f.attachments || []).filter(
                            (a) => (a.stored_name || a.file_id) !== (att.stored_name || att.file_id),
                          ),
                        }));
                      }}
                    />
                  </div>
                ) : (
                  <div className="text-[11px] text-slate-500 italic"
                       data-testid="sch-attachments-hint">
                    Save the schedule first, then reopen it to attach files.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="px-5 py-3 border-t bg-slate-50 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 rounded-lg border border-slate-300 text-sm font-semibold" data-testid="sch-cancel">Cancel</button>
          <button onClick={save} disabled={saving} className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-bold disabled:opacity-50" data-testid="sch-save">
            {saving ? <Loader2 size={14} className="inline animate-spin" /> : <Check size={14} className="inline" />} Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ────────────────── Service log tab ──────────────────

export function ServiceLogTab({ asset, canEdit }) {
  const [records, setRecords] = useState([]);
  const [adder, setAdder] = useState(null); // {kind:'service'|'defect', record?:existing} or null
  const [deleting, setDeleting] = useState(null); // record being confirmed
  const load = useCallback(async () => {
    if (!asset?.id) return;
    const r = await api.get(`/assets/${asset.id}/records`);
    setRecords(r.data.records || []);
  }, [asset?.id]);
  useEffect(() => { load(); }, [load]);

  const onDelete = async () => {
    if (!deleting) return;
    try {
      await api.delete(`/assets/${asset.id}/records/${deleting.id}`);
      toast.success('Record deleted');
      setDeleting(null);
      load();
    } catch (e) { toast.error(apiError(e)); }
  };

  return (
    <div className="space-y-3" data-testid="service-log-tab">
      <div className="flex items-center gap-2 flex-wrap">
        <h4 className="font-display text-sm font-semibold text-slate-800 flex-1">Service log</h4>
        {canEdit && (
          <>
            <button onClick={() => setAdder({ kind: 'service' })} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold" data-testid="record-add-service"><Plus size={12} /> Log service</button>
            <button onClick={() => setAdder({ kind: 'defect' })} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-semibold" data-testid="record-add-defect"><AlertTriangle size={12} /> Report defect</button>
          </>
        )}
      </div>
      <ul className="space-y-2" data-testid="record-list">
        {records.length === 0 && <li className="text-xs text-slate-500 italic">No records yet.</li>}
        {records.map((r) => (
          <RecordRow key={r.id} record={r}
            canEdit={canEdit}
            onEdit={() => setAdder({ kind: r.type === 'defect' ? 'defect' : 'service', record: r })}
            onDelete={() => setDeleting(r)} />
        ))}
      </ul>
      {adder && <RecordEditor asset={asset} kind={adder.kind} initial={adder.record || null}
        onClose={() => setAdder(null)}
        onSaved={() => { setAdder(null); load(); }} />}
      {deleting && (
        <DeleteRecordDialog record={deleting} onCancel={() => setDeleting(null)} onConfirm={onDelete} />
      )}
    </div>
  );
}

function DeleteRecordDialog({ record, onCancel, onConfirm }) {
  useLockBodyScroll();
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 p-3"
      onClick={(e) => e.target === e.currentTarget && onCancel()}
      data-testid="record-delete-dialog">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl border border-slate-200 p-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-full bg-rose-100 text-rose-700 flex items-center justify-center">
            <AlertTriangle size={16} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-display font-bold text-slate-900">Delete this {record.type} entry?</h3>
            <p className="text-xs text-slate-500 mt-1">This cannot be undone. {record.linked_hazard_id ? 'A linked hazard exists and will be kept with an audit note.' : ''}</p>
            <p className="text-[11px] text-slate-600 mt-2 truncate">&ldquo;{record.title}&rdquo;</p>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="px-3 py-2 rounded-lg border border-slate-300 text-sm font-semibold" data-testid="record-delete-cancel">Cancel</button>
          <button onClick={onConfirm} className="px-4 py-2 rounded-lg bg-rose-600 text-white text-sm font-bold" data-testid="record-delete-confirm">Delete</button>
        </div>
      </div>
    </div>
  );
}

function RecordRow({ record, canEdit, onEdit, onDelete }) {
  const isDefect = record.type === 'defect';
  const tone = isDefect ? 'border-rose-200 bg-rose-50' : record.type === 'meter_update' ? 'border-slate-200 bg-slate-50' : 'border-emerald-200 bg-emerald-50';
  const Icon = isDefect ? AlertTriangle : record.type === 'meter_update' ? Gauge : Wrench;
  return (
    <li className={`group relative px-3 py-2.5 rounded-xl border ${tone}`} data-testid={`record-${record.id}`}>
      <div className="flex items-start gap-2">
        <Icon size={14} className="mt-0.5 text-slate-600 shrink-0" />
        <div className="flex-1 min-w-0 pr-12">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm text-slate-900">{record.title}</span>
            <span className="text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-white border border-slate-200">{record.type}</span>
            {record.defect_severity && (
              <span className={`text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded ${record.defect_severity === 'critical' ? 'bg-rose-600 text-white' : record.defect_severity === 'major' ? 'bg-amber-600 text-white' : 'bg-slate-200 text-slate-700'}`}>{record.defect_severity}</span>
            )}
            {record.linked_hazard_id && (
              <span className="inline-flex items-center gap-0.5 text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 border border-rose-300" data-testid={`hazard-link-${record.id}`}>
                <ShieldAlert size={9} /> Hazard raised
              </span>
            )}
          </div>
          {record.description && <div className="text-[11px] text-slate-600 mt-0.5">{record.description}</div>}
          <div className="text-[11px] text-slate-500 mt-0.5">
            {new Date(record.performed_at).toLocaleString()} · {record.performed_by_name || record.performed_by}
            {record.hours_at != null && <span className="ml-2">{record.hours_at}h</span>}
            {record.km_at != null && <span className="ml-2">{record.km_at}km</span>}
            {record.cost != null && <span className="ml-2">${record.cost}</span>}
            {record.technician_name && <span className="ml-2">· {record.technician_name}</span>}
          </div>
        </div>
        {canEdit && (
          <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 sm:opacity-0 max-sm:opacity-100 focus-within:opacity-100 transition">
            <button type="button" onClick={onEdit}
              data-testid={`record-edit-${record.id}`}
              aria-label="Edit record"
              className="p-1.5 rounded-lg bg-white/90 border border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900 shadow-sm">
              <Edit3 size={12} />
            </button>
            <button type="button" onClick={onDelete}
              data-testid={`record-delete-${record.id}`}
              aria-label="Delete record"
              className="p-1.5 rounded-lg bg-white/90 border border-slate-200 text-rose-600 hover:bg-rose-50 shadow-sm">
              <Trash2 size={12} />
            </button>
          </div>
        )}
      </div>
    </li>
  );
}

// v58.13.18 — Exported so the new Service Inbox tab in
// PlantVehicles.jsx can reuse the exact same "Log service" flow
// pre-filled with `{schedule_id, asset_id, type: schedule.task_type}`.
// Internal helpers (ScheduleEditor / DeleteRecordDialog / RecordRow /
// state, sub-modes and derived memos) stay module-scoped — only the
// component itself is exposed.
export function RecordEditor({ asset, kind, initial, onClose, onSaved }) {
  useLockBodyScroll();
  const isEdit = !!initial;
  const [form, setForm] = useState({
    title: initial?.title ?? (kind === 'defect' ? 'Defect' : 'Service performed'),
    description: initial?.description ?? '',
    hours_at: initial?.hours_at != null ? String(initial.hours_at) : '',
    km_at: initial?.km_at != null ? String(initial.km_at) : '',
    cost: initial?.cost != null ? String(initial.cost) : '',
    technician_name: initial?.technician_name ?? '',
    technician_id: initial?.technician_id ?? '',
    // v58.12.8 (shipped v58.12.10) — Simpro position captured alongside
    // the technician. Free-text at persistence; picker-constrained in UI.
    technician_position: initial?.technician_position ?? '',
    defect_severity: initial?.defect_severity ?? 'minor',
  });
  const [saving, setSaving] = useState(false);
  // v160.3.9.58.11.2 — Simpro-employee dropdown for the Technician
  // field. Fetches once on mount from the new
  // `GET /api/workers/directory?active=true&source=simpro` endpoint
  // (thin projection, `service_records.edit`-gated). Two UI modes:
  //   · `mode="picker"` — native `<select>` sourced from Simpro.
  //     Default for new records. If an edited legacy record's
  //     `technician_name` doesn't match any dropdown option, we
  //     start in `mode="freetext"` so the value renders and can be
  //     preserved without forcing the user to overwrite it.
  //   · `mode="freetext"` — the pre-v58.11.2 `<input>`. Reachable
  //     from the picker via the "— Type manually —" sentinel option
  //     (contractors, one-off techs, employees not yet synced).
  const [techs, setTechs] = useState([]);
  const [techsLoaded, setTechsLoaded] = useState(false);
  const [techMode, setTechMode] = useState('picker');
  // v58.12.12 — Service Log Position-Primary redesign. Position is now
  // the FIRST-CLASS primary picker; Technician follows and filters by
  // matching position. Chip + pencil auto-fill UX from v58.12.10 is
  // retired — position drives tech, not the other way around.
  //   posMode: 'select' | 'freetext'
  //     · 'select'  (default) — dropdown of Simpro-distinct positions
  //     · 'freetext'          — user picked "— Type manually —" for a
  //                              contractor / off-roster override.
  const [posMode, setPosMode] = useState('select');
  const positions = useMemo(
    () => Array.from(new Set((techs || []).map((t) => t.position).filter(Boolean))).sort(),
    [techs],
  );
  // Filter the technician list by the currently-selected position when
  // one is set. Alphabetical inherited from the Simpro-sorted `techs`.
  const filteredTechs = useMemo(() => {
    if (!form.technician_position) return techs;
    return techs.filter((t) => t.position === form.technician_position);
  }, [techs, form.technician_position]);
  // Zero-match fallback: when the picked position has zero workers on
  // the roster, we DO NOT strand the user with an empty list — the
  // dropdown reverts to the full 68-worker set and an inline hint tells
  // them what's happening.
  const techPositionHasNoMatch = Boolean(
    form.technician_position && filteredTechs.length === 0 && techs.length > 0,
  );
  const effectiveTechs = techPositionHasNoMatch ? techs : filteredTechs;
  useEffect(() => {
    if (kind !== 'service') return;
    let cancelled = false;
    api.get('/workers/directory', {
      params: { active: true, source: 'simpro' },
    }).then((r) => {
      if (cancelled) return;
      const list = Array.isArray(r.data) ? r.data : [];
      setTechs(list);
      setTechsLoaded(true);
      // Decide initial mode once we have the list. Legacy records
      // that don't match any option start in freetext to preserve
      // the string.
      if (initial?.technician_id && list.some((t) => t.id === initial.technician_id)) {
        setTechMode('picker');
      } else if (initial?.technician_name && !list.some((t) => t.name === initial.technician_name)) {
        setTechMode('freetext');
      } else {
        setTechMode('picker');
      }
    }).catch(() => {
      if (cancelled) return;
      // Endpoint unreachable → fall back to freetext so the user is
      // never blocked from logging a service.
      setTechs([]);
      setTechsLoaded(true);
      setTechMode('freetext');
    });
    return () => { cancelled = true; };
  }, [kind, initial]);

  const onPickTech = (value) => {
    if (value === '__manual__') {
      // Preserve the currently-picked name if any so the user can
      // edit rather than retype from scratch.
      setTechMode('freetext');
      setForm((f) => ({ ...f, technician_id: '' }));
      return;
    }
    if (!value) {
      setForm((f) => ({ ...f, technician_id: '', technician_name: '' }));
      return;
    }
    const chosen = techs.find((t) => t.id === value);
    if (chosen) {
      setForm((f) => ({
        ...f,
        technician_id: chosen.id,
        technician_name: chosen.name,
        // v58.12.12 — Do NOT overwrite `technician_position` from the
        // tech pick. Position is now the primary/upstream field and
        // drives which techs are visible in this dropdown. Preserving
        // the user's position choice is the whole point of the
        // Position-Primary redesign.
      }));
    }
  };
  const backToPicker = () => {
    setTechMode('picker');
  };

  const submit = async () => {
    setSaving(true);
    try {
      const payload = {
        title: form.title,
        description: form.description || null,
        hours_at: form.hours_at === '' ? null : Number(form.hours_at),
        km_at: form.km_at === '' ? null : Number(form.km_at),
        cost: form.cost === '' ? null : Number(form.cost),
        technician_name: form.technician_name || null,
        technician_id: form.technician_id || null,
        // v58.12.8 (shipped v58.12.10) — always send the field so the
        // backend's PATCH-clear semantic (None → $unset via the "keep if
        // None" whitelist in update_record) is exercised when the user
        // deletes the position.
        technician_position: form.technician_position || null,
      };
      if (kind === 'defect') payload.defect_severity = form.defect_severity;
      if (isEdit) {
        await api.put(`/assets/${asset.id}/records/${initial.id}`, payload);
        toast.success(`${kind === 'defect' ? 'Defect' : 'Service'} updated`);
      } else {
        payload.type = kind;
        const r = await api.post(`/assets/${asset.id}/records`, payload);
        if (kind === 'defect' && r.data.linked_hazard_id) toast.success('Defect logged · hazard raised');
        else toast.success(`${kind} logged`);
      }
      onSaved();
    } catch (e) { toast.error(apiError(e)); } finally { setSaving(false); }
  };
  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-slate-900/40 p-3" onClick={(e) => e.target === e.currentTarget && onClose()} data-testid={`record-editor-${kind}`}>
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200">
        <div className="px-5 py-3 border-b flex items-center">
          <h3 className="font-display font-bold text-slate-900 flex-1">
            {isEdit ? `Edit ${kind === 'defect' ? 'defect' : 'service'}` : (kind === 'defect' ? 'Report defect' : 'Log service')}
          </h3>
          <button onClick={onClose}><X size={16} /></button>
        </div>
        <div className="px-5 py-4 space-y-3 text-sm">
          <div>
            <label className="block text-xs font-semibold mb-1">Title</label>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg" data-testid="rec-title" />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">Description</label>
            <textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg" data-testid="rec-desc" />
          </div>
          {kind === 'defect' && (
            <div>
              <label className="block text-xs font-semibold mb-1">Severity</label>
              <div className="flex gap-2">
                {['minor', 'major', 'critical'].map((s) => (
                  <button key={s} type="button" onClick={() => setForm({ ...form, defect_severity: s })}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase border ${form.defect_severity === s ? (s === 'critical' ? 'bg-rose-600 text-white border-rose-600' : s === 'major' ? 'bg-amber-600 text-white border-amber-600' : 'bg-slate-600 text-white border-slate-600') : 'bg-white border-slate-200'}`}
                    data-testid={`rec-sev-${s}`}>{s}</button>
                ))}
              </div>
              {['major', 'critical'].includes(form.defect_severity) && !isEdit && (
                <p className="text-[11px] text-amber-700 mt-1.5 flex items-center gap-1"><AlertTriangle size={11} /> This will raise a hazard if your workspace setting is on.</p>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1">Hours at</label>
              <input type="number" value={form.hours_at} onChange={(e) => setForm({ ...form, hours_at: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg" data-testid="rec-hours" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Km at</label>
              <input type="number" value={form.km_at} onChange={(e) => setForm({ ...form, km_at: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg" data-testid="rec-km" />
            </div>
          </div>
          {kind === 'service' && (
            <div className="grid grid-cols-2 gap-3">
              {/* v58.12.12 — Service Log Position-Primary redesign.
                  Position is the col-span-2 primary field; Technician
                  filters by the picked position. The v58.12.10
                  chip+pencil auto-fill has been retired — position now
                  drives selection, not the other way around. */}
              <div className="col-span-2">
                <label className="block text-xs font-semibold mb-1">Technician position</label>
                {posMode === 'freetext' ? (
                  <div className="flex gap-2 items-center">
                    <input
                      value={form.technician_position}
                      onChange={(e) => setForm({ ...form, technician_position: e.target.value })}
                      className="flex-1 px-3 py-2 border border-slate-300 rounded-lg"
                      data-testid="technician-position-freetext"
                      placeholder="e.g. Plumber, Site Supervisor"
                    />
                    <button
                      type="button"
                      onClick={() => setPosMode('select')}
                      className="text-[11px] text-slate-500 hover:text-slate-900 underline whitespace-nowrap"
                    >
                      Pick from list
                    </button>
                  </div>
                ) : (
                  <select
                    value={form.technician_position || ''}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === '__manual__') {
                        setPosMode('freetext');
                        setForm((f) => ({ ...f, technician_position: '' }));
                      } else {
                        setForm((f) => ({ ...f, technician_position: v }));
                      }
                    }}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                    data-testid="technician-position-select"
                  >
                    <option value="">— Select position —</option>
                    {positions.map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                    <option value="__manual__">— Type manually —</option>
                  </select>
                )}
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Cost (AUD)</label>
                <input type="number" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg" data-testid="rec-cost" />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Technician</label>
                {techMode === 'picker' ? (
                  <>
                    <select
                      value={form.technician_id || ''}
                      onChange={(e) => onPickTech(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                      data-testid="rec-tech-select"
                      disabled={!techsLoaded}
                    >
                      <option value="">— Select technician —</option>
                      {effectiveTechs.map((t) => (
                        <option key={t.id} value={t.id} data-testid={`rec-tech-opt-${t.id}`}>
                          {t.simpro_employee_id
                            ? `${t.name} · #${t.simpro_employee_id}`
                            : t.name}
                        </option>
                      ))}
                      <option value="__manual__">— Type manually —</option>
                    </select>
                    {techPositionHasNoMatch && (
                      <p
                        data-testid="technician-position-hint-no-match"
                        className="mt-1 text-[11px] text-slate-500 italic"
                      >
                        No workers listed with this position — showing all workers.
                      </p>
                    )}
                  </>
                ) : (
                  <div className="flex gap-2 items-center">
                    <input
                      value={form.technician_name}
                      onChange={(e) => setForm({ ...form, technician_name: e.target.value, technician_id: '' })}
                      className="flex-1 px-3 py-2 border border-slate-300 rounded-lg"
                      data-testid="rec-tech"
                      placeholder="Contractor or unlisted technician"
                    />
                    <button
                      type="button"
                      onClick={backToPicker}
                      className="text-[11px] text-slate-500 hover:text-slate-900 underline whitespace-nowrap"
                      data-testid="rec-tech-back-to-picker"
                    >
                      Pick from list
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="px-5 py-3 border-t bg-slate-50 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 rounded-lg border border-slate-300 text-sm font-semibold" data-testid="rec-cancel">Cancel</button>
          <button onClick={submit} disabled={saving} className={`px-4 py-2 rounded-lg text-white text-sm font-bold disabled:opacity-50 ${kind === 'defect' ? 'bg-rose-600' : 'bg-blue-600'}`} data-testid="rec-save">
            {saving ? <Loader2 size={14} className="inline animate-spin" /> : (isEdit ? 'Save changes' : 'Save')}
          </button>
        </div>
      </div>
    </div>
  );
}
