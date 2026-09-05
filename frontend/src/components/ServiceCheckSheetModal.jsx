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
  AlertTriangle, Truck, ChevronDown, ChevronRight, CircleDot, Plus,
  Trash2, Paperclip, Wifi,
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
  // v58.13.123 — Template picker. Auto-selected from asset shape.
  const _pickDefaultTemplate = () => {
    const st = (asset?.asset_type || asset?.sub_type || '').toLowerCase();
    const heavySubtypes = new Set(['vacuum truck','vac truck','vacuum_truck',
      'tipper','service truck','service_truck','crane truck','crane_truck','commercial']);
    if (heavySubtypes.has(st)) return 'v123.1';
    if (asset?.kind === 'plant') return 'v123.1';
    if (asset?.kind === 'vehicle' && (asset?.hours_meter || 0) >= 500) return 'v123.1';
    return 'v121.1';
  };
  const [templateVersion, setTemplateVersion] = useState(_pickDefaultTemplate);
  const [templates, setTemplates] = useState(null); // loaded from /service-sheet-templates
  useEffect(() => {
    api.get('/fleet/service-sheet-templates').then((r) => setTemplates(r.data?.templates)).catch(() => {});
  }, []);
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
  // v58.13.123a — Attachments replace the Customer Signature pad.
  const [attachments, setAttachments] = useState([]);
  // v58.13.123 — Heavy Truck state (dormant when template=v121.1).
  const [heavyMarks, setHeavyMarks] = useState({}); // {"A|Oil changed": "X"|"CHECK"|"NA"|"UNSET"}
  const [heavyNotes, setHeavyNotes] = useState({}); // same key -> string
  const [tread, setTread] = useState({}); // {position_id: {out, in}}
  const [consumables, setConsumables] = useState('');
  const [nextInspectionDue, setNextInspectionDue] = useState('');
  const [openSection, setOpenSection] = useState('A');
  // v58.13.123a — Ad-hoc per-sheet custom items keyed by section id.
  const [customItems, setCustomItems] = useState({}); // {"A": ["Custom item name", ...]}
  const addCustomItem = (sec) => {
    const name = (window.prompt('Custom item name (this sheet only)') || '').trim();
    if (!name) return;
    setCustomItems((p) => ({ ...p, [sec]: [...(p[sec] || []), name] }));
  };
  const deleteCustomItem = (sec, name) => {
    setCustomItems((p) => ({ ...p, [sec]: (p[sec] || []).filter((x) => x !== name) }));
    // Also drop any marks/notes for that row.
    const key = `${sec}|${name}`;
    setHeavyMarks((p) => { const n = { ...p }; delete n[key]; return n; });
    setHeavyNotes((p) => { const n = { ...p }; delete n[key]; return n; });
  };
  const heavyTmpl = templates?.['v123.1'];
  const setMark = (sec, item, mark) => setHeavyMarks((p) => ({ ...p, [`${sec}|${item}`]: mark }));
  const setNote = (sec, item, val) => setHeavyNotes((p) => ({ ...p, [`${sec}|${item}`]: val }));
  const bulkCheckSection = (sec) => {
    if (!heavyTmpl) return;
    const section = heavyTmpl.sections.find((s) => s.id === sec);
    if (!section) return;
    setHeavyMarks((p) => {
      const next = { ...p };
      for (const it of section.items) {
        if (!next[`${sec}|${it}`] || next[`${sec}|${it}`] === 'UNSET') {
          next[`${sec}|${it}`] = 'CHECK';
        }
      }
      return next;
    });
  };
  const totalHeavyItems = heavyTmpl ? heavyTmpl.sections.reduce((n, s) => n + s.items.length, 0) : 0;
  const markedHeavyCount = Object.values(heavyMarks).filter((m) => m && m !== 'UNSET').length;
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
      ? technicians.find((t) => t.id === technicianId || t.name.toLowerCase() === (technicianName || '').toLowerCase())
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
      // v121 legacy fields kept for backward-compat when template=v121.1.
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
      sheet_template_version: templateVersion,
      service_level: serviceLevel,
      save_to_asset_record: saveToAssetRecord,
      // v58.13.123 — heavy-truck additive fields (null when Light).
      checklist_items: templateVersion === 'v123.1' && heavyTmpl
        ? [
            ...heavyTmpl.sections.flatMap((s) => s.items.map((it) => ({
              item: it, section: s.id,
              mark: heavyMarks[`${s.id}|${it}`] || 'UNSET',
              notes: heavyNotes[`${s.id}|${it}`] || '',
            }))),
            // v58.13.123a — Custom per-sheet items with `custom:true`.
            ...Object.entries(customItems).flatMap(([sec, items]) =>
              items.map((it) => ({
                item: it, section: sec, custom: true,
                mark: heavyMarks[`${sec}|${it}`] || 'UNSET',
                notes: heavyNotes[`${sec}|${it}`] || '',
              }))
            ),
          ]
        : checklist,
      tread_depth_readings: templateVersion === 'v123.1' ? tread : null,
      consumables_used: templateVersion === 'v123.1' ? (consumables || null) : null,
      next_inspection_due_date: templateVersion === 'v123.1' ? (nextInspectionDue || null) : null,
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
            {/* v58.13.126 — Persistent Navixy connection banner so an
                operator can tell at a glance whether the sheet's
                counters + rego will auto-populate. Prior chips lived
                inside the Registration label only, which some users
                missed on the first scan. */}
            <div className={`mb-2 rounded-lg px-3 py-2 text-xs flex items-center gap-2 ${
              asset?.navixy_device_id
                ? 'bg-emerald-50 border border-emerald-200 text-emerald-900'
                : 'bg-slate-50 border border-slate-200 text-slate-700'
            }`} data-testid="sheet-navixy-status-banner">
              <Wifi size={13} className={asset?.navixy_device_id ? 'text-emerald-600' : 'text-slate-400'} />
              {asset?.navixy_device_id ? (
                <span>
                  <span className="font-bold">Navixy · connected.</span>{' '}
                  Live counters: odo <span className="font-semibold tabular-nums">{asset?.odo_km ? Math.round(asset.odo_km).toLocaleString() + ' km' : '—'}</span>,
                  hours <span className="font-semibold tabular-nums">{asset?.hours_meter ? asset.hours_meter.toFixed(1) + ' h' : '—'}</span>.
                  Device ID <span className="font-mono">{asset.navixy_device_id}</span>.
                </span>
              ) : (
                <span>
                  <span className="font-bold">Manual entry.</span>{' '}
                  No Navixy tracker linked — mileage and hours will not auto-populate. To link, open the Pairing tab on the asset drawer.
                </span>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 bg-white rounded-xl p-4 border border-slate-200">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Registration
                  {asset?.navixy_device_id ? (
                    <span className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-emerald-100 text-emerald-800 normal-case tracking-normal"
                          data-testid="sheet-rego-navixy-chip">
                      <Wifi size={9} /> Navixy · live
                    </span>
                  ) : (
                    <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-slate-100 text-slate-600 normal-case tracking-normal"
                          data-testid="sheet-rego-manual-chip">
                      Manual
                    </span>
                  )}
                </label>
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
                    <input
                      list="sheet-technician-datalist"
                      value={technicianName}
                      onChange={(e) => {
                        const v = e.target.value;
                        setTechnicianName(v);
                        const hit = technicians.find(
                          (t) => t.name.toLowerCase() === v.toLowerCase(),
                        );
                        setTechnicianId(hit?.id || '');
                      }}
                      placeholder="Search technicians (name)"
                      data-testid="sheet-technician-select"
                      className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white" />
                    <datalist id="sheet-technician-datalist">
                      {technicians.map((t) => (
                        <option key={t.id} value={t.name}>
                          {t.position || t.role || ''}
                        </option>
                      ))}
                    </datalist>
                    <button type="button" onClick={() => setTechnicianMode('freetext')}
                      data-testid="sheet-technician-freetext-toggle"
                      className="px-2 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 hover:bg-slate-50">
                      Type new
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

          {/* v58.13.123 — Template picker + overall progress bar. */}
          <section data-testid="sheet-template-picker-block">
            <div className="bg-white rounded-xl border border-slate-200 p-3 mb-4 flex items-center gap-3 flex-wrap">
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Choose a vehicle type to service
              </label>
              <select value={templateVersion} onChange={(e) => setTemplateVersion(e.target.value)}
                data-testid="sheet-template-picker"
                className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm bg-white font-semibold">
                <option value="v121.1">Light Vehicle — Service Check Sheet</option>
                <option value="v123.1">Heavy Truck — Preventative Maintenance Checklist</option>
              </select>
              {templateVersion === 'v123.1' && heavyTmpl && (
                <div className="flex-1 flex items-center gap-2 min-w-[220px]">
                  <span className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">
                    Progress
                  </span>
                  <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden"
                       data-testid="sheet-heavy-progress-bar">
                    <div className={`h-full transition-all ${
                      markedHeavyCount === totalHeavyItems ? 'bg-emerald-500'
                      : markedHeavyCount ? 'bg-violet-500' : 'bg-slate-300'
                    }`}
                    style={{ width: `${(markedHeavyCount / Math.max(totalHeavyItems, 1)) * 100}%` }} />
                  </div>
                  <span className="text-xs font-semibold tabular-nums text-slate-700">
                    {markedHeavyCount}/{totalHeavyItems}
                  </span>
                </div>
              )}
            </div>
          </section>

          {templateVersion === 'v123.1' && heavyTmpl && (
            <>
              <section data-testid="sheet-heavy-sections">
                <SectionHeader Icon={ClipboardCheck} title="Preventative Maintenance Checklist"
                  chipClass="bg-emerald-50 text-emerald-700" />
                <div className="space-y-2">
                  {heavyTmpl.sections.map((sec) => {
                    const isOpen = openSection === sec.id;
                    const secMarks = sec.items.map((it) => heavyMarks[`${sec.id}|${it}`] || 'UNSET');
                    const anyX = secMarks.includes('X');
                    const allSet = secMarks.every((m) => m !== 'UNSET');
                    const pill = anyX
                      ? { bg: 'bg-rose-100', txt: 'text-rose-800', lbl: 'Attention' }
                      : allSet
                      ? { bg: 'bg-emerald-100', txt: 'text-emerald-800', lbl: 'All OK' }
                      : { bg: 'bg-slate-100', txt: 'text-slate-600', lbl: 'Not started' };
                    return (
                      <div key={sec.id} className="bg-white rounded-xl border border-slate-200 overflow-hidden"
                           data-testid={`sheet-heavy-section-${sec.id}`}>
                        <div className={`flex items-center gap-2 px-3 py-2 cursor-pointer bg-${sec.accent}-50/70`}
                             onClick={() => setOpenSection(isOpen ? null : sec.id)}>
                          {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          <span className={`text-[10px] font-bold uppercase tracking-wider text-${sec.accent}-800`}>
                            {sec.id}
                          </span>
                          <span className="text-sm font-semibold text-slate-800 flex-1">{sec.label}</span>
                          <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${pill.bg} ${pill.txt}`}
                                data-testid={`sheet-heavy-section-status-${sec.id}`}>
                            {pill.lbl}
                          </span>
                          <button type="button" onClick={(e) => { e.stopPropagation(); addCustomItem(sec.id); }}
                            data-testid={`sheet-heavy-add-item-${sec.id}`}
                            title="Add a custom item to this section"
                            className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-violet-100 text-violet-800 hover:bg-violet-200 inline-flex items-center gap-1">
                            <Plus size={10} /> add
                          </button>
                          <button type="button" onClick={(e) => { e.stopPropagation(); bulkCheckSection(sec.id); }}
                            data-testid={`sheet-heavy-bulk-check-${sec.id}`}
                            title="Mark every unset item ✓"
                            className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-100 text-emerald-800 hover:bg-emerald-200">
                            ✓ all
                          </button>
                        </div>
                        {isOpen && (
                          <div className="divide-y divide-slate-100">
                            {sec.items.map((item) => {
                              const mark = heavyMarks[`${sec.id}|${item}`] || 'UNSET';
                              const tint = mark === 'X' ? 'bg-rose-50'
                                : mark === 'CHECK' ? 'bg-emerald-50'
                                : mark === 'NA' ? 'bg-slate-50' : 'bg-white';
                              return (
                                <div key={item}
                                     className={`grid grid-cols-[1fr_auto_2fr] gap-2 items-center px-3 py-1.5 ${tint}`}
                                     data-testid={`sheet-heavy-row-${sec.id}-${sec.items.indexOf(item)}`}>
                                  <div className="text-xs text-slate-800">{item}</div>
                                  <div className="flex gap-1">
                                    {['X','CHECK','NA'].map((m) => (
                                      <button key={m} type="button"
                                        onClick={() => setMark(sec.id, item, mark === m ? 'UNSET' : m)}
                                        data-testid={`sheet-heavy-mark-${sec.id}-${sec.items.indexOf(item)}-${m}`}
                                        className={`w-8 h-6 text-[10px] font-bold rounded ${
                                          mark === m
                                            ? (m === 'X' ? 'bg-rose-600 text-white'
                                              : m === 'CHECK' ? 'bg-emerald-600 text-white'
                                              : 'bg-slate-500 text-white')
                                            : 'bg-white border border-slate-300 text-slate-500 hover:bg-slate-50'
                                        }`}>
                                        {m === 'CHECK' ? '✓' : m}
                                      </button>
                                    ))}
                                  </div>
                                  <input value={heavyNotes[`${sec.id}|${item}`] || ''}
                                    onChange={(e) => setNote(sec.id, item, e.target.value)}
                                    placeholder="Notes"
                                    className="w-full px-2 py-0.5 border border-slate-200 rounded text-xs bg-white" />
                                </div>
                              );
                            })}
                            {/* v58.13.123a — Custom per-sheet rows. */}
                            {(customItems[sec.id] || []).map((item, ci) => {
                              const mark = heavyMarks[`${sec.id}|${item}`] || 'UNSET';
                              const tint = mark === 'X' ? 'bg-rose-50'
                                : mark === 'CHECK' ? 'bg-emerald-50'
                                : mark === 'NA' ? 'bg-slate-50' : 'bg-violet-50/60';
                              return (
                                <div key={`custom-${ci}-${item}`}
                                  className={`grid grid-cols-[1fr_auto_2fr_28px] gap-2 items-center px-3 py-1.5 ${tint}`}
                                  data-testid={`sheet-heavy-custom-row-${sec.id}-${ci}`}>
                                  <div className="text-xs text-slate-800">
                                    <span className="italic text-violet-700 mr-1">(custom)</span>{item}
                                  </div>
                                  <div className="flex gap-1">
                                    {['X','CHECK','NA'].map((m) => (
                                      <button key={m} type="button"
                                        onClick={() => setMark(sec.id, item, mark === m ? 'UNSET' : m)}
                                        className={`w-8 h-6 text-[10px] font-bold rounded ${
                                          mark === m
                                            ? (m === 'X' ? 'bg-rose-600 text-white'
                                              : m === 'CHECK' ? 'bg-emerald-600 text-white'
                                              : 'bg-slate-500 text-white')
                                            : 'bg-white border border-slate-300 text-slate-500 hover:bg-slate-50'
                                        }`}>
                                        {m === 'CHECK' ? '✓' : m}
                                      </button>
                                    ))}
                                  </div>
                                  <input value={heavyNotes[`${sec.id}|${item}`] || ''}
                                    onChange={(e) => setNote(sec.id, item, e.target.value)}
                                    placeholder="Notes"
                                    className="w-full px-2 py-0.5 border border-slate-200 rounded text-xs bg-white" />
                                  <button type="button" onClick={() => deleteCustomItem(sec.id, item)}
                                    data-testid={`sheet-heavy-custom-delete-${sec.id}-${ci}`}
                                    title="Delete this custom item"
                                    className="p-1 rounded text-rose-600 hover:bg-rose-50">
                                    <Trash2 size={12} />
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>

              <section data-testid="sheet-tread-depth-block">
                <div className="flex items-center gap-2 mb-2 cursor-pointer bg-white rounded-lg border border-slate-200 px-3 py-2"
                     onClick={() => setOpenSection(openSection === '__tread' ? null : '__tread')}
                     data-testid="sheet-tread-depth-toggle">
                  {openSection === '__tread' ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider bg-cyan-50 text-cyan-800`}>
                    <CircleDot size={12} /> Tire Tread Depth (32nds)
                  </div>
                  <div className="flex-1 h-px bg-slate-200" />
                </div>
                {openSection === '__tread' && (
                <div className="bg-white rounded-xl border border-slate-200 p-3">
                  <div className="grid grid-cols-[1fr_80px_80px] gap-2 text-[10px] uppercase tracking-wider text-slate-500 font-bold pb-2 border-b border-slate-200">
                    <div>Position</div><div>Out</div><div>In</div>
                  </div>
                  {heavyTmpl.tread_positions.map((pos) => {
                    const val = tread[pos.id] || {};
                    const isLow = (v) => v !== undefined && v !== '' && parseFloat(v) < 4;
                    return (
                      <div key={pos.id} className="grid grid-cols-[1fr_80px_80px] gap-2 items-center py-1"
                           data-testid={`sheet-tread-row-${pos.id}`}>
                        <div className="text-xs text-slate-800">{pos.label}</div>
                        <input type="number" step="0.5" value={val.out || ''}
                          onChange={(e) => setTread((p) => ({ ...p, [pos.id]: { ...(p[pos.id]||{}), out: e.target.value } }))}
                          data-testid={`sheet-tread-out-${pos.id}`}
                          className={`w-full px-2 py-0.5 border rounded text-xs ${isLow(val.out) ? 'border-rose-500 bg-rose-50 text-rose-800' : 'border-slate-300'}`} />
                        {pos.has_inner ? (
                          <input type="number" step="0.5" value={val.in || ''}
                            onChange={(e) => setTread((p) => ({ ...p, [pos.id]: { ...(p[pos.id]||{}), in: e.target.value } }))}
                            data-testid={`sheet-tread-in-${pos.id}`}
                            className={`w-full px-2 py-0.5 border rounded text-xs ${isLow(val.in) ? 'border-rose-500 bg-rose-50 text-rose-800' : 'border-slate-300'}`} />
                        ) : <span className="text-xs text-slate-300">—</span>}
                      </div>
                    );
                  })}
                </div>
                )}
              </section>

              <section data-testid="sheet-consumables-block">
                <SectionHeader Icon={Wrench} title="Consumables / Parts Used"
                  chipClass="bg-amber-50 text-amber-800" />
                <textarea value={consumables} onChange={(e) => setConsumables(e.target.value)}
                  rows={3} placeholder="Parts, oils, filters used…"
                  data-testid="sheet-consumables"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white" />
              </section>

              <section data-testid="sheet-rego-expiry-block">
                <SectionHeader Icon={AlertTriangle} title="Rego expiry / Next inspection due"
                  chipClass="bg-indigo-50 text-indigo-700" />
                <input type="date" value={nextInspectionDue}
                  onChange={(e) => setNextInspectionDue(e.target.value)}
                  data-testid="sheet-next-inspection-due"
                  className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white" />
              </section>
            </>
          )}

          {templateVersion === 'v121.1' && (
          <>
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
          </>
          )}
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
                  Attach documents or photos <span className="text-slate-400 normal-case font-medium">(optional)</span>
                </label>
                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={async (e) => {
                    e.preventDefault();
                    if (!asset?.id) { toast.error('Save the asset first to attach files'); return; }
                    for (const f of Array.from(e.dataTransfer.files || [])) {
                      const fd = new FormData(); fd.append('file', f);
                      try {
                        const r = await api.post(`/assets/${asset.id}/photos`, fd);
                        setAttachments((p) => [...p, ...(r.data?.photos || []).slice(-1)]);
                        toast.success(`Attached ${f.name}`);
                      } catch (err) { toast.error(apiError(err) || `Failed: ${f.name}`); }
                    }
                  }}
                  data-testid="sheet-attach-dropzone"
                  className="rounded-lg border-2 border-dashed border-slate-300 hover:border-blue-400 p-4 bg-white text-center cursor-pointer"
                  onClick={() => document.getElementById('sheet-attach-file-input')?.click()}
                >
                  <Paperclip size={18} className="mx-auto text-slate-400" />
                  <div className="mt-1 text-xs text-slate-600">
                    Drop images or PDFs here, or click to browse.
                  </div>
                  <input id="sheet-attach-file-input" type="file" accept="image/*,application/pdf" multiple className="hidden"
                    data-testid="sheet-attach-input"
                    onChange={async (e) => {
                      if (!asset?.id) return;
                      for (const f of Array.from(e.target.files || [])) {
                        const fd = new FormData(); fd.append('file', f);
                        try {
                          const r = await api.post(`/assets/${asset.id}/photos`, fd);
                          setAttachments((p) => [...p, ...(r.data?.photos || []).slice(-1)]);
                        } catch (err) { toast.error(apiError(err) || 'Upload failed'); }
                      }
                      e.target.value = '';
                    }} />
                </div>
                {attachments.length > 0 && (
                  <div className="grid grid-cols-4 gap-2 mt-2" data-testid="sheet-attach-grid">
                    {attachments.map((att, i) => (
                      <div key={att.id || i} className="relative aspect-square rounded overflow-hidden border border-slate-200 bg-slate-100">
                        <img src={att.photo_url ? `${att.photo_url}${att.photo_url.includes('?') ? '&' : '?'}token=${encodeURIComponent(localStorage.getItem('paneltec_token')||'')}` : ''}
                          alt={att.filename || 'attachment'}
                          className="w-full h-full object-cover"
                          onError={(e) => { e.target.style.display = 'none'; }} />
                      </div>
                    ))}
                  </div>
                )}
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
