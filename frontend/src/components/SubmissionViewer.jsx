// v160.3.9.10 — Shared submission viewer for Hazards / Incidents /
// Inspections / Pre-Starts / Site-Diary capture pages.
//
// Fixes the "unable to just review" bug: previously admins could only
// download a PDF from these lists. Now the eye-icon on any CaptureCard
// opens this modal, which renders the submission inline — labels +
// values in two columns, inline photos (click for lightbox), inline
// signatures, GPS chip, AI analysis callout, and the same PDF /
// Delete / Edit actions as the card row.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, Download, Trash2, Edit3, MapPin, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import PdfActions from './PdfActions';
import AuthedImage from './AuthedImage'; // v42 · SEC-004 image wrapper
import DeleteRecordButton from './DeleteRecordButton';
import { getUser } from '../lib/auth';
import { useCan } from '../lib/permissions';
import useLockBodyScroll from '../lib/useLockBodyScroll';
import { formatDateTime12 } from '../lib/timeFormat';

const BACKEND = process.env.REACT_APP_BACKEND_URL;
// v160.3.9.29-2c — Legacy set retained; authoritative gate via useCan below.
const WRITE_ROLES = new Set(['admin', 'manager', 'hseq_lead']);

function _fileUrl(url) {
  if (!url) return null;
  return url.startsWith('http') ? url : `${BACKEND}${url}`;
}

function FieldRow({ field }) {
  const label = field.label || field.field_id || '—';
  return (
    <div className="py-2 border-b border-slate-100 last:border-b-0" data-testid={`sv-field-${field.field_id}`}>
      <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-0.5">{label}</div>
      <FieldValue field={field} />
    </div>
  );
}

function FieldValue({ field }) {
  const { value, type } = field;
  if (value == null || value === '') {
    return <div className="text-sm text-slate-400 italic">—</div>;
  }
  switch (type) {
    case 'photo': {
      const items = Array.isArray(value) ? value : [value];
      return (
        <div className="flex flex-wrap gap-2 mt-1">
          {items.map((v, i) => {
            const url = _fileUrl(typeof v === 'string' ? v : v?.url || v?.src);
            if (!url) return null;
            return (
              <button key={i} type="button"
                onClick={() => window.__paneltecLightbox?.(url)}
                data-testid={`sv-photo-${field.field_id}-${i}`}
                className="w-28 h-28 rounded-lg overflow-hidden border border-slate-200 hover:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue">
                <img src={url} alt="Submission" className="w-full h-full object-cover" />
              </button>
            );
          })}
        </div>
      );
    }
    case 'signature': {
      const url = _fileUrl(typeof value === 'string' ? value : value?.url || value?.src);
      if (!url) return <div className="text-sm text-slate-400 italic">—</div>;
      return (
        <img src={url} alt="Signature" className="mt-1 max-h-24 border border-slate-200 rounded bg-white p-1" />
      );
    }
    case 'gps': {
      if (typeof value !== 'object') return <div className="text-sm">{String(value)}</div>;
      const bits = [];
      if (value.address) bits.push(value.address);
      if (value.lat != null && value.lng != null) bits.push(`${value.lat.toFixed(5)}, ${value.lng.toFixed(5)}`);
      return (
        <div className="inline-flex items-center gap-1.5 text-sm text-slate-700">
          <MapPin size={12} className="text-slate-400" />
          <span>{bits.join(' · ') || '—'}</span>
        </div>
      );
    }
    case 'worker_picker':
    case 'site_picker':
    case 'job_picker':
    case 'customer_picker': {
      const items = Array.isArray(value) ? value : [value];
      return (
        <div className="flex flex-wrap gap-1 mt-1">
          {items.map((v, i) => {
            const label = typeof v === 'string' ? v : (v?.name || v?.site_name || v?.label || v?.company_label || '—');
            return (
              <span key={i} className="inline-flex items-center px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-xs">
                {label}
              </span>
            );
          })}
        </div>
      );
    }
    case 'vehicle_navixy': {
      const label = typeof value === 'string' ? value : (value?.label || value?.name || '—');
      return <div className="text-sm">{label}</div>;
    }
    case 'time':
      return <div className="text-sm font-mono">{String(value)}</div>;
    case 'textarea':
      return <div className="text-sm whitespace-pre-wrap rounded bg-slate-50 border border-slate-200 p-2">{String(value)}</div>;
    default: {
      if (typeof value === 'object') {
        return <pre className="text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded p-2 overflow-x-auto">{JSON.stringify(value, null, 2)}</pre>;
      }
      return <div className="text-sm text-slate-800">{String(value)}</div>;
    }
  }
}

export default function SubmissionViewer({ record, resourceKind, apiPath, onClose, onDeleted }) {
  useLockBodyScroll();
  const me = getUser();
  // v160.3.9.29-2c — Migrated to forms.edit token.
  const canEdit = useCan()('forms', 'edit');
  void me; void WRITE_ROLES;
  const [lightboxUrl, setLightboxUrl] = useState(null);

  // Expose a global lightbox opener so nested FieldValue can trigger it
  // without having to thread callbacks through every child.
  useEffect(() => {
    window.__paneltecLightbox = (url) => setLightboxUrl(url);
    return () => { delete window.__paneltecLightbox; };
  }, []);

  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') (lightboxUrl ? setLightboxUrl(null) : onClose?.()); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose, lightboxUrl]);

  const r = record || {};
  const title = r.template_name_snapshot || r.template_name || r.title || 'Submission';
  const operator = r.submitted_by_name || r.operator || r.created_by_name || '—';
  const submittedAt = formatDateTime12(r.submitted_at || r.created_at);
  const fields = r.fields || [];
  const aiAnalysis = r.ai_analysis || r.ai_analysis_output || r.deep_parse_stats;

  return createPortal(
    <div className="fixed inset-0 z-[70] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4"
         onClick={onClose}
         data-testid="submission-viewer-backdrop">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[92vh] flex flex-col"
           onClick={(e) => e.stopPropagation()}
           data-testid="submission-viewer">
        {/* Header */}
        <div className="px-5 py-3 border-b border-slate-200 flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
              {resourceKind?.replace('_', ' ') || 'Submission'} · {r.source || 'manual'}
            </div>
            <div className="text-lg font-semibold text-slate-900 truncate" title={title}>{title}</div>
            <div className="text-xs text-slate-500 mt-0.5">
              Submitted by <span className="text-slate-700 font-medium">{operator}</span>
              {submittedAt && <span> · {submittedAt}</span>}
              {r.status && <span> · <span className="uppercase tracking-wider text-[10px] font-semibold text-slate-600">{r.status}</span></span>}
            </div>
          </div>
          <button onClick={onClose} data-testid="submission-viewer-close"
            className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100">
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {/* v160.3.9.10 — Some capture records (photo-first hazards) store
              their primary image on the record root, not inside fields[].
              Show it front-and-centre so it doesn't get hidden behind PDF. */}
          {r.photo_url && (
            <div className="mb-4">
              <button type="button" onClick={() => setLightboxUrl(_fileUrl(r.photo_url))}
                data-testid="submission-viewer-primary-photo"
                className="block w-full max-w-md rounded-xl overflow-hidden border border-slate-200 hover:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue">
                <AuthedImage rawSrc={r.photo_url} alt="Primary" className="w-full h-56 object-cover" />
              </button>
            </div>
          )}

          {aiAnalysis && typeof aiAnalysis === 'object' && (
            <div className="mb-4 rounded-xl border border-violet-200 bg-violet-50 p-3">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-semibold text-violet-700 mb-1">
                <Sparkles size={11} /> AI analysis
              </div>
              <pre className="text-[11px] text-slate-700 whitespace-pre-wrap overflow-x-auto">{JSON.stringify(aiAnalysis, null, 2)}</pre>
            </div>
          )}

          {fields.length > 0 ? (
            <div className="grid sm:grid-cols-2 gap-x-6">
              {fields.map((f) => (
                <FieldRow key={f.field_id || f.label} field={f} />
              ))}
            </div>
          ) : (
            <div className="text-sm text-slate-500 italic">
              This record was captured with the legacy shape and has no per-field breakdown.
              Use &quot;Download PDF&quot; for the rendered form.
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2 rounded-b-2xl">
          <PdfActions
            resourceKind={resourceKind}
            recordId={r.id}
            source={r.source}
            title={title}
            size="sm"
            data-testid="submission-viewer-pdf"
          />
          {canEdit && (
            <button
              onClick={() => toast.info('In-app edit is coming in a follow-up ticket. Use "Download PDF" for the current record.')}
              data-testid="submission-viewer-edit"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-100">
              <Edit3 size={12} /> Edit
            </button>
          )}
          {canEdit && (
            <DeleteRecordButton
              resourceKind={resourceKind}
              apiPath={apiPath}
              recordId={r.id}
              source={r.source}
              label={title}
              recordTitle={title}
              onDeleted={(id) => { onDeleted?.(id); onClose?.(); }}
            />
          )}
        </div>
      </div>

      {/* Lightbox for photo click-through */}
      {lightboxUrl && (
        <div className="fixed inset-0 z-[80] bg-black/85 grid place-items-center p-6"
             onClick={() => setLightboxUrl(null)}
             data-testid="submission-viewer-lightbox">
          <img src={lightboxUrl} alt="Full" className="max-w-full max-h-full rounded-lg shadow-2xl" />
          <button onClick={() => setLightboxUrl(null)}
            className="absolute top-4 right-4 w-9 h-9 inline-flex items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
            aria-label="Close lightbox">
            <X size={18} />
          </button>
        </div>
      )}
    </div>,
    document.body,
  );
}
