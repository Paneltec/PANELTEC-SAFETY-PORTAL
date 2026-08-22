// v58.13.33 — MisclassifiedImportBanner.
//
// Detects records that were imported before v58.13.32's classifier fix
// (Ship 3) and where the classification is likely wrong — either
// `fields[]` is empty (nothing was mapped) OR the filename-parsed
// template family disagrees with the `template_name_snapshot` that
// the backend classifier stamped.
//
// Renders an amber info banner nudging the user to view the source
// PDF or re-enter the data manually. No destructive actions.
//
// v58.13.10 flash-bug guardrail: click handlers e.stopPropagation()
// before mutating state.
import React, { useCallback } from 'react';
import { AlertTriangle } from 'lucide-react';
import { inferTemplateType } from '../lib/preStartsPalette';

/**
 * @param {{ record: object, className?: string }} props
 * `record` — the pre_start row (with `fields[]`,
 * `template_name_snapshot`, `work_summary`, `imported`, `pdf_hash`).
 */
export default function MisclassifiedImportBanner({ record, className }) {
  const filenameParsedTemplate = React.useMemo(
    () => inferTemplateType({ work_summary: record?.work_summary || '' }) || '',
    [record?.work_summary],
  );
  const snapshotTemplate = (record?.template_name_snapshot || '').trim();
  const fieldsEmpty = !Array.isArray(record?.fields) || record.fields.length === 0;
  // Template mismatch signal: both non-empty AND different.
  const templateMismatch = (
    !!snapshotTemplate
    && !!filenameParsedTemplate
    && snapshotTemplate.toLowerCase() !== filenameParsedTemplate.toLowerCase()
  );
  // Only show on imported records — non-imported rows can't be
  // misclassified by our pipeline (they were manually entered).
  const isImported = !!record?.imported;
  const show = isImported && (fieldsEmpty || templateMismatch);

  const handleClick = useCallback((e) => {
    e.stopPropagation(); e.preventDefault();
    // no-op link: we don't currently retain the source PDF for
    // successful imports (per prior diagnostic; only failed PDFs are
    // persisted). Kept as a visual affordance + explanatory copy.
  }, []);

  if (!show) return null;

  return (
    <div
      data-testid="misclassified-import-banner"
      className={
        'flex items-start gap-3 p-3 rounded-lg border '
        + 'border-amber-300 bg-amber-50 text-amber-900 '
        + (className || '')
      }
    >
      <AlertTriangle
        size={18}
        className="text-amber-600 shrink-0 mt-0.5"
        aria-hidden
      />
      <div className="text-sm">
        <div className="font-semibold" data-testid="misclassified-banner-title">
          This record was imported before v58.13.32&apos;s classifier fix.
        </div>
        <div className="text-xs mt-0.5">
          Some fields may be missing.
          {' '}
          <button
            type="button"
            onClick={handleClick}
            data-testid="misclassified-banner-source-btn"
            className="underline font-semibold text-amber-800 hover:text-amber-900"
          >
            View source PDF
          </button>
          {' '}or re-enter data manually below.
        </div>
      </div>
    </div>
  );
}
