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
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

function ChipDisplay({ icon, primary, secondary, onClear, readOnly, testId,
                       autoPinned, sourceJobId, onOverride }) {
  return (
    <div data-testid={testId}
      className="w-full flex items-center gap-2 px-3 py-2.5 min-h-[44px] rounded-xl border border-emerald-300 bg-emerald-50 text-emerald-900">
      <div className="w-7 h-7 rounded-lg bg-white/70 text-emerald-700 flex items-center justify-center shrink-0">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold leading-tight truncate">{primary}</div>
        {(secondary || autoPinned) && (
          <div className="text-[11px] text-emerald-700/80 truncate flex items-center gap-1 flex-wrap">
            {autoPinned && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-200/80 text-emerald-900 text-[10px] font-bold uppercase tracking-[0.06em]"
                data-testid={`${testId}-auto-pin-badge`}>
                Auto-pinned{sourceJobId ? ` from Job #${sourceJobId}` : ''}
              </span>
            )}
            {autoPinned && onOverride && !readOnly && (
              <button type="button" onClick={onOverride}
                data-testid={`${testId}-override`}
                className="underline text-emerald-800 text-[11px] font-semibold hover:text-emerald-900">
                Override
              </button>
            )}
            {secondary && <span className="truncate">{secondary}</span>}
          </div>
        )}
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

function PickerList({ items, render, onPick, loading, emptyState, searchActive, testId }) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-slate-500 px-3 py-2.5 rounded-xl bg-white border border-slate-200">
        <Loader2 size={12} className="animate-spin" /> Loading…
      </div>
    );
  }
  if (!items.length) {
    // Silent when the user hasn't typed anything yet — feels less broken.
    if (!searchActive) return null;
    if (emptyState) return emptyState;
    return (
      <div className="text-xs text-slate-500 px-3 py-2.5 rounded-xl bg-white border border-slate-200">
        No matches
      </div>
    );
  }
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
                       emptyState, pinnedRow, footerNote, testId }) {
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
  }, [open, debounced, JSON.stringify(fetchParams || {})]);

  if (value && typeof value === 'object' && value.id) {
    return (
      <ChipDisplay icon={icon}
        primary={displayPrimary(value)}
        secondary={displaySecondary(value)}
        onClear={() => onChange(null)}
        readOnly={readOnly}
        autoPinned={!!value.auto_pinned}
        sourceJobId={value.source_job_id}
        onOverride={() => { onChange({ ...value, auto_pinned: false }); setOpen(true); }}
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
          {pinnedRow}
          <PickerList items={items} render={renderRow}
            onPick={(it) => { onChange(it); setOpen(false); setQ(''); }}
            loading={loading} emptyState={emptyState}
            searchActive={!!debounced}
            testId={`${testId}-list`} />
          {footerNote && (
            <div className="text-[11px] text-slate-400 px-1 pt-1 border-t border-slate-100">
              {footerNote}
            </div>
          )}
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


// ─────────────── Sites (customer filter optional + GPS affordance) ───────────────
export function SitePicker(props) {
  const depId = (props.field.config || {}).dependsOn || null;
  const depValue = useMemo(() => _resolveDepValue(props.allValues, depId),
    [props.allValues, depId]);
  const [geo, setGeo] = useState(null);
  const [geoError, setGeoError] = useState(false);

  const requestGeo = useCallback(() => {
    if (geo || geoError) return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGeoError(true);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => setGeo({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: Math.round(pos.coords.accuracy || 0),
        captured_at: new Date().toISOString(),
      }),
      () => setGeoError(true),
      { enableHighAccuracy: false, timeout: 6000, maximumAge: 60000 },
    );
  }, [geo, geoError]);

  // Auto-request once on first render (the picker is inside the open dropdown
  // already — the user has chosen to interact with the form).
  useEffect(() => { requestGeo(); }, [requestGeo]);

  const pinnedRow = geo ? (
    <button type="button"
      data-testid={`site-picker-${props.field.id}-use-gps`}
      onClick={() => props.onChange({
        site_id: null,
        label: `Custom location · ${geo.lat.toFixed(4)}, ${geo.lng.toFixed(4)}`,
        name: `Custom location · ${geo.lat.toFixed(4)}, ${geo.lng.toFixed(4)}`,
        id: `gps:${geo.lat.toFixed(5)},${geo.lng.toFixed(5)}`,
        lat: geo.lat, lng: geo.lng, accuracy: geo.accuracy,
        captured_at: geo.captured_at, freeform: true,
      })}
      className="w-full text-left flex items-center gap-2 px-3 py-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 hover:bg-emerald-100">
      <span className="w-7 h-7 rounded-lg bg-white/70 text-emerald-700 flex items-center justify-center shrink-0">
        <MapPin size={13} />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-semibold truncate">Use current location</span>
        <span className="block text-[11px] text-emerald-700/80 truncate">
          {geo.lat.toFixed(4)}, {geo.lng.toFixed(4)} (±{geo.accuracy || 0} m)
        </span>
      </span>
    </button>
  ) : (
    <button type="button"
      data-testid={`site-picker-${props.field.id}-request-gps`}
      onClick={requestGeo}
      className="w-full text-left flex items-center gap-2 px-3 py-2 rounded-xl border border-dashed border-emerald-300 text-emerald-700 hover:bg-emerald-50">
      <MapPin size={13} />
      <span className="text-xs">
        {geoError ? 'Location unavailable — tap to retry' : 'Use my current location'}
      </span>
    </button>
  );

  return (
    <PickerInput {...props}
      icon={<MapPin size={13} />}
      testId={`site-picker-${props.field.id}`}
      fetchUrl="/forms/pickers/sites"
      fetchParams={{
        ...(depValue ? { customer_id: depValue } : {}),
        ...(geo ? { lat: geo.lat, lng: geo.lng } : {}),
      }}
      pinnedRow={pinnedRow}
      displayPrimary={(v) => v.name || v.label}
      displaySecondary={(v) => v.freeform
        ? `±${v.accuracy || 0} m · ${new Date(v.captured_at).toLocaleTimeString()}`
        : (v.customer_name || v.address || null)}
      renderRow={(s) => (
        <>
          <div className="w-7 h-7 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
            <MapPin size={13} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-slate-900 truncate">{s.name}</div>
            <div className="text-[11px] text-slate-500 truncate">
              {[s.customer_name,
                s.distance_km != null ? `${s.distance_km.toFixed(1)} km` : null,
                s.jobs != null ? `${s.jobs} jobs` : null].filter(Boolean).join(' · ')}
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
      displayPrimary={(v) => v.name || `Job #${v.simpro_job_id}`}
      displaySecondary={(v) => [v.customer_name, v.site_name, v.stage].filter(Boolean).join(' · ')}
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
