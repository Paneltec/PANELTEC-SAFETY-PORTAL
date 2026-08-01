// v160.3.9.24 — CRUD affordances + admin-only tightening.
// Reusable Add/Edit modal for Risk Assessments reference-library tabs.
// Renders any schema[] as a form; on Save POSTs (create) or PATCHes
// (edit) to the matching resource endpoint. Empty-schema columns are
// intentionally exposed so admins can populate previously-empty
// spreadsheet fields — those values will surface in the table on next
// fetch via each module's /columns metadata endpoint.
import React, { useEffect, useMemo, useState } from 'react';
import api, { apiError } from '../../lib/api';
import { toast } from 'sonner';
import useLockBodyScroll from '../../lib/useLockBodyScroll';
import { Dismiss20Regular as X } from '@fluentui/react-icons';

export default function RecordFormModal({
  mode,               // 'create' | 'edit'
  resource,           // '/master-risks' etc.
  keyField,           // 'risk_id', 'company_id', ...
  schema,             // [{ key, label, type, required?, options?, placeholder? }]
  initialValues,      // {} for create, current record for edit
  onSaved,            // (savedRecord) => void
  onClose,
}) {
  useLockBodyScroll();
  const [values, setValues] = useState(() => ({ ...(initialValues || {}) }));
  const [busy, setBusy] = useState(false);

  useEffect(() => { setValues({ ...(initialValues || {}) }); }, [initialValues]);

  const isEdit = mode === 'edit';
  const title  = isEdit ? 'Edit record' : 'Add new record';

  const set = (k, v) => setValues((prev) => ({ ...prev, [k]: v }));

  const submit = async () => {
    // Client-side required-field check.
    const missing = schema.filter((f) => f.required && (values[f.key] == null || values[f.key] === ''))
                          .map((f) => f.label);
    if (missing.length) { toast.error(`Missing required: ${missing.join(', ')}`); return; }
    setBusy(true);
    try {
      // Normalise chips_multi / array_of_strings to arrays.
      const payload = {};
      schema.forEach((f) => {
        const v = values[f.key];
        if (v === undefined || v === '') return;
        if (f.type === 'array_of_strings' && typeof v === 'string') {
          payload[f.key] = v.split(',').map((s) => s.trim()).filter(Boolean);
        } else if (f.type === 'number') {
          payload[f.key] = typeof v === 'number' ? v : Number(v);
        } else if (f.type === 'boolean') {
          payload[f.key] = !!v;
        } else {
          payload[f.key] = v;
        }
      });
      let saved;
      if (isEdit) {
        const uid = initialValues?.id || initialValues?.[keyField];
        const r = await api.patch(`${resource}/${encodeURIComponent(uid)}`, payload);
        saved = r.data;
        toast.success('Record updated');
      } else {
        const r = await api.post(`${resource}/`, payload);
        saved = r.data;
        toast.success('Record created');
      }
      onSaved?.(saved);
      onClose();
    } catch (e) {
      toast.error(apiError(e) || (isEdit ? 'Update failed' : 'Create failed'));
    } finally { setBusy(false); }
  };

  const groups = useMemo(() => {
    // Simple 2-column layout by declaration order.
    return schema;
  }, [schema]);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
      data-testid="record-form-modal">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-2xl w-full mx-4 max-h-[85vh] overflow-hidden flex flex-col">
        <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-base font-display font-semibold text-slate-900">{title}</h3>
          <button onClick={onClose} disabled={busy}
            className="p-1.5 rounded-md hover:bg-slate-100 text-slate-500"
            data-testid="record-form-close">
            <X />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 grid grid-cols-1 md:grid-cols-2 gap-x-5 gap-y-4">
          {groups.map((f) => (
            <FieldInput key={f.key} field={f}
              value={values[f.key]} onChange={(v) => set(f.key, v)} />
          ))}
        </div>
        <div className="border-t border-slate-200 px-5 py-3 flex justify-end gap-2">
          <button onClick={onClose} disabled={busy}
            className="px-3 py-1.5 text-sm rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            data-testid="record-form-cancel">Cancel</button>
          <button onClick={submit} disabled={busy}
            className="px-3 py-1.5 text-sm rounded-md bg-blue-800 text-white font-semibold hover:bg-blue-900 disabled:opacity-50"
            data-testid="record-form-save">{busy ? 'Saving…' : (isEdit ? 'Save changes' : 'Create')}</button>
        </div>
      </div>
    </div>
  );
}

function FieldInput({ field, value, onChange }) {
  const base = 'w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400';
  const label = (
    <label className="block text-[11px] uppercase tracking-wide text-slate-500 font-semibold mb-1">
      {field.label}{field.required && <span className="text-rose-500 ml-0.5">*</span>}
    </label>
  );
  const wrap = (input, wide = false) => (
    <div className={wide ? 'md:col-span-2' : ''}>{label}{input}</div>
  );
  switch (field.type) {
    case 'textarea':
      return wrap(
        <textarea value={value || ''} onChange={(e) => onChange(e.target.value)}
          rows={3} className={base} placeholder={field.placeholder}
          data-testid={`field-${field.key}`} />, true);
    case 'number':
      return wrap(
        <input type="number" value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
          className={base} placeholder={field.placeholder}
          data-testid={`field-${field.key}`} />);
    case 'date':
      return wrap(
        <input type="date" value={value || ''} onChange={(e) => onChange(e.target.value)}
          className={base} data-testid={`field-${field.key}`} />);
    case 'boolean':
      return wrap(
        <div className="flex gap-2">
          {[{ v: true, l: 'Yes' }, { v: false, l: 'No' }].map((o) => (
            <button key={String(o.v)} type="button" onClick={() => onChange(o.v)}
              data-testid={`field-${field.key}-${o.l.toLowerCase()}`}
              className={`px-3 py-1 text-xs font-semibold rounded-md border ${
                value === o.v
                  ? 'bg-blue-800 text-white border-blue-800'
                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
              }`}>{o.l}</button>
          ))}
        </div>);
    case 'enum':
      return wrap(
        <select value={value || ''} onChange={(e) => onChange(e.target.value)}
          className={base} data-testid={`field-${field.key}`}>
          <option value="">— Select —</option>
          {(field.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>);
    case 'chips_multi': {
      const arr = Array.isArray(value) ? value : [];
      const toggle = (opt) => {
        const next = arr.includes(opt) ? arr.filter((x) => x !== opt) : [...arr, opt];
        onChange(next);
      };
      return wrap(
        <div className="flex flex-wrap gap-1">
          {(field.options || []).map((opt) => (
            <button key={opt} type="button" onClick={() => toggle(opt)}
              className={`px-2 py-0.5 text-xs rounded-full border ${
                arr.includes(opt)
                  ? 'bg-blue-800 text-white border-blue-800'
                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
              }`}
              data-testid={`field-${field.key}-${opt.toLowerCase().replace(/\s+/g,'_')}`}>
              {opt}
            </button>
          ))}
        </div>, true);
    }
    case 'array_of_strings':
      return wrap(
        <input type="text"
          value={Array.isArray(value) ? value.join(', ') : (value || '')}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder || 'comma-separated'}
          className={base} data-testid={`field-${field.key}`} />, true);
    case 'text':
    default:
      return wrap(
        <input type="text" value={value || ''} onChange={(e) => onChange(e.target.value)}
          className={base} placeholder={field.placeholder}
          data-testid={`field-${field.key}`} />);
  }
}
