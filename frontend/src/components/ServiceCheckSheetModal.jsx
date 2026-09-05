/**
 * v58.13.121 — Service Check Sheet modal.
 *
 * Replaces the pre-.121 4-field Log-Service form with a full Vehicle
 * Service Inspection sheet. 18 checklist items frozen for
 * `sheet_template_version="v121.1"`.
 *
 * Sections (top to bottom):
 *   1. Header — violet→indigo gradient band, "Service Check Sheet"
 *      title + asset rego pill + close X. WATERMARK-FREE.
 *   2. Vehicle Details — auto-filled from asset + Navixy. Empty
 *      Navixy-blind fields (make/model/vin/year) show a muted
 *      "Not synced from Navixy — enter to save" hint. `save_to_asset_record`
 *      default-checked so filled values persist back to the asset row.
 *   3. Service Checklist — 18 rows: item · Checked · Replaced · Notes.
 *      Row tints: emerald on Checked, amber on Replaced. "Check all"
 *      convenience button.
 *   4. Advisory / Comments — autosizing textarea.
 *   5. Next Service Due — km + hours + date; km auto-suggests based
 *      on current mileage + 10 000 km when the asset has an odometer.
 *   6. Sign Off — SignaturePad for technician + optional customer.
 *   7. Footer — Cancel · Save · Save & Print. Save & Print POSTs then
 *      opens the PDF via `.107 downloads.js` so auth is preserved.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X, Loader2, ClipboardCheck, Wrench, PenLine, CheckCircle2, Printer,
  AlertTriangle, Truck,
} from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../lib/api';
import useLockBodyScroll from '../lib/useLockBodyScroll';
import SignaturePad from './SignaturePad';
import { openAuthedFile } from '../lib/downloads';

// Frozen 18-item checklist per the user's template. Any future
// variant bumps `sheet_template_version` and lives in its own array.
export const CHECKLIST_V121_1 = [
  'Engine Oil', 'Oil Filter', 'Air Filter', 'Cabin Filter', 'Fuel Filter',
  'Coolant', 'Brake Fluid', 'Power Steering Fluid', 'Windscreen Washer Fluid',
  'Auxiliary Belt', 'Battery Condition', 'Tyres', 'Brakes', 'Suspension',
  'Steering', 'Exhaust', 'Lights', 'Wipers',
];

// v58.13.122 — Service Level presets. Selecting a level auto-populates
// the checklist with the recommended tasks + notes. "Custom" keeps
// the current 18-item free-form. Mirror of backend `SCHEDULE_TABLE`
// but frontend-only for zero-latency preset application.
export const SERVICE_LEVEL_PRESETS = {
  custom: {
    label: 'Custom (free-form)',
    checked: [],
    notes: {},
  },
  minor: {
    label: 'Minor · 5–10 000 km / 250 hrs',
    checked: ['Engine Oil', 'Oil Filter'],
    notes: {
      Tyres: 'Pressure + safety inspection',
      Lights: 'Function check',
      Wipers: 'Blade condition',
    },
  },
  intermediate: {
    label: 'Intermediate · 15–20 000 km / 500 hrs',
    checked: ['Engine Oil', 'Oil Filter', 'Cabin Filter', 'Air Filter',
              'Brakes', 'Battery Condition'],
    notes: {
      Tyres: 'Rotate',
    },
  },
  major: {
    label: 'Major · 30–45 000 km / 1 000 hrs',
    checked: ['Engine Oil', 'Oil Filter', 'Cabin Filter', 'Air Filter',
              'Brakes', 'Battery Condition', 'Fuel Filter', 'Coolant',
              'Brake Fluid', 'Power Steering Fluid', 'Suspension', 'Steering'],
    notes: {
      Tyres: 'Rotate',
    },
  },
  heavy_overhaul: {
    label: 'Heavy Overhaul · 90–100 000+ km / 2 000+ hrs',
    checked: CHECKLIST_V121_1.slice(),
    notes: {
      'Auxiliary Belt': 'Timing belt/chain — 100k service replace',
      Suspension: 'Inspect bushings for wear',
      Steering: 'Valve adjustment / drivetrain overhaul check',
    },
  },
};

const _todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const _plusMonthsIso = (n) => {
  const d = new Date();
  d.setMonth(d.getMonth() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function SectionHeader({ Icon, title, chipClass, testId }) {
  return (
    <div className="flex items-center gap-2 mb-3" data-testid={testId}>
      <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider ${chipClass}`}>
        <Icon size={12} /> {title}
      </div>
      <div className="flex-1 h-px bg-slate-200" />
    </div>
  );
}

function NavixyBlindField({ label, value, onChange, placeholder, testId }) {
  return (
    <div>
      <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
        {label}
      </label>
      <input
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || 'Not synced from Navixy — enter to save'}
        data-testid={testId}
        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white
                    placeholder:italic placeholder:text-slate-400
                    focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
      />
      {!value && (
        <div className="mt-1 text-[10px] text-amber-700 flex items-center gap-1">
          <AlertTriangle size={10} /> Not synced from Navixy — fill in to save on the vehicle record
        </div>
      )}
    </div>
  );
}

function ChecklistRow({ item, state, onChange, index }) {
  const tint = state.replaced ? 'bg-amber-50 border-l-4 border-l-amber-500'
    : state.checked ? 'bg-emerald-50 border-l-4 border-l-emerald-500'
    : 'bg-white border-l-4 border-l-transparent';
  return (
    <div className={`grid grid-cols-[1fr_80px_80px_2fr] gap-2 items-center px-3 py-2 border-b border-slate-100 transition-colors ${tint}`}
         data-testid={`sheet-checklist-row-${index}`}>
      <div className="text-sm font-medium text-slate-800">{item}</div>
      <label className="inline-flex items-center gap-2 text-xs cursor-pointer">
        <input type="checkbox" checked={!!state.checked}
          onChange={(e) => onChange({ ...state, checked: e.target.checked })}
          data-testid={`sheet-checklist-checked-${index}`}
          className="w-4 h-4 rounded accent-emerald-600" />
        <span className={state.checked ? 'font-semibold text-emerald-800' : 'text-slate-500'}>
          {state.checked ? 'Checked' : 'Check'}
        </span>
      </label>
      <label className="inline-flex items-center gap-2 text-xs cursor-pointer">
        <input type="checkbox" checked={!!state.replaced}
          onChange={(e) => onChange({ ...state, replaced: e.target.checked })}
          data-testid={`sheet-checklist-replaced-${index}`}
          className="w-4 h-4 rounded accent-amber-500" />
        <span className={state.replaced ? 'font-semibold text-amber-800' : 'text-slate-500'}>
          {state.replaced ? 'Replaced' : 'Replace'}
        </span>
      </label>
      <input
        value={state.notes || ''}
        onChange={(e) => onChange({ ...state, notes: e.target.value })}
        placeholder="Notes"
        data-testid={`sheet-checklist-notes-${index}`}
        className="w-full px-2 py-1 border border-slate-200 rounded text-xs bg-white
                    focus:outline-none focus:ring-1 focus:ring-blue-500/30 focus:border-blue-400"
      />
    </div>
  );
}

export default function ServiceCheckSheetModal({ asset, onClose, onSaved }) {
  useLockBodyScroll();
  // Vehicle details (auto-filled from asset).
  const [date, setDate] = useState(_todayIso());
  const [technicianId, setTechnicianId] = useState('');
  const [technicianName, setTechnicianName] = useState('');
  const [company, setCompany] = useState('');
  const [mileage, setMileage] = useState(asset?.odo_km ? Math.round(asset.odo_km).toString() : '');
  const [hoursAtService, setHoursAtService] = useState(asset?.hours_meter ? asset.hours_meter.toFixed(1) : '');
  // Navixy-blind fields.
  const [makeModel, setMakeModel] = useState(
    [asset?.make, asset?.model].filter(Boolean).join(' ')
  );
  const [vin, setVin] = useState(asset?.vin || '');
  const [saveToAssetRecord, setSaveToAssetRecord] = useState(true);
  // Checklist state.
  const [checklist, setChecklist] = useState(() =>
    CHECKLIST_V121_1.map((item) => ({ item, checked: false, replaced: false, notes: '' }))
  );
  // v58.13.122 — Service Level preset. Custom = user drives the checklist.
  const [serviceLevel, setServiceLevel] = useState('custom');
  const applyPreset = (levelKey) => {
    setServiceLevel(levelKey);
    const preset = SERVICE_LEVEL_PRESETS[levelKey];
    if (!preset) return;
    setChecklist((prev) => prev.map((row) => ({
      ...row,
      checked: preset.checked.includes(row.item) || (levelKey === 'custom' ? row.checked : false),
      notes: preset.notes[row.item] || row.notes,
    })));
  };
  // v58.13.122 — Auto-populate next-due from backend compute on mount.
  useEffect(() => {
    if (!asset?.id) return;
    api.get(`/fleet/assets/${asset.id}/next-service`)
      .then((r) => {
        const d = r.data || {};
        if (d.next_service_due_km) setNextDueKm(String(Math.round(d.next_service_due_km)));
        if (d.next_service_due_hours) setNextDueHours(d.next_service_due_hours.toFixed(0));
      })
      .catch(() => { /* best-effort — modal still works without */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset?.id]);
  const checkAll = () => {
    setChecklist((p) => p.map((r) => ({ ...r, checked: true })));
  };
  // Advisory + Next Service Due.
  const [advisory, setAdvisory] = useState('');
  const [nextDueKm, setNextDueKm] = useState(
    asset?.odo_km ? String(Math.round(asset.odo_km + 10000)) : ''
  );
  const [nextDueHours, setNextDueHours] = useState(
    asset?.hours_meter ? (Math.floor(asset.hours_meter / 250) * 250 + 250).toFixed(0) : ''
  );
  const [nextDueDate, setNextDueDate] = useState(_plusMonthsIso(6));
  // Signatures.
  const [techSig, setTechSig] = useState(null);
  const [custSig, setCustSig] = useState(null);
  // Technician picker.
  const [technicians, setTechnicians] = useState([]);
  const [technicianMode, setTechnicianMode] = useState('picker'); // 'picker' | 'freetext'
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/fleet/technicians')
      .then((r) => {
        const list = r.data?.technicians || [];
        setTechnicians(list);
        if (list.length === 0) setTechnicianMode('freetext');
      })
      .catch(() => setTechnicianMode('freetext'));
  }, []);

  // ESC → confirm close
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const buildPayload = () => {
    // Description = first non-empty checklist "Replaced" summary, or "Service".
    const replaced = checklist.filter((r) => r.replaced).map((r) => r.item);
    const description = advisory
      || (replaced.length ? `Replaced: ${replaced.join(', ')}` : 'Service check completed');
    const tech = technicianMode === 'picker'
      ? technicians.find((t) => t.id === technicianId)
      : null;
    return {
      // Required legacy fields.
      date_completed: date,
      maintenance_type: 'Service',
      cost: 0,
      description,
      performed_by: tech?.name || technicianName || null,
      company: company || null,
      notes: advisory || null,
      next_due_date: nextDueDate || null,
      // v121 sheet extensions.
      checklist_items: checklist,
      advisory_comments: advisory || null,
      next_service_due_km: nextDueKm ? Number(nextDueKm) : null,
      next_service_due_hours: nextDueHours ? Number(nextDueHours) : null,
      mileage_at_service: mileage ? Number(mileage) : null,
      hours_at_service: hoursAtService ? Number(hoursAtService) : null,
      technician_user_id: tech?.id || null,
      technician_name: tech?.name || technicianName || null,
      technician_signature_data_url: techSig,
      customer_signature_data_url: custSig,
      vin_captured: vin || null,
      make_model_captured: makeModel || null,
      sheet_template_version: 'v121.1',
      service_level: serviceLevel,
      save_to_asset_record: saveToAssetRecord,
    };
  };

  const submit = async ({ andPrint = false } = {}) => {
    if (!techSig) {
      toast.error('Technician signature is required');
      return;
    }
    setSaving(true);
    try {
      const { data: rec } = await api.post(
        `/fleet/assets/${asset.id}/services`, buildPayload()
      );
      toast.success('Service check sheet saved');
      onSaved?.(rec);
      if (andPrint) {
        try {
          await openAuthedFile(
            `/fleet/assets/${asset.id}/service-sheet/${rec.id}/pdf`,
            `service-sheet-${rec.maintenance_id || rec.id}.pdf`,
            { mode: 'blob' },
          );
        } catch (e) {
          toast.warning('Saved, but PDF generation failed — retry from Maintenance History', {
            description: apiError(e) || 'PDF unavailable',
          });
        }
      }
      onClose();
    } catch (e) {
      toast.error(apiError(e) || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
         onClick={(e) => e.target === e.currentTarget && !saving && onClose()}
         data-testid="service-check-sheet-modal">
      <div className="w-full max-w-3xl bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header — violet→indigo gradient band. */}
        <div className="relative px-6 py-4 text-white overflow-hidden"
             style={{ background: 'linear-gradient(90deg, #7C3AED 0%, #6D28D9 55%, #4F46E5 100%)' }}
             data-testid="sheet-header">
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <div className="text-[10px] uppercase tracking-[0.2em] font-bold opacity-90">
                Vehicle Service Inspection
              </div>
              <h2 className="font-display text-2xl font-bold mt-0.5">Service Check Sheet</h2>
              <div className="mt-1 text-sm opacity-85">Template {'v121.1'} · No decorative background · Live data</div>
            </div>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/15 backdrop-blur">
              <Truck size={14} />
              <span className="font-mono font-bold">{asset?.rego_serial || '—'}</span>
              <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/20 font-semibold">
                {asset?.kind || 'asset'}
              </span>
            </div>
            <button onClick={onClose}
              disabled={saving}
              data-testid="sheet-close"
              aria-label="Close service check sheet"
              className="p-1.5 rounded-lg hover:bg-white/15 disabled:opacity-50">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="px-6 py-4 overflow-y-auto space-y-6 flex-1 bg-slate-50/40">
          {/* Vehicle Details */}
          <section data-testid="sheet-section-vehicle">
            <SectionHeader Icon={Truck} title="Vehicle Details"
              chipClass="bg-blue-50 text-blue-700"
              testId="sheet-section-vehicle-header" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 bg-white rounded-xl p-4 border border-slate-200">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Registration</label>
                <input readOnly value={asset?.rego_serial || ''}
                  data-testid="sheet-vehicle-rego"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-slate-50 font-mono font-semibold text-slate-800" />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Date</label>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                  data-testid="sheet-vehicle-date"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white" />
              </div>
              <NavixyBlindField label="Make / Model" value={makeModel} onChange={setMakeModel}
                testId="sheet-vehicle-make-model" />
              <NavixyBlindField label="VIN" value={vin} onChange={setVin}
                testId="sheet-vehicle-vin" />
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Mileage (km) {asset?.odo_km ? <span className="text-emerald-700 normal-case font-medium">· auto from Navixy</span> : null}
                </label>
                <input type="number" value={mileage} onChange={(e) => setMileage(e.target.value)}
                  data-testid="sheet-vehicle-mileage"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white" />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Engine hours {asset?.hours_meter ? <span className="text-emerald-700 normal-case font-medium">· auto from Navixy</span> : null}
                </label>
                <input type="number" step="0.1" value={hoursAtService} onChange={(e) => setHoursAtService(e.target.value)}
                  data-testid="sheet-vehicle-hours"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white" />
              </div>
              <div className="md:col-span-2">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Technician</label>
                {technicianMode === 'picker' && technicians.length > 0 ? (
                  <div className="flex items-center gap-2">
                    <select value={technicianId} onChange={(e) => setTechnicianId(e.target.value)}
                      data-testid="sheet-technician-select"
                      className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white">
                      <option value="">— Select technician —</option>
                      {technicians.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}{t.position ? ` (${t.position})` : ''}
                        </option>
                      ))}
                    </select>
                    <button type="button" onClick={() => setTechnicianMode('freetext')}
                      data-testid="sheet-technician-freetext-toggle"
                      className="px-2 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 hover:bg-slate-50">
                      Type name
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <input value={technicianName} onChange={(e) => setTechnicianName(e.target.value)}
                      data-testid="sheet-technician-freetext"
                      placeholder="Technician name"
                      className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white" />
                    {technicians.length > 0 && (
                      <button type="button" onClick={() => setTechnicianMode('picker')}
                        className="px-2 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 hover:bg-slate-50">
                        Pick from list
                      </button>
                    )}
                  </div>
                )}
              </div>
              <div className="md:col-span-2">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Company (workshop)</label>
                <input value={company} onChange={(e) => setCompany(e.target.value)}
                  data-testid="sheet-company"
                  placeholder="e.g. G Mech Tas"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white" />
              </div>
              <label className="md:col-span-2 inline-flex items-center gap-2 text-xs cursor-pointer text-slate-700">
                <input type="checkbox" checked={saveToAssetRecord}
                  onChange={(e) => setSaveToAssetRecord(e.target.checked)}
                  data-testid="sheet-save-to-asset"
                  className="w-3.5 h-3.5 rounded accent-blue-600" />
                Save Make/Model/VIN back to the vehicle record (only empty fields will be updated)
              </label>
            </div>
          </section>

          {/* Checklist */}
          <section data-testid="sheet-section-checklist">
            <div className="flex items-center gap-2 mb-3">
              <SectionHeader Icon={ClipboardCheck} title="Service Checklist"
                chipClass="bg-emerald-50 text-emerald-700"
                testId="sheet-section-checklist-header" />
            </div>
            <div className="mb-3 bg-white rounded-xl border border-slate-200 p-3 flex items-center gap-3 flex-wrap"
                 data-testid="sheet-service-level-block">
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Service Level
              </label>
              <select value={serviceLevel} onChange={(e) => applyPreset(e.target.value)}
                data-testid="sheet-service-level"
                className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm bg-white
                            focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500">
                {Object.entries(SERVICE_LEVEL_PRESETS).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
              <span className="text-[11px] text-slate-500 flex-1">
                Selecting a level pre-checks the recommended items and pre-fills key notes.
              </span>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="grid grid-cols-[1fr_80px_80px_2fr] gap-2 px-3 py-2 bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500 font-bold">
                <div>Item</div>
                <div>Checked</div>
                <div>Replaced</div>
                <div className="flex items-center gap-2">
                  <span>Notes</span>
                  <button type="button" onClick={checkAll}
                    data-testid="sheet-check-all"
                    className="ml-auto px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold uppercase tracking-wider hover:bg-emerald-200">
                    Check all
                  </button>
                </div>
              </div>
              {checklist.map((r, i) => (
                <ChecklistRow key={r.item} item={r.item} state={r} index={i}
                  onChange={(next) => setChecklist((p) =>
                    p.map((row, idx) => idx === i ? next : row))} />
              ))}
            </div>
          </section>

          {/* Advisory / Comments */}
          <section data-testid="sheet-section-advisory">
            <SectionHeader Icon={Wrench} title="Advisory Items / Comments"
              chipClass="bg-amber-50 text-amber-800" />
            <textarea value={advisory} onChange={(e) => setAdvisory(e.target.value)}
              rows={4} placeholder="Notes, next-visit items, deferred work…"
              data-testid="sheet-advisory"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white
                          focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500" />
          </section>

          {/* Next Service Due */}
          <section data-testid="sheet-section-next-due">
            <SectionHeader Icon={Wrench} title="Next Service Due"
              chipClass="bg-indigo-50 text-indigo-700" />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 bg-white rounded-xl p-4 border border-slate-200">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Due mileage (km)</label>
                <input type="number" value={nextDueKm} onChange={(e) => setNextDueKm(e.target.value)}
                  data-testid="sheet-next-due-km"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white" />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Due engine hours</label>
                <input type="number" value={nextDueHours} onChange={(e) => setNextDueHours(e.target.value)}
                  data-testid="sheet-next-due-hours"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white" />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Due date</label>
                <input type="date" value={nextDueDate} onChange={(e) => setNextDueDate(e.target.value)}
                  data-testid="sheet-next-due-date"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white" />
              </div>
            </div>
          </section>

          {/* Sign Off */}
          <section data-testid="sheet-section-signoff">
            <SectionHeader Icon={PenLine} title="Sign Off"
              chipClass="bg-violet-50 text-violet-700" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-white rounded-xl p-4 border border-slate-200">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-700 mb-2">
                  Technician signature <span className="text-rose-600">*</span>
                </label>
                <SignaturePad value={techSig} onChange={setTechSig}
                  ariaLabel="Technician signature pad"
                  testId="sheet-tech-signature" />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">
                  Customer signature <span className="text-slate-400 normal-case font-medium">(optional)</span>
                </label>
                <SignaturePad value={custSig} onChange={setCustSig}
                  ariaLabel="Customer signature pad"
                  testId="sheet-cust-signature" />
              </div>
            </div>
          </section>
        </div>

        <div className="px-6 py-3 border-t border-slate-200 bg-white emergent-badge-safe flex items-center justify-end gap-2">
          <button onClick={onClose} disabled={saving}
            data-testid="sheet-cancel"
            className="px-4 py-2 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            Cancel
          </button>
          <button onClick={() => submit()} disabled={saving}
            data-testid="sheet-save"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 disabled:opacity-50">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            Save
          </button>
          <button onClick={() => submit({ andPrint: true })} disabled={saving}
            data-testid="sheet-save-print"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-600 text-white text-sm font-bold hover:bg-violet-700 disabled:opacity-50">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />}
            Save & Print
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
