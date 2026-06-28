// Phase 3.7 — Picker field components for Forms.
//
// Each picker shares a uniform contract:
//   props: { field, value, onChange, readOnly, allValues, allFields }
//   value: structured snapshot stored on the submission, e.g.
//     worker_picker: { id, name, trade, phone, email }
//     job_picker:    { id, simpro_job_id, name, site_id, site_name, customer_name }
//     site_picker:   { id, name, customer_name }
//     customer_picker: { id, simpro_customer_id, name, company_label }
//
// Picker fields can be wired to one another via `field.config.dependsOn`,
// which is the id of a sibling picker on the same template. When a dependency
// is selected, this picker re-fetches with that filter applied.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown, HardHat, Loader2, MapPin, Search, Briefcase, Building2, X,
} from 'lucide-react';
import api from '../../lib/api';

const SETTINGS_PATH = '/app/settings/integrations';

function useDebounced(value, ms = 250) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

function _resolveDepValue(allValues, depFieldId) {
  if (!depFieldId) return null;
  const v = (allValues || {})[depFieldId];
  if (!v) return null;
  if (typeof v === 'string') return v;
  return v.name || v.customer_name || v.simpro_customer_id || v.id || null;
}

function ChipDisplay({ icon, primary, secondary, onClear, readOnly, testId }) {
  return (
    <div data-testid={testId}
      className="w-full flex items-center gap-2 px-3 py-2.5 min-h-[44px] rounded-xl border border-emerald-300 bg-emerald-50 text-emerald-900">
      <div className="w-7 h-7 rounded-lg bg-white/70 text-emerald-700 flex items-center justify-center shrink-0">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold leading-tight truncate">{primary}</div>
        {secondary && <div className="text-[11px] text-emerald-700/80 truncate">{secondary}</div>}
      </div>
      {!readOnly && (
        <button type="button" onClick={onClear}
          className="p-1.5 rounded-lg hover:bg-emerald-100 text-emerald-700"
          aria-label="Clear selection">
          <X size={14} />
        </button>
      )}
    </div>
  );
}

function PickerEmptyState({ icon, title, hint }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-center">
      <div className="w-9 h-9 mx-auto mb-2 rounded-full bg-white text-slate-400 flex items-center justify-center">
        {icon}
      </div>
      <div className="text-sm font-semibold text-slate-700">{title}</div>
      {hint && <p className="text-xs text-slate-500 mt-1 leading-snug">{hint}</p>}
    </div>
  );
}

function PickerList({ items, render, onPick, loading, emptyState, testId }) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-slate-500 px-3 py-2.5 rounded-xl bg-white border border-slate-200">
        <Loader2 size={12} className="animate-spin" /> Loading…
      </div>
    );
  }
  if (!items.length) return emptyState;
  return (
    <div className="max-h-72 overflow-y-auto rounded-xl border border-slate-200 bg-white divide-y divide-slate-100"
      data-testid={testId}>
      {items.map((it) => (
        <button key={`${it.id}-${it.simpro_company_id || ''}`} type="button"
          onClick={() => onPick(it)}
          data-testid={`${testId}-row-${it.id}`}
          className="w-full text-left px-3 py-2.5 hover:bg-blue-50 transition flex items-center gap-2">
          {render(it)}
        </button>
      ))}
    </div>
  );
}

function PickerInput({ field, value, onChange, readOnly, icon, displayPrimary,
                       displaySecondary, fetchUrl, fetchParams, renderRow,
                       emptyState, depBlockedState, testId }) {
  const [q, setQ] = useState('');
  const debounced = useDebounced(q, 250);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  // Close on outside click.
  useEffect(() => {
    const onDoc = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  // Fetch when open or filters/search change.
  useEffect(() => {
    if (!open || readOnly) return;
    if (depBlockedState) { setItems([]); return; }
    let cancelled = false;
    setLoading(true);
    api.get(fetchUrl, { params: { ...(fetchParams || {}), q: debounced || undefined } })
      .then((r) => {
        if (cancelled) return;
        const list = (r.data && (r.data[Object.keys(r.data)[0]] || [])) || [];
        // Pick the array property (workers/jobs/sites/customers).
        const arr = Array.isArray(list) ? list
          : (r.data.workers || r.data.jobs || r.data.sites || r.data.customers || []);
        setItems(arr);
      })
      .catch(() => { if (!cancelled) setItems([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, debounced, JSON.stringify(fetchParams || {}), depBlockedState]);

  if (value && typeof value === 'object' && value.id) {
    return (
      <ChipDisplay icon={icon}
        primary={displayPrimary(value)}
        secondary={displaySecondary(value)}
        onClear={() => onChange(null)}
        readOnly={readOnly}
        testId={`${testId}-chip`} />
    );
  }

  if (readOnly) {
    return <div className="text-xs text-slate-400 italic">No selection</div>;
  }

  return (
    <div ref={containerRef} className="relative" data-testid={testId}>
      <button type="button" onClick={() => setOpen((o) => !o)}
        data-testid={`${testId}-toggle`}
        className="w-full flex items-center gap-2 px-3 py-3 min-h-[44px] rounded-xl border border-slate-300 bg-white text-left text-sm text-slate-500 hover:border-slate-400">
        <span className="w-6 h-6 rounded-md bg-slate-100 text-slate-500 flex items-center justify-center">
          {icon}
        </span>
        <span className="flex-1">{field.placeholder || `Search ${field.label || 'records'}…`}</span>
        <ChevronDown size={14} className={`text-slate-400 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full rounded-xl border border-slate-200 bg-white shadow-xl p-2 space-y-2">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Type to search…"
              data-testid={`${testId}-search`}
              className="w-full pl-8 pr-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:border-blue-400 focus:outline-none" />
          </div>
          {depBlockedState ? depBlockedState
            : <PickerList items={items} render={renderRow}
                onPick={(it) => { onChange(it); setOpen(false); setQ(''); }}
                loading={loading} emptyState={emptyState}
                testId={`${testId}-list`} />}
        </div>
      )}
    </div>
  );
}


// ─────────────── Workers ───────────────
export function WorkerPicker(props) {
  return (
    <PickerInput {...props}
      icon={<HardHat size={13} />}
      testId={`worker-picker-${props.field.id}`}
      fetchUrl="/forms/pickers/workers"
      displayPrimary={(v) => v.name}
      displaySecondary={(v) => [v.trade, v.phone].filter(Boolean).join(' · ')}
      emptyState={<PickerEmptyState icon={<HardHat size={16} />}
        title="No active workers"
        hint={`Sync from Simpro in Settings → Integrations.`} />}
      renderRow={(w) => (
        <>
          <div className="w-7 h-7 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center text-[10px] font-bold shrink-0">
            {(w.name || '?').split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-slate-900 truncate">{w.name}</div>
            <div className="text-[11px] text-slate-500 truncate">{[w.trade, w.phone].filter(Boolean).join(' · ')}</div>
          </div>
        </>
      )}
    />
  );
}


// ─────────────── Customers ───────────────
export function CustomerPicker(props) {
  return (
    <PickerInput {...props}
      icon={<Building2 size={13} />}
      testId={`customer-picker-${props.field.id}`}
      fetchUrl="/forms/pickers/customers"
      displayPrimary={(v) => v.name}
      displaySecondary={(v) => v.company_label || null}
      emptyState={<PickerEmptyState icon={<Building2 size={16} />}
        title="No customers cached"
        hint="Connect Simpro in Settings → Integrations to populate the customer list." />}
      renderRow={(c) => (
        <>
          <div className="w-7 h-7 rounded-lg bg-purple-100 text-purple-700 flex items-center justify-center shrink-0">
            <Building2 size={13} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-slate-900 truncate">{c.name}</div>
            <div className="text-[11px] text-slate-500">{c.company_label || 'Simpro'}</div>
          </div>
        </>
      )}
    />
  );
}


// ─────────────── Sites (depends on Customer) ───────────────
export function SitePicker(props) {
  const depId = (props.field.config || {}).dependsOn || null;
  const depValue = useMemo(() => _resolveDepValue(props.allValues, depId),
    [props.allValues, depId]);
  const depFieldLabel = useMemo(() => {
    if (!depId) return null;
    const f = (props.allFields || []).find((x) => x.id === depId);
    return f?.label || 'customer';
  }, [props.allFields, depId]);
  const depBlocked = depId && !depValue ? (
    <PickerEmptyState icon={<MapPin size={16} />}
      title={`Pick a ${depFieldLabel} first`}
      hint="Sites filter to the selected customer's record set." />
  ) : null;

  return (
    <PickerInput {...props}
      icon={<MapPin size={13} />}
      testId={`site-picker-${props.field.id}`}
      fetchUrl="/forms/pickers/sites"
      fetchParams={depValue ? { customer_id: depValue } : {}}
      depBlockedState={depBlocked}
      displayPrimary={(v) => v.name}
      displaySecondary={(v) => v.customer_name || v.address || null}
      emptyState={<PickerEmptyState icon={<MapPin size={16} />}
        title="No sites synced yet"
        hint={depValue
          ? `No sites for "${depValue}" — sync Simpro jobs in Settings → Integrations.`
          : 'Sites are derived from Simpro job records — sync in Settings → Integrations.'} />}
      renderRow={(s) => (
        <>
          <div className="w-7 h-7 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
            <MapPin size={13} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-slate-900 truncate">{s.name}</div>
            <div className="text-[11px] text-slate-500 truncate">
              {[s.customer_name, s.jobs != null ? `${s.jobs} jobs` : null].filter(Boolean).join(' · ')}
            </div>
          </div>
        </>
      )}
    />
  );
}


// ─────────────── Jobs (optionally depends on Site / Customer) ───────────────
export function JobPicker(props) {
  const depId = (props.field.config || {}).dependsOn || null;
  // Job picker may depend on a customer OR a site sibling.
  const depFieldType = useMemo(() => {
    if (!depId) return null;
    const f = (props.allFields || []).find((x) => x.id === depId);
    return f?.type || null;
  }, [props.allFields, depId]);
  const depValue = useMemo(() => _resolveDepValue(props.allValues, depId),
    [props.allValues, depId]);
  const depFieldLabel = useMemo(() => {
    if (!depId) return null;
    const f = (props.allFields || []).find((x) => x.id === depId);
    return f?.label || 'parent';
  }, [props.allFields, depId]);
  const depBlocked = depId && !depValue ? (
    <PickerEmptyState icon={<Briefcase size={16} />}
      title={`Pick a ${depFieldLabel} first`}
      hint="Jobs filter to the selected parent record set." />
  ) : null;
  const params = useMemo(() => {
    if (!depValue) return { status: 'open' };
    if (depFieldType === 'customer_picker') return { status: 'open', customer_id: depValue };
    if (depFieldType === 'site_picker') return { status: 'open', site_id: depValue };
    return { status: 'open' };
  }, [depValue, depFieldType]);

  return (
    <PickerInput {...props}
      icon={<Briefcase size={13} />}
      testId={`job-picker-${props.field.id}`}
      fetchUrl="/forms/pickers/jobs"
      fetchParams={params}
      depBlockedState={depBlocked}
      displayPrimary={(v) => v.name || `Job #${v.simpro_job_id}`}
      displaySecondary={(v) => [v.customer_name, v.site_name, v.stage].filter(Boolean).join(' · ')}
      emptyState={<PickerEmptyState icon={<Briefcase size={16} />}
        title="No open Simpro jobs"
        hint="Sync Simpro jobs in Settings → Integrations to populate this list." />}
      renderRow={(j) => (
        <>
          <div className="w-7 h-7 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
            <Briefcase size={13} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-slate-900 truncate">
              {j.name || `Job #${j.simpro_job_id}`}
            </div>
            <div className="text-[11px] text-slate-500 truncate">
              {[j.customer_name, j.site_name, j.stage].filter(Boolean).join(' · ')}
              {j.simpro_job_id && <span className="ml-1 text-slate-400">#{j.simpro_job_id}</span>}
            </div>
          </div>
        </>
      )}
    />
  );
}

export { SETTINGS_PATH };
