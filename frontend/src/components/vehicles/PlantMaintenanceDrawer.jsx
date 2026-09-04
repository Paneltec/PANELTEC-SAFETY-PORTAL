// v58.13.117 — Plant Maintenance detail drawer + Print.
//
// Right-side drawer replacing the inline expansion that used to live
// in PlantMaintenanceTab.jsx. Same shell pattern as VisitorDetail
// Drawer from .110: fixed overlay, Esc closes, click-outside dismiss,
// header with Close button. Print reuses the .113 portal + @media
// print CSS so the printed page renders the maintenance card ONLY,
// full A4 portrait with the Paneltec header.
//
// Edit + Link-to-asset are intentionally OUT of scope — flagged for
// .117a (link picker) and .117b (edit modal) so the mutation surface
// gets its own audit-log + validation ship.
import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Printer, X as XIcon } from 'lucide-react';

function Field({ label, value, mono = false, multiline = false, className = '' }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className={className}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-0.5">
        {label}
      </div>
      <div
        className={
          'text-sm text-slate-800 '
          + (mono ? 'font-mono ' : '')
          + (multiline ? 'whitespace-pre-line ' : '')
        }
      >
        {String(value)}
      </div>
    </div>
  );
}

function PrintableMaintenanceCard({ row }) {
  if (!row) return null;
  const now = new Date();
  const card = (
    <div className="risk-print-root" data-testid="pm-printable">
      <header className="risk-print-header">
        <div className="risk-print-brand">
          <svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3 L21 19 L15 19 L12 13 L9 19 L3 19 Z" fill="#F97316" />
          </svg>
          <div>
            <div className="risk-print-brand-name">Paneltec Civil</div>
            <div className="risk-print-brand-sub">Plant Maintenance Record</div>
          </div>
        </div>
        <div className="risk-print-riskid">#{row.maintenance_id}</div>
      </header>
      <h1 className="risk-print-title">{row.description || 'Untitled maintenance record'}</h1>
      <div className="risk-print-meta">
        <span><strong>Category:</strong> {row.maintenance_type || 'Category not set'}</span>
        <span><strong>Asset kind:</strong> {row.type || '—'}</span>
        <span><strong>Rego:</strong> {row.registration_no || '—'}</span>
        <span><strong>Asset code:</strong> {row.asset_code || '—'}</span>
        <span><strong>Completed:</strong> {row.date_completed || '—'}</span>
        <span><strong>Status:</strong> {row.maintenance_status || '—'}</span>
      </div>
      <section>
        <h2>Description</h2>
        <p>{row.description || 'Not provided'}</p>
      </section>
      {row.notes && (
        <section>
          <h2>Notes</h2>
          <p style={{ whiteSpace: 'pre-line' }}>{row.notes}</p>
        </section>
      )}
      <section>
        <h2>Details</h2>
        <ul>
          {row.sub_type && <li><strong>Sub-type:</strong> {row.sub_type}</li>}
          {row.manufacturer && <li><strong>Manufacturer:</strong> {row.manufacturer}</li>}
          {row.performed_by && <li><strong>Performed by:</strong> {row.performed_by}</li>}
          {row.company && <li><strong>Company:</strong> {row.company}</li>}
          {row.cost && <li><strong>Cost:</strong> {row.cost}</li>}
          {row.latest_usage_reading && <li><strong>Usage reading:</strong> {row.latest_usage_reading}</li>}
          {(row.due_date || row.due_at) && <li><strong>Due:</strong> {row.due_date || row.due_at}</li>}
        </ul>
      </section>
      <section>
        <h2>Import provenance</h2>
        <ul>
          {row.imported_at && <li><strong>Imported at:</strong> {row.imported_at}</li>}
          {row.imported_by && <li><strong>Imported by:</strong> {row.imported_by}</li>}
          {row.plant_id
            ? <li><strong>Linked asset:</strong> {row.plant_id}</li>
            : <li><strong>Linked asset:</strong> —</li>}
        </ul>
      </section>
      <footer className="risk-print-footer">
        <span>Printed {now.toLocaleString('en-AU')}</span>
        <span>Paneltec Civil — WHS platform</span>
      </footer>
    </div>
  );
  return typeof document !== 'undefined' ? createPortal(card, document.body) : card;
}

export default function PlantMaintenanceDrawer({ row, onClose }) {
  const open = !!row;

  // Esc-to-close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Print handler — sets a state flag so the portal card renders,
  // fires window.print(), then clears on afterprint or 500ms.
  const [printing, setPrinting] = React.useState(false);
  useEffect(() => {
    if (!printing) return;
    const clear = () => setPrinting(false);
    const raf = requestAnimationFrame(() => {
      try { window.print(); } catch { /* headless */ }
      window.addEventListener('afterprint', clear, { once: true });
      setTimeout(clear, 500);
    });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('afterprint', clear);
    };
  }, [printing]);

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-slate-900/40"
        onClick={onClose}
        data-testid="pm-drawer-backdrop"
      />
      <aside
        className="fixed top-0 right-0 z-50 h-full w-full sm:max-w-lg bg-white shadow-2xl overflow-y-auto"
        data-testid={`pm-drawer-${row.maintenance_id}`}
        role="dialog"
        aria-label="Maintenance record detail"
      >
        <header className="sticky top-0 bg-white border-b border-slate-200 px-5 py-3 flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Maintenance record
            </div>
            <div className="flex items-center gap-2 flex-wrap mt-0.5">
              <span className="font-mono text-sm text-slate-800">#{row.maintenance_id}</span>
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-blue-50 text-blue-800 border border-blue-200">
                {row.maintenance_type || 'Uncategorised'}
              </span>
              {/* v58.13.118 — Header pill for the retired
                  matched/unmatched concept was removed here per
                  user directive. `plant_id` still surfaces in the
                  drawer body's "Linked asset id" field for
                  diagnostic use, but no chrome-level chip flags it. */}
            </div>
            <div className="text-sm text-slate-700 mt-1 line-clamp-2">
              {row.description || '—'}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setPrinting(true)}
              disabled={printing}
              title="Print this record (A4 portrait)"
              data-testid="pm-drawer-print"
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <Printer size={12} /> Print
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              data-testid="pm-drawer-close"
              className="p-1.5 rounded hover:bg-slate-100 text-slate-500"
            >
              <XIcon size={16} />
            </button>
          </div>
        </header>

        <div className="p-5 space-y-4 text-sm">
          {/* Primary block */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-3">
            <Field label="Category" value={row.maintenance_type || 'Category not set'} />
            <Field label="Asset kind" value={row.type} />
            <Field label="Sub-type" value={row.sub_type} />
            <Field label="Status" value={row.maintenance_status} />
            <Field label="Completed" value={row.date_completed} mono />
            <Field label="Due" value={row.due_date || row.due_at} mono />
          </div>

          {/* Description + notes */}
          <div className="border-t border-slate-200 pt-3 grid grid-cols-1 gap-y-3">
            <Field label="Description" value={row.description} multiline />
            <Field label="Notes" value={row.notes} multiline />
          </div>

          {/* Asset + rego block */}
          <div className="border-t border-slate-200 pt-3 grid grid-cols-2 gap-x-6 gap-y-3">
            <Field label="Registration" value={row.registration_no} mono />
            <Field label="Asset code" value={row.asset_code} mono />
            <Field label="Manufacturer" value={row.manufacturer} />
            <Field label="Latest usage reading" value={row.latest_usage_reading} mono />
            <Field
              label="Linked asset id"
              value={row.plant_id || '—'}
              mono
              className="col-span-2"
            />
          </div>

          {/* Performed / commercial */}
          <div className="border-t border-slate-200 pt-3 grid grid-cols-2 gap-x-6 gap-y-3">
            <Field label="Performed by" value={row.performed_by} />
            <Field label="Company" value={row.company} />
            <Field label="Cost" value={row.cost} mono />
          </div>

          {/* Provenance */}
          <div className="border-t border-slate-200 pt-3 grid grid-cols-2 gap-x-6 gap-y-3">
            <Field label="Imported at" value={row.imported_at} mono />
            <Field label="Imported by" value={row.imported_by} mono />
            <Field label="Created at" value={row.created_at} mono />
            <Field label="Updated at" value={row.updated_at} mono />
          </div>

          {/* v58.13.118 — The amber "Reconcile — coming in .118a"
              banner was removed here. Reconciliation UI was tied to
              the retired matched/unmatched concept and won't ship
              as a follow-on. */}
        </div>
      </aside>
      <PrintableMaintenanceCard row={printing ? row : null} />
    </>
  );
}
