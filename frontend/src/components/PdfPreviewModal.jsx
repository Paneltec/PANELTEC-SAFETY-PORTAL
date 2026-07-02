// Phase 3.10 — Universal PDF preview modal.
//
// Opens an in-app iframe of `GET /api/files/{id}/pdf`. Bearer-auth is
// supplied via a one-shot blob fetch (axios attaches the JWT through the
// interceptor) so the iframe loads an object URL instead of relying on
// cookies, which the iframe's child request context doesn't share.
//
// Header shows filename + pipeline chip (from response header `X-Pipeline`).
// Footer: "Download PDF" (forces ?dl=1), "Open in new tab", "Close".
// ESC closes. Mobile: full-screen below 768 px via Tailwind responsive utilities.
import { useEffect, useState } from 'react';
import { X, Download, ExternalLink, Loader2, FileWarning } from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../lib/api';
import { stashInlinePdf } from '../lib/pdfStash';

// File types that the backend can convert to PDF (mirrors file_pdf.py `_pipeline_for`).
const PDF_OK = (mime, name) => {
  const m = (mime || '').toLowerCase();
  const n = (name || '').toLowerCase();
  if (m === 'application/pdf' || n.endsWith('.pdf')) return true;
  if (m === 'application/octet-stream') {
    // Octet-stream is often an .docx upload — trust the filename extension.
    return /\.(docx|jpg|jpeg|png|webp|heic|heif|txt|csv|md)$/.test(n);
  }
  if (m.startsWith('image/jpeg') || m.startsWith('image/png') || m.startsWith('image/webp')) return true;
  if (m === 'image/heic' || m === 'image/heif') return true;
  if (m === 'text/csv' || m === 'text/plain' || m === 'text/markdown') return true;
  if (n.endsWith('.docx') || m.includes('officedocument.wordprocessingml')) return true;
  if (/\.(jpg|jpeg|png|webp|heic|heif|txt|csv|md|docx)$/.test(n)) return true;
  return false;
};

export const isPdfPreviewable = PDF_OK;

export default function PdfPreviewModal({ file, blobUrl, directUrl, onClose }) {
  // Three modes:
  //   1. file={id, filename}            → mint a signed token, build iframe src.
  //   2. directUrl + file={filename}    → caller already has a same-origin
  //                                       HTTPS URL the iframe can render
  //                                       directly (e.g. the inline-PDF stash
  //                                       at /api/files/inline/{id}?t=...).
  //                                       Ad blockers leave this alone.
  //   3. blobUrl + file={filename}      → legacy path: caller hands us a
  //                                       blob: URL. Kept for back-compat
  //                                       but routinely blocked by ad
  //                                       blockers (ERR_BLOCKED_BY_CLIENT).
  //                                       The blocked-fallback UI applies.
  // Iframes can't carry the Authorization header, so we mint a short-lived
  // signed token via POST /files/{id}/preview-token and put it on the iframe
  // src as `?t=`. This sidesteps Chrome's iframe-cookie / cross-origin auth
  // friction that produced the "page blocked" screen with the bearer-blob
  // approach.
  const [src, setSrc] = useState(null);
  const [pipeline, setPipeline] = useState(null);
  const [err, setErr] = useState(null);
  const [iframeBlocked, setIframeBlocked] = useState(false);
  const isBlobMode = !!blobUrl && !directUrl;

  useEffect(() => {
    if (!file) return;
    let alive = true;
    setIframeBlocked(false);
    // Watchdog — if the iframe hasn't fired `onload` within 6 s, we assume
    // it's been blocked (Chrome's CSP enforcement is silent, and ad
    // blockers don't surface ERR_BLOCKED_BY_CLIENT through the iframe
    // either). The blocked-fallback UI lets the user pop the PDF in a new
    // tab where the same-origin policy doesn't apply.
    const watchdog = setTimeout(() => {
      if (alive) setIframeBlocked(true);
    }, 6000);
    // Mode 2 — caller-supplied same-origin URL. Render immediately.
    if (directUrl) {
      setSrc(directUrl);
      return () => { alive = false; clearTimeout(watchdog); };
    }
    // Mode 3 — caller-supplied blob URL. Render but keep the watchdog on
    // because ad blockers routinely refuse blob: URLs.
    if (blobUrl) {
      setSrc(blobUrl);
      return () => { alive = false; clearTimeout(watchdog); };
    }
    // Mode 1 — fetch a signed preview token.
    (async () => {
      try {
        const r = await api.post(`/files/${file.id}/preview-token`);
        if (!alive) return;
        const t = r.data?.token;
        // We honour same-origin by routing through the React proxy; the
        // backend stamps frame-ancestors with the preview domain so the
        // iframe loads cross-process within the Kubernetes ingress.
        setSrc(`${process.env.REACT_APP_BACKEND_URL}/api/files/${file.id}/pdf?t=${encodeURIComponent(t)}`);
        // Pipeline isn't available via the signed iframe URL; do a tiny
        // bearer HEAD-style fetch on /pdf to grab the header for display.
        api.get(`/files/${file.id}/pdf`, { responseType: 'blob' })
          .then((rr) => { if (alive) setPipeline(rr.headers?.['x-pipeline'] || null); })
          .catch(() => {});
      } catch (e) {
        if (alive) setErr(apiError(e));
      }
    })();
    return () => { alive = false; clearTimeout(watchdog); };
  }, [file, blobUrl, directUrl]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const downloadPdf = async () => {
    // blobUrl mode → we already have the PDF bytes locally; just trigger
    // the download with the desired filename.
    if (blobUrl) {
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = (file.filename || 'document').replace(/\.[^.]+$/, '') + '.pdf';
      document.body.appendChild(a); a.click(); a.remove();
      return;
    }
    try {
      const r = await api.get(`/files/${file.id}/pdf`, {
        params: { dl: 1 }, responseType: 'blob',
      });
      // v148 — stashInlinePdf → same-origin URL (ad-blocker-safe)
      const filename = (file.filename || 'document').replace(/\.[^.]+$/, '') + '.pdf';
      const { src: stashSrc } = await stashInlinePdf(r.data, filename);
      const a = document.createElement('a');
      a.href = stashSrc;
      a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
    } catch (e) { toast.error(apiError(e)); }
  };

  const openInNewTab = () => {
    if (!src) return;
    window.open(src, '_blank');
  };

  if (!file) return null;
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 grid place-items-center p-0 md:p-6"
         onClick={(e) => e.target === e.currentTarget && onClose?.()}
         data-testid="pdf-preview-modal">
      <div className="w-full h-full md:max-w-5xl md:h-[88vh] bg-white md:rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-200 bg-slate-50">
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-slate-900 truncate" data-testid="pdf-modal-filename">
              {file.filename || 'Document'}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-2 flex-wrap">
              <span>PDF preview</span>
              {pipeline && (
                <span data-testid="pdf-modal-pipeline"
                  className="inline-flex items-center px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-mono text-[10px]">
                  pipeline:{pipeline}
                </span>
              )}
            </div>
          </div>
          <button onClick={downloadPdf} title="Download as PDF"
            data-testid="pdf-modal-download"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-white hover:border-slate-400">
            <Download size={12} /> <span className="hidden sm:inline">Download PDF</span>
          </button>
          <button onClick={openInNewTab} disabled={!src} title="Open in new tab"
            data-testid="pdf-modal-newtab"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-white hover:border-slate-400 disabled:opacity-50">
            <ExternalLink size={12} /> <span className="hidden sm:inline">New tab</span>
          </button>
          <button onClick={onClose} title="Close (Esc)"
            data-testid="pdf-modal-close"
            className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-slate-500 hover:bg-slate-200">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 bg-slate-100 relative">
          {err ? (
            <div className="absolute inset-0 grid place-items-center" data-testid="pdf-modal-error">
              <div className="text-center max-w-sm px-6">
                <FileWarning size={28} className="text-amber-600 mx-auto mb-3" />
                <div className="font-semibold text-slate-900">PDF preview failed</div>
                <p className="text-[12px] text-slate-600 mt-1.5">{err}</p>
              </div>
            </div>
          ) : iframeBlocked ? (
            <div className="absolute inset-0 grid place-items-center" data-testid="pdf-modal-blocked">
              <div className="text-center max-w-md px-6">
                <FileWarning size={28} className="text-amber-600 mx-auto mb-3" />
                <div className="font-semibold text-slate-900">Your browser blocked the inline preview</div>
                <p className="text-[12px] text-slate-600 mt-1.5">
                  {isBlobMode
                    ? 'This is usually caused by an ad blocker or privacy extension flagging the local preview URL. Open the PDF in a new tab or download it directly — those paths bypass the extension.'
                    : 'Some browsers refuse to render PDFs inside an iframe. Use the buttons below to open this PDF in a new tab or download it.'}
                </p>
                <div className="mt-4 inline-flex gap-2">
                  <button onClick={openInNewTab}
                    data-testid="pdf-modal-blocked-newtab"
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700">
                    <ExternalLink size={12} /> Open in new tab
                  </button>
                  <button onClick={downloadPdf}
                    data-testid="pdf-modal-blocked-download"
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50">
                    <Download size={12} /> Download PDF
                  </button>
                </div>
              </div>
            </div>
          ) : !src ? (
            <div className="absolute inset-0 grid place-items-center" data-testid="pdf-modal-loading">
              <div className="text-center">
                <Loader2 size={24} className="text-blue-600 animate-spin mx-auto" />
                <div className="text-[12px] text-slate-600 mt-2">Preparing PDF…</div>
              </div>
            </div>
          ) : (
            <iframe data-testid="pdf-modal-iframe"
              title={file.filename || 'PDF preview'}
              src={src}
              onLoad={() => setIframeBlocked(false)}
              className="w-full h-full border-0" />
          )}
        </div>
      </div>
    </div>
  );
}
