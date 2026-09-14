// v160.3.9.10 — Shared submission viewer for Hazards / Incidents /
// Inspections / Pre-Starts / Site-Diary capture pages.
//
// Fixes the "unable to just review" bug: previously admins could only
// download a PDF from these lists. Now the eye-icon on any CaptureCard
// opens this modal, which renders the submission inline — labels +
// values in two columns, inline photos (click for lightbox), inline
// signatures, GPS chip, AI analysis callout, and the same PDF /
// Delete / Edit actions as the card row.
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, Download, Trash2, Edit3, MapPin, Sparkles, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import PdfActions from './PdfActions';
import AuthedImage from './AuthedImage'; // v42 · SEC-004 image wrapper
import DeleteRecordButton from './DeleteRecordButton';
import { getUser } from '../lib/auth';
import { useCan } from '../lib/permissions';
import useLockBodyScroll from '../lib/useLockBodyScroll';
import { formatDateTime12 } from '../lib/timeFormat';
import {
  resolveCategory,
  paletteForCategory,
  isPartialCacheOnlyReextract,
  isMeaningfulValue,
} from '../lib/detailViewCategory';

const BACKEND = process.env.REACT_APP_BACKEND_URL;
// v160.3.9.29-2c — Legacy set retained; authoritative gate via useCan below.
const WRITE_ROLES = new Set(['admin', 'manager', 'hseq_lead']);

function _fileUrl(url) {
  if (!url) return null;
  // v58.13.132fu — Signatures land in the submission payload as
  // `data:image/png;base64,…` inline URLs (see forms.py L863,
  // and the .132fu ship memo). Prefix them with the backend host
  // and the browser tries to fetch a nonsense URL. `blob:` URLs
  // are similarly self-contained. Only "/api/…"-shaped relative
  // URLs need the backend host prepended.
  if (url.startsWith('http') || url.startsWith('data:') || url.startsWith('blob:')) {
    return url;
  }
  return `${BACKEND}${url}`;
}

function FieldRow({ field, submissionId }) {
  const label = field.label || field.field_id || '—';
  return (
    <div className="py-2 border-b border-slate-100 last:border-b-0" data-testid={`sv-field-${field.field_id}`}>
      <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-0.5">{label}</div>
      <FieldValue field={field} submissionId={submissionId} />
    </div>
  );
}

function FieldValue({ field, submissionId }) {
  const { value, type } = field;
  // v58.12.1 — reference_matrix has no `value` (template-embedded);
  // render the matrix using the field's config regardless of value.
  if (type === 'reference_matrix') {
    const { ReferenceMatrixField } = require('./forms/BydaFields');
    return <ReferenceMatrixField field={field} />;
  }
  if (type === 'attachment') {
    const { AttachmentField } = require('./forms/BydaFields');
    return <AttachmentField field={field} value={value} submissionId={submissionId} readOnly />;
  }
  if (type === 'actions') {
    const { ActionsField } = require('./forms/BydaFields');
    return <ActionsField field={field} value={value} readOnly />;
  }
  if (value == null || value === '') {
    return <div className="text-sm text-slate-400 italic">—</div>;
  }
  switch (type) {
    case 'photo': {
      const items = Array.isArray(value) ? value : [value];
      return (
        <div className="flex flex-wrap gap-2 mt-1">
          {items.map((v, i) => {
            // v58.13.132fu — Photos stored via `POST /submissions/
            // {id}/photos` land in the field value as objects shaped
            // `{id, file_url, stored_name, …}`. The previous
            // implementation only checked `v.url` and `v.src`, both
            // undefined on the persisted shape, so photos silently
            // rendered as empty. Recognise `file_url` alongside
            // legacy `url` / `src` for any pre-.132fu records.
            const src = typeof v === 'string'
              ? v
              : (v?.file_url || v?.url || v?.src);
            const url = _fileUrl(src);
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

function Section({ title, testid, children, empty }) {
  return (
    <section
      className="mb-5 rounded-xl border border-slate-200 bg-white overflow-hidden"
      data-testid={testid}
    >
      <div className="px-4 py-2 border-b border-slate-100 bg-slate-50 text-[10px] uppercase tracking-wider font-semibold text-slate-600">
        {title}
      </div>
      <div className="p-4">
        {empty ? (
          <div
            className="text-xs text-slate-400 italic"
            data-testid={`${testid}-empty`}
          >
            {empty}
          </div>
        ) : children}
      </div>
    </section>
  );
}

function ChecklistSection({ fields, allFields, submissionId }) {
  if (!fields || fields.length === 0) {
    return (
      <Section
        title="Checklist"
        testid="submission-viewer-section-checklist"
        empty={
          allFields && allFields.length > 0
            ? 'All checklist items came back empty on this import. Use "Download PDF" for the rendered form.'
            : 'This record was captured with the legacy shape and has no per-field breakdown. Use "Download PDF" for the rendered form.'
        }
      />
    );
  }
  return (
    <Section title="Checklist" testid="submission-viewer-section-checklist">
      <div className="grid sm:grid-cols-2 gap-x-6">
        {fields.map((f, i) => (
          <FieldRow
            key={f.field_id || f.label || `f-${i}`}
            field={{
              ...f,
              label: f.label || f.field_id || `Field ${i + 1}`,
            }}
            submissionId={submissionId}
          />
        ))}
      </div>
    </Section>
  );
}

function HazardsSection({ hazards, testid }) {
  const raw = hazards?.hazards_discussed;
  const items = Array.isArray(raw) ? raw : (raw ? [raw] : []);
  if (items.length === 0) {
    return (
      <Section
        title="Hazards discussed"
        testid={testid}
        empty="No hazard details on this record yet."
      />
    );
  }
  return (
    <Section title="Hazards discussed" testid={testid}>
      <ul className="space-y-1.5">
        {items.map((h, i) => (
          <li key={i} className="text-sm text-slate-800 flex gap-2">
            <span className="text-slate-400">·</span>
            <span className="whitespace-pre-wrap">
              {typeof h === 'string'
                ? h
                : (h?.description || h?.label || JSON.stringify(h))}
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function CrewSection({ crew, testid }) {
  if (!Array.isArray(crew) || crew.length === 0) {
    return (
      <Section
        title="Crew sign-on"
        testid={testid}
        empty="No crew sign-ons recorded on this record yet."
      />
    );
  }
  return (
    <Section title="Crew sign-on" testid={testid}>
      <div className="grid sm:grid-cols-2 gap-2">
        {crew.map((c, i) => {
          const name = typeof c === 'string' ? c : (c?.name || c?.worker_name || '—');
          const role = (c && typeof c === 'object') ? (c.role || c.company_label || '') : '';
          const signedAt = (c && typeof c === 'object') ? (c.signature_ts || c.signed_at) : null;
          return (
            <div key={i} className="flex items-center justify-between gap-2 border border-slate-100 rounded-lg px-2.5 py-1.5">
              <div className="min-w-0">
                <div className="text-sm text-slate-800 truncate">{name}</div>
                {role && <div className="text-[11px] text-slate-500 truncate">{role}</div>}
              </div>
              {signedAt && (
                <span className="text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                  Signed
                </span>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function SignaturesSection({ signatures, testid }) {
  if (!Array.isArray(signatures) || signatures.length === 0) {
    return (
      <Section
        title="Signatures"
        testid={testid}
        empty="No signatures attached to this record yet."
      />
    );
  }
  return (
    <Section title="Signatures" testid={testid}>
      <div className="flex flex-wrap gap-3">
        {signatures.map((s, i) => {
          const url = typeof s === 'string' ? s : (s?.url || s?.src);
          if (!url) {
            return (
              <div key={i} className="text-xs text-slate-500">
                {typeof s === 'string' ? s : (s?.name || 'Signature')}
              </div>
            );
          }
          return (
            <img
              key={i}
              src={url.startsWith('http') ? url : `${BACKEND}${url}`}
              alt="Signature"
              className="max-h-24 border border-slate-200 rounded bg-white p-1"
            />
          );
        })}
      </div>
    </Section>
  );
}

/**
 * v58.13.36 — Category-aware section switch.
 *
 * · pre_start / plant_pre_start / inspection → CHECKLIST only
 * · hazard / swms                            → HAZARDS + CREW + SIGNATURES + CHECKLIST
 * · permit                                   → HAZARDS + SIGNATURES + CHECKLIST
 * · unknown                                  → CHECKLIST only
 */
export function Sections({ category, fields, allFields, hazards, record }) {
  const submissionId = record?.id;
  const checklist = (
    <ChecklistSection
      fields={fields}
      allFields={allFields}
      submissionId={submissionId}
    />
  );

  if (category === 'hazard' || category === 'swms') {
    return (
      <div data-testid={`submission-viewer-sections-${category}`}>
        <HazardsSection
          hazards={hazards}
          testid="submission-viewer-section-hazards"
        />
        <CrewSection
          crew={hazards.sign_ons}
          testid="submission-viewer-section-crew"
        />
        <SignaturesSection
          signatures={hazards.signatures}
          testid="submission-viewer-section-signatures"
        />
        {checklist}
      </div>
    );
  }
  if (category === 'permit') {
    return (
      <div data-testid="submission-viewer-sections-permit">
        <HazardsSection
          hazards={hazards}
          testid="submission-viewer-section-hazards"
        />
        <SignaturesSection
          signatures={hazards.signatures}
          testid="submission-viewer-section-signatures"
        />
        {checklist}
      </div>
    );
  }
  return (
    <div data-testid={`submission-viewer-sections-${category}`}>
      {checklist}
    </div>
  );
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

  // v58.13.36 — category-aware section rendering.
  const category = useMemo(() => resolveCategory(r), [r]);
  const catPill = useMemo(() => paletteForCategory(category), [category]);
  const partialReextract = useMemo(() => isPartialCacheOnlyReextract(r), [r]);
  const meaningfulFields = useMemo(
    () => fields.filter((f) => isMeaningfulValue(f?.value)),
    [fields],
  );
  const hazardsFromRecord = useMemo(() => {
    // Recover hazard/crew/signature side-channels from either the
    // pre_starts row shape or the form_submissions metadata.
    const meta = r.metadata || {};
    return {
      hazards_discussed: r.hazards_discussed
        || meta.hazards_discussed
        || (Array.isArray(meta.hazards) ? meta.hazards : null)
        || null,
      sign_ons: (Array.isArray(r.sign_ons) && r.sign_ons)
        || (Array.isArray(meta.crew) && meta.crew)
        || (Array.isArray(meta.sign_ons) && meta.sign_ons)
        || [],
      signatures: (Array.isArray(meta.signatures) && meta.signatures) || [],
    };
  }, [r]);

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
            <div className="flex items-center gap-2 mt-0.5">
              <span
                className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider"
                style={{ background: catPill.tint, color: catPill.text,
                         border: `1px solid ${catPill.hex}22` }}
                data-testid={`submission-viewer-type-pill-${category}`}
                title={`Category: ${category}`}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full mr-1.5"
                  style={{ background: catPill.hex }}
                  aria-hidden
                />
                {catPill.label}
              </span>
              <div className="text-lg font-semibold text-slate-900 truncate" title={title}>{title}</div>
            </div>
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

          {/* v58.13.36 — Partial re-extraction banner */}
          {partialReextract && (
            <div
              className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 flex items-start gap-2"
              data-testid="submission-viewer-partial-reextract-banner"
            >
              <AlertTriangle size={14} className="text-amber-600 mt-0.5 shrink-0" />
              <div>
                <div className="text-[11px] uppercase tracking-wider font-semibold text-amber-800">
                  Awaiting full re-extraction
                </div>
                <div className="text-xs text-amber-800 mt-0.5 leading-snug">
                  This record was re-routed to the correct template on
                  22 Feb 2026 via a filename-only cache-derived
                  backfill (v58.13.35). SSRA-shape fields (hazards,
                  crew sign-on, signatures) are pending a full Claude
                  re-extraction from the source PDF.
                </div>
              </div>
            </div>
          )}

          {/* v58.13.36 — Category-aware sections */}
          <Sections
            category={category}
            fields={meaningfulFields}
            allFields={fields}
            hazards={hazardsFromRecord}
            record={r}
          />
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
