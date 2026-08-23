import React, { useState } from 'react';
import { FileText, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Can } from '../lib/permissions';
import api, { apiError } from '../lib/api';

// Open every PDF in a single shared popup window. Re-opening another PDF
// reuses the same window (named 'paneltec-pdf') so we never spawn a wall of
// tabs. The PDF URL itself is a signed `/api/files/pdf/{token}.pdf` route
// served by the browser's native PDF viewer.
//
// v160.3.0-adjust — Same mirror-routing fix as `DeleteRecordButton`.
// Capture list rows for mirrored `form_submissions` (source ==
// "form_submission") were 404'ing on `POST /api/pdf-token` because
// that endpoint only searches the legacy per-entity collection.
// When mirrored, route to the submissions-specific token endpoint
// (`POST /api/forms/submissions/pdf-token`) which resolves against
// `form_submissions` and mints a JWT bound to the submission id.
// Legacy rows continue on the original path.
const POPUP_NAME = 'paneltec-pdf';
const POPUP_FEATURES = 'popup=yes,width=900,height=1100,scrollbars=yes,resizable=yes,toolbar=no,location=no,menubar=no,status=no';

export default function PdfActions({ resourceKind, pdfResourceKind, recordId, title = '', size = 'sm', source, iconOnly = false, enabled = true }) {
  const [busy, setBusy] = useState(false);
  const isMirrored = source === 'form_submission';
  // v58.13.48 — `pdfResourceKind` overrides `resourceKind` for the
  // `POST /api/pdf-token` body ONLY. `resourceKind` still drives
  // the `<Can>` permission gate + testids. Needed for CS Incidents,
  // which is permission-scoped under `reference_library` but must
  // request its PDF as `cs_incidents` (the backend renderer key).
  const pdfResource = pdfResourceKind || resourceKind;

  // v160.3.9.58.13.46 — Opt out. Some Capture kinds (CS Incidents +
  // other `reference_library` DB rows) don't have a PDF backend
  // representation; rendering the button anyway causes the "file
  // icon flashes and disappears" bug because `POST /api/pdf-token`
  // rejects the resource with a 400 and we close the popup we just
  // opened. When `enabled === false`, render nothing at all.
  if (!enabled) return null;

  const open = async (e) => {
    e?.stopPropagation();
    setBusy(true);
    const win = window.open('about:blank', POPUP_NAME, POPUP_FEATURES);
    if (!win || win.closed) {
      setBusy(false);
      toast.error('Popup blocked — please allow popups for this site to open PDF reports');
      return;
    }
    try {
      let signedUrl;
      if (isMirrored) {
        const { data } = await api.post('/forms/submissions/pdf-token', {
          submission_id: recordId, action: 'view',
        });
        signedUrl = data.url;
      } else {
        const { data } = await api.post('/pdf-token', {
          resource: pdfResource, record_id: recordId, action: 'view',
        });
        signedUrl = data.url;
      }
      win.location.replace(signedUrl);
      win.focus();
    } catch (err) {
      try { win.close(); } catch { /* ignore */ }
      const status = err?.response?.status;
      if (status === 404) toast.error('This report has been deleted or moved.');
      else toast.error(apiError(err) || 'Failed to open PDF');
    } finally {
      setBusy(false);
    }
  };

  const ico = size === 'sm' ? 12 : 14;
  const iconOnlyCls =
    'inline-flex items-center justify-center h-6 w-6 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-900';
  const cls = size === 'sm'
    ? 'inline-flex items-center gap-1 text-xs px-2 py-1 rounded hover:bg-slate-100 text-slate-700'
    : 'inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50';

  return (
    <Can resource={resourceKind} action="view">
      <div className="inline-flex gap-1" data-testid={`pdf-actions-${resourceKind}-${recordId}`}>
        <button onClick={open} disabled={busy} className={iconOnly ? iconOnlyCls : cls}
          title={title || 'Open report'} data-testid={`pdf-open-${recordId}`}
          aria-label="Open report">
          {busy ? <Loader2 size={ico} className="animate-spin" /> : <FileText size={ico} />}
          {!iconOnly && ' Open report'}
        </button>
      </div>
    </Can>
  );
}
