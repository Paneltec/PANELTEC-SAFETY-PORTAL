import React, { useState } from 'react';
import { FileText, Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Can } from '../lib/permissions';
import api, { apiError } from '../lib/api';

export default function PdfActions({ resourceKind, recordId, title = '', size = 'sm' }) {
  const [busy, setBusy] = useState(null); // 'view' | 'download' | null

  // VIEW — open a new tab synchronously during the user gesture, then redirect.
  // Edge/Chrome won't block iframe-blob PDFs anymore because we're hitting a
  // real signed URL handled by the browser's native PDF viewer.
  const view = async (e) => {
    e?.stopPropagation();
    setBusy('view');
    const win = window.open('', '_blank');
    if (!win) {
      setBusy(null);
      toast.error('Popup blocked — please allow popups for this site to view PDFs');
      return;
    }
    try {
      const { data } = await api.post('/pdf-token', {
        resource: resourceKind,
        record_id: recordId,
        action: 'view',
      });
      win.location.href = data.url;
    } catch (err) {
      try { win.close(); } catch { /* ignore */ }
      toast.error(apiError(err) || 'Failed to open PDF');
    } finally { setBusy(null); }
  };

  // DOWNLOAD — anchor click hits Content-Disposition: attachment.
  const dl = async (e) => {
    e?.stopPropagation();
    setBusy('download');
    try {
      const { data } = await api.post('/pdf-token', {
        resource: resourceKind,
        record_id: recordId,
        action: 'download',
      });
      const a = document.createElement('a');
      a.href = data.url;
      a.download = '';
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      toast.success('PDF download started');
    } catch (err) {
      toast.error(apiError(err) || 'Could not download PDF');
    } finally { setBusy(null); }
  };

  const ico = size === 'sm' ? 12 : 14;
  const cls = size === 'sm'
    ? 'inline-flex items-center gap-1 text-xs px-2 py-1 rounded hover:bg-slate-100 text-slate-700'
    : 'inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50';

  return (
    <Can resource={resourceKind} action="view">
      <div className="inline-flex gap-1" data-testid={`pdf-actions-${resourceKind}-${recordId}`}>
        <button onClick={view} disabled={busy === 'view'} className={cls} title={title || 'View PDF'} data-testid={`pdf-view-${recordId}`}>
          {busy === 'view' ? <Loader2 size={ico} className="animate-spin" /> : <FileText size={ico} />} View PDF
        </button>
        <button onClick={dl} disabled={busy === 'download'} className={cls} title="Download PDF" data-testid={`pdf-dl-${recordId}`}>
          {busy === 'download' ? <Loader2 size={ico} className="animate-spin" /> : <Download size={ico} />} Download
        </button>
      </div>
    </Can>
  );
}
