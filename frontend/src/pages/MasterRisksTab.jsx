// v160.3.9.13a — Master Risks reference library tab.
//
// Reworked in .13a: all 10 populated source columns are now visible in the
// table (Risk ID, Classification, Activity, Hazard aspect, Unwanted event,
// Score U, Mandatory controls, Other controls, Score C, Legal refs). Long
// prose cells clamp to 3 lines; row click expands the full-text detail
// panel unchanged. The 11th "SWMS reference" column exists in the schema
// but is blank on every source row, so it's hidden from the visible grid.
//
// Wide layout uses the same mirror-scrollbar pattern as InductionsMatrix
// (v160.3.9.6) — a synced sticky top scrollbar so admins don't have to
// scroll to the bottom of the page to find horizontal-scroll control.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
// v160.3.9.24 — CRUD affordances + admin-only tightening.
import useCrudModal from '../components/riskAssessments/useCrudModal';
// v58.13.113 — Copy / Print / Edit action-bar icons for the expanded card.
import { ClipboardCopy, Printer, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import api from '../lib/api';
import { loadListSort, saveListSort } from '../lib/listSort';
import { useCan } from '../lib/permissions';

const SEVERITY_ORDER = ['extreme', 'high', 'medium', 'low'];
const SEVERITY_LABEL = {
  extreme: 'Extreme', high: 'High', medium: 'Medium', low: 'Low',
};
// Tailwind fallback if the XLSX row didn't carry a fill.
const SEVERITY_FALLBACK = {
  extreme: { bg: '#FEE2E2', fg: '#991B1B' },  // rose-100 / rose-800
  high:    { bg: '#FEF3C7', fg: '#92400E' },  // amber-100 / amber-800
  medium:  { bg: '#FEF9C3', fg: '#854D0E' },  // yellow-100 / yellow-800
  low:     { bg: '#D1FAE5', fg: '#065F46' },  // emerald-100 / emerald-800
  _null:   { bg: '#F1F5F9', fg: '#334155' },  // slate-100 / slate-700
};

// Pick a readable text colour (black or white) for a given hex background
// using the standard sRGB relative-luminance formula.
function readableTextOn(hex) {
  if (!hex || typeof hex !== 'string') return '#0F172A';
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return '#0F172A';
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  // Perceptual luminance (Rec. 709).
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum > 0.6 ? '#0F172A' : '#FFFFFF';
}

function severityStyle(row) {
  if (row.fill_hex) {
    return { bg: row.fill_hex, fg: readableTextOn(row.fill_hex) };
  }
  const fb = SEVERITY_FALLBACK[row.severity] || SEVERITY_FALLBACK._null;
  return { bg: fb.bg, fg: fb.fg };
}

function SeverityPill({ row, testid, showScore = true }) {
  const s = severityStyle(row);
  return (
    <span
      data-testid={testid}
      className="inline-flex items-center px-2 py-0.5 rounded-md font-mono text-xs font-semibold"
      style={{ backgroundColor: s.bg, color: s.fg }}
      title={SEVERITY_LABEL[row.severity] || row.severity || 'Unclassified'}
    >
      {showScore ? (row.risk_score_uncontrolled || row.risk_id) : row.risk_id}
    </span>
  );
}

function ControlledPill({ row, testid }) {
  if (!row.risk_score_controlled) return <span className="text-slate-400">—</span>;
  const bg = row.fill_hex_controlled || SEVERITY_FALLBACK._null.bg;
  return (
    <span
      data-testid={testid}
      className="inline-flex items-center px-2 py-0.5 rounded-md font-mono text-xs font-semibold"
      style={{ backgroundColor: bg, color: readableTextOn(bg) }}
    >
      {row.risk_score_controlled}
    </span>
  );
}

function ImportModal({ open, onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState('');
  const [file, setFile] = useState(null);
  const [msg, setMsg] = useState('');
  if (!open) return null;

  const submit = async () => {
    setBusy(true); setMsg('');
    try {
      let resp;
      if (file) {
        const fd = new FormData();
        fd.append('file', file);
        resp = await api.post('/master-risks/reimport', fd);
      } else if (url.trim()) {
        const fd = new FormData();
        fd.append('url', url.trim());
        resp = await api.post('/master-risks/reimport', fd);
      } else {
        setMsg('Provide a file OR a URL.'); setBusy(false); return;
      }
      setMsg(`Imported → new: ${resp.data.inserted}, updated: ${resp.data.updated}, unchanged: ${resp.data.unchanged}. Live rows: ${resp.data.live_total}.`);
      onDone();
    } catch (e) {
      setMsg(`Failed: ${e?.response?.data?.detail || e?.message || 'unknown'}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" data-testid="master-risks-import-modal">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">Import Master Risks from XLSX</h3>
            <p className="text-sm text-slate-500 mt-1">Existing rows are matched by <code>risk_id</code>. Changed rows are updated; new rows are inserted; unchanged rows are skipped.</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700" data-testid="master-risks-import-close" aria-label="Close">×</button>
        </div>

        <label className="block text-sm font-medium text-slate-700 mb-1">Upload .xlsx file</label>
        <input
          type="file" accept=".xlsx"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
          className="block w-full text-sm text-slate-600 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200"
          data-testid="master-risks-import-file"
        />

        <div className="my-3 text-center text-xs uppercase tracking-wide text-slate-400">or</div>

        <label className="block text-sm font-medium text-slate-700 mb-1">Paste XLSX URL</label>
        <input
          type="url" value={url} onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…/master_risks.xlsx"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
          data-testid="master-risks-import-url"
        />

        {msg && <div className="mt-3 text-sm text-slate-700 whitespace-pre-line" data-testid="master-risks-import-msg">{msg}</div>}

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-sm rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50" data-testid="master-risks-import-cancel">Close</button>
          <button
            onClick={submit} disabled={busy}
            className="px-3 py-1.5 text-sm rounded-md bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50"
            data-testid="master-risks-import-submit"
          >
            {busy ? 'Importing…' : 'Import'}
          </button>
        </div>
      </div>
    </div>
  );
}

// v58.13.113 — Copy / Print helpers for the expanded detail panel.
//
// Both formats keep the ORDER stable so a printed page and a pasted
// email read the same left-to-right. `formatRiskAsText` is what lands
// in the plain-text clipboard AND what the receipt file would carry;
// `formatRiskAsHtml` is the rich-text sibling written alongside via
// `navigator.clipboard.write` — pasting into Word or Outlook keeps
// the bullets and headings intact.
function formatRiskAsText(row) {
  const bullets = (row.mandatory_controls || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const cls = row.classification || 'Not provided';
  const activity = row.activity || 'Not provided';
  const un = row.risk_score_uncontrolled || '—';
  const co = row.risk_score_controlled || '—';
  const lines = [
    `Risk #${row.risk_id} — ${activity}`,
    `Classification: ${cls} | Activity: ${activity}`,
    `Uncontrolled: ${un} | Controlled: ${co}`,
    '',
    'Hazard Aspect:',
    row.hazard_aspect || 'Not provided',
    '',
    'Unwanted Event:',
    row.unwanted_event || 'Not provided',
    '',
    'Mandatory Controls:',
    ...(bullets.length ? bullets.map((b) => `- ${b}`) : ['- Not provided']),
    '',
    'Other Controls:',
    row.other_controls || 'Not provided',
    '',
    'Legal & Other References:',
    row.legal_references || 'Not provided',
  ];
  return lines.join('\n');
}

function escapeHtml(s) {
  return String(s || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function formatRiskAsHtml(row) {
  const bullets = (row.mandatory_controls || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const activity = row.activity || 'Not provided';
  const cls = row.classification || 'Not provided';
  const un = row.risk_score_uncontrolled || '—';
  const co = row.risk_score_controlled || '—';
  const bulletLis = bullets.length
    ? bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join('')
    : '<li>Not provided</li>';
  return (
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:12pt;color:#0f172a">`
    + `<div><strong>Risk #${escapeHtml(row.risk_id)} — ${escapeHtml(activity)}</strong></div>`
    + `<div>Classification: ${escapeHtml(cls)} | Activity: ${escapeHtml(activity)}</div>`
    + `<div>Uncontrolled: ${escapeHtml(un)} | Controlled: ${escapeHtml(co)}</div>`
    + `<p><strong>Hazard Aspect</strong><br/>${escapeHtml(row.hazard_aspect || 'Not provided')}</p>`
    + `<p><strong>Unwanted Event</strong><br/>${escapeHtml(row.unwanted_event || 'Not provided')}</p>`
    + `<p><strong>Mandatory Controls</strong></p><ul>${bulletLis}</ul>`
    + `<p><strong>Other Controls</strong><br/>${escapeHtml(row.other_controls || 'Not provided')}</p>`
    + `<p><strong>Legal &amp; Other References</strong><br/>${escapeHtml(row.legal_references || 'Not provided')}</p>`
    + `</div>`
  );
}

async function copyRiskToClipboard(row) {
  const text = formatRiskAsText(row);
  const html = formatRiskAsHtml(row);
  // Dual-format write via ClipboardItem so pasting into Word / Outlook
  // preserves the bullets + bold headings. Older browsers (Firefox
  // <127 without dom.events.asyncClipboard.clipboardItem, Safari
  // <15.4) fall back to plain text.
  try {
    if (window.ClipboardItem && navigator.clipboard?.write) {
      const item = new window.ClipboardItem({
        'text/plain': new Blob([text], { type: 'text/plain' }),
        'text/html': new Blob([html], { type: 'text/html' }),
      });
      await navigator.clipboard.write([item]);
      return true;
    }
  } catch {
    // Ad blockers occasionally block ClipboardItem; fall through.
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Legacy execCommand fallback — last resort for pre-Blink browsers
    // and http:// contexts (rare in production but seen inside iframes).
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } finally { ta.remove(); }
    return true;
  }
}

// v58.13.113 — Printable card. Rendered in a portal-friendly div that
// is invisible on screen but the ONLY visible element under `@media
// print` thanks to the `.risk-print-root` class defined in index.css.
// Rendered inline (not a portal) so React sees the mount immediately
// and `window.print()` can fire on the same tick.
function PrintableRiskCard({ row }) {
  if (!row) return null;
  const bullets = (row.mandatory_controls || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const now = new Date();
  // v58.13.113 — Portal to document.body so the printable card is a
  // DIRECT sibling of `#root`. `@media print` in index.css then hides
  // `#root` and shows this sibling cleanly — no visibility-cascade
  // gotchas from any intermediate Tailwind layer.
  const card = (
    <div className="risk-print-root" data-testid="master-risks-printable">
      <header className="risk-print-header">
        <div className="risk-print-brand">
          <svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3 L21 19 L15 19 L12 13 L9 19 L3 19 Z" fill="#F97316" />
          </svg>
          <div>
            <div className="risk-print-brand-name">Paneltec Civil</div>
            <div className="risk-print-brand-sub">WHS Compliance · Master Risks Reference Library</div>
          </div>
        </div>
        <div className="risk-print-riskid">Risk #{row.risk_id}</div>
      </header>
      <h1 className="risk-print-title">{row.activity || 'Untitled risk'}</h1>
      <div className="risk-print-meta">
        <span><strong>Classification:</strong> {row.classification || 'Not provided'}</span>
        <span><strong>Activity:</strong> {row.activity || 'Not provided'}</span>
        <span><strong>Uncontrolled:</strong> {row.risk_score_uncontrolled || '—'}</span>
        <span><strong>Controlled:</strong> {row.risk_score_controlled || '—'}</span>
      </div>
      <section>
        <h2>Hazard Aspect</h2>
        <p>{row.hazard_aspect || 'Not provided'}</p>
      </section>
      <section>
        <h2>Unwanted Event</h2>
        <p>{row.unwanted_event || 'Not provided'}</p>
      </section>
      <section>
        <h2>Mandatory Controls</h2>
        {bullets.length ? (
          <ul>{bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>
        ) : (
          <p>Not provided</p>
        )}
      </section>
      <section>
        <h2>Other Controls</h2>
        <p style={{ whiteSpace: 'pre-line' }}>{row.other_controls || 'Not provided'}</p>
      </section>
      <section>
        <h2>Legal &amp; Other References</h2>
        <p style={{ whiteSpace: 'pre-line' }}>{row.legal_references || 'Not provided'}</p>
      </section>
      <footer className="risk-print-footer">
        <span>Printed {now.toLocaleString('en-AU')}</span>
        <span>Paneltec Civil — WHS platform</span>
      </footer>
    </div>
  );
  return typeof document !== 'undefined' ? createPortal(card, document.body) : card;
}

function DetailPanel({ row, canEdit, onCopy, onPrint, onEdit }) {
  return (
    <div
      className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4 p-4 rounded-lg border border-slate-200 bg-slate-50/60"
      data-testid={`master-risks-detail-${row.risk_id}`}
    >
      <div className="md:col-span-2 flex items-center gap-3 flex-wrap">
        <span className="text-xs text-slate-500">Risk ID:</span>
        <span className="font-mono text-sm text-slate-800">#{row.risk_id}</span>
        <span className="text-xs text-slate-500 ml-3">Uncontrolled:</span>
        <SeverityPill row={row} testid={`master-risks-detail-pill-${row.risk_id}`} />
        <span className="text-xs text-slate-500 ml-3">Controlled:</span>
        <ControlledPill row={row} testid={`master-risks-detail-pill-c-${row.risk_id}`} />
        {row.classification && (
          <span className="text-xs text-slate-500 ml-3">{row.classification}</span>
        )}
        {/* v58.13.113 — action bar. Copy + Print available to every
            authenticated viewer; Edit gated on reference_library.edit
            via `canEdit`. */}
        <div className="ml-auto flex items-center gap-1.5"
             data-testid={`master-risks-detail-actions-${row.risk_id}`}>
          <button
            type="button"
            onClick={() => onCopy(row)}
            data-testid={`master-risks-detail-copy-${row.risk_id}`}
            title="Copy this risk to clipboard (plain text + rich text)"
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
          >
            <ClipboardCopy size={13} /> Copy
          </button>
          <button
            type="button"
            onClick={() => onPrint(row)}
            data-testid={`master-risks-detail-print-${row.risk_id}`}
            title="Print this risk (portrait A4)"
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
          >
            <Printer size={13} /> Print
          </button>
          {canEdit && (
            <button
              type="button"
              onClick={() => onEdit(row)}
              data-testid={`master-risks-detail-edit-${row.risk_id}`}
              title="Edit this risk"
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md bg-orange-600 text-white hover:bg-orange-700"
            >
              <Pencil size={13} /> Edit
            </button>
          )}
        </div>
      </div>
      <Field label="Unwanted event" value={row.unwanted_event} />
      <Field label="Hazard aspect" value={row.hazard_aspect} />
      <Field label="Mandatory controls" value={row.mandatory_controls} multiline />
      <Field label="Other controls" value={row.other_controls} multiline />
      <Field label="Legal &amp; other references" value={row.legal_references} multiline />
    </div>
  );
}

function Field({ label, value, multiline }) {
  if (!value) return <div className="text-xs text-slate-400">{label}: <span className="italic">not provided</span></div>;
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">{label}</div>
      <div className={`text-sm text-slate-800 ${multiline ? 'whitespace-pre-line' : ''}`}>{value}</div>
    </div>
  );
}

// Sort helpers.
function riskIdSortKey(id) {
  // Numeric per-row Risk ID from column A. Sort numerically if it parses.
  const n = parseInt((id || '').trim(), 10);
  if (Number.isFinite(n)) return [0, n];
  return [1, 0];
}

function scoreSortKey(code) {
  const m = /^([EHMLehml])-(\d+)$/.exec((code || '').trim());
  if (!m) return [9, 0];
  const rank = { E: 0, H: 1, M: 2, L: 3 }[m[1].toUpperCase()];
  return [rank, -parseInt(m[2], 10)]; // Larger score first within band.
}

// v160.3.9.13a — local twin of the InductionsMatrix v160.3.9.6 mirror
// scroll pattern. Keeps a synced sticky top scrollbar visible above the
// wide table so admins don't need to scroll to the bottom of the page
// to find horizontal-scroll control. Rendered inline to keep this tab
// self-contained; if a third caller shows up, promote to a shared
// component under components/.
function MirrorScrollContainer({ children, maxHeight = '68vh' }) {
  const topRef = useRef(null);
  const bodyRef = useRef(null);
  const spacerRef = useRef(null);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const body = bodyRef.current;
    const spacer = spacerRef.current;
    if (!body || !spacer) return;
    const syncWidth = () => {
      spacer.style.width = body.scrollWidth + 'px';
      setOverflows(body.scrollWidth > body.clientWidth + 4);
    };
    syncWidth();
    const ro = new ResizeObserver(syncWidth);
    ro.observe(body);
    for (const el of body.children) ro.observe(el);
    window.addEventListener('resize', syncWidth);
    return () => { ro.disconnect(); window.removeEventListener('resize', syncWidth); };
  }, [children]);

  useEffect(() => {
    const body = bodyRef.current;
    const top = topRef.current;
    if (!body || !top) return;
    let lock = false;
    const onBody = () => { if (lock) return; lock = true; top.scrollLeft = body.scrollLeft; lock = false; };
    const onTop = () => { if (lock) return; lock = true; body.scrollLeft = top.scrollLeft; lock = false; };
    body.addEventListener('scroll', onBody, { passive: true });
    top.addEventListener('scroll', onTop, { passive: true });
    return () => { body.removeEventListener('scroll', onBody); top.removeEventListener('scroll', onTop); };
  }, []);

  return (
    <div className="relative" data-testid="master-risks-scroll-wrap">
      <div
        ref={topRef}
        className="sticky top-0 z-40 bg-white border-x border-t border-slate-200 rounded-t-2xl"
        style={{ overflowX: 'scroll', overflowY: 'hidden', height: 14 }}
        aria-hidden="true"
      >
        <div ref={spacerRef} style={{ height: 1 }} />
      </div>
      <div
        ref={bodyRef}
        className="bg-white border border-slate-200 rounded-b-2xl"
        style={{ overflowX: 'scroll', overflowY: 'auto', maxHeight, scrollbarGutter: 'stable' }}
      >
        {children}
      </div>
      {overflows && (
        <div className="absolute top-4 right-4 z-30 px-2.5 py-1 rounded-full bg-slate-900/80 text-white text-[10px] font-medium shadow-lg pointer-events-none">
          ← scroll to see all columns →
        </div>
      )}
    </div>
  );
}

// Column definitions. `grow` numbers are relative — sizing is fixed pixels
// so total width is deterministic (~1900px) and mirror-scrollbar can be
// pinned regardless of viewport.
const COLUMNS = [
  { key: 'risk_id',                  label: 'ID',              width: 60,  sortable: true,  align: 'left' },
  { key: 'classification',           label: 'Classification',  width: 140, sortable: true,  align: 'left' },
  { key: 'activity',                 label: 'Activity',        width: 180, sortable: true,  align: 'left' },
  { key: 'hazard_aspect',            label: 'Hazard aspect',   width: 220, sortable: false, align: 'left' },
  { key: 'unwanted_event',           label: 'Unwanted event',  width: 260, sortable: false, align: 'left' },
  { key: 'risk_score_uncontrolled',  label: 'Score (U)',       width: 90,  sortable: true,  align: 'left', kind: 'pill_u' },
  { key: 'mandatory_controls',       label: 'Mandatory controls', width: 300, sortable: false, align: 'left' },
  { key: 'other_controls',           label: 'Other controls',  width: 240, sortable: false, align: 'left' },
  { key: 'risk_score_controlled',    label: 'Score (C)',       width: 90,  sortable: true,  align: 'left', kind: 'pill_c' },
  { key: 'legal_references',         label: 'Legal & other refs', width: 220, sortable: false, align: 'left' },
];
const GRID_TEMPLATE = COLUMNS.map((c) => c.width + 'px').join(' ') + ' 32px';

export default function MasterRisksTab({ user }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [sevOn, setSevOn] = useState({ extreme: true, high: true, medium: true, low: true });
  const [classification, setClassification] = useState('');
  const [expanded, setExpanded] = useState(null);
  const [sort, setSort] = useState(() => loadListSort('master_risks', { key: 'risk_id', dir: 'asc' }));
  const [importOpen, setImportOpen] = useState(false);
  // v58.13.113 — Row that the user is currently printing. When set, we
  // render `<PrintableRiskCard>` into the DOM (invisible on-screen,
  // ONLY visible in @media print) and fire `window.print()`. After the
  // print dialog closes we clear the state so subsequent expanded
  // panels aren't stuck under the printing-mode class.
  const [printingRow, setPrintingRow] = useState(null);

  // v160.3.9.29-2b — reference_library gate migration (see CompaniesTab).
  // MasterRisksTab feeds the SWMS master risk library; treated as reference data.
  const can = useCan();
  const canWrite = can('reference_library', 'edit');
  const canDelete = can('reference_library', 'delete');
  const isAdmin = canWrite;
  void user;

  const load = () => {
    setLoading(true);
    api.get('/master-risks/', { params: { limit: 1000 } })
      .then((r) => setItems(r.data.items || []))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  // v160.3.9.24 — CRUD affordances (Add / Edit / Delete) via shared hook.
  const crud = useCrudModal({ tabKey: 'master_risks', isAdmin, onRefresh: load });

  // v58.13.113 — Copy handler. Dual-format write via ClipboardItem so
  // Word/Outlook paste keeps bullets; plain-text fallback for older
  // browsers. Toast surfaces the outcome.
  const handleCopy = async (row) => {
    const ok = await copyRiskToClipboard(row);
    if (ok) toast.success(`Risk #${row.risk_id} copied to clipboard`);
    else toast.error('Copy failed — please try again');
  };

  // v58.13.113 — Print handler. Sets the state → React renders the
  // print-only card in the next tick → we fire `window.print()`. The
  // `afterprint` event (or a fallback timeout) clears the state so the
  // rest of the tab returns to normal.
  const handlePrint = (row) => {
    setPrintingRow(row);
  };
  useEffect(() => {
    if (!printingRow) return;
    // Wait one frame so React commits the print card into the DOM
    // BEFORE the browser snapshots the printable area.
    let cleared = false;
    const clear = () => { if (!cleared) { cleared = true; setPrintingRow(null); } };
    const raf = requestAnimationFrame(() => {
      try {
        window.print();
      } catch { /* headless / iframe context — no-op */ }
      // Some browsers fire `afterprint`; others don't. Clear on both.
      window.addEventListener('afterprint', clear, { once: true });
      // Belt-and-braces: clear after 500ms if `afterprint` never fired.
      setTimeout(clear, 500);
    });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('afterprint', clear);
    };
  }, [printingRow]);

  // v58.13.113 — Edit handler. Reuses the existing PATCH-backed edit
  // modal from `useCrudModal` — no new endpoint, no new modal.
  const handleEdit = (row) => {
    crud.openEdit(row);
  };

  const classifications = useMemo(() => {
    const s = new Set();
    items.forEach((r) => { if (r.classification) s.add(r.classification); });
    return Array.from(s).sort();
  }, [items]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = items.filter((r) => {
      if (!sevOn[r.severity || '_null'] && r.severity) return false;
      if (classification && r.classification !== classification) return false;
      if (needle) {
        const hay = [r.risk_id, r.activity, r.hazard_aspect, r.unwanted_event,
                     r.mandatory_controls, r.other_controls, r.legal_references,
                     r.swms_reference, r.classification]
          .filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    const dir = sort.dir === 'desc' ? -1 : 1;
    out = [...out].sort((a, b) => {
      if (sort.key === 'risk_id') {
        const [ra, na] = riskIdSortKey(a.risk_id);
        const [rb, nb] = riskIdSortKey(b.risk_id);
        return dir * (ra === rb ? na - nb : ra - rb);
      }
      if (sort.key === 'risk_score_uncontrolled') {
        const [ra, na] = scoreSortKey(a.risk_score_uncontrolled);
        const [rb, nb] = scoreSortKey(b.risk_score_uncontrolled);
        return dir * (ra === rb ? na - nb : ra - rb);
      }
      const va = (a[sort.key] || '').toString().toLowerCase();
      const vb = (b[sort.key] || '').toString().toLowerCase();
      return dir * va.localeCompare(vb);
    });
    return out;
  }, [items, q, sevOn, classification, sort]);

  const cycleSort = (key) => {
    let next;
    if (sort.key !== key) next = { key, dir: 'asc' };
    else next = { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' };
    setSort(next);
    saveListSort('master_risks', next.key, next.dir);
  };

  const sortIndicator = (key) => sort.key !== key ? '' : (sort.dir === 'asc' ? '↑' : '↓');

  return (
    <div data-testid="master-risks-tab">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          type="search" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search risks…"
          className="w-64 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
          data-testid="master-risks-search"
        />

        <div className="flex items-center gap-1" data-testid="master-risks-severity-chips">
          {SEVERITY_ORDER.map((sev) => {
            const active = sevOn[sev];
            const fb = SEVERITY_FALLBACK[sev];
            return (
              <button
                key={sev}
                onClick={() => setSevOn({ ...sevOn, [sev]: !active })}
                data-testid={`master-risks-chip-${sev}`}
                className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition ${active ? '' : 'opacity-40'}`}
                style={{ backgroundColor: active ? fb.bg : '#FFF', color: fb.fg, borderColor: fb.bg }}
                title={`Toggle ${SEVERITY_LABEL[sev]}`}
              >
                {SEVERITY_LABEL[sev]}
              </button>
            );
          })}
        </div>

        <select
          value={classification} onChange={(e) => setClassification(e.target.value)}
          className="rounded-md border border-slate-300 px-2 py-2 text-sm bg-white"
          data-testid="master-risks-classification-select"
        >
          <option value="">All classifications</option>
          {classifications.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>

        <div className="text-xs text-slate-500 ml-auto" data-testid="master-risks-count">
          {filtered.length} of {items.length} risks
        </div>

        {isAdmin && crud.AddButton}
        {isAdmin && (
          <button
            onClick={() => setImportOpen(true)}
            className="px-3 py-1.5 text-sm rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-slate-700"
            data-testid="master-risks-import-open"
          >
            Import from XLSX…
          </button>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-sm text-slate-500 p-6" data-testid="master-risks-loading">Loading master risks…</div>
      ) : items.length === 0 ? (
        <div className="p-8 border border-dashed border-slate-300 rounded-lg text-center" data-testid="master-risks-empty">
          <p className="text-slate-700 font-medium">No master risks imported yet</p>
          <p className="text-slate-500 text-sm mt-1">
            {isAdmin
              ? 'Use "Import from XLSX" above to load the reference library.'
              : 'Ask an admin to import the master risks reference library.'}
          </p>
        </div>
      ) : (
        <MirrorScrollContainer>
          {/* Grid table — width is fixed by GRID_TEMPLATE (~1900px) so the
              mirror-scrollbar pattern works. Vertical scroll inside so
              headers can position: sticky. */}
          <div style={{ minWidth: 'max-content' }}>
            {/* Sticky column headers */}
            <div
              className="grid text-[11px] uppercase tracking-wider bg-slate-50 border-b border-slate-200 py-2 text-slate-600 font-semibold sticky top-0 z-20 gap-2 px-3"
              style={{ gridTemplateColumns: GRID_TEMPLATE }}
              data-testid="master-risks-header"
            >
              {COLUMNS.map((col) => (
                col.sortable ? (
                  <button
                    key={col.key}
                    className="text-left hover:text-slate-900"
                    onClick={() => cycleSort(col.key)}
                    data-testid={`master-risks-sort-${col.key}`}
                    title={`Sort by ${col.label}`}
                  >
                    {col.label} {sortIndicator(col.key)}
                  </button>
                ) : (
                  <div key={col.key} className="text-left">{col.label}</div>
                )
              ))}
              <div className="text-center">›</div>
            </div>

            {/* Rows */}
            <ul className="divide-y divide-slate-100" data-testid="master-risks-rows">
              {filtered.map((row) => {
                const isOpen = expanded === row.id;
                return (
                  <li key={row.id} className="bg-white relative" data-testid={`master-risks-row-${row.risk_id}`}>
                    <button
                      className={`w-full text-left grid items-start py-2.5 hover:bg-slate-50 transition gap-2 px-3 ${isOpen ? 'bg-slate-50' : ''}`}
                      style={{ gridTemplateColumns: GRID_TEMPLATE }}
                      onClick={() => setExpanded(isOpen ? null : row.id)}
                      aria-expanded={isOpen}
                    >
                      {COLUMNS.map((col) => {
                        if (col.kind === 'pill_u') {
                          return <div key={col.key}><SeverityPill row={row} testid={`master-risks-pill-${row.risk_id}`} /></div>;
                        }
                        if (col.kind === 'pill_c') {
                          return <div key={col.key}><ControlledPill row={row} testid={`master-risks-pill-c-${row.risk_id}`} /></div>;
                        }
                        if (col.key === 'risk_id') {
                          return <div key={col.key} className="font-mono text-xs text-slate-500 pt-0.5">#{row.risk_id}</div>;
                        }
                        const v = row[col.key];
                        return (
                          <div
                            key={col.key}
                            className="text-xs text-slate-800 line-clamp-3 leading-snug"
                            title={v || ''}
                          >
                            {v || <span className="italic text-slate-400">—</span>}
                          </div>
                        );
                      })}
                      <div className="text-center text-slate-400 text-xs pt-0.5">{isOpen ? '▾' : '▸'}</div>
                    </button>
                    {isAdmin && (
                      <div className="absolute top-1 right-8 z-10 bg-white/95 rounded-md shadow-sm border border-slate-200"
                           data-testid={`ra-row-actions-${row.risk_id}`}>
                        {crud.RowActions(row)}
                      </div>
                    )}
                    {isOpen && (
                      <div className="px-4 pb-4">
                        <DetailPanel
                          row={row}
                          canEdit={canWrite}
                          onCopy={handleCopy}
                          onPrint={handlePrint}
                          onEdit={handleEdit}
                        />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </MirrorScrollContainer>
      )}

      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} onDone={load} />
      {crud.Modals}
      {/* v58.13.113 — Print target. Rendered in-tree (not a portal) so
          React commits it before window.print() snapshots the layout.
          On screen it's invisible (see .risk-print-root in index.css);
          in @media print the app shell + everything else is hidden and
          ONLY this element paints — one risk per printed page. */}
      <PrintableRiskCard row={printingRow} />
    </div>
  );
}
