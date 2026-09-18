/**
 * v58.13.132ig / .132ih — Compliance question widget.
 *
 * First-class 3-state field for checklist / inspection forms
 * (Pre-Starts, SSRAs, Toolbox Talks, Inspections, Site Audits, JSEAs).
 *
 * UX contract (matches the mockup Stephen shared):
 *   · Question label on its own line, prefixed with the question
 *     number if provided.
 *   · Three buttons directly below the label:
 *       COMPLIANT (emerald-500 when active)
 *       AT RISK   (rose-500 when active — brand danger)
 *       N/A       (slate-400 when active)
 *   · Right-aligned in the same row: 3 utility icons:
 *       (i) info    — visible only when `help_text` is set. Click
 *                     opens a small popover with the help copy.
 *       📷 camera   — v58.13.132ih: on click triggers a hidden
 *                     `<input type="file" accept="image/*"
 *                     capture="environment" multiple>` — on mobile
 *                     Safari / Chrome this opens the native camera;
 *                     on desktop it falls back to the file picker.
 *                     Staged files (pre-submit) or persisted photos
 *                     render as inline thumbnails below the buttons;
 *                     click a thumbnail to open the lightbox.
 *       📝 notes    — still stubbed for .132ii.
 *
 * Value shape: `{status, photos, notes}` where status is one of
 * "compliant" | "at_risk" | "na" | null (null = un-answered).
 *
 * Callers pass:
 *   · field       — the FormField (label / help_text / required / id).
 *   · value       — current value dict OR null.
 *   · onChange(v) — commit a new value dict.
 *   · readOnly    — disable all interactions.
 *   · questionNumber — optional 1-based ordinal; when set, renders
 *                     "N. <label>".
 *
 * v58.13.132ih optional props (photo attach staging):
 *   · stagedPhotos: File[]        — client-side pending uploads.
 *   · onStagePhotos: (files) => v — append staged Files.
 *   · onUnstagePhoto: (i) => v    — remove a staged File by index.
 */
import React, { useMemo, useRef, useState } from 'react';
import { Info, Camera, StickyNote, X } from 'lucide-react';
import ImagePreviewModal from '../ImagePreviewModal';

const STATUS_BUTTONS = [
  {
    key: 'compliant', label: 'COMPLIANT',
    activeCls: 'bg-emerald-500 text-white border-emerald-500',
    inactiveCls: 'bg-white text-slate-600 border-slate-300 hover:bg-emerald-50 hover:border-emerald-300',
  },
  {
    key: 'at_risk', label: 'AT RISK',
    activeCls: 'bg-rose-500 text-white border-rose-500',
    inactiveCls: 'bg-white text-slate-600 border-slate-300 hover:bg-rose-50 hover:border-rose-300',
  },
  {
    key: 'na', label: 'N/A',
    activeCls: 'bg-slate-400 text-white border-slate-400',
    inactiveCls: 'bg-white text-slate-600 border-slate-300 hover:bg-slate-100 hover:border-slate-400',
  },
];

function _readStatus(value) {
  if (value && typeof value === 'object') return value.status || null;
  return null;
}

function _readPersistedPhotos(value) {
  if (!value || typeof value !== 'object') return [];
  const arr = Array.isArray(value.photos) ? value.photos : [];
  return arr.filter((p) => p && (p.file_url || p.stored_name));
}

export default function ComplianceQuestion({
  field,
  value,
  onChange,
  readOnly = false,
  questionNumber = null,
  stagedPhotos = [],
  onStagePhotos = null,
  onUnstagePhoto = null,
}) {
  const [infoOpen, setInfoOpen] = useState(false);
  const [preview, setPreview] = useState(null); // { url } | { file }
  const cameraInputRef = useRef(null);

  const status = _readStatus(value);
  const helpText = (field?.help_text || '').trim();
  const label = field?.label || 'Untitled';
  const prefix = questionNumber != null ? `${questionNumber}. ` : '';

  const persistedPhotos = _readPersistedPhotos(value);
  const canStage = !readOnly && typeof onStagePhotos === 'function';

  // Object-URL previews for staged Files — revoked when the array
  // reference changes (parent state update triggers a fresh map).
  const stagedPreviews = useMemo(() => (stagedPhotos || []).map((f) => ({
    file: f,
    name: f?.name || 'photo',
    url: (() => { try { return URL.createObjectURL(f); } catch { return null; } })(),
  })), [stagedPhotos]);
  React.useEffect(() => () => {
    stagedPreviews.forEach((p) => { if (p.url) URL.revokeObjectURL(p.url); });
  }, [stagedPreviews]);

  const commit = (nextStatus) => {
    if (readOnly || typeof onChange !== 'function') return;
    // Merge with existing photos/notes so we don't clobber .132ih/ii data.
    const prev = (value && typeof value === 'object') ? value : {};
    onChange({
      status: nextStatus,
      photos: Array.isArray(prev.photos) ? prev.photos : [],
      notes: typeof prev.notes === 'string' ? prev.notes : '',
    });
  };

  const onCameraPick = (e) => {
    const picked = Array.from(e.target.files || []);
    e.target.value = '';
    if (!picked.length || !onStagePhotos) return;
    onStagePhotos(picked);
  };

  return (
    <div
      className="rounded-xl border border-slate-200 bg-white p-3 space-y-2"
      data-testid={`compliance-question-${field?.id || 'unknown'}`}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-900 leading-snug break-words">
            {prefix}{label}
            {field?.required && <span className="text-rose-600 ml-1">*</span>}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="inline-flex flex-wrap gap-1.5">
          {STATUS_BUTTONS.map((btn) => {
            const active = status === btn.key;
            return (
              <button
                key={btn.key}
                type="button"
                disabled={readOnly}
                onClick={() => commit(btn.key)}
                data-testid={`compliance-btn-${btn.key}-${field?.id || 'unknown'}`}
                data-active={active ? 'true' : 'false'}
                className={
                  'inline-flex items-center px-3 py-1.5 min-h-[36px] rounded-full border ' +
                  'text-[11px] font-semibold uppercase tracking-wider transition-colors ' +
                  'disabled:opacity-60 disabled:cursor-not-allowed ' +
                  (active ? btn.activeCls : btn.inactiveCls)
                }
              >
                {btn.label}
              </button>
            );
          })}
        </div>

        <div className="ml-auto inline-flex items-center gap-1">
          {helpText ? (
            <div className="relative">
              <button
                type="button"
                onClick={() => setInfoOpen((v) => !v)}
                onBlur={() => setTimeout(() => setInfoOpen(false), 120)}
                data-testid={`compliance-info-${field?.id || 'unknown'}`}
                title={helpText}
                aria-label="Guidance for this question"
                className="p-1.5 rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              >
                <Info size={14} />
              </button>
              {infoOpen && (
                <div
                  role="tooltip"
                  data-testid={`compliance-info-popover-${field?.id || 'unknown'}`}
                  className="absolute right-0 top-8 z-20 w-64 rounded-lg border border-slate-200 bg-white p-2.5 shadow-lg text-[11px] text-slate-700 leading-snug"
                >
                  {helpText}
                </div>
              )}
            </div>
          ) : null}
          {/* v58.13.132ih — Camera / file-picker attach. Uses the browser's
              native accept+capture combo: mobile opens the camera,
              desktop falls back to the file picker. */}
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            className="hidden"
            data-testid={`compliance-camera-input-${field?.id || 'unknown'}`}
            onChange={onCameraPick}
          />
          <button
            type="button"
            disabled={!canStage}
            onClick={() => cameraInputRef.current?.click()}
            data-testid={`compliance-camera-${field?.id || 'unknown'}`}
            title={canStage ? 'Take or attach photo' : 'Photo attach not available here'}
            aria-label={canStage ? 'Take or attach photo' : 'Attach photo (unavailable)'}
            className={
              'p-1.5 rounded-full ' + (canStage
                ? 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                : 'text-slate-300 cursor-not-allowed')
            }
          >
            <Camera size={14} />
          </button>
          <button
            type="button"
            disabled
            data-testid={`compliance-notes-${field?.id || 'unknown'}`}
            title="Add note — coming in v58.13.132ii"
            aria-label="Add note (coming soon)"
            className="p-1.5 rounded-full text-slate-300 cursor-not-allowed"
          >
            <StickyNote size={14} />
          </button>
        </div>
      </div>

      {/* v58.13.132ih — Inline thumbnail row. Merges persisted photos
          (already on the server) with client-side staged Files. */}
      {(persistedPhotos.length > 0 || stagedPreviews.length > 0) && (
        <div
          className="grid grid-cols-4 gap-2 pt-1"
          data-testid={`compliance-photos-${field?.id || 'unknown'}`}
        >
          {persistedPhotos.map((p, i) => (
            <button
              key={`p-${p.stored_name || p.id || i}`}
              type="button"
              onClick={() => setPreview({ url: p.file_url })}
              data-testid={`compliance-photo-thumb-${field?.id || 'unknown'}-${i}`}
              className="relative aspect-square rounded-lg overflow-hidden border border-slate-200 bg-slate-50 hover:border-brand-blue"
            >
              <img
                src={p.file_url}
                alt={p.filename || 'photo'}
                className="w-full h-full object-cover"
                loading="lazy"
              />
            </button>
          ))}
          {stagedPreviews.map((p, i) => (
            <div
              key={`s-${i}`}
              className="relative aspect-square rounded-lg overflow-hidden border border-dashed border-brand-blue bg-blue-50 group"
              data-staged="true"
            >
              <button
                type="button"
                onClick={() => setPreview({ file: p.file })}
                data-testid={`compliance-photo-staged-thumb-${field?.id || 'unknown'}-${i}`}
                className="w-full h-full block"
              >
                {p.url ? (
                  <img src={p.url} alt={p.name} className="w-full h-full object-cover" />
                ) : null}
              </button>
              {typeof onUnstagePhoto === 'function' && !readOnly && (
                <button
                  type="button"
                  onClick={() => onUnstagePhoto(i)}
                  data-testid={`compliance-photo-unstage-${field?.id || 'unknown'}-${i}`}
                  aria-label="Remove staged photo"
                  className="absolute top-1 right-1 w-6 h-6 rounded-full bg-white/95 text-rose-700 flex items-center justify-center shadow opacity-0 group-hover:opacity-100 transition"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {preview && (
        <ImagePreviewModal
          url={preview.url}
          file={preview.file}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}
