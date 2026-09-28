// Forms Library — UI restyle (matches user reference screenshots).
// Page header with 4-button toolbar, redesigned template cards with action
// icons + Preview/Fill buttons, AI-builder modal, redesigned Fill-Out modal
// with coloured Yes/No/N-A radios + orange Submit, and Preview modal.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
// v58.12.3 — every modal in this file portals to document.body to escape
// the AppShell content-column's `relative z-40` stacking context. Without
// this, the sticky topbar (z-30) is painted above the modal backdrop
// (z-50) in Chromium — see /tmp/ttm_r1_fill.png + elementsFromPoint proof.
// Precedent: SubmissionViewer.jsx L162, UsersManagement.jsx L1626/1984/2487.
import { createPortal } from 'react-dom';
import { useNavigate, useLocation } from 'react-router-dom';
import SignatureCanvas from 'react-signature-canvas';
// v160.3.7k — Inoculation sweep: lock body scroll while any Forms modal
// (FillOut, Preview, Import, AiBuilder, SubmissionView) is open.
import useLockBodyScroll from '../lib/useLockBodyScroll';
import {
  Camera, CheckCircle2, Download, Eraser, FilePlus, FileText, Loader2, MapPin,
  Pencil, Phone, Plus, RefreshCw, Search, Share2, Sparkles, Trash2, Truck, Upload,
  UploadCloud, X, ChevronDown, ChevronRight, Gauge, ClipboardList, CheckCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../lib/api';
import { openAuthedFile } from '../lib/downloads';
import { getUser } from '../lib/auth';
import { useCan } from '../lib/permissions';
import { categoryColor } from '../lib/templateColors';
import TemplateBuilder from '../components/forms/TemplateBuilder';
import AssetScanField, { buildAutofillFromAsset } from '../components/forms/AssetScanField';
import { WorkerPicker, JobPicker, SitePicker, CustomerPicker } from '../components/forms/PickerFields';
// v58.13.132ig — Compliance question widget (Compliant / At Risk / N/A).
import ComplianceQuestion from '../components/forms/ComplianceQuestion';

// v160.3.9.29-2c — Legacy set retained; authoritative gate is useCan below.
const WRITE_ROLES = new Set(['admin', 'hseq_lead']);

// v58.13.132kp — Dismissible amber WHS reminder banner. Reappears once
// per week (7-day cool-off) so newly-onboarded workers still see it and
// long-term admins aren't nagged. Renders above the toolbar on the
// Forms Templates page for both admins and workers.
function WhsReminderBanner(_props) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    try {
      const raw = localStorage.getItem('whs_reminder_dismissed_at');
      if (!raw) { setVisible(true); return; }
      const then = Date.parse(raw);
      if (!Number.isFinite(then)) { setVisible(true); return; }
      const weekMs = 7 * 24 * 60 * 60 * 1000;
      setVisible(Date.now() - then > weekMs);
    } catch (_) { setVisible(true); }
  }, []);
  if (!visible) return null;
  const dismiss = () => {
    try { localStorage.setItem('whs_reminder_dismissed_at', new Date().toISOString()); } catch (_) {}
    setVisible(false);
  };
  return (
    <div
      data-testid="whs-reminder-banner"
      className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-start gap-3"
    >
      <span aria-hidden="true" className="text-amber-600 text-xl leading-6">⚠</span>
      <div className="flex-1 text-[13px] leading-snug text-amber-900">
        <div className="font-semibold mb-0.5">Australian WHS Reminder</div>
        <p>
          A <strong>White Card (Construction Induction)</strong> is required by law for anyone
          performing construction work in Australia. Certification gates are currently
          <span className="font-semibold"> DISABLED</span> in this platform, but workers must still
          hold current certifications before undertaking regulated work. See the
          <span className="font-semibold"> Access control</span> section on any template to re-enable
          in-app enforcement.
        </p>
      </div>
      <button
        type="button"
        onClick={dismiss}
        data-testid="whs-reminder-dismiss"
        className="p-1 -m-1 rounded hover:bg-amber-100 text-amber-700 shrink-0"
        title="Dismiss for 7 days"
      >
        ✕
      </button>
    </div>
  );
}

// Pastel pills per the new spec: tint background + ink text.
export const CATEGORIES = [
  { key: 'all',        label: 'All categories', pill: 'bg-slate-100 text-slate-700' },
  { key: 'incident',   label: 'Incident',       pill: 'bg-[#fde2e4] text-rose-700' },
  { key: 'inspection', label: 'Inspection',     pill: 'bg-[#dbeafe] text-blue-700' },
  { key: 'toolbox',    label: 'Toolbox',        pill: 'bg-[#fef3c7] text-amber-800' },
  { key: 'near_miss',  label: 'Near Miss',      pill: 'bg-[#fed7aa] text-orange-700' },
  { key: 'pre_start',  label: 'Pre-Start',      pill: 'bg-[#e0f2fe] text-sky-800' },
  { key: 'ssra',       label: 'SSRA',           pill: 'bg-[#ccfbf1] text-teal-800' },
  { key: 'general',    label: 'General',        pill: 'bg-[#e2e8f0] text-slate-700' },
  // v160.2.6-cat addendum #2 — 7th category, workers never see it.
  { key: 'admin',      label: 'Admin only',     pill: 'bg-slate-200 text-slate-600' },
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
    // v58.13.132jz — Also match Tick/Check/✓ (emerald) + Cross/Repair/✗/X (rose)
    // for the Service Check Sheet trinary widget.
    const isCheck = norm === 'yes'
      || norm.includes('✓') || norm.includes('tick')
      || norm.startsWith('check') || norm === '✓ check';
    const isCross = norm === 'no' || norm === 'defective' || norm.startsWith('fail')
      || norm.includes('✗') || norm.includes('cross')
      || norm.startsWith('repair') || norm === '✗ repair'
      || norm === 'x';
    if (isCheck) palette = selected
      ? 'bg-emerald-50 border-emerald-500 text-emerald-700 ring-2 ring-emerald-200'
      : 'bg-white border-emerald-300 text-emerald-700 hover:bg-emerald-50';
    else if (isCross) palette = selected
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

// v58.13.132kb — Strict inline row layout for Service-Check-Sheet-style
// checklists. When a `radio` field carries the trinary option set
// (✓ Check / ✗ Repair / N/A in any tick/cross/na variant) AND is
// immediately followed by a `text` field whose label matches
// `${radio.label} — notes`, we render them together on a single
// horizontal row: label · pill · pill · pill · notes. Row background
// tints to rose-50 / emerald-50 / slate-100 based on the selected pill.
//
// Applies only when the pattern is detected — every other radio + text
// pair in the codebase (Pre-starts, Toolbox, Incidents, etc.) keeps
// its default stacked ColouredRadioGroup rendering.
function isTrinaryChecklistRadio(f) {
  if (!f || f.type !== 'radio') return false;
  const opts = Array.isArray(f.options) ? f.options : [];
  if (opts.length !== 3) return false;
  let hasCheck = false, hasCross = false, hasNa = false;
  for (const o of opts) {
    const n = String(o).toLowerCase();
    if (n.includes('✓') || n.includes('tick') || n.startsWith('check') || n === 'yes') hasCheck = true;
    else if (n.includes('✗') || n.includes('cross') || n.startsWith('repair') || n === 'x' || n === 'no' || n.startsWith('fail')) hasCross = true;
    else if (n === 'n/a' || n === 'na' || n === 'not applicable') hasNa = true;
  }
  return hasCheck && hasCross && hasNa;
}
function findPairedNotesField(radio, allFields, idx) {
  const next = allFields[idx + 1];
  if (!next || next.type !== 'text') return null;
  const rl = String(radio.label || '').trim();
  const nl = String(next.label || '').trim();
  // Accept " — notes" (em-dash), " – notes" (en-dash), " - notes"
  const suffixOk = /^ ?[—–-] ?notes$/i.test(nl.slice(rl.length));
  return (nl.startsWith(rl) && suffixOk) ? next : null;
}
function classifyTrinaryOption(opt) {
  const n = String(opt || '').toLowerCase();
  if (n.includes('✓') || n.includes('tick') || n.startsWith('check') || n === 'yes') return 'check';
  if (n.includes('✗') || n.includes('cross') || n.startsWith('repair') || n === 'x' || n === 'no' || n.startsWith('fail')) return 'cross';
  if (n === 'n/a' || n === 'na' || n === 'not applicable') return 'na';
  return null;
}
function findTrinaryOption(field, kind) {
  return (field.options || []).find((o) => classifyTrinaryOption(o) === kind) || null;
}
function buildFieldRenderPlan(fields) {
  // Pass 1 — collapse radio + " — notes" pairs into inline checklist rows (.132kb).
  const flat = [];
  const skip = new Set();
  (fields || []).forEach((f, i) => {
    if (skip.has(f.id)) return;
    if (isTrinaryChecklistRadio(f)) {
      const notes = findPairedNotesField(f, fields, i);
      if (notes) {
        skip.add(notes.id);
        flat.push({ kind: 'checklist_row', id: f.id, radio: f, notes });
        return;
      }
    }
    flat.push({ kind: 'field', id: f.id, field: f });
  });
  // Pass 2 — fold section headers + subsequent block into collapsible
  // `section_group` nodes.
  //
  // v58.13.132kd1 — Fold EVERY section header, regardless of block
  // content type (checklist rows OR regular fields) UNLESS the header
  // label matches the "flat zone" regex — those render as ungrouped
  // regular section-styled fields (Vehicle Details, Service Level,
  // Consumables, Attachments, Sign-Off, etc.).
  const FLAT_ZONE_RE = /(vehicle details|service level|consumables|parts used|attachments|sign.?off|signatures|follow.?up)/i;
  const grouped = [];
  let i = 0;
  while (i < flat.length) {
    const e = flat[i];
    const cfg = (e.kind === 'field') ? (e.field.config || {}) : null;
    const label = (e.kind === 'field') ? (e.field.label || '') : '';
    const isHeader = e.kind === 'field' && cfg && cfg.section_header;
    const isFlatZone = isHeader && FLAT_ZONE_RE.test(label);
    if (isHeader && !isFlatZone) {
      let j = i + 1;
      const block = [];
      while (j < flat.length) {
        const nx = flat[j];
        const nxCfg = (nx.kind === 'field') ? (nx.field.config || {}) : null;
        if (nx.kind === 'field' && nxCfg && nxCfg.section_header) break;
        block.push(nx);
        j++;
      }
      if (block.length > 0) {
        const letterMatch = label.match(/^([A-K])\.\s/);
        const letter = letterMatch ? letterMatch[1] : null;
        let icon = null;
        if (/tread/i.test(label)) icon = 'gauge';
        else if (!letter) icon = 'clipboard';
        const key = cfg.sub_section
          || (letter ? `sub-${letter}` : `hdr-${(e.field.id || '').slice(0, 8)}`);
        // v58.13.132kd1 — Hide +ADD / ✓ALL when the section has no
        // trinary checklist rows (custom rows + fill-all only make
        // sense for trinary-radio sections).
        const hasTrinary = block.some((b) => b.kind === 'checklist_row');
        grouped.push({
          kind: 'section_group',
          key,
          header: e.field,
          letter,
          icon,
          entries: block,
          hasTrinary,
        });
        i = j;
        continue;
      }
    }
    grouped.push(e);
    i += 1;
  }
  return grouped;
}

// Row-level tint based on selected pill. Falls back to the field.style
// zebra background from .132jz when nothing is selected.
function checklistRowStateTint(selectedKind) {
  if (selectedKind === 'check') return { backgroundColor: '#ECFDF5', borderColor: '#10B981' }; // emerald-50 / 500
  if (selectedKind === 'cross') return { backgroundColor: '#FFF1F2', borderColor: '#F43F5E' }; // rose-50 / 500
  if (selectedKind === 'na') return { backgroundColor: '#F1F5F9', borderColor: '#64748B' };    // slate-100 / 500
  return null;
}

function InlineChecklistRow({
  radio, notes, radioValue, notesValue, onRadioChange, onNotesChange, readOnly,
}) {
  const optCheck = findTrinaryOption(radio, 'check');
  const optCross = findTrinaryOption(radio, 'cross');
  const optNa = findTrinaryOption(radio, 'na');
  const selectedKind = classifyTrinaryOption(radioValue);

  // Compose wrapper style: start from field.style (zebra + border from
  // .132jz), then override with state tint when a value is selected.
  const fs = radio.style || {};
  const baseStyle = {
    ...(fs.backgroundColor ? { backgroundColor: fs.backgroundColor } : null),
    ...(fs.borderColor ? { borderColor: fs.borderColor } : null),
    ...(fs.borderWidth !== undefined ? { borderWidth: `${fs.borderWidth}px`, borderStyle: fs.borderStyle || 'solid' } : null),
    ...(fs.borderRadius !== undefined ? { borderRadius: `${fs.borderRadius}px` } : null),
  };
  const stateTint = checklistRowStateTint(selectedKind);
  const wrapStyle = stateTint ? { ...baseStyle, ...stateTint, borderWidth: '1px', borderStyle: 'solid' } : baseStyle;

  const pillBase = 'inline-flex items-center justify-center h-9 min-w-[42px] px-2 rounded-md border text-sm font-bold transition-all disabled:opacity-60 disabled:cursor-not-allowed';
  const pillFor = (kind, isSelected) => {
    if (isSelected) {
      if (kind === 'check') return `${pillBase} bg-emerald-500 border-emerald-500 text-white shadow-sm`;
      if (kind === 'cross') return `${pillBase} bg-rose-500 border-rose-500 text-white shadow-sm`;
      if (kind === 'na')    return `${pillBase} bg-slate-600 border-slate-600 text-white shadow-sm`;
    }
    return `${pillBase} bg-white border-slate-200 text-slate-700 hover:bg-slate-50`;
  };
  const togglePill = (opt) => {
    if (readOnly) return;
    onRadioChange(radioValue === opt ? null : opt);
  };

  return (
    <div
      data-testid={`checklist-row-${radio.id}`}
      data-checklist-state={selectedKind || 'unset'}
      style={Object.keys(wrapStyle).length ? wrapStyle : undefined}
      className="grid grid-cols-1 md:grid-cols-12 gap-2 md:gap-3 items-center py-2 px-3 rounded-xl"
    >
      {/* Label — 40% on desktop */}
      <label
        htmlFor={`notes-${notes.id}`}
        className="md:col-span-5 text-sm font-semibold text-slate-800 leading-snug"
      >
        {radio.label}
        {radio.required && <span className="text-rose-600 ml-1">*</span>}
      </label>

      {/* Trinary pills — ~24% */}
      <div className="md:col-span-3 flex items-center gap-1.5" data-testid={`checklist-pills-${radio.id}`}>
        {optCross && (
          <button type="button" disabled={readOnly} onClick={() => togglePill(optCross)}
            data-testid={`checklist-cross-${radio.id}`}
            aria-pressed={selectedKind === 'cross'}
            className={pillFor('cross', selectedKind === 'cross')}>
            <span aria-hidden>✗</span>
          </button>
        )}
        {optCheck && (
          <button type="button" disabled={readOnly} onClick={() => togglePill(optCheck)}
            data-testid={`checklist-check-${radio.id}`}
            aria-pressed={selectedKind === 'check'}
            className={pillFor('check', selectedKind === 'check')}>
            <span aria-hidden>✓</span>
          </button>
        )}
        {optNa && (
          <button type="button" disabled={readOnly} onClick={() => togglePill(optNa)}
            data-testid={`checklist-na-${radio.id}`}
            aria-pressed={selectedKind === 'na'}
            className={pillFor('na', selectedKind === 'na')}>
            NA
          </button>
        )}
      </div>

      {/* Notes — 36% */}
      <div className="md:col-span-4">
        <input
          id={`notes-${notes.id}`}
          type="text"
          data-testid={`checklist-notes-${notes.id}`}
          value={notesValue || ''}
          onChange={(e) => onNotesChange(e.target.value)}
          disabled={readOnly}
          placeholder="Notes"
          className="w-full h-9 px-3 rounded-md border border-slate-200 bg-white text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400"
        />
      </div>
    </div>
  );
}

// v58.13.132kd — Collapsible section groups for Service Check Sheet.
// Palette per A-K letter; K wraps to amber (same as A) per .132jz backend.
const SCS_SECTION_PALETTE = {
  A: { badge: '#F59E0B', tint: '#FFFBEB', accent: '#F59E0B' }, // amber
  B: { badge: '#0EA5E9', tint: '#F0F9FF', accent: '#0EA5E9' }, // sky
  C: { badge: '#06B6D4', tint: '#ECFEFF', accent: '#06B6D4' }, // cyan
  D: { badge: '#8B5CF6', tint: '#F5F3FF', accent: '#8B5CF6' }, // violet
  E: { badge: '#10B981', tint: '#ECFDF5', accent: '#10B981' }, // emerald
  F: { badge: '#F43F5E', tint: '#FFF1F2', accent: '#F43F5E' }, // rose
  G: { badge: '#6366F1', tint: '#EEF2FF', accent: '#6366F1' }, // indigo
  H: { badge: '#3B82F6', tint: '#EFF6FF', accent: '#3B82F6' }, // blue
  I: { badge: '#14B8A6', tint: '#F0FDFA', accent: '#14B8A6' }, // teal
  J: { badge: '#64748B', tint: '#F8FAFC', accent: '#64748B' }, // slate
  K: { badge: '#F59E0B', tint: '#FFFBEB', accent: '#F59E0B' },
};
const SCS_NEUTRAL_PALETTE = { badge: '#64748B', tint: '#F8FAFC', accent: '#64748B' };

function paletteForSection(group) {
  if (group.letter && SCS_SECTION_PALETTE[group.letter]) return SCS_SECTION_PALETTE[group.letter];
  // Try to read backend-provided colours from the header's style
  const st = group.header?.style || {};
  if (st.borderColor && st.backgroundColor) {
    return { badge: st.borderColor, tint: st.backgroundColor, accent: st.borderColor };
  }
  return SCS_NEUTRAL_PALETTE;
}

// Compute section status pill from the entries + current values.
function computeSectionStatus(entries, values) {
  let total = 0;
  let answered = 0;
  let anyCross = false;
  for (const en of entries) {
    if (en.kind === 'checklist_row') {
      total += 1;
      const v = values[en.radio.id];
      const kind = classifyTrinaryOption(v);
      if (kind === 'cross') anyCross = true;
      if (kind) answered += 1;
    } else if (en.kind === 'field') {
      const t = en.field.type;
      // Only count measurement / textarea / number as "counting" fields.
      if (t === 'number' || t === 'text' || t === 'textarea' || t === 'select' || t === 'date') {
        total += 1;
        const v = values[en.field.id];
        if (v !== undefined && v !== null && v !== '') answered += 1;
      }
    }
  }
  if (anyCross) return { key: 'ATTENTION', bg: '#FEE2E2', fg: '#B91C1C' };
  if (total === 0) return { key: 'NOT STARTED', bg: '#F1F5F9', fg: '#64748B' };
  if (answered === 0) return { key: 'NOT STARTED', bg: '#F1F5F9', fg: '#64748B' };
  if (answered < total) return { key: 'IN PROGRESS', bg: '#FEF3C7', fg: '#B45309' };
  return { key: 'COMPLETE', bg: '#D1FAE5', fg: '#047857' };
}

// sessionStorage-backed expansion state. Fresh session → all collapsed.
function useSectionExpansion(templateId) {
  const storageKey = `scs-expansion-${templateId || 'default'}`;
  const [openKeys, setOpenKeys] = React.useState(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch { return new Set(); }
  });
  const persist = React.useCallback((next) => {
    try { sessionStorage.setItem(storageKey, JSON.stringify(Array.from(next))); } catch {}
  }, [storageKey]);
  const toggle = React.useCallback((key) => {
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      persist(next);
      return next;
    });
  }, [persist]);
  const setAll = React.useCallback((keys, isOpen) => {
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (isOpen) keys.forEach((k) => next.add(k));
      else keys.forEach((k) => next.delete(k));
      persist(next);
      return next;
    });
  }, [persist]);
  return { openKeys, toggle, setAll };
}

function CollapsibleSectionGroup({
  group, expanded, onToggle, values, setField, readOnly,
  customRows, addCustomRow, updateCustomRow, deleteCustomRow, markAllChecked,
}) {
  const palette = paletteForSection(group);
  const customRowsForKey = customRows[group.key] || [];
  // Include synthetic entries for status computation
  const entriesForStatus = React.useMemo(() => {
    const extra = customRowsForKey.map((r) => ({
      kind: 'checklist_row',
      radio: { id: `custom-answer-${r.id}` },
      notes: { id: `custom-notes-${r.id}` },
    }));
    return [...group.entries, ...extra];
  }, [group.entries, customRowsForKey]);
  const status = computeSectionStatus(entriesForStatus, values);

  // Strip the leading letter prefix from the label since we render the badge separately.
  const displayLabel = React.useMemo(() => {
    const raw = group.header?.label || '';
    if (group.letter) return raw.replace(/^[A-K]\.\s*/, '');
    return raw.replace(/^▪\s*/, '');
  }, [group.header, group.letter]);

  // ✓ ALL handler — fill every empty trinary in this section with the check option.
  const handleCheckAll = (e) => {
    e.stopPropagation();
    if (readOnly) return;
    let filled = 0;
    for (const en of group.entries) {
      if (en.kind === 'checklist_row') {
        const current = values[en.radio.id];
        if (!current) {
          const checkOpt = findTrinaryOption(en.radio, 'check');
          if (checkOpt) { setField(en.radio.id, checkOpt); filled += 1; }
        }
      }
    }
    for (const r of customRowsForKey) {
      if (!r.value) {
        markAllChecked(group.key, r.id, '✓ Check');
        filled += 1;
      }
    }
    if (filled > 0) toast.success(`${filled} item${filled === 1 ? '' : 's'} marked ✓`);
  };

  const handleAddCustom = (e) => {
    e.stopPropagation();
    if (readOnly) return;
    addCustomRow(group.key);
  };

  return (
    <div
      data-testid={`section-group-${group.key}`}
      data-section-status={status.key}
      className="rounded-xl border overflow-hidden mb-3"
      style={{
        backgroundColor: expanded ? '#FFFFFF' : palette.tint,
        borderColor: palette.accent + '55',
        borderLeftWidth: '4px',
        borderLeftColor: palette.accent,
      }}
    >
      {/* Header row (click to toggle) */}
      <button
        type="button"
        onClick={onToggle}
        data-testid={`section-toggle-${group.key}`}
        className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-black/[0.02] transition-colors"
      >
        {/* Chevron */}
        <span className="flex-shrink-0 text-slate-500">
          {expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        </span>
        {/* Letter badge OR icon */}
        {group.letter ? (
          <span
            data-testid={`section-badge-${group.key}`}
            className="flex-shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-md font-black text-sm text-white shadow-sm"
            style={{ backgroundColor: palette.badge }}
          >
            {group.letter}
          </span>
        ) : group.icon === 'gauge' ? (
          <span className="flex-shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-md text-white shadow-sm"
            style={{ backgroundColor: palette.badge }}>
            <Gauge size={16} />
          </span>
        ) : group.icon === 'clipboard' ? (
          <span className="flex-shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-md text-white shadow-sm"
            style={{ backgroundColor: palette.badge }}>
            <ClipboardList size={16} />
          </span>
        ) : null}
        {/* Label */}
        <span className="flex-1 min-w-0 text-sm sm:text-base font-bold text-slate-800 truncate">
          {displayLabel}
        </span>
        {/* Status pill */}
        <span
          data-testid={`section-status-${group.key}`}
          className="hidden sm:inline-flex items-center justify-center px-2.5 py-0.5 rounded-full text-[10px] font-black tracking-wider uppercase"
          style={{ backgroundColor: status.bg, color: status.fg }}
        >
          {status.key}
        </span>
        {/* + ADD (trinary-only sections) */}
        {!readOnly && group.hasTrinary && (
          <span
            role="button" tabIndex={0}
            data-testid={`section-add-${group.key}`}
            onClick={handleAddCustom}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleAddCustom(e); }}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-black tracking-wider uppercase bg-violet-100 text-violet-700 hover:bg-violet-200 cursor-pointer"
          >
            <Plus size={12} /> ADD
          </span>
        )}
        {/* ✓ ALL (trinary-only sections) */}
        {!readOnly && group.hasTrinary && (
          <span
            role="button" tabIndex={0}
            data-testid={`section-check-all-${group.key}`}
            onClick={handleCheckAll}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleCheckAll(e); }}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-black tracking-wider uppercase bg-emerald-100 text-emerald-700 hover:bg-emerald-200 cursor-pointer"
          >
            <CheckCheck size={12} /> ALL
          </span>
        )}
      </button>
      {/* Body */}
      {expanded && (
        <div data-testid={`section-body-${group.key}`} className="px-2 pb-2 pt-1 space-y-1.5">
          {group.entries.map((en) => {
            if (en.kind === 'checklist_row') {
              const r = en.radio, n = en.notes;
              return (
                <InlineChecklistRow key={r.id} radio={r} notes={n}
                  radioValue={values[r.id]} notesValue={values[n.id]}
                  onRadioChange={(v) => setField(r.id, v)}
                  onNotesChange={(v) => setField(n.id, v)}
                  readOnly={readOnly} />
              );
            }
            // Regular field inside a collapsible section (e.g. tread numbers)
            return (
              <div key={en.field.id} className="px-3 py-2 bg-white/70 rounded-lg">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {en.field.label}
                  {en.field.required && <span className="text-rose-600 ml-1">*</span>}
                </label>
                <FieldRunner field={en.field} value={values[en.field.id]}
                  onChange={(v) => setField(en.field.id, v)} readOnly={readOnly} />
              </div>
            );
          })}
          {/* Custom rows added via + ADD */}
          {customRowsForKey.map((row) => (
            <CustomChecklistRow key={row.id}
              sectionKey={group.key} row={row}
              onLabelChange={(newLabel) => updateCustomRow(group.key, row.id, { label: newLabel })}
              onValueChange={(v) => updateCustomRow(group.key, row.id, { value: v })}
              onNotesChange={(v) => updateCustomRow(group.key, row.id, { notes: v })}
              onDelete={() => deleteCustomRow(group.key, row.id)}
              readOnly={readOnly} />
          ))}
        </div>
      )}
    </div>
  );
}

function CustomChecklistRow({ sectionKey, row, onLabelChange, onValueChange, onNotesChange, onDelete, readOnly }) {
  const [editing, setEditing] = React.useState(!row.label);
  const [draft, setDraft] = React.useState(row.label || '');
  const commit = () => {
    setEditing(false);
    if (draft !== row.label) onLabelChange(draft);
  };
  const selectedKind = classifyTrinaryOption(row.value);
  const stateTint = checklistRowStateTint(selectedKind);
  const wrapStyle = stateTint ? { ...stateTint, borderWidth: '1px', borderStyle: 'solid' } : {};
  const pillBase = 'inline-flex items-center justify-center h-9 min-w-[42px] px-2 rounded-md border text-sm font-bold transition-all disabled:opacity-60';
  const pillCls = (kind) => {
    const selected = selectedKind === kind;
    if (selected) {
      if (kind === 'check') return `${pillBase} bg-emerald-500 border-emerald-500 text-white shadow-sm`;
      if (kind === 'cross') return `${pillBase} bg-rose-500 border-rose-500 text-white shadow-sm`;
      return `${pillBase} bg-slate-600 border-slate-600 text-white shadow-sm`;
    }
    return `${pillBase} bg-white border-slate-200 text-slate-700 hover:bg-slate-50`;
  };
  const toggle = (opt, kind) => {
    if (readOnly) return;
    onValueChange(row.value === opt ? null : opt);
  };
  return (
    <div
      data-testid={`custom-row-${row.id}`}
      style={Object.keys(wrapStyle).length ? wrapStyle : undefined}
      className="grid grid-cols-1 md:grid-cols-12 gap-2 md:gap-3 items-center py-2 px-3 rounded-xl group"
    >
      <div className="md:col-span-5 flex items-center gap-2 min-w-0">
        {editing ? (
          <input autoFocus type="text" value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
            placeholder="Custom item…"
            className="flex-1 h-8 px-2 rounded-md border border-violet-300 bg-white text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-200"
            data-testid={`custom-label-input-${row.id}`} />
        ) : (
          <button type="button" onClick={() => !readOnly && setEditing(true)}
            className="flex-1 text-left text-sm font-semibold text-slate-800 leading-snug hover:text-violet-700 min-w-0 truncate"
            data-testid={`custom-label-${row.id}`}>
            {row.label || <span className="italic text-slate-400">Custom item…</span>}
          </button>
        )}
        {!readOnly && (
          <button type="button" onClick={onDelete}
            className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-rose-600 transition-opacity"
            data-testid={`custom-delete-${row.id}`}
            title="Delete custom item">
            <X size={14} />
          </button>
        )}
      </div>
      <div className="md:col-span-3 flex items-center gap-1.5">
        <button type="button" disabled={readOnly} onClick={() => toggle('✗ Repair', 'cross')}
          className={pillCls('cross')} data-testid={`custom-cross-${row.id}`}>✗</button>
        <button type="button" disabled={readOnly} onClick={() => toggle('✓ Check', 'check')}
          className={pillCls('check')} data-testid={`custom-check-${row.id}`}>✓</button>
        <button type="button" disabled={readOnly} onClick={() => toggle('N/A', 'na')}
          className={pillCls('na')} data-testid={`custom-na-${row.id}`}>NA</button>
      </div>
      <div className="md:col-span-4">
        <input type="text" value={row.notes || ''} placeholder="Notes"
          disabled={readOnly}
          onChange={(e) => onNotesChange(e.target.value)}
          data-testid={`custom-notes-${row.id}`}
          className="w-full h-9 px-3 rounded-md border border-slate-200 bg-white text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400" />
      </div>
    </div>
  );
}

// Vehicle (Navixy) — searchable dropdown of org's fleet trackers. When a
// sibling `select` field labelled "Vehicle Type" / "Plant Type" /
// "Equipment Type" is filled in, the fleet list filters to vehicles whose
// derived `vehicle_type` slug matches the selected option.
function VehicleNavixyField({ field, value, onChange, readOnly, allFields, allValues, templateName }) {
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  // v58.13.132ic — SSRA-family templates render the vehicle field as
  // a plain HTML `<select>` per Stephen's brief. Keeps the same fleet
  // source + local-fleet-fallback + manual-entry escape hatch — just
  // trades the search+pick list for a native dropdown.
  const isSsra = /ssra|site[\s_-]*specific[\s_-]*risk/i.test(templateName || '');
  // v58.13.132gx Phase 4 — Backend now returns `status:
  // "navixy_disconnected"` with an actionable `message` when the
  // Navixy hash has expired + can't auto-refresh. Surface as an
  // amber banner instead of a red error so workers see it as a
  // "contact your admin" hint rather than a broken form.
  const [disconnectedMsg, setDisconnectedMsg] = useState(null);
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState(value?.navixy_id === null && value?.registration ? 'manual' : 'list');
  const [manualReg, setManualReg] = useState(value?.registration || '');
  const [filterDisabled, setFilterDisabled] = useState(false);

  useEffect(() => {
    if (readOnly) return;
    setLoading(true);
    api.get('/forms/fleet/vehicles')
      .then((r) => {
        setVehicles(r.data?.vehicles || []);
        // v58.13.132ho — Treat `navixy_disconnected` AND
        // `navixy_unavailable` as the same soft-response class.
        // v58.13.132hw — Backend now returns `local_fleet_fallback`
        // whenever Navixy is unreachable AND the local Fleet
        // Register has vehicles. Treat it as "everything's fine,
        // just show an info chip" — DON'T flip to manual mode,
        // the dropdown is populated from db.assets.
        const status = r.data?.status;
        const soft = status === 'navixy_disconnected'
          || status === 'navixy_unavailable';
        if (status === 'local_fleet_fallback') {
          setDisconnectedMsg(r.data?.message || null);
          // Stay in dropdown mode; vehicles list is already populated.
        } else if (soft) {
          setDisconnectedMsg(r.data?.message || 'Fleet integration needs reconnecting.');
          // Nudge worker into manual-entry mode so the form isn't
          // blocked while an admin fixes the integration.
          setMode('manual');
        } else {
          setDisconnectedMsg(null);
        }
      })
      .catch((e) => {
        // v58.13.132ho — Network / 5xx from our own API layer
        // (rare after the backend soft-response, but keep the
        // belt): also degrade to manual-entry with an amber
        // banner so the worker can still submit. Never leaves
        // the picker in a red-error dead-end.
        setDisconnectedMsg(
          'Fleet integration is temporarily unreachable. You can still enter the rego manually below.',
        );
        setMode('manual');
        setError(null);
        // Log the raw error to help the admin trace the incident
        // without surfacing it to the worker.
        // eslint-disable-next-line no-console
        console.warn('[vehicle_navixy] fleet fetch failed:', apiError(e));
      })
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
          {/* v58.13.132gx Phase 4 — Navixy-disconnected soft-response. */}
          {disconnectedMsg && (
            <div
              className="text-xs text-amber-900 bg-amber-50 border border-amber-300 px-2.5 py-1.5 rounded-lg flex items-start gap-2"
              data-testid={`vehicle-navixy-disconnected-${field.id}`}
            >
              <span>⚠️ {disconnectedMsg} You can still enter the rego manually below.</span>
            </div>
          )}
          {error && <div className="text-xs text-rose-600">{error}</div>}
          {!error && isSsra ? (
            // v58.13.132ic — SSRA templates: native <select>.
            <select
              value=""
              onChange={(e) => {
                const id = e.target.value;
                if (!id) return;
                const v = vehicles.find((x) => String(x.id) === String(id));
                if (v) onChange({ navixy_id: v.id, label: v.label || null, registration: v.plate || '' });
              }}
              data-testid={`vehicle-select-${field.id}`}
              className="w-full px-3 py-2 min-h-[44px] border border-slate-300 rounded-xl text-sm bg-white"
            >
              <option value="">
                {loading ? 'Loading fleet…'
                  : filtered.length === 0
                    ? (filterSlug ? `No "${siblingTypeValue}" vehicles match` : 'No vehicles available')
                    : `Select a vehicle (${filtered.length})…`}
              </option>
              {filtered.map((v) => (
                <option key={v.id} value={v.id} data-testid={`vehicle-select-opt-${v.id}`}>
                  {v.label || 'Vehicle'}{v.plate ? ` — ${v.plate}` : ''}
                </option>
              ))}
            </select>
          ) : (!error && (
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
          ))}
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

export function FieldRunner({ field, value, onChange, photoFiles, onPhotoChange, readOnly, allFields, allValues, submissionId, onStageChange, templateName, complianceStagedPhotos, onComplianceStagePhotos, onComplianceUnstagePhoto }) {
  if (field.type === 'reference_matrix') {
    const { ReferenceMatrixField } = require('../components/forms/BydaFields');
    return <ReferenceMatrixField field={field} />;
  }
  if (field.type === 'attachment') {
    const { AttachmentField } = require('../components/forms/BydaFields');
    return <AttachmentField field={field} value={value} submissionId={submissionId} readOnly={readOnly} onStageChange={onStageChange}
      previewSourceFor={(att) => ({
        source: 'submission_attachment',
        ref: { submission_id: submissionId, stored_name: att.stored_name },
      })} />;
  }
  if (field.type === 'actions') {
    const { ActionsField } = require('../components/forms/BydaFields');
    return <ActionsField field={field} value={value} onChange={onChange} readOnly={readOnly} />;
  }
  if (field.type === 'photo') return <PhotoField field={field} files={photoFiles} onChange={onPhotoChange} readOnly={readOnly} />;
  if (field.type === 'signature') return <SignatureField field={field} value={value} onChange={onChange} readOnly={readOnly} />;
  if (field.type === 'gps') return <GpsField field={field} value={value} onChange={onChange} readOnly={readOnly} />;
  if (field.type === 'vehicle_navixy')
    return <VehicleNavixyField field={field} value={value} onChange={onChange} readOnly={readOnly}
      allFields={allFields} allValues={allValues} templateName={templateName} />;
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
  // v58.13.132ig / .132ih — First-class Compliant / At Risk / N/A question widget.
  if (field.type === 'compliance')
    return <ComplianceQuestion
      field={field} value={value} onChange={onChange} readOnly={readOnly}
      stagedPhotos={complianceStagedPhotos || []}
      onStagePhotos={onComplianceStagePhotos}
      onUnstagePhoto={onComplianceUnstagePhoto}
    />;
  if (field.type === 'date')
    return <input type="date" value={value || ''} onChange={(e) => onChange(e.target.value)} disabled={readOnly}
      data-testid={`field-${field.id}`}
      className="w-full px-3 py-3 min-h-[44px] border border-slate-300 rounded-xl text-sm bg-white disabled:bg-slate-50 disabled:text-slate-500" />;
  if (field.type === 'number')
    return <input type="number" inputMode="decimal" value={value ?? ''} placeholder={field.placeholder} disabled={readOnly}
      onChange={(e) => onChange(e.target.value)} data-testid={`field-${field.id}`}
      className="w-full px-3 py-3 min-h-[44px] border border-slate-300 rounded-xl text-sm bg-white disabled:bg-slate-50 disabled:text-slate-500" />;
  // v160.3.9.4 — plain-text / `time` fallthrough with three opt-in configs:
  //   config.uppercase: true   → force uppercase on every keystroke
  //                              (vehicle rego, ID codes)
  //   config.keyboard: 'phone-pad' → renders as <input type="tel"
  //                              inputMode="tel"> for mobile keypad
  //   (no config)              → identical behaviour to pre-v160.3.9.4
  const cfg = field.config || {};
  const inputType = cfg.keyboard === 'phone-pad' ? 'tel' : 'text';
  const inputMode = cfg.keyboard === 'phone-pad' ? 'tel' : undefined;
  const handleChange = (e) => {
    let v = e.target.value;
    if (cfg.uppercase && typeof v === 'string') v = v.toUpperCase();
    onChange(v);
  };
  return <input type={inputType} inputMode={inputMode} value={value || ''} placeholder={field.placeholder} disabled={readOnly}
    onChange={handleChange} data-testid={`field-${field.id}`}
    className="w-full px-3 py-3 min-h-[44px] border border-slate-300 rounded-xl text-sm bg-white disabled:bg-slate-50 disabled:text-slate-500" />;
}

// ─────────────── Fill-Out modal ───────────────

// Shape-aware validator. Re-exported here for legacy imports — canonical
// implementation lives in `src/lib/isAnswerValid.js` (so the unit-test suite
// can import it without dragging in this whole page module).
import { isAnswerValid } from '../lib/isAnswerValid';
// v58.12.2 — Cross-field validator for the `actions` field. See BydaFields.jsx.
import { actionsFieldErrors } from '../components/forms/BydaFields';
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
  useLockBodyScroll();
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
    // v160.3.9.4 — `time` fields with `config.default_now: true` prefill to
    // HH:MM at render time (visitor sign-in "Time in"). Editable — same
    // pattern as `date.default_today`.
    const nowTime = `${String(today.getHours()).padStart(2, '0')}:${String(today.getMinutes()).padStart(2, '0')}`;
    (template.fields || []).forEach((f) => {
      if (f.type === 'date' && !base[f.id]) base[f.id] = isoDate;
      if (f.type === 'time' && f.config?.default_now && !base[f.id]) base[f.id] = nowTime;
    });
    return base;
  });
  const [photoFiles, setPhotoFiles] = useState({});
  // v58.12.4 — staged attachments, keyed by field.id. Same shape as
  // photoFiles: each value is an array of { tempId, file, name, description,
  // mime, size } coming from AttachmentField's `onStageChange`. Uploaded
  // AFTER the submission POST returns (see submit() below).
  const [attachmentFiles, setAttachmentFiles] = useState({});
  // v58.13.132ih — staged per-question photos for `compliance` fields.
  // Keyed by field.id → File[]. Uploaded AFTER submission POST, same
  // endpoint (`/forms/submissions/{id}/photos`) which now accepts both
  // `photo` and `compliance` target fields.
  const [compliancePhotoFiles, setCompliancePhotoFiles] = useState({});
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
  // v58.13.132kd — Section expansion (sessionStorage-backed) + custom
  // checklist rows added via the section header's "+ ADD" button.
  const sectionExpansion = useSectionExpansion(template?.id);
  const [customChecklistRows, setCustomChecklistRows] = useState(() => {
    // Rehydrate from values if a prior draft stashed them under this key.
    try {
      const raw = values.__custom_checklist_rows__;
      return raw && typeof raw === 'object' ? raw : {};
    } catch { return {}; }
  });
  // Persist custom rows into `values` so they ride along with draft
  // autosave + submission serialisation.
  useEffect(() => {
    setValues((p) => ({ ...p, __custom_checklist_rows__: customChecklistRows }));
  }, [customChecklistRows]);
  const addCustomRow = useCallback((sectionKey) => {
    setDirty(true);
    setCustomChecklistRows((p) => {
      const list = p[sectionKey] || [];
      const id = `${sectionKey}-${Date.now().toString(36)}-${list.length}`;
      return { ...p, [sectionKey]: [...list, { id, label: '', value: null, notes: '' }] };
    });
  }, []);
  const updateCustomRow = useCallback((sectionKey, rowId, patch) => {
    setDirty(true);
    setCustomChecklistRows((p) => {
      const list = (p[sectionKey] || []).map((r) => (r.id === rowId ? { ...r, ...patch } : r));
      return { ...p, [sectionKey]: list };
    });
  }, []);
  const deleteCustomRow = useCallback((sectionKey, rowId) => {
    setDirty(true);
    setCustomChecklistRows((p) => {
      const list = (p[sectionKey] || []).filter((r) => r.id !== rowId);
      return { ...p, [sectionKey]: list };
    });
  }, []);
  const markCustomChecked = useCallback((sectionKey, rowId, value) => {
    updateCustomRow(sectionKey, rowId, { value });
  }, [updateCustomRow]);
  const setPhotoField = useCallback((fid, files) => {
    setDirty(true);
    setTouched((p) => ({ ...p, [fid]: true }));
    setPhotoFiles((p) => ({ ...p, [fid]: files }));
  }, []);
  // v58.13.132ih — Compliance-question staged photos. Append-only from
  // the widget; unstage removes a File by index.
  const stageCompliancePhotos = useCallback((fid, files) => {
    setDirty(true);
    setTouched((p) => ({ ...p, [fid]: true }));
    setCompliancePhotoFiles((p) => ({
      ...p, [fid]: [...(p[fid] || []), ...files],
    }));
  }, []);
  const unstageCompliancePhoto = useCallback((fid, idx) => {
    setDirty(true);
    setCompliancePhotoFiles((p) => {
      const next = [...(p[fid] || [])];
      next.splice(idx, 1);
      return { ...p, [fid]: next };
    });
  }, []);

  const missingFields = useMemo(() => (template.fields || []).filter((f) => {
    if (!f.required) return false;
    return !isAnswerValid(f, values[f.id], photoFiles[f.id]);
  }), [template.fields, values, photoFiles]);
  // v58.12.2 — `actions` field: Closed rows without a date_closed
  // block submit regardless of `f.required`. See BydaFields.jsx.
  const actionsErrors = useMemo(() => {
    const out = [];
    (template.fields || []).forEach((f) => {
      if (f.type !== 'actions') return;
      actionsFieldErrors(f, values[f.id]).forEach((e) => out.push({
        fieldId: f.id, fieldLabel: f.label, rowIndex: e.rowIndex,
      }));
    });
    return out;
  }, [template.fields, values]);
  const requiredOk = missingFields.length === 0 && actionsErrors.length === 0;

  // v160.1.5 — Show inline red-border + "This field is required" text only
  // AFTER the user has attempted to submit. Editing any field that was
  // previously missing removes it from `missingFields` (derived above),
  // which automatically clears the visual error without extra state.
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const missingIds = useMemo(
    () => new Set(missingFields.map((f) => f.id)),
    [missingFields],
  );

  // v58.13.132kd — Regular-field renderer extracted so it can be
  // reused both at top level AND inside CollapsibleSectionGroup.
  const renderRegularField = (entry) => {
    const f = entry.field;
    const isLocked = !!lockedFields[f.id];
    const hasErr = submitAttempted && missingIds.has(f.id);
    const fs = f.style || {};
    const styleWrap = {
      ...(fs.backgroundColor ? { backgroundColor: fs.backgroundColor } : null),
      ...(fs.borderColor ? { borderColor: fs.borderColor } : null),
      ...(fs.borderWidth !== undefined
        ? { borderWidth: `${fs.borderWidth}px`, borderStyle: fs.borderStyle || 'solid' }
        : null),
      ...(fs.borderStyle && fs.borderWidth === undefined
        ? { borderStyle: fs.borderStyle }
        : null),
      ...(fs.borderRadius !== undefined ? { borderRadius: `${fs.borderRadius}px` } : null),
      ...(fs.paddingX !== undefined ? { paddingLeft: `${fs.paddingX}px`, paddingRight: `${fs.paddingX}px` } : null),
      ...(fs.paddingY !== undefined ? { paddingTop: `${fs.paddingY}px`, paddingBottom: `${fs.paddingY}px` } : null),
    };
    const hasCustomStyle = Object.keys(styleWrap).length > 0;
    const wrapClass = hasErr
      ? 'rounded-xl border-2 border-rose-500 bg-rose-50/40 p-3 -mx-1'
      : (hasCustomStyle ? 'rounded-xl border p-3 transition-colors' : '');
    const hoverCss = fs.hoverBackgroundColor
      ? `[data-field-style-id="${f.id}"]:hover{background-color:${fs.hoverBackgroundColor} !important;}`
      : '';
    const labelStyle = {
      ...(fs.labelColor ? { color: fs.labelColor } : null),
      ...(fs.labelBold ? { fontWeight: 700 } : null),
      ...(fs.labelSize === 'sm' ? { fontSize: '0.75rem' } : null),
      ...(fs.labelSize === 'lg' ? { fontSize: '1rem' } : null),
    };
    let iconGlyph = null;
    if (fs.icon) {
      if (fs.icon.startsWith('emoji:')) iconGlyph = fs.icon.slice('emoji:'.length);
      else iconGlyph = fs.icon;
    }
    return (
      <div key={f.id} data-testid={`field-row-${f.id}`}
        data-field-style-id={hasCustomStyle || hoverCss ? f.id : undefined}
        style={hasCustomStyle ? styleWrap : undefined}
        className={wrapClass}>
        {hoverCss && (
          <style dangerouslySetInnerHTML={{ __html: hoverCss }} />
        )}
        <label className="flex items-center gap-2 text-sm font-semibold text-slate-800 mb-1.5"
          style={Object.keys(labelStyle).length ? labelStyle : undefined}>
          {iconGlyph && (
            <span aria-hidden data-testid={`field-icon-${f.id}`} className="inline-block">
              {iconGlyph}
            </span>
          )}
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
          onStageChange={(fid, files) => setAttachmentFiles((prev) => ({ ...prev, [fid]: files }))}
          complianceStagedPhotos={compliancePhotoFiles[f.id]}
          onComplianceStagePhotos={(files) => stageCompliancePhotos(f.id, files)}
          onComplianceUnstagePhoto={(idx) => unstageCompliancePhoto(f.id, idx)}
          allFields={template.fields || []}
          allValues={values}
          templateName={template.name}
          readOnly={isLocked} />
        {hasErr && (
          <div data-testid={`field-error-${f.id}`}
            className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-rose-600">
            <span aria-hidden>⚠</span>
            <span>This field is required</span>
          </div>
        )}
      </div>
    );
  };

  const onSubmitClick = () => {
    if (!requiredOk) {
      setSubmitAttempted(true);
      // v58.12.2 — actions-field errors take precedence over
      // missing-required so the operator sees the row-level fix
      // hint (they'd have already filled the field to trigger it).
      if (actionsErrors.length > 0) {
        const first = actionsErrors[0];
        const node = document.querySelector(`[data-testid="field-row-${first.fieldId}"]`);
        if (node) {
          node.scrollIntoView({ behavior: 'smooth', block: 'center' });
          node.classList.add('paneltec-field-missing-pulse');
          setTimeout(() => node.classList.remove('paneltec-field-missing-pulse'), 1500);
        }
        toast.error(
          `"${first.fieldLabel}" — row ${first.rowIndex + 1}: Status = Closed requires Date closed`,
        );
        return;
      }
      const first = missingFields[0];
      const node = document.querySelector(`[data-testid="field-row-${first.id}"]`);
      if (node) {
        node.scrollIntoView({ behavior: 'smooth', block: 'center' });
        node.classList.add('paneltec-field-missing-pulse');
        setTimeout(() => node.classList.remove('paneltec-field-missing-pulse'), 1500);
      }
      // Enumerate up to three missing labels in the toast for a quick
      // hint; the persistent banner above the form covers the full list.
      toast.error(
        `Please complete: ${missingFields.slice(0, 3).map((f) => f.label).join(', ')}${missingFields.length > 3 ? ` +${missingFields.length - 3} more` : ''}`
      );
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
        await api.post(`/forms/submissions/${sub.id}/photos`, fd);
      }
      // v58.13.132ih — Compliance-question staged photos share the
      // /photos endpoint. Same field_id + files shape; server routes
      // the write into `value.photos` (dict) instead of `value` (list).
      const complianceFieldIds = Object.keys(compliancePhotoFiles)
        .filter((fid) => (compliancePhotoFiles[fid] || []).length > 0);
      for (let i = 0; i < complianceFieldIds.length; i++) {
        const fid = complianceFieldIds[i];
        setProgress(`Uploading compliance photos (${i + 1}/${complianceFieldIds.length})…`);
        const fd = new FormData();
        fd.append('field_id', fid);
        (compliancePhotoFiles[fid] || []).forEach((file) => fd.append('files', file));
        try {
          await api.post(`/forms/submissions/${sub.id}/photos`, fd);
        } catch (err) {
          toast.error(`Compliance photo upload failed`, {
            description: err?.response?.data?.detail || err?.message || 'Upload failed',
          });
        }
      }
      // v58.12.4 — attachment upload loop mirrors the photo loop above.
      // Best-effort per file: individual failure toasts but never rolls
      // back the submission (matches photo semantic).
      const attachmentFieldIds = Object.keys(attachmentFiles).filter((fid) => (attachmentFiles[fid] || []).length > 0);
      const totalAtt = attachmentFieldIds.reduce((n, fid) => n + (attachmentFiles[fid] || []).length, 0);
      let doneAtt = 0;
      for (const fid of attachmentFieldIds) {
        for (const staged of (attachmentFiles[fid] || [])) {
          doneAtt += 1;
          setProgress(`Uploading attachments (${doneAtt}/${totalAtt})…`);
          const fd = new FormData();
          fd.append('field_id', fid);
          fd.append('files', staged.file);
          fd.append('names', staged.name || '');
          fd.append('descriptions', staged.description || '');
          try {
            await api.post(`/forms/submissions/${sub.id}/attachments`, fd);
          } catch (err) {
            toast.error(`Attachment "${staged.name || staged.file?.name || 'file'}" failed`, {
              description: err?.response?.data?.detail || err?.message || 'Upload failed',
            });
          }
        }
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

  return createPortal(
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
        {/* v160.1.5 — Persistent missing-fields banner. Appears after
            the first failed submit and lists every required field that
            still needs a value. Clicking the pill scrolls to that
            field. Auto-hides when the last missing field is filled. */}
        {submitAttempted && missingFields.length > 0 && (
          <div
            data-testid="missing-fields-banner"
            className="px-4 sm:px-6 py-3 border-b border-rose-200 bg-rose-50 flex flex-wrap items-center gap-2"
          >
            <span className="text-xs font-bold text-rose-800 uppercase tracking-wider">
              Please complete
            </span>
            {missingFields.map((f) => (
              <button
                key={f.id}
                type="button"
                data-testid={`missing-chip-${f.id}`}
                onClick={() => {
                  const n = document.querySelector(`[data-testid="field-row-${f.id}"]`);
                  if (n) {
                    n.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    n.classList.add('paneltec-field-missing-pulse');
                    setTimeout(() => n.classList.remove('paneltec-field-missing-pulse'), 1500);
                  }
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-rose-300 bg-white text-xs font-semibold text-rose-700 hover:bg-rose-100"
              >
                {f.label}
              </button>
            ))}
          </div>
        )}
        <div className="px-4 sm:px-6 py-5 overflow-y-auto space-y-5 flex-1">
          {(template.fields || []).length === 0 ? (
            <div className="text-sm text-slate-500 italic">This template has no fields yet.</div>
          ) : (() => {
            const plan = buildFieldRenderPlan(template.fields || []);
            const groupKeys = plan.filter((p) => p.kind === 'section_group').map((p) => p.key);
            const allExpanded = groupKeys.length > 0 && groupKeys.every((k) => sectionExpansion.openKeys.has(k));
            return (
              <>
                {groupKeys.length > 0 && (
                  <div className="flex items-center justify-end gap-3 -mt-2 mb-1 text-xs">
                    <button type="button"
                      data-testid="section-expand-all"
                      onClick={() => sectionExpansion.setAll(groupKeys, !allExpanded)}
                      className="font-semibold text-blue-600 hover:text-blue-800 hover:underline">
                      {allExpanded ? 'Collapse all' : 'Expand all'}
                    </button>
                  </div>
                )}
                {plan.map((entry) => {
                  // v58.13.132kd — Section group
                  if (entry.kind === 'section_group') {
                    return (
                      <CollapsibleSectionGroup
                        key={entry.key} group={entry}
                        expanded={sectionExpansion.openKeys.has(entry.key)}
                        onToggle={() => sectionExpansion.toggle(entry.key)}
                        values={values} setField={setField}
                        readOnly={false}
                        customRows={customChecklistRows}
                        addCustomRow={addCustomRow}
                        updateCustomRow={updateCustomRow}
                        deleteCustomRow={deleteCustomRow}
                        markAllChecked={markCustomChecked}
                      />
                    );
                  }
                  // v58.13.132kb — Inline checklist row (radio + paired notes)
                  if (entry.kind === 'checklist_row') {
                    const r = entry.radio, n = entry.notes;
                    const hasErr = submitAttempted && missingIds.has(r.id);
                    return (
                      <div key={r.id} data-testid={`field-row-${r.id}`}
                        className={hasErr ? 'rounded-xl border-2 border-rose-500 bg-rose-50/40 -mx-1' : ''}>
                        <InlineChecklistRow radio={r} notes={n}
                          radioValue={values[r.id]}
                          notesValue={values[n.id]}
                          onRadioChange={(v) => setField(r.id, v)}
                          onNotesChange={(v) => setField(n.id, v)}
                          readOnly={!!lockedFields[r.id]} />
                        {hasErr && (
                          <div data-testid={`field-error-${r.id}`}
                            className="mt-1 mx-3 flex items-center gap-1.5 text-xs font-semibold text-rose-600">
                            <span aria-hidden>⚠</span>
                            <span>This field is required</span>
                          </div>
                        )}
                      </div>
                    );
                  }
                  return renderRegularField(entry);
                })}
              </>
            );
          })()}
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
            {/* v160.1.5 — Submit-button text enumerates the missing fields
                so the operator knows what to fix without hunting. */}
            {!requiredOk
              ? `Complete: ${missingFields.slice(0, 2).map((f) => f.label).join(', ')}${missingFields.length > 2 ? ` +${missingFields.length - 2}` : ''}`
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
    </div>,
    document.body,
  );
}

// ─────────────── Preview modal ───────────────

function PreviewModal({ template, onClose, onFill }) {
  useLockBodyScroll();
  return createPortal(
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
          {buildFieldRenderPlan(template.fields || []).map((entry) => {
            // v58.13.132kd — Section groups render as always-expanded read-only.
            if (entry.kind === 'section_group') {
              return (
                <CollapsibleSectionGroup key={entry.key} group={entry}
                  expanded readOnly onToggle={() => {}}
                  values={{}} setField={() => {}}
                  customRows={{}} addCustomRow={() => {}} updateCustomRow={() => {}}
                  deleteCustomRow={() => {}} markAllChecked={() => {}} />
              );
            }
            // v58.13.132kb — Inline checklist row in preview too.
            if (entry.kind === 'checklist_row') {
              const r = entry.radio, n = entry.notes;
              return (
                <InlineChecklistRow key={r.id} radio={r} notes={n}
                  radioValue={null} notesValue={''}
                  onRadioChange={() => {}} onNotesChange={() => {}}
                  readOnly />
              );
            }
            const f = entry.field;
            return (
              <div key={f.id}>
                <label className="block text-sm font-semibold text-slate-800 mb-1.5">
                  {f.label}
                  {f.required && <span className="text-rose-600 ml-1">*</span>}
                  <span className="ml-2 text-[10px] uppercase tracking-wider font-medium text-slate-400">{f.type}</span>
                </label>
                <FieldRunner field={f} value={null} onChange={() => {}} readOnly />
              </div>
            );
          })}
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
    </div>,
    document.body,
  );
}

// ─────────────── Import + Build-with-AI modals ───────────────

function ImportModal({ onClose, onImported }) {
  useLockBodyScroll();
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
  return createPortal(
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
    </div>,
    document.body,
  );
}

function AiBuilderModal({ onClose, onCreated }) {
  useLockBodyScroll();
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
  return createPortal(
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
    </div>,
    document.body,
  );
}

// ─────────────── Template card ───────────────

function TemplateCard({ t, canEdit, onPreview, onFill, onDelete, onEdit, onOpenSubmissions }) {
  // v160.3.0-adjust-17e — colored left stripe + category badge sourced
  // from the shared templateColors palette. `chipBg/chipText` overrides
  // the flat grey CAT_PILL when the category has a colour mapping.
  // v160.3.7a — Shrunk padding, typography and buttons. Description is
  // URL-sanitised + clamped to 2 lines with the full text on hover.
  const colour = categoryColor(t.category);
  const cleanDescription = React.useMemo(() => {
    const raw = t.description || '';
    // Strip any embedded URLs (data-entry cruft), collapse whitespace,
    // trim. If nothing's left we render an em-dash placeholder.
    return raw
      .replace(/https?:\/\/\S+/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  }, [t.description]);
  return (
    <div className="group relative rounded-2xl border border-slate-200 bg-white p-4 hover:border-slate-300 hover:shadow-card transition-all flex flex-col overflow-hidden"
      data-testid={`template-card-${t.id}`}>
      {/* v58.13.132jk — LH stripe width tripled from w-1 (4px) to
          w-3 (12px) per Stephen; colour + vertical extent preserved. */}
      <div className={`absolute left-0 top-0 bottom-0 w-3 ${colour.stripe}`} aria-hidden />
      <div className="flex items-start gap-1.5 mb-2">
        <span className={`inline-block text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full ${colour.chipBg} ${colour.chipText}`}>
          {categoryLabel(t.category)}
        </span>
        <div className="flex-1" />
        <button onClick={onPreview} data-testid={`card-icon-preview-${t.id}`} title="Preview"
          className="w-7 h-7 rounded-lg flex items-center justify-center text-blue-600 hover:bg-blue-50">
          <Phone size={12} />
        </button>
        {canEdit && (
          <button onClick={onEdit} data-testid={`card-icon-edit-${t.id}`} title="Edit"
            className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-600 hover:bg-slate-100">
            <Pencil size={12} />
          </button>
        )}
        {canEdit && (
          <button onClick={onDelete} data-testid={`card-icon-delete-${t.id}`} title="Delete"
            className="w-7 h-7 rounded-lg flex items-center justify-center text-rose-600 hover:bg-rose-50">
            <Trash2 size={12} />
          </button>
        )}
      </div>
      <h3 className="font-display text-base font-bold text-slate-900 leading-tight line-clamp-2" title={t.name}>{t.name}</h3>
      <p
        className="mt-1.5 text-xs text-slate-500 leading-snug line-clamp-2"
        title={cleanDescription || 'No description'}
        data-testid={`card-desc-${t.id}`}>
        {cleanDescription || '—'}
      </p>
      <div className="mt-2 flex items-center flex-wrap gap-2 text-[10px] text-slate-400">
        <span>{(t.fields || []).length} fields</span>
        {(t.submission_count ?? 0) > 0 && (
          <button onClick={onOpenSubmissions} data-testid={`card-subs-${t.id}`}
            className="inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 hover:bg-emerald-100">
            {t.submission_count} sent
          </button>
        )}
        {t.source === 'ai' && (
          <span className="inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-purple-50 text-purple-700">
            <Sparkles size={8} /> AI draft
          </span>
        )}
        {t.source === 'paneltec' && (
          <span
            data-testid={`card-paneltec-badge-${t.id}`}
            title="Seeded by Paneltec"
            className="inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-orange-50 text-orange-700 ring-1 ring-orange-200"
          >
            <img src="/brand/mark.png" alt="" aria-hidden="true" className="h-2.5 w-2.5 object-contain" />
            Paneltec
          </span>
        )}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button onClick={onPreview} data-testid={`card-preview-${t.id}`}
          className="inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg border border-blue-200 bg-white text-blue-700 text-xs font-semibold hover:bg-blue-50">
          <Phone size={11} /> Preview
        </button>
        <button onClick={onFill} data-testid={`card-fill-${t.id}`}
          className="inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800">
          <Pencil size={11} /> Fill This Form
        </button>
      </div>
    </div>
  );
}

// ─────────────── Page ───────────────

export default function Forms() {
  const user = getUser();
  const navigate = useNavigate();
  // v160.3.9.29-2c — Migrated from WRITE_ROLES to forms.edit token.
  const can = useCan();
  const canEdit = can('forms', 'edit');
  void user; void WRITE_ROLES;
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
      // v160.3.9.29-2c — `isWorker` was a negative gate on the admin/manager/
      // hseq_lead write set. Under new model, "no forms.edit" replaces it
      // exactly — no need to enumerate roles.
      const isWorker = !canEdit;
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

  // v58.13.19 — Deep-link `?template_id=<id>` → auto-open the preview
  // modal (read-only, no fill-out). Fired by rich-text "View
  // Checklist" links inserted into schedule descriptions. Ignored if
  // the id isn't in the loaded rows (e.g. archived or from a
  // different org). Runs after `rows` is populated so the modal has
  // a template to render.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tid = params.get('template_id');
    if (!tid || !rows.length) return;
    const tpl = rows.find((t) => t.id === tid);
    if (!tpl) return;
    setPreviewT(tpl);
    // Strip the query param so a back-nav doesn't retrigger the
    // modal after the user closes it.
    navigate('/app/forms', { replace: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search, rows.length]);

  useEffect(() => {
    if (!filterOpen) return;
    const onDoc = (e) => { if (filterRef.current && !filterRef.current.contains(e.target)) setFilterOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [filterOpen]);

  const counts = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = rows.filter((r) => !q || `${r.name} ${r.description || ''} ${categoryLabel(r.category)}`.toLowerCase().includes(q));
    const c = { all: base.length };
    for (const cat of CATEGORIES) if (cat.key !== 'all') c[cat.key] = 0;
    for (const r of base) { if (c[r.category] !== undefined) c[r.category]++; }
    return c;
  }, [rows, search]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((r) => filter === 'all' ? true : r.category === filter)
      .filter((r) => !q || `${r.name} ${r.description || ''} ${categoryLabel(r.category)}`.toLowerCase().includes(q))
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
      {/* v160.3.0-adjust-17e/20 — Sticky page header: title + action
          buttons + search + category filter stay pinned; card grid
          scrolls below. */}
      <div className="sticky top-16 z-20 bg-white -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 pt-1 pb-3 border-b border-slate-100">
      {/* Page header */}
      <div className="mb-4">
        <h1 className="font-display text-4xl sm:text-5xl font-bold text-slate-900 tracking-tight">Form Templates</h1>
        <p className="mt-1 text-sm text-slate-500">Choose a form to fill, build your own, or generate with AI</p>
      </div>

      {/* v58.13.132kp — WHS reminder banner. Dismissible per-user with a
          7-day cool-off (localStorage key `whs_reminder_dismissed_at`).
          Shown to admins + workers on this page; a corresponding note
          lives in the mobile manual for phone workers. */}
      <WhsReminderBanner canEdit={canEdit} />

      {/* Toolbar */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
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
      <div className="flex flex-wrap items-center gap-3">
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3" data-testid="forms-grid">
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
  useLockBodyScroll();
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
            <button key={i} type="button"
              onClick={() => openAuthedFile(p.file_url, p.filename || 'photo.jpg')}
              className="aspect-square rounded-lg overflow-hidden border border-slate-200 hover:opacity-90"
              data-testid={`form-photo-open-${i}`}
              title={`Open ${p.filename || 'photo'} in a new tab`}>
              {/* v58.13.105 — Bearer-authed image thumbnail. Both the
                  outer link AND the <img src=…> used to bare-load the
                  file_url through a 401 endpoint. The thumbnail now
                  falls back to the object-URL when the click handler
                  fires; the <img> tag keeps its original src which
                  will render fine because <img> requests DO carry
                  cookies but not JWT — if the endpoint permits cookie
                  auth OR is workspace-scoped by session, the preview
                  still shows. When it doesn't, the click still works
                  via the shared blob helper. */}
              <img src={`${process.env.REACT_APP_BACKEND_URL}${p.file_url}`}
                alt={p.filename} className="w-full h-full object-cover" loading="lazy" />
            </button>
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
      // v160.3.0-adjust-16e — Fetch the map from our backend proxy which
      // composes an OSM tile mosaic (English labels) and caches on disk.
      const lat = Number(v.lat);
      const lng = Number(v.lng);
      const apiBase = (process.env.REACT_APP_BACKEND_URL || '').replace(/\/$/, '');
      const mapUrl = `${apiBase}/api/gps-map?lat=${lat}&lng=${lng}&w=500&h=300&z=16`;
      return (
        <div className="rounded-lg border border-slate-200 overflow-hidden bg-white" data-testid="gps-map-block">
          <a href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`} target="_blank" rel="noreferrer" className="block">
            <img src={mapUrl} alt="Site location map"
                 className="w-full h-auto object-cover bg-slate-100"
                 style={{ maxHeight: 260 }}
                 loading="lazy"
                 onError={(e) => { e.currentTarget.style.display = 'none'; }} />
          </a>
          <div className="px-3 py-2 grid grid-cols-3 gap-2 text-[11px] text-slate-600">
            <div><span className="block text-slate-400 uppercase tracking-wider">Lat</span>{lat.toFixed(5)}</div>
            <div><span className="block text-slate-400 uppercase tracking-wider">Lng</span>{lng.toFixed(5)}</div>
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
    // v160.3.0-adjust-16c — Worker picker returns `[{worker_id, name,
    // company_label}, …]` — must render the names, NOT dump the object
    // as a React child (previously crashed the modal with "Objects are
    // not valid as a React child").
    if (f.type === 'worker_picker') {
      if (!Array.isArray(v) || v.length === 0) {
        return <span className="text-slate-400 italic text-sm">Not assigned.</span>;
      }
      return (
        <div className="flex flex-wrap gap-2">
          {v.map((w, i) => (
            <span key={i} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 text-slate-800 text-xs">
              <span className="font-medium">{w?.name || '—'}</span>
              {w?.company_label && (
                <span className="text-slate-500">· {w.company_label}</span>
              )}
            </span>
          ))}
        </div>
      );
    }
    // v160.3.9.4 — Graceful chip rendering for job_picker + site_picker
    // submission values. Visitor Register was `job_picker` before v160.3.9.4
    // and `site_picker` after — both value shapes must render legibly on
    // the submission viewer (not as raw JSON.stringify() blobs).
    if (f.type === 'job_picker' || f.type === 'site_picker') {
      if (!v || typeof v !== 'object') {
        return <span className="text-slate-400 italic text-sm">Not selected.</span>;
      }
      const name = v.site_name || v.name || v.job_name || v.label || '—';
      const sub = v.job_name && v.site_name ? v.job_name
        : v.address || v.site_address || null;
      return (
        <div className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-100 text-sm">
          <span className="font-medium text-slate-900">{name}</span>
          {sub && <span className="text-slate-500">· {sub}</span>}
        </div>
      );
    }
    // v160.3.0-adjust-16c — Defensive stringification for any residual
    // object / array values so the modal never crashes on unexpected
    // shapes (e.g. legacy submissions with rich objects). Also strip any
    // literal `<b>…</b>` markup that may have leaked in from a stringified
    // template value.
    let display;
    if (v === null || v === undefined || v === '') {
      display = '—';
    } else if (typeof v === 'object') {
      display = Array.isArray(v)
        ? v.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(', ')
        : JSON.stringify(v);
    } else {
      display = String(v);
    }
    display = display.replace(/<\/?b>/gi, '');
    return <div className="text-sm text-slate-800 whitespace-pre-line">{display}</div>;
  };

  // v160.3.0-adjust-16b — Smart label display: strip section prefix
  // ("TAILGATE — Item" → "Item") OR guidance suffix ("Fluid Levels —
  // Check oil…" → "Fluid Levels"). Mirrors backend/forms_pdf.py.
  const displayLabel = (raw) => {
    if (!raw) return 'Untitled';
    let lbl = raw.trim();
    if (lbl.includes('—')) {
      const [before, ...rest] = lbl.split('—');
      const after = rest.join('—').trim();
      const b = (before || '').trim();
      if (b && b === b.toUpperCase() && b.length <= 24 && after) {
        lbl = after;
      } else {
        lbl = b || after;
      }
    }
    lbl = lbl.replace(/\s*\([^)]*\)\s*$/, '').trim();
    return lbl || raw;
  };

  return createPortal(
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
        <div className="px-4 sm:px-6 py-5 overflow-y-auto space-y-4 flex-1">
          {loading ? <div className="text-sm text-slate-500 inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading…</div>
            : !data ? <div className="text-sm text-slate-500">Submission not found.</div>
            : (data.fields || [])
                .filter((f) => {
                  // v160.3.0-adjust-16b — Suppress empty photo rows in the
                  // UI too, matching the PDF renderer.
                  if (f.type === 'photo') {
                    return Array.isArray(f.value) && f.value.some(
                      (ph) => ph && (ph.filename || ph.file_url || ph.url)
                    );
                  }
                  return true;
                })
                .map((f) => (
              <div key={f.id} className="grid grid-cols-1 sm:grid-cols-[minmax(180px,40%)_1fr] gap-2 sm:gap-4 pb-3 border-b border-slate-100 last:border-b-0">
                <label className="block text-xs font-semibold text-slate-700 sm:pt-1" data-testid={`submission-field-label-${f.id}`}>
                  {displayLabel(f.label)}
                </label>
                <div data-testid={`submission-field-value-${f.id}`}>
                  {renderValue(f)}
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
