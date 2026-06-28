// Phase 3 — Service & Maintenance UI surfaces for the AssetDrawer.
// Consolidates the three new tabs (Schedules, Service log, Defects) so the
// AssetDrawer can stay a single file with low churn.
import React, { useCallback, useEffect, useState } from 'react';
import {
  Plus, Loader2, Clock, Gauge, Calendar, Edit3, Trash2, X, Check,
  Wrench, AlertTriangle, ShieldAlert,
} from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../lib/api';

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
  }));
  const [saving, setSaving] = useState(false);

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
  const [adder, setAdder] = useState(null); // 'service' | 'defect' | null
  const load = useCallback(async () => {
    if (!asset?.id) return;
    const r = await api.get(`/assets/${asset.id}/records`);
    setRecords(r.data.records || []);
  }, [asset?.id]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-3" data-testid="service-log-tab">
      <div className="flex items-center gap-2 flex-wrap">
        <h4 className="font-display text-sm font-semibold text-slate-800 flex-1">Service log</h4>
        {canEdit && (
          <>
            <button onClick={() => setAdder('service')} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold" data-testid="record-add-service"><Plus size={12} /> Log service</button>
            <button onClick={() => setAdder('defect')} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-semibold" data-testid="record-add-defect"><AlertTriangle size={12} /> Report defect</button>
          </>
        )}
      </div>
      <ul className="space-y-2" data-testid="record-list">
        {records.length === 0 && <li className="text-xs text-slate-500 italic">No records yet.</li>}
        {records.map((r) => <RecordRow key={r.id} record={r} />)}
      </ul>
      {adder && <RecordEditor asset={asset} kind={adder} onClose={() => setAdder(null)} onSaved={() => { setAdder(null); load(); }} />}
    </div>
  );
}

function RecordRow({ record }) {
  const isDefect = record.type === 'defect';
  const tone = isDefect ? 'border-rose-200 bg-rose-50' : record.type === 'meter_update' ? 'border-slate-200 bg-slate-50' : 'border-emerald-200 bg-emerald-50';
  const Icon = isDefect ? AlertTriangle : record.type === 'meter_update' ? Gauge : Wrench;
  return (
    <li className={`px-3 py-2.5 rounded-xl border ${tone}`} data-testid={`record-${record.id}`}>
      <div className="flex items-start gap-2">
        <Icon size={14} className="mt-0.5 text-slate-600 shrink-0" />
        <div className="flex-1 min-w-0">
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
      </div>
    </li>
  );
}

function RecordEditor({ asset, kind, onClose, onSaved }) {
  const [form, setForm] = useState({
    title: kind === 'defect' ? 'Defect' : 'Service performed',
    description: '', hours_at: '', km_at: '', cost: '', technician_name: '',
    defect_severity: 'minor',
  });
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    setSaving(true);
    try {
      const payload = {
        type: kind, title: form.title, description: form.description || null,
        hours_at: form.hours_at === '' ? null : Number(form.hours_at),
        km_at: form.km_at === '' ? null : Number(form.km_at),
        cost: form.cost === '' ? null : Number(form.cost),
        technician_name: form.technician_name || null,
      };
      if (kind === 'defect') payload.defect_severity = form.defect_severity;
      const r = await api.post(`/assets/${asset.id}/records`, payload);
      if (kind === 'defect' && r.data.linked_hazard_id) toast.success('Defect logged · hazard raised');
      else toast.success(`${kind} logged`);
      onSaved();
    } catch (e) { toast.error(apiError(e)); } finally { setSaving(false); }
  };
  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-slate-900/40 p-3" onClick={(e) => e.target === e.currentTarget && onClose()} data-testid={`record-editor-${kind}`}>
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200">
        <div className="px-5 py-3 border-b flex items-center"><h3 className="font-display font-bold text-slate-900 flex-1">{kind === 'defect' ? 'Report defect' : 'Log service'}</h3><button onClick={onClose}><X size={16} /></button></div>
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
              {['major', 'critical'].includes(form.defect_severity) && (
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
              <div>
                <label className="block text-xs font-semibold mb-1">Cost (AUD)</label>
                <input type="number" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg" data-testid="rec-cost" />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Technician</label>
                <input value={form.technician_name} onChange={(e) => setForm({ ...form, technician_name: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg" data-testid="rec-tech" />
              </div>
            </div>
          )}
        </div>
        <div className="px-5 py-3 border-t bg-slate-50 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 rounded-lg border border-slate-300 text-sm font-semibold" data-testid="rec-cancel">Cancel</button>
          <button onClick={submit} disabled={saving} className={`px-4 py-2 rounded-lg text-white text-sm font-bold disabled:opacity-50 ${kind === 'defect' ? 'bg-rose-600' : 'bg-blue-600'}`} data-testid="rec-save">
            {saving ? <Loader2 size={14} className="inline animate-spin" /> : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
