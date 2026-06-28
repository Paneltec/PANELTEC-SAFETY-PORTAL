// Forms Library — UI restyle (matches user reference screenshots).
// Page header with 4-button toolbar, redesigned template cards with action
// icons + Preview/Fill buttons, AI-builder modal, redesigned Fill-Out modal
// with coloured Yes/No/N-A radios + orange Submit, and Preview modal.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import SignatureCanvas from 'react-signature-canvas';
import {
  Camera, CheckCircle2, Download, Eraser, FilePlus, FileText, Loader2, MapPin,
  Pencil, Phone, Plus, RefreshCw, Search, Share2, Sparkles, Trash2, Truck, Upload,
  UploadCloud, X, ChevronDown,
} from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../lib/api';
import { getUser } from '../lib/auth';
import TemplateBuilder from '../components/forms/TemplateBuilder';
import AssetScanField, { buildAutofillFromAsset } from '../components/forms/AssetScanField';
import { WorkerPicker, JobPicker, SitePicker, CustomerPicker } from '../components/forms/PickerFields';

const WRITE_ROLES = new Set(['admin', 'hseq_lead']);

// Pastel pills per the new spec: tint background + ink text.
export const CATEGORIES = [
  { key: 'all',        label: 'All categories', pill: 'bg-slate-100 text-slate-700' },
  { key: 'incident',   label: 'Incident',       pill: 'bg-[#fde2e4] text-rose-700' },
  { key: 'inspection', label: 'Inspection',     pill: 'bg-[#dbeafe] text-blue-700' },
  { key: 'toolbox',    label: 'Toolbox',        pill: 'bg-[#fef3c7] text-amber-800' },
  { key: 'near_miss',  label: 'Near Miss',      pill: 'bg-[#fed7aa] text-orange-700' },
  { key: 'general',    label: 'General',        pill: 'bg-[#e2e8f0] text-slate-700' },
];
export const CAT_PILL = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.pill]));
export const categoryLabel = (key) => (CATEGORIES.find((c) => c.key === key)?.label || 'General').replace('All categories', 'General');

// ─────────────── Field renderers ───────────────

function PhotoField({ field, files, onChange, readOnly }) {
  const inputRef = useRef(null);
  const previews = useMemo(() => (files || []).map((f) => ({
    name: f.name, url: URL.createObjectURL(f),
  })), [files]);
  useEffect(() => () => previews.forEach((p) => URL.revokeObjectURL(p.url)), [previews]);

  if (readOnly) return <div className="text-xs text-slate-400 italic">Photo capture (preview disabled)</div>;

  const onPick = (e) => {
    const picked = Array.from(e.target.files || []);
    if (!picked.length) return;
    onChange([...(files || []), ...picked]);
    e.target.value = '';
  };
  const removeAt = (idx) => {
    const next = [...(files || [])];
    next.splice(idx, 1);
    onChange(next);
  };

  return (
    <div className="space-y-2" data-testid={`field-${field.id}`}>
      <input ref={inputRef} type="file" accept="image/*" capture="environment"
        multiple className="hidden" onChange={onPick}
        data-testid={`photo-input-${field.id}`} />
      <button type="button" onClick={() => inputRef.current?.click()}
        data-testid={`photo-take-${field.id}`}
        className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 min-h-[44px] rounded-xl border-2 border-dashed border-blue-200 bg-blue-50 text-blue-700 text-sm font-semibold hover:bg-blue-100">
        <Camera size={16} /> {previews.length ? 'Add another photo' : 'Take or choose photo'}
      </button>
      {previews.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {previews.map((p, i) => (
            <div key={i} className="relative aspect-square rounded-lg overflow-hidden border border-slate-200 group">
              <img src={p.url} alt={p.name} className="w-full h-full object-cover" />
              <button type="button" onClick={() => removeAt(i)}
                className="absolute top-1 right-1 w-6 h-6 rounded-full bg-white/90 text-rose-700 flex items-center justify-center shadow opacity-0 group-hover:opacity-100 transition">
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SignatureField({ field, value, onChange, readOnly }) {
  const padRef = useRef(null);
  const wrapRef = useRef(null);
  const [size, setSize] = useState({ w: 400, h: 150 });

  useEffect(() => {
    const update = () => {
      if (!wrapRef.current) return;
      const w = Math.min(wrapRef.current.clientWidth, 600);
      setSize({ w, h: Math.max(140, Math.min(180, Math.round(w * 0.4))) });
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  useEffect(() => {
    if (value && padRef.current && padRef.current.isEmpty()) {
      try { padRef.current.fromDataURL(value); } catch { /* ignore */ }
    }
  }, [value]);

  if (readOnly) {
    return value
      ? <img src={value} alt="signature" className="border border-slate-200 rounded-lg max-h-32 bg-white" />
      : <div className="text-xs text-slate-400 italic">Signature pad (preview disabled)</div>;
  }

  const clear = () => { padRef.current?.clear(); onChange(null); };
  const onEnd = () => {
    if (padRef.current && !padRef.current.isEmpty()) {
      onChange(padRef.current.toDataURL('image/png'));
    }
  };

  return (
    <div className="space-y-2" ref={wrapRef} data-testid={`field-${field.id}`}>
      <div className="rounded-xl border border-slate-300 bg-white overflow-hidden">
        <SignatureCanvas ref={padRef} penColor="#0f172a"
          canvasProps={{ width: size.w, height: size.h, className: 'block w-full touch-none', 'data-testid': `signature-canvas-${field.id}` }}
          onEnd={onEnd} />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-slate-500">Sign with your finger or mouse.</span>
        <button type="button" onClick={clear}
          className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-rose-700 px-2 py-1">
          <Eraser size={12} /> Clear
        </button>
      </div>
    </div>
  );
}

function GpsField({ field, value, onChange, readOnly }) {
  const [busy, setBusy] = useState(false);
  const capture = () => {
    if (readOnly) return;
    if (!navigator.geolocation) { toast.error('Geolocation not supported'); return; }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        onChange({ lat: pos.coords.latitude, lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy, captured_at: new Date().toISOString() });
        setBusy(false);
      },
      (err) => { toast.error(`GPS error: ${err.message}`); setBusy(false); },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    );
  };
  const hasFix = value && typeof value.lat === 'number';
  return (
    <div className="space-y-2" data-testid={`field-${field.id}`}>
      {!readOnly && (
        <button type="button" onClick={capture} disabled={busy}
          data-testid={`gps-capture-${field.id}`}
          className="inline-flex items-center gap-2 px-4 py-2.5 min-h-[44px] rounded-xl bg-blue-50 border border-blue-200 text-blue-700 text-sm font-semibold hover:bg-blue-100 disabled:opacity-60">
          {busy ? <Loader2 size={16} className="animate-spin" /> : (hasFix ? <RefreshCw size={16} /> : <MapPin size={16} />)}
          {busy ? 'Capturing…' : (hasFix ? 'Re-capture GPS' : 'Capture GPS')}
        </button>
      )}
      {hasFix && (
        <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
          <iframe title={`gps-${field.id}`} src={`https://www.google.com/maps?q=${value.lat},${value.lng}&hl=en&z=16&output=embed`}
            width="100%" height="160" style={{ border: 0 }} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
          <div className="px-3 py-2 grid grid-cols-3 gap-2 text-[11px] text-slate-600">
            <div><span className="block text-slate-400 uppercase tracking-wider">Lat</span>{value.lat.toFixed(5)}</div>
            <div><span className="block text-slate-400 uppercase tracking-wider">Lng</span>{value.lng.toFixed(5)}</div>
            <div><span className="block text-slate-400 uppercase tracking-wider">± m</span>{Math.round(value.accuracy ?? 0)}</div>
          </div>
        </div>
      )}
    </div>
  );
}

// New: coloured pill-button radios per Vehicle Pre-Use reference.
function ColouredRadioGroup({ field, value, onChange, readOnly }) {
  const style = (opt, selected) => {
    const norm = String(opt).toLowerCase();
    let palette;
    if (norm === 'yes') palette = selected
      ? 'bg-emerald-50 border-emerald-500 text-emerald-700 ring-2 ring-emerald-200'
      : 'bg-white border-emerald-300 text-emerald-700 hover:bg-emerald-50';
    else if (norm === 'no' || norm === 'defective' || norm.startsWith('fail')) palette = selected
      ? 'bg-rose-50 border-rose-500 text-rose-700 ring-2 ring-rose-200'
      : 'bg-white border-rose-300 text-rose-700 hover:bg-rose-50';
    else if (norm === 'n/a' || norm === 'na' || norm === 'not applicable') palette = selected
      ? 'bg-slate-100 border-slate-500 text-slate-700 ring-2 ring-slate-200'
      : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50';
    else palette = selected
      ? 'bg-slate-100 border-slate-500 text-slate-800 ring-2 ring-slate-200'
      : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50';
    return palette;
  };
  return (
    <div className="flex flex-wrap gap-2" data-testid={`field-${field.id}`}>
      {(field.options || []).map((opt) => {
        const selected = value === opt;
        return (
          <button key={opt} type="button" disabled={readOnly}
            onClick={() => !readOnly && onChange(opt)}
            data-testid={`radio-${field.id}-${String(opt).toLowerCase().replace(/[^a-z0-9]/g, '-')}`}
            className={`px-4 py-2.5 min-h-[44px] min-w-[80px] rounded-xl border-2 text-sm font-semibold transition-all disabled:opacity-70 disabled:cursor-not-allowed ${style(opt, selected)}`}>
            {opt}
          </button>
        );
      })}
    </div>
  );
}

// Vehicle (Navixy) — searchable dropdown of org's fleet trackers. When a
// sibling `select` field labelled "Vehicle Type" / "Plant Type" /
// "Equipment Type" is filled in, the fleet list filters to vehicles whose
// derived `vehicle_type` slug matches the selected option.
function VehicleNavixyField({ field, value, onChange, readOnly, allFields, allValues }) {
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState(value?.navixy_id === null && value?.registration ? 'manual' : 'list');
  const [manualReg, setManualReg] = useState(value?.registration || '');
  const [filterDisabled, setFilterDisabled] = useState(false);

  useEffect(() => {
    if (readOnly) return;
    setLoading(true);
    api.get('/forms/fleet/vehicles')
      .then((r) => setVehicles(r.data?.vehicles || []))
      .catch((e) => setError(apiError(e)))
      .finally(() => setLoading(false));
  }, [readOnly]);

  // Detect sibling Vehicle/Plant/Equipment Type field value.
  const siblingTypeValue = useMemo(() => {
    if (!allFields) return null;
    const sibling = allFields.find((f) =>
      (f.type === 'select' || f.type === 'radio') &&
      /\b(vehicle|plant|equipment)\s+type\b/i.test(f.label || ''),
    );
    if (!sibling) return null;
    return allValues?.[sibling.id] || null;
  }, [allFields, allValues]);

  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const filterSlug = filterDisabled ? null : (siblingTypeValue ? norm(siblingTypeValue) : null);

  const typeFiltered = useMemo(() => {
    if (!filterSlug) return vehicles;
    return vehicles.filter((v) => {
      const slug = v.vehicle_type || 'other';
      // Match exact slug OR substring (e.g. "vacuum" matches "vacuum_truck")
      return slug === filterSlug || slug.includes(filterSlug) || filterSlug.includes(slug);
    });
  }, [vehicles, filterSlug]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return typeFiltered;
    return typeFiltered.filter((v) => `${v.label || ''} ${v.plate || ''}`.toLowerCase().includes(q));
  }, [typeFiltered, search]);

  if (readOnly) {
    if (!value) return <div className="text-xs text-slate-400 italic">No vehicle selected</div>;
    return (
      <div className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-100 text-sm">
        <Truck size={13} className="text-slate-500" />
        <span className="font-medium text-slate-900">{value.label || 'Manual entry'}</span>
        <span className="text-slate-500">·</span>
        <span className="font-mono font-semibold text-slate-800">{value.registration || '—'}</span>
      </div>
    );
  }

  if (value) {
    return (
      <div className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-blue-50 border border-blue-200 text-sm" data-testid={`field-${field.id}`}>
        <Truck size={14} className="text-blue-700" />
        <span className="font-medium text-slate-900">{value.label || 'Manual entry'}</span>
        <span className="text-slate-400">·</span>
        <span className="font-mono font-semibold text-slate-800">{value.registration || '—'}</span>
        <button type="button" onClick={() => onChange(null)}
          data-testid={`vehicle-clear-${field.id}`}
          className="ml-2 p-1 rounded hover:bg-blue-100 text-slate-500">
          <X size={12} />
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2" data-testid={`field-${field.id}`}>
      <div className="flex gap-2 items-center">
        <button type="button" onClick={() => setMode('list')}
          className={`px-3 py-1.5 text-xs font-semibold rounded-lg ${mode === 'list' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
          From fleet
        </button>
        <button type="button" onClick={() => setMode('manual')}
          data-testid={`vehicle-manual-${field.id}`}
          className={`px-3 py-1.5 text-xs font-semibold rounded-lg ${mode === 'manual' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
          Other (manual entry)
        </button>
        {loading && <Loader2 size={12} className="animate-spin text-slate-400" />}
      </div>
      {mode === 'list' ? (
        <div className="space-y-1">
          {siblingTypeValue && !filterDisabled && (
            <div className="flex items-center gap-2 text-[11px] text-blue-700 bg-blue-50 border border-blue-200 px-2.5 py-1.5 rounded-lg" data-testid={`vehicle-filter-hint-${field.id}`}>
              <span>Showing {typeFiltered.length} vehicle{typeFiltered.length === 1 ? '' : 's'} matching <strong>{siblingTypeValue}</strong></span>
              <button type="button" onClick={() => setFilterDisabled(true)} data-testid={`vehicle-filter-clear-${field.id}`}
                className="ml-auto underline hover:text-blue-900">Clear filter</button>
            </div>
          )}
          {filterDisabled && siblingTypeValue && (
            <div className="flex items-center gap-2 text-[11px] text-slate-600 bg-slate-50 border border-slate-200 px-2.5 py-1.5 rounded-lg">
              <span>Showing all {vehicles.length} vehicles · filter disabled</span>
              <button type="button" onClick={() => setFilterDisabled(false)} className="ml-auto underline hover:text-slate-900">Re-enable</button>
            </div>
          )}
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by label or rego…"
            data-testid={`vehicle-search-${field.id}`}
            className="w-full px-3 py-2 min-h-[44px] border border-slate-300 rounded-xl text-sm bg-white" />
          {error && <div className="text-xs text-rose-600">{error}</div>}
          {!error && (
            <div className="max-h-60 overflow-y-auto rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
              {filtered.length === 0 ? (
                <div className="px-3 py-3 text-xs text-slate-500 italic">
                  {loading ? 'Loading fleet…' : (filterSlug ? `No "${siblingTypeValue}" vehicles match.` : 'No vehicles match.')}
                </div>
              ) : filtered.map((v) => (
                <button key={v.id} type="button"
                  onClick={() => onChange({ navixy_id: v.id, label: v.label || null, registration: v.plate || '' })}
                  data-testid={`vehicle-opt-${v.id}`}
                  className="w-full px-3 py-2.5 text-left text-sm hover:bg-blue-50 flex items-center gap-2">
                  <Truck size={13} className="text-slate-400" />
                  <span className="font-medium text-slate-900">{v.label || 'Vehicle'}</span>
                  {v.plate && <span className="ml-auto text-xs font-mono font-semibold text-slate-700">{v.plate}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="flex gap-2">
          <input value={manualReg} onChange={(e) => setManualReg(e.target.value)}
            placeholder="Enter registration manually"
            data-testid={`vehicle-manual-input-${field.id}`}
            className="flex-1 px-3 py-2 min-h-[44px] border border-slate-300 rounded-xl text-sm bg-white" />
          <button type="button" disabled={!manualReg.trim()}
            onClick={() => onChange({ navixy_id: null, label: null, registration: manualReg.trim() })}
            data-testid={`vehicle-manual-save-${field.id}`}
            className="px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-semibold disabled:opacity-50">
            Save
          </button>
        </div>
      )}
    </div>
  );
}

export function FieldRunner({ field, value, onChange, photoFiles, onPhotoChange, readOnly, allFields, allValues }) {
  if (field.type === 'photo') return <PhotoField field={field} files={photoFiles} onChange={onPhotoChange} readOnly={readOnly} />;
  if (field.type === 'signature') return <SignatureField field={field} value={value} onChange={onChange} readOnly={readOnly} />;
  if (field.type === 'gps') return <GpsField field={field} value={value} onChange={onChange} readOnly={readOnly} />;
  if (field.type === 'vehicle_navixy')
    return <VehicleNavixyField field={field} value={value} onChange={onChange} readOnly={readOnly}
      allFields={allFields} allValues={allValues} />;
  if (field.type === 'worker_picker')
    return <WorkerPicker field={field} value={value} onChange={onChange} readOnly={readOnly}
      allFields={allFields} allValues={allValues} />;
  if (field.type === 'job_picker')
    return <JobPicker field={field} value={value} onChange={onChange} readOnly={readOnly}
      allFields={allFields} allValues={allValues} />;
  if (field.type === 'site_picker')
    return <SitePicker field={field} value={value} onChange={onChange} readOnly={readOnly}
      allFields={allFields} allValues={allValues} />;
  if (field.type === 'customer_picker')
    return <CustomerPicker field={field} value={value} onChange={onChange} readOnly={readOnly}
      allFields={allFields} allValues={allValues} />;
  if (field.type === 'asset_scan')
    return <AssetScanField field={field} value={value} readOnly={readOnly}
      onChange={(v) => {
        // Commit the scanned asset, then auto-fill any dependent siblings.
        if (typeof onChange !== 'function') return;
        onChange(v);
        if (v && typeof window !== 'undefined') {
          // The autofill targets sibling fields by id, which can't be set via
          // the current onChange (it only writes our own field). Defer to the
          // parent through a CustomEvent so the FillOutModal can apply it.
          const auto = buildAutofillFromAsset(allFields || [], v, field.config || {});
          if (Object.keys(auto).length) {
            window.dispatchEvent(new CustomEvent('paneltec:asset-autofill', { detail: { sourceFieldId: field.id, values: auto } }));
          }
        }
      }} />;
  if (field.type === 'textarea')
    return <textarea rows={4} value={value || ''} placeholder={field.placeholder} disabled={readOnly}
      onChange={(e) => onChange(e.target.value)} data-testid={`field-${field.id}`}
      className="w-full px-3 py-3 min-h-[88px] border border-slate-300 rounded-xl text-sm bg-white disabled:bg-slate-50 disabled:text-slate-500" />;
  if (field.type === 'select')
    return (
      <select value={value || ''} onChange={(e) => onChange(e.target.value)} disabled={readOnly}
        data-testid={`field-${field.id}`}
        className="w-full px-3 py-3 min-h-[44px] border border-slate-300 rounded-xl text-sm bg-white disabled:bg-slate-50">
        <option value="">— Select —</option>
        {(field.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  if (field.type === 'radio') return <ColouredRadioGroup field={field} value={value} onChange={onChange} readOnly={readOnly} />;
  if (field.type === 'date')
    return <input type="date" value={value || ''} onChange={(e) => onChange(e.target.value)} disabled={readOnly}
      data-testid={`field-${field.id}`}
      className="w-full px-3 py-3 min-h-[44px] border border-slate-300 rounded-xl text-sm bg-white disabled:bg-slate-50 disabled:text-slate-500" />;
  if (field.type === 'number')
    return <input type="number" inputMode="decimal" value={value ?? ''} placeholder={field.placeholder} disabled={readOnly}
      onChange={(e) => onChange(e.target.value)} data-testid={`field-${field.id}`}
      className="w-full px-3 py-3 min-h-[44px] border border-slate-300 rounded-xl text-sm bg-white disabled:bg-slate-50 disabled:text-slate-500" />;
  return <input type="text" value={value || ''} placeholder={field.placeholder} disabled={readOnly}
    onChange={(e) => onChange(e.target.value)} data-testid={`field-${field.id}`}
    className="w-full px-3 py-3 min-h-[44px] border border-slate-300 rounded-xl text-sm bg-white disabled:bg-slate-50 disabled:text-slate-500" />;
}

// ─────────────── Fill-Out modal ───────────────

// Shape-aware validator. Re-exported here for legacy imports — canonical
// implementation lives in `src/lib/isAnswerValid.js` (so the unit-test suite
// can import it without dragging in this whole page module).
import { isAnswerValid } from '../lib/isAnswerValid';
export { isAnswerValid };

function _draftKey(template, userId) {
  return `paneltec.draft.${template.id}.${userId || 'anon'}`;
}

function _readDraft(template, userId) {
  try {
    const raw = localStorage.getItem(_draftKey(template, userId));
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d?.savedAt) return null;
    if (Date.now() - d.savedAt > 7 * 86400 * 1000) {
      localStorage.removeItem(_draftKey(template, userId));
      return null;
    }
    return d;
  } catch { return null; }
}

function FillOutModal({ template, onClose, onSubmitted, initialValues, sourceScanToken, sourceAssetId }) {
  const userId = (() => {
    try { return JSON.parse(localStorage.getItem('paneltec.user') || 'null')?.id; }
    catch { return null; }
  })();
  const draftKey = _draftKey(template, userId);
  const existingDraft = useMemo(() => _readDraft(template, userId), [template.id, userId]);
  const [draftBanner, setDraftBanner] = useState(!!existingDraft);
  const [dirty, setDirty] = useState(false);
  const [touched, setTouched] = useState({});
  const [confirmClose, setConfirmClose] = useState(false);
  const firstMissingRef = useRef(null);

  // Defensive: guard against background prop changes (e.g. template refetch
  // after a sync) re-running this hook and wiping in-progress edits. Once we
  // have the initial answers map, subsequent template prop changes are
  // ignored. The `useState` lazy initializer above already runs once, but the
  // ref also lets downstream effects opt out of resets.
  const initialisedRef = useRef(true);

  const [values, setValues] = useState(() => {
    const base = { ...(initialValues || {}) };
    const today = new Date();
    const isoDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    (template.fields || []).forEach((f) => {
      if (f.type === 'date' && !base[f.id]) base[f.id] = isoDate;
    });
    return base;
  });
  const [photoFiles, setPhotoFiles] = useState({});
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState('');
  const [lockedFields, setLockedFields] = useState({});

  // Draft auto-save (debounced 800ms).
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(draftKey, JSON.stringify({
          values, savedAt: Date.now(),
        }));
      } catch { /* quota exceeded — fail silent */ }
    }, 800);
    return () => clearTimeout(t);
  }, [values, dirty, draftKey]);

  // beforeunload guard while dirty.
  useEffect(() => {
    if (!dirty) return undefined;
    const onBeforeUnload = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  // ESC -> confirm if dirty.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (dirty) { e.stopPropagation(); setConfirmClose(true); }
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dirty, onClose]);

  // Apply autofill values pushed by an `asset_scan` field elsewhere on the
  // template. The runner dispatches `paneltec:asset-autofill` on commit.
  useEffect(() => {
    const handler = (ev) => {
      const { sourceFieldId, values: auto } = ev.detail || {};
      if (!auto) return;
      setValues((prev) => ({ ...prev, ...auto }));
      setLockedFields((p) => ({ ...p, ...Object.fromEntries(Object.keys(auto).map((k) => [k, sourceFieldId])) }));
      setDirty(true);
    };
    window.addEventListener('paneltec:asset-autofill', handler);
    return () => window.removeEventListener('paneltec:asset-autofill', handler);
  }, []);

  const overrideField = (fid) =>
    setLockedFields((p) => { const next = { ...p }; delete next[fid]; return next; });

  // Auto-pin Site from Job picker — when a `job_picker` resolves to a job that
  // has `site_name` and a sibling `site_picker` is empty (or previously
  // auto-pinned), copy the site over and tag it `auto_pinned: true`. Re-pinning
  // happens when the job changes too, but only if the site is still flagged
  // auto-pinned (user-typed sites are left alone).
  useEffect(() => {
    const fields = template.fields || [];
    const jobField = fields.find((f) => f.type === 'job_picker' && values[f.id]?.site_name);
    if (!jobField) return;
    const siteField = fields.find((f) => f.type === 'site_picker');
    if (!siteField) return;
    const current = values[siteField.id];
    if (current && !current.auto_pinned) return;
    const job = values[jobField.id];
    if (current && current.id === job.site_name) return;
    setValues((p) => ({
      ...p,
      [siteField.id]: {
        id: job.site_name, name: job.site_name,
        customer_name: job.customer_name || null,
        auto_pinned: true, source_job_id: job.simpro_job_id,
      },
    }));
    setLockedFields((p) => ({ ...p, [siteField.id]: jobField.id }));
  }, [values, template.fields]);

  const setField = useCallback((fid, v) => {
    setDirty(true);
    setTouched((p) => ({ ...p, [fid]: true }));
    setValues((p) => ({ ...p, [fid]: v }));
  }, []);
  const setPhotoField = useCallback((fid, files) => {
    setDirty(true);
    setTouched((p) => ({ ...p, [fid]: true }));
    setPhotoFiles((p) => ({ ...p, [fid]: files }));
  }, []);

  const missingFields = useMemo(() => (template.fields || []).filter((f) => {
    if (!f.required) return false;
    return !isAnswerValid(f, values[f.id], photoFiles[f.id]);
  }), [template.fields, values, photoFiles]);
  const requiredOk = missingFields.length === 0;

  const onSubmitClick = () => {
    if (!requiredOk) {
      const first = missingFields[0];
      const node = document.querySelector(`[data-testid="field-row-${first.id}"]`);
      if (node) {
        node.scrollIntoView({ behavior: 'smooth', block: 'center' });
        node.classList.add('paneltec-field-missing-pulse');
        setTimeout(() => node.classList.remove('paneltec-field-missing-pulse'), 1500);
      }
      toast.error(`Missing: ${missingFields.slice(0, 3).map((f) => f.label).join(', ')}${missingFields.length > 3 ? '…' : ''}`);
      return;
    }
    submit();
  };

  const capturedGps = useMemo(() => {
    for (const f of template.fields || []) {
      if (f.type === 'gps' && values[f.id]?.lat != null) return values[f.id];
    }
    return null;
  }, [template, values]);

  const submit = async () => {
    setSaving(true);
    try {
      setProgress('Saving submission…');
      const payload = {
        fields: (template.fields || []).map((f) => ({
          id: f.id, label: f.label, type: f.type,
          value: f.type === 'photo' ? [] : (values[f.id] ?? null),
        })),
      };
      // Phase 3.8 — stamp scan provenance so PDFs/audits attribute this
      // submission to the asset that launched it.
      if (sourceScanToken) {
        payload.launched_via = 'scan';
        payload.source_scan_token = sourceScanToken;
        if (sourceAssetId) payload.source_asset_id = sourceAssetId;
      }
      const { data: sub } = await api.post(`/forms/templates/${template.id}/submissions`, payload);
      const photoFieldIds = Object.keys(photoFiles).filter((fid) => (photoFiles[fid] || []).length > 0);
      for (let i = 0; i < photoFieldIds.length; i++) {
        const fid = photoFieldIds[i];
        setProgress(`Uploading photos (${i + 1}/${photoFieldIds.length})…`);
        const fd = new FormData();
        fd.append('field_id', fid);
        (photoFiles[fid] || []).forEach((file) => fd.append('files', file));
        await api.post(`/forms/submissions/${sub.id}/photos`, fd,
          { headers: { 'Content-Type': 'multipart/form-data' } });
      }
      toast.success('Form submitted', { description: template.name });
      try { localStorage.removeItem(draftKey); } catch { /* noop */ }
      onSubmitted?.(sub);
      onClose();
    } catch (e) { toast.error(apiError(e)); }
    finally { setSaving(false); setProgress(''); }
  };

  const resumeDraft = () => {
    if (!existingDraft?.values) return;
    // Never overwrite a non-empty answers map (user has been typing). Merge
    // only keys that are still empty in memory.
    setValues((p) => {
      const merged = { ...p };
      Object.entries(existingDraft.values).forEach(([k, v]) => {
        if (merged[k] == null || merged[k] === '') merged[k] = v;
      });
      return merged;
    });
    setDraftBanner(false);
    toast.success('Draft restored');
  };
  const discardDraft = () => {
    try { localStorage.removeItem(draftKey); } catch { /* noop */ }
    setDraftBanner(false);
  };

  const handleBackdropClick = (e) => {
    if (e.target !== e.currentTarget) return;
    if (dirty) setConfirmClose(true); else onClose();
  };

  const guardedClose = () => {
    if (dirty) setConfirmClose(true); else onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-slate-900/40 backdrop-blur-sm"
      onClick={handleBackdropClick}
      data-testid="form-fillout-modal">
      <div className="w-full sm:max-w-3xl bg-white sm:rounded-3xl shadow-2xl border border-slate-200 overflow-hidden h-full sm:h-auto sm:max-h-[92vh] flex flex-col">
        <div className="px-4 sm:px-6 py-5 border-b border-slate-200 bg-white flex items-start gap-3">
          <div className="flex-1 min-w-0 space-y-1.5">
            <span className={`inline-block text-[10px] uppercase tracking-wider font-semibold px-2.5 py-0.5 rounded-full ${CAT_PILL[template.category] || CAT_PILL.general}`}>
              {categoryLabel(template.category)}
            </span>
            <h2 className="font-display text-2xl font-bold text-slate-900 leading-tight">{template.name}</h2>
            {template.description && <p className="text-sm text-slate-500 leading-snug">{template.description}</p>}
          </div>
          <button onClick={guardedClose} data-testid="fillout-close"
            className="p-2 -m-1 rounded-xl hover:bg-slate-100 min-w-[44px] min-h-[44px] flex items-center justify-center">
            <X size={18} />
          </button>
        </div>
        {draftBanner && existingDraft && (
          <div className="px-4 sm:px-6 py-2.5 border-b border-slate-200 bg-slate-50 flex items-center gap-2"
            data-testid="draft-banner">
            <span className="text-xs text-slate-600 flex-1">
              You have a draft from {Math.max(1, Math.round((Date.now() - existingDraft.savedAt) / 60000))} min ago.
            </span>
            <button onClick={resumeDraft} data-testid="draft-resume"
              className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold">Resume</button>
            <button onClick={discardDraft} data-testid="draft-discard"
              className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700">Discard</button>
          </div>
        )}
        {capturedGps && (
          <div className="px-4 sm:px-6 py-2 border-b border-emerald-100 bg-emerald-50 flex items-center gap-2" data-testid="gps-captured-indicator">
            <MapPin size={14} className="text-emerald-700" />
            <span className="text-xs font-semibold text-emerald-800">
              GPS captured: {capturedGps.lat.toFixed(5)}, {capturedGps.lng.toFixed(5)}
            </span>
          </div>
        )}
        <div className="px-4 sm:px-6 py-5 overflow-y-auto space-y-5 flex-1">
          {(template.fields || []).length === 0 ? (
            <div className="text-sm text-slate-500 italic">This template has no fields yet.</div>
          ) : (template.fields || []).map((f) => {
            const isLocked = !!lockedFields[f.id];
            return (
            <div key={f.id} data-testid={`field-row-${f.id}`}>
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-800 mb-1.5">
                <span>{f.label}{f.required && <span className="text-rose-600 ml-1">*</span>}</span>
                <span className="text-[10px] uppercase tracking-wider font-medium text-slate-400">{f.type}</span>
                {isLocked && (
                  <button type="button" onClick={() => overrideField(f.id)}
                    className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100"
                    data-testid={`override-${f.id}`}>Override</button>
                )}
              </label>
              <FieldRunner field={f}
                value={values[f.id]}
                onChange={(v) => setField(f.id, v)}
                photoFiles={photoFiles[f.id]}
                onPhotoChange={(files) => setPhotoField(f.id, files)}
                allFields={template.fields || []}
                allValues={values}
                readOnly={isLocked} />
            </div>
          );})}
        </div>
        <div className="px-4 sm:px-6 py-3 border-t border-slate-200 bg-white flex items-center gap-2 sticky bottom-0">
          {progress && <span className="text-xs text-slate-500 flex-1 truncate" data-testid="submit-progress">{progress}</span>}
          {!progress && <div className="flex-1" />}
          <button onClick={guardedClose} disabled={saving}
            className="px-4 py-2.5 min-h-[44px] rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50">
            Cancel
          </button>
          <button onClick={onSubmitClick} disabled={saving} data-testid="form-submit-btn"
            title={!requiredOk ? `Missing: ${missingFields.map((f) => f.label).join(', ')}` : ''}
            className={`inline-flex items-center gap-2 px-5 py-2.5 min-h-[44px] rounded-xl text-white text-sm font-bold uppercase tracking-wide shadow-md hover:shadow-lg disabled:shadow-none ${requiredOk ? 'bg-gradient-to-r from-orange-500 to-amber-500' : 'bg-slate-300 cursor-not-allowed'}`}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            {!requiredOk
              ? `${missingFields.length} required field${missingFields.length === 1 ? '' : 's'} missing`
              : 'Submit Form'}
          </button>
        </div>
      </div>
      {confirmClose && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50"
          onClick={(e) => e.target === e.currentTarget && setConfirmClose(false)}
          data-testid="discard-confirm-dialog">
          <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl border border-slate-200 p-5 space-y-4">
            <h3 className="font-display font-bold text-slate-900">Discard your changes?</h3>
            <p className="text-xs text-slate-500">Your draft will still be saved — you can resume next time you open this template.</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmClose(false)} data-testid="discard-cancel"
                className="px-3 py-2 rounded-lg border border-slate-300 text-sm font-semibold">Cancel</button>
              <button onClick={() => { setConfirmClose(false); onClose(); }} data-testid="discard-confirm"
                className="px-4 py-2 rounded-lg bg-rose-600 text-white text-sm font-bold">Discard</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────── Preview modal ───────────────

function PreviewModal({ template, onClose, onFill }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-slate-900/40 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      data-testid="form-preview-modal">
      <div className="w-full sm:max-w-3xl bg-white sm:rounded-3xl shadow-2xl border border-slate-200 overflow-hidden h-full sm:h-auto sm:max-h-[92vh] flex flex-col">
        <div className="px-4 sm:px-6 py-5 border-b border-slate-200 bg-white flex items-start gap-3">
          <div className="flex-1 min-w-0 space-y-1.5">
            <div className="flex items-center gap-2">
              <span className={`inline-block text-[10px] uppercase tracking-wider font-semibold px-2.5 py-0.5 rounded-full ${CAT_PILL[template.category] || CAT_PILL.general}`}>
                {categoryLabel(template.category)}
              </span>
              <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-semibold px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700">
                <Phone size={10} /> Preview
              </span>
            </div>
            <h2 className="font-display text-2xl font-bold text-slate-900 leading-tight">Preview · {template.name}</h2>
            {template.description && <p className="text-sm text-slate-500">{template.description}</p>}
          </div>
          <button onClick={onClose} data-testid="preview-close"
            className="p-2 -m-1 rounded-xl hover:bg-slate-100 min-w-[44px] min-h-[44px] flex items-center justify-center">
            <X size={18} />
          </button>
        </div>
        <div className="px-4 sm:px-6 py-5 overflow-y-auto space-y-5 flex-1 bg-slate-50/50">
          {(template.fields || []).map((f) => (
            <div key={f.id}>
              <label className="block text-sm font-semibold text-slate-800 mb-1.5">
                {f.label}
                {f.required && <span className="text-rose-600 ml-1">*</span>}
                <span className="ml-2 text-[10px] uppercase tracking-wider font-medium text-slate-400">{f.type}</span>
              </label>
              <FieldRunner field={f} value={null} onChange={() => {}} readOnly />
            </div>
          ))}
        </div>
        <div className="px-4 sm:px-6 py-3 border-t border-slate-200 bg-white flex items-center gap-2">
          <div className="flex-1" />
          <button onClick={onClose}
            className="px-4 py-2.5 min-h-[44px] rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-100">
            Close
          </button>
          <button onClick={onFill} data-testid="preview-fill-cta"
            className="inline-flex items-center gap-2 px-5 py-2.5 min-h-[44px] rounded-xl bg-slate-900 text-white text-sm font-bold hover:bg-slate-800">
            <Pencil size={14} /> Fill out this form
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────── Import + Build-with-AI modals ───────────────

function ImportModal({ onClose, onImported }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const onFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const r = new FileReader();
    r.onload = () => setText(String(r.result || ''));
    r.readAsText(file);
  };
  const doImport = async () => {
    let parsed;
    try { parsed = JSON.parse(text); } catch { toast.error('Invalid JSON'); return; }
    if (!parsed || !Array.isArray(parsed.templates)) { toast.error('JSON must have a "templates" array'); return; }
    setBusy(true);
    try {
      const { data } = await api.post('/forms/templates/import', parsed);
      const skippedN = (data.skipped || []).length;
      toast.success(`Imported ${data.created} template${data.created === 1 ? '' : 's'}${skippedN ? ` · skipped ${skippedN}` : ''}`);
      onImported(); onClose();
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      data-testid="forms-import-modal">
      <div className="w-full max-w-2xl bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]">
        <div className="px-6 py-5 border-b border-slate-200">
          <h2 className="font-display text-2xl font-bold text-slate-900">Import Civil Library</h2>
          <p className="text-sm text-slate-500 mt-1">Paste a JSON payload or upload a .json file. Templates with names already in your library are skipped.</p>
        </div>
        <div className="px-6 py-4 space-y-3 flex-1 overflow-y-auto">
          <button onClick={() => fileRef.current?.click()} data-testid="import-file-btn"
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl border border-slate-300 bg-white text-slate-700 hover:bg-slate-50">
            <UploadCloud size={12} /> Upload .json file
          </button>
          <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={onFile} />
          <textarea value={text} onChange={(e) => setText(e.target.value)}
            placeholder='{"templates":[{"name":"...","category":"...","fields":[...]}]}'
            data-testid="import-textarea"
            className="w-full h-64 px-3 py-2 border border-slate-300 rounded-xl font-mono text-xs" />
        </div>
        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-100">Cancel</button>
          <button onClick={doImport} disabled={busy || !text.trim()} data-testid="import-confirm"
            className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl bg-slate-900 text-white text-sm font-bold hover:bg-slate-800 disabled:opacity-50">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Import
          </button>
        </div>
      </div>
    </div>
  );
}

function AiBuilderModal({ onClose, onCreated }) {
  const [prompt, setPrompt] = useState('');
  const [category, setCategory] = useState('general');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (prompt.trim().length < 10) { toast.error('Describe the form in a bit more detail'); return; }
    setBusy(true);
    try {
      const { data } = await api.post('/forms/templates/ai-generate', { prompt: prompt.trim(), category });
      toast.success('AI draft created', { description: data.name });
      onCreated(data);
      onClose();
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && !busy && onClose()}
      data-testid="ai-builder-modal">
      <div className="w-full max-w-xl bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-200 bg-gradient-to-br from-purple-50 to-pink-50">
          <div className="flex items-center gap-2 text-xs font-semibold text-purple-700 uppercase tracking-wider mb-1">
            <Sparkles size={12} /> AI form builder
          </div>
          <h2 className="font-display text-2xl font-bold text-slate-900">Build a form with AI</h2>
          <p className="text-sm text-slate-500 mt-1">Describe what you need, AI generates a draft template you can refine.</p>
        </div>
        <div className="px-6 py-5 space-y-3">
          <label className="block text-xs font-semibold text-slate-700">Describe the form you want to build</label>
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={5}
            placeholder='e.g. "A daily scaffold inspection with sign-on, weather check, anchor points, photo evidence and supervisor signature"'
            data-testid="ai-prompt-input"
            className="w-full px-3 py-3 border border-slate-300 rounded-xl text-sm bg-white" />
          <label className="block text-xs font-semibold text-slate-700 mt-2">Category</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)}
            data-testid="ai-category-select"
            className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm bg-white">
            {CATEGORIES.filter((c) => c.key !== 'all').map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </div>
        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">
          <button onClick={onClose} disabled={busy} className="px-4 py-2 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50">Cancel</button>
          <button onClick={submit} disabled={busy || !prompt.trim()} data-testid="ai-generate-btn"
            className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-gradient-to-r from-purple-500 to-pink-500 text-white text-sm font-bold hover:opacity-95 disabled:opacity-50">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Generate
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────── Template card ───────────────

function TemplateCard({ t, canEdit, onPreview, onFill, onDelete, onEdit, onOpenSubmissions }) {
  return (
    <div className="group rounded-3xl border border-slate-200 bg-white p-5 hover:border-slate-300 hover:shadow-card transition-all flex flex-col"
      data-testid={`template-card-${t.id}`}>
      <div className="flex items-start gap-2 mb-3">
        <span className={`inline-block text-[10px] uppercase tracking-wider font-semibold px-2.5 py-1 rounded-full ${CAT_PILL[t.category] || CAT_PILL.general}`}>
          {categoryLabel(t.category)}
        </span>
        <div className="flex-1" />
        <button onClick={onPreview} data-testid={`card-icon-preview-${t.id}`} title="Preview"
          className="w-8 h-8 rounded-xl flex items-center justify-center text-blue-600 hover:bg-blue-50">
          <Phone size={14} />
        </button>
        {canEdit && (
          <button onClick={onEdit} data-testid={`card-icon-edit-${t.id}`} title="Edit"
            className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-600 hover:bg-slate-100">
            <Pencil size={14} />
          </button>
        )}
        {canEdit && (
          <button onClick={onDelete} data-testid={`card-icon-delete-${t.id}`} title="Delete"
            className="w-8 h-8 rounded-xl flex items-center justify-center text-rose-600 hover:bg-rose-50">
            <Trash2 size={14} />
          </button>
        )}
      </div>
      <h3 className="font-display text-2xl font-bold text-slate-900 leading-tight">{t.name}</h3>
      <p className="mt-2 text-sm text-slate-500 leading-relaxed">{t.description || '—'}</p>
      <div className="mt-3 flex items-center gap-3 text-[11px] text-slate-400">
        <span>{(t.fields || []).length} fields</span>
        {(t.submission_count ?? 0) > 0 && (
          <button onClick={onOpenSubmissions} data-testid={`card-subs-${t.id}`}
            className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 hover:bg-emerald-100">
            {t.submission_count} sent
          </button>
        )}
        {t.source === 'ai' && (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-purple-50 text-purple-700">
            <Sparkles size={9} /> AI draft
          </span>
        )}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button onClick={onPreview} data-testid={`card-preview-${t.id}`}
          className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 min-h-[44px] rounded-xl border-2 border-blue-200 bg-white text-blue-700 text-sm font-semibold hover:bg-blue-50">
          <Phone size={13} /> Preview
        </button>
        <button onClick={onFill} data-testid={`card-fill-${t.id}`}
          className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 min-h-[44px] rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800">
          <Pencil size={13} /> Fill This Form
        </button>
      </div>
    </div>
  );
}

// ─────────────── Page ───────────────

export default function Forms() {
  const user = getUser();
  const navigate = useNavigate();
  const canEdit = WRITE_ROLES.has(user?.role);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [previewT, setPreviewT] = useState(null);
  const [fillTemplate, setFillTemplate] = useState(null);
  const [importing, setImporting] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [builderTemplate, setBuilderTemplate] = useState(null);  // {} for new, {id,...} for edit
  const filterRef = useRef(null);

  const load = async () => {
    setLoading(true);
    try {
      // Phase 3.9c — workers see only forms applicable to them by default.
      // Admins/managers/hseq see the full library.
      const role = user?.role;
      const isWorker = role && !['admin', 'manager', 'hseq_lead'].includes(role);
      const params = isWorker ? { for_worker: 'me' } : {};
      const { data } = await api.get('/forms/templates', { params });
      setRows(data || []);
    }
    catch (e) { toast.error(apiError(e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const location = useLocation();

  // Deep-link from /scan/{token}?form={id} → auto-open the fill-out modal and
  // pre-fill the first asset_scan field with the scanned asset.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tid = params.get('template');
    const tok = params.get('scan');
    if (!tid || !tok || !rows.length) return;
    const tpl = rows.find((t) => t.id === tid);
    if (!tpl) return;
    (async () => {
      try {
        const { data: asset } = await api.get('/forms/assets/lookup', { params: { token: tok } });
        const scanField = (tpl.fields || []).find((f) => f.type === 'asset_scan');
        const initial = {};
        if (scanField) initial[scanField.id] = {
          asset_id: asset.id, scan_token: asset.scan_token, name: asset.name,
          rego_serial: asset.rego_serial, asset_type: asset.asset_type,
          vehicle_type_slug: asset.vehicle_type_slug, kind: asset.kind,
          last_known_lat: asset.last_known_lat, last_known_lng: asset.last_known_lng,
          resolved_via: 'qr', resolved_at: new Date().toISOString(),
        };
        // Phase 3.8 — pre-fill the *logged-in* worker into any worker_picker
        // field. We match by email against the org's workers register so a
        // user without a worker row simply skips this step.
        const me = user;
        if (me?.email) {
          try {
            const { data: wp } = await api.get('/forms/pickers/workers', { params: { q: me.email, limit: 5 } });
            const match = (wp?.workers || []).find((w) => (w.email || '').toLowerCase() === me.email.toLowerCase());
            if (match) {
              (tpl.fields || []).forEach((f) => {
                if (f.type === 'worker_picker' && initial[f.id] == null) {
                  initial[f.id] = {
                    id: match.id, name: match.name, trade: match.trade || null,
                    phone: match.phone || null, email: match.email || null,
                  };
                }
              });
            }
          } catch { /* picker not available — skip silently */ }
        }
        // Phase 3.8 — auto-capture GPS so the worker doesn't have to tap a
        // button on their phone. Best-effort: silently no-op if the browser
        // denies / takes too long.
        const gpsField = (tpl.fields || []).find((f) => f.type === 'gps');
        if (gpsField && navigator.geolocation) {
          try {
            await new Promise((resolve) => {
              navigator.geolocation.getCurrentPosition(
                (pos) => {
                  initial[gpsField.id] = {
                    lat: pos.coords.latitude, lng: pos.coords.longitude,
                    accuracy: pos.coords.accuracy,
                    captured_at: new Date().toISOString(),
                  };
                  resolve();
                },
                () => resolve(),
                { enableHighAccuracy: true, timeout: 4000, maximumAge: 30_000 },
              );
            });
          } catch { /* noop */ }
        }
        // Schedule autofill of dependent fields after the modal mounts.
        const auto = buildAutofillFromAsset(tpl.fields || [], { ...asset });
        setFillTemplate({
          ...tpl,
          _initialValues: { ...initial, ...auto },
          _sourceScanToken: tok,
          _sourceAssetId: asset.id,
        });
      } catch (e) { toast.error(apiError(e)); }
      navigate('/app/forms', { replace: true });
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search, rows.length]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('builder') === 'ai' && canEdit) {
      setAiOpen(true);
      navigate('/app/forms', { replace: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  useEffect(() => {
    if (!filterOpen) return;
    const onDoc = (e) => { if (filterRef.current && !filterRef.current.contains(e.target)) setFilterOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [filterOpen]);

  const counts = useMemo(() => {
    const c = { all: rows.length, incident: 0, inspection: 0, toolbox: 0, near_miss: 0, general: 0 };
    for (const r of rows) if (c[r.category] !== undefined) c[r.category]++;
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((r) => filter === 'all' ? true : r.category === filter)
      .filter((r) => !q || `${r.name} ${r.description || ''}`.toLowerCase().includes(q))
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [rows, filter, search]);

  const removeTemplate = async (t) => {
    if (!window.confirm(`Delete "${t.name}"?`)) return;
    try { await api.delete(`/forms/templates/${t.id}`); toast.success(`${t.name} deleted`); load(); }
    catch (e) { toast.error(apiError(e)); }
  };

  const exportAll = () => {
    const payload = {
      app: 'Paneltec Civil', exported_at: new Date().toISOString(), version: 1,
      count: rows.length,
      templates: rows.map((r) => ({ name: r.name, category: r.category, description: r.description, fields: r.fields })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `forms-export-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  const onEditTemplate = (t) => { setBuilderTemplate(t); };

  const currentFilterLabel = filter === 'all' ? `All categories (${counts.all})` : `${categoryLabel(filter)} (${counts[filter] ?? 0})`;

  return (
    <div className="max-w-7xl mx-auto" data-testid="forms-page">
      {/* Page header */}
      <div className="mb-6">
        <h1 className="font-display text-4xl sm:text-5xl font-bold text-slate-900 tracking-tight">Form Templates</h1>
        <p className="mt-2 text-base text-slate-500">Choose a form to fill, build your own, or generate with AI</p>
      </div>

      {/* Toolbar */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {canEdit && (
          <button onClick={() => setImporting(true)} data-testid="toolbar-import"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50">
            <Download size={14} /> Import Civil Library
          </button>
        )}
        <button onClick={exportAll} disabled={rows.length === 0} data-testid="toolbar-export"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          <Share2 size={14} /> Export All Forms
        </button>
        {canEdit && (
          <button onClick={() => setAiOpen(true)} data-testid="toolbar-ai"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-gradient-to-r from-purple-500 to-pink-500 text-white text-sm font-semibold shadow-md hover:shadow-lg">
            <Sparkles size={14} /> Build with AI
          </button>
        )}
        {canEdit && (
          <button onClick={() => setBuilderTemplate({})}
            data-testid="toolbar-new"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-gradient-to-r from-orange-500 to-amber-500 text-slate-900 text-sm font-bold shadow-md hover:shadow-lg">
            <Plus size={14} /> New Template
          </button>
        )}
      </div>

      {/* Search + category dropdown */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            data-testid="forms-search" placeholder="Search forms..."
            className="w-full pl-10 pr-3 py-2.5 text-sm border border-slate-300 rounded-2xl bg-white" />
        </div>
        <div className="relative" ref={filterRef}>
          <button onClick={() => setFilterOpen((o) => !o)} data-testid="filter-dropdown"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50">
            {currentFilterLabel} <ChevronDown size={14} />
          </button>
          {filterOpen && (
            <div className="absolute right-0 mt-1 w-64 rounded-2xl border border-slate-200 bg-white shadow-xl z-10 overflow-hidden" data-testid="filter-dropdown-menu">
              {CATEGORIES.map((c) => (
                <button key={c.key} onClick={() => { setFilter(c.key); setFilterOpen(false); }}
                  data-testid={`filter-opt-${c.key}`}
                  className={`w-full px-4 py-2.5 text-left text-sm font-medium hover:bg-slate-50 flex items-center justify-between ${filter === c.key ? 'bg-slate-100' : ''}`}>
                  <span className="flex items-center gap-2">
                    {c.key !== 'all' && <span className={`inline-block w-2.5 h-2.5 rounded-full ${c.pill.split(' ')[0]}`} />}
                    {c.label}
                  </span>
                  <span className="text-xs text-slate-500">{counts[c.key] ?? 0}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Cards */}
      {loading ? (
        <div className="text-sm text-slate-500 inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-3xl border border-slate-200 bg-white p-12 text-center" data-testid="forms-empty">
          <FileText size={28} className="mx-auto text-slate-300 mb-2" />
          <div className="text-sm font-medium text-slate-700">No templates match</div>
          <div className="text-xs text-slate-500 mt-1">Try a different category or clear the search.</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4" data-testid="forms-grid">
          {filtered.map((t) => (
            <TemplateCard key={t.id} t={t} canEdit={canEdit}
              onPreview={() => setPreviewT(t)}
              onFill={() => setFillTemplate(t)}
              onDelete={() => removeTemplate(t)}
              onEdit={() => onEditTemplate(t)}
              onOpenSubmissions={() => navigate(`/app/forms/templates/${t.id}/submissions`)} />
          ))}
        </div>
      )}

      {importing && <ImportModal onClose={() => setImporting(false)} onImported={load} />}
      {aiOpen && <AiBuilderModal onClose={() => setAiOpen(false)} onCreated={(t) => { load(); setBuilderTemplate(t); }} />}
      {previewT && <PreviewModal template={previewT} onClose={() => setPreviewT(null)}
        onFill={() => { setFillTemplate(previewT); setPreviewT(null); }} />}
      {fillTemplate && <FillOutModal template={fillTemplate} initialValues={fillTemplate._initialValues}
        sourceScanToken={fillTemplate._sourceScanToken}
        sourceAssetId={fillTemplate._sourceAssetId}
        onClose={() => setFillTemplate(null)} onSubmitted={load} />}
      {builderTemplate !== null && <TemplateBuilder template={builderTemplate}
        onClose={() => setBuilderTemplate(null)}
        onSaved={() => load()} />}
    </div>
  );
}

// ─────────────── Read-only submission view (used by FormSubmissions) ───────────────

export function SubmissionViewModal({ submissionId, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    api.get(`/forms/submissions/${submissionId}`)
      .then((r) => { if (alive) setData(r.data); })
      .catch((e) => toast.error(apiError(e)))
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [submissionId]);

  const renderValue = (f) => {
    const v = f.value;
    if (f.type === 'photo') {
      if (!Array.isArray(v) || v.length === 0) return <span className="text-slate-400 italic text-sm">No photos.</span>;
      return (
        <div className="grid grid-cols-3 gap-2">
          {v.map((p, i) => (
            <a key={i} href={`${process.env.REACT_APP_BACKEND_URL}${p.file_url}`} target="_blank" rel="noreferrer"
              className="aspect-square rounded-lg overflow-hidden border border-slate-200 hover:opacity-90">
              <img src={`${process.env.REACT_APP_BACKEND_URL}${p.file_url}`}
                alt={p.filename} className="w-full h-full object-cover" />
            </a>
          ))}
        </div>
      );
    }
    if (f.type === 'signature') {
      if (!v) return <span className="text-slate-400 italic text-sm">Not signed.</span>;
      return <img src={v} alt="signature" className="border border-slate-200 rounded-lg max-h-32 bg-white" />;
    }
    if (f.type === 'gps') {
      if (!v || v.lat == null) return <span className="text-slate-400 italic text-sm">Not captured.</span>;
      return (
        <div className="rounded-lg border border-slate-200 overflow-hidden bg-white">
          <iframe title="gps-view" src={`https://www.google.com/maps?q=${v.lat},${v.lng}&hl=en&z=16&output=embed`}
            width="100%" height="140" style={{ border: 0 }} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
          <div className="px-3 py-2 grid grid-cols-3 gap-2 text-[11px] text-slate-600">
            <div><span className="block text-slate-400 uppercase tracking-wider">Lat</span>{Number(v.lat).toFixed(5)}</div>
            <div><span className="block text-slate-400 uppercase tracking-wider">Lng</span>{Number(v.lng).toFixed(5)}</div>
            <div><span className="block text-slate-400 uppercase tracking-wider">± m</span>{Math.round(v.accuracy ?? 0)}</div>
          </div>
        </div>
      );
    }
    if (f.type === 'textarea') return <div className="text-sm text-slate-800 whitespace-pre-line">{v || '—'}</div>;
    if (f.type === 'vehicle_navixy') {
      if (!v || typeof v !== 'object') return <span className="text-slate-400 italic text-sm">No vehicle selected.</span>;
      return (
        <div className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-100 text-sm">
          <span className="font-medium text-slate-900">{v.label || 'Manual entry'}</span>
          <span className="text-slate-500">·</span>
          <span className="font-mono font-semibold text-slate-800">{v.registration || '—'}</span>
        </div>
      );
    }
    return <div className="text-sm text-slate-800">{v ?? '—'}</div>;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-slate-900/40 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      data-testid="submission-view-modal">
      <div className="w-full sm:max-w-3xl bg-white sm:rounded-3xl shadow-2xl border border-slate-200 overflow-hidden h-full sm:h-auto sm:max-h-[92vh] flex flex-col">
        <div className="px-4 sm:px-6 py-5 border-b border-slate-200 bg-white flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-[0.16em] font-semibold text-slate-500">Submission</div>
            <h2 className="font-display text-xl font-bold text-slate-900 truncate">{data?.template_name_snapshot || '…'}</h2>
            {data && <p className="text-xs text-slate-500 mt-1">By {data.submitted_by_name} · {(data.submitted_at || '').slice(0, 16).replace('T', ' ')}</p>}
          </div>
          <button onClick={onClose} className="p-2 -m-1 rounded-xl hover:bg-slate-100 min-w-[44px] min-h-[44px] flex items-center justify-center" data-testid="submission-close">
            <X size={18} />
          </button>
        </div>
        <div className="px-4 sm:px-6 py-5 overflow-y-auto space-y-5 flex-1">
          {loading ? <div className="text-sm text-slate-500 inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading…</div>
            : !data ? <div className="text-sm text-slate-500">Submission not found.</div>
            : (data.fields || []).map((f) => (
              <div key={f.id}>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  {f.label}
                  <span className="ml-2 text-[10px] uppercase tracking-wider font-medium text-slate-400">{f.type}</span>
                </label>
                {renderValue(f)}
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
