import React, { useState } from 'react';
import { FileText, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Can } from '../lib/permissions';
import api, { apiError } from '../lib/api';

// Open every PDF in a single shared popup window. Re-opening another PDF
// reuses the same window (named 'paneltec-pdf') so we never spawn a wall of
// tabs. The PDF URL itself is a signed `/api/files/pdf/{token}.pdf` route
// served by the browser's native PDF viewer.
const POPUP_NAME = 'paneltec-pdf';
const POPUP_FEATURES = 'popup=yes,width=900,height=1100,scrollbars=yes,resizable=yes,toolbar=no,location=no,menubar=no,status=no';

export default function PdfActions({ resourceKind, recordId, title = '', size = 'sm' }) {
  const [busy, setBusy] = useState(false);

  const open = async (e) => {
    e?.stopPropagation();
    setBusy(true);
    // Open the popup synchronously inside the user gesture, then redirect it
    // once the signed URL is back. Popup blockers won't fire when triggered
    // by a real click.
    const win = window.open('about:blank', POPUP_NAME, POPUP_FEATURES);
    if (!win || win.closed) {
      setBusy(false);
      toast.error('Popup blocked — please allow popups for this site to open PDF reports');
      return;
    }
    try {
      const { data } = await api.post('/pdf-token', {
        resource: resourceKind, record_id: recordId, action: 'view',
      });
      win.location.replace(data.url);
      win.focus();
    } catch (err) {
      try { win.close(); } catch { /* ignore */ }
      toast.error(apiError(err) || 'Failed to open PDF');
    } finally {
      setBusy(false);
    }
  };

  const ico = size === 'sm' ? 12 : 14;
  const cls = size === 'sm'
    ? 'inline-flex items-center gap-1 text-xs px-2 py-1 rounded hover:bg-slate-100 text-slate-700'
    : 'inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50';

  return (
    <Can resource={resourceKind} action="view">
      <div className="inline-flex gap-1" data-testid={`pdf-actions-${resourceKind}-${recordId}`}>
        <button onClick={open} disabled={busy} className={cls}
          title={title || 'Open report'} data-testid={`pdf-open-${recordId}`}>
          {busy ? <Loader2 size={ico} className="animate-spin" /> : <FileText size={ico} />} Open report
        </button>
      </div>
    </Can>
  );
}
