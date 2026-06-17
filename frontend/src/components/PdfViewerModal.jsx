import React, { useEffect } from 'react';
import { X as XIcon, Download, Loader2 } from 'lucide-react';

export default function PdfViewerModal({ isOpen, onClose, blobUrl, filename, isLoading, onDownload }) {
  useEffect(() => {
    // Revoke when modal closes (the parent created the blob)
    return () => { if (blobUrl) { try { URL.revokeObjectURL(blobUrl); } catch { /* ignore */ } } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-3 sm:p-6" onClick={onClose}>
      <div
        className="bg-white rounded-2xl w-full max-w-5xl h-[85vh] shadow-card-lg overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
        data-testid="pdf-viewer-modal"
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 bg-slate-50">
          <div className="text-sm font-medium text-slate-800 truncate" title={filename}>{filename || 'PDF preview'}</div>
          <div className="inline-flex items-center gap-1">
            <button onClick={onDownload} disabled={!blobUrl}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-slate-300 hover:bg-white disabled:opacity-50"
              data-testid="pdf-viewer-download">
              <Download size={13} /> Download
            </button>
            <button onClick={onClose}
              className="p-2 rounded-lg hover:bg-slate-200 text-slate-600"
              aria-label="Close" data-testid="pdf-viewer-close">
              <XIcon size={16} />
            </button>
          </div>
        </div>
        <div className="flex-1 bg-slate-100">
          {isLoading || !blobUrl ? (
            <div className="h-full flex items-center justify-center text-slate-500 gap-2">
              <Loader2 size={18} className="animate-spin" /> Rendering PDF…
            </div>
          ) : (
            <iframe src={blobUrl} title={filename || 'pdf'} className="w-full h-full border-0" data-testid="pdf-viewer-iframe" />
          )}
        </div>
        <div className="px-5 py-2 border-t border-slate-200 text-[10px] text-slate-400 text-center">
          Rendered by your browser's built-in PDF viewer
        </div>
      </div>
    </div>
  );
}
