/**
 * v58.13.132hk — Universal "open file as PDF" button.
 *
 * Thin wrapper around PdfPreviewModal that any non-DocLib surface can
 * drop into its row / card to give admins consistent PDF preview
 * behaviour. Handles the modal open/close state and the raw-download
 * fallback (invoked automatically by the modal when the backend
 * returns 415 for an unsupported source format).
 *
 * Usage:
 *   <OpenAsPdfButton
 *     source="cert_file"                                // registry key
 *     refObj={{ worker_id, cert_id }}                   // adapter fields
 *     filename={row.name}                               // user-visible label
 *     onDownloadOriginal={async () => window.open(...)} // 415 fallback
 *     data-testid={`open-pdf-cert-${row.id}`}
 *   />
 *
 * The button itself renders as a slate-tinted "Open" pill with an
 * external-link icon so it visually matches the existing anchors it
 * replaces. Callers wanting a bare icon-only trigger can pass
 * `variant="icon"`.
 */
import { useState } from 'react';
import { Eye, ExternalLink } from 'lucide-react';
import PdfPreviewModal from './PdfPreviewModal';

export default function OpenAsPdfButton({
  source,
  refObj,
  filename,
  mime,
  onDownloadOriginal,
  label,
  variant = 'link',   // 'link' | 'icon' | 'button'
  className = '',
  disabled = false,
  ...rest             // passes data-testid through
}) {
  const [open, setOpen] = useState(false);

  const trigger = () => {
    if (disabled) return;
    setOpen(true);
  };

  // Three visual variants — pick per call-site so the button fits
  // its host row without bespoke class overrides.
  let btn;
  if (variant === 'icon') {
    btn = (
      <button type="button" onClick={trigger} disabled={disabled}
        title={disabled ? 'No file attached' : `Open ${filename || 'file'} as PDF`}
        className={`inline-flex items-center justify-center w-7 h-7 rounded bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-40 ${className}`}
        {...rest}>
        <Eye size={12} />
      </button>
    );
  } else if (variant === 'button') {
    btn = (
      <button type="button" onClick={trigger} disabled={disabled}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 ${className}`}
        {...rest}>
        <Eye size={12} /> {label || 'Open as PDF'}
      </button>
    );
  } else {
    // 'link' — matches existing "Open ↗" anchor styling used across the app.
    btn = (
      <button type="button" onClick={trigger} disabled={disabled}
        className={`inline-flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900 hover:underline disabled:opacity-40 disabled:cursor-not-allowed ${className}`}
        {...rest}>
        <ExternalLink size={12} /> {label || 'Open'}
      </button>
    );
  }

  return (
    <>
      {btn}
      {open && (
        <PdfPreviewModal
          file={{ filename, mime }}
          previewSource={{ source, ref: refObj }}
          onDownloadOriginal={onDownloadOriginal}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
