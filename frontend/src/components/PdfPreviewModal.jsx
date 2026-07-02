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
import { useEffect, useRef, useState } from 'react';
import { X, Download, ExternalLink, Loader2, FileWarning } from 'lucide-react';
import { toast } from 'sonner';
import * as pdfjsLib from 'pdfjs-dist';
import api, { apiError } from '../lib/api';
import { stashInlinePdf } from '../lib/pdfStash';

// v151 — pdfjs-dist workerSrc. Serve the worker as a same-origin static
// asset so no CSP `worker-src` update is needed and it stays offline-cacheable
// via the service worker.
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.js';

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

export default function PdfPreviewModal({ file, blobUrl, directUrl, headerExtras, footerExtras, onClose }) {
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
  // v149 — track iframe onLoad so we can overlay a "Converting…" hint while
  // the backend runs LibreOffice on the DOCX (cold conversion is 10–30 s).
  const [iframeLoaded, setIframeLoaded] = useState(false);
  // v151 — pdfjs-dist rendering state. `pdfDoc` is the loaded document,
  // `pdfError` flips to true on any pdfjs failure and falls back to the
  // legacy iframe path.
  const [pdfDoc, setPdfDoc] = useState(null);
  const [pdfError, setPdfError] = useState(false);
  const isBlobMode = !!blobUrl && !directUrl;

  useEffect(() => {
    if (!file) return;
    let alive = true;
    setIframeBlocked(false);
    setIframeLoaded(false);
    // v150 — reset err on prop change so a stale error from a previous
    // mount (e.g. SitePrintModal delegating with directUrl=null before
    // generation completes) doesn't leak into the fresh render.
    setErr(null);
    // v149 — the 6 s watchdog exists to catch ad-blocker silence on `blob:`
    // URLs. `directUrl` (same-origin stash) and preview-token modes are
    // HTTPS same-origin — no ad-blocker interference — but the backend
    // may take 10–30 s to convert a DOCX via LibreOffice on first hit, so
    // arming the watchdog there unmounted the iframe before the PDF
    // arrived, producing a false "browser blocked the preview" UI. Gate
    // the watchdog to blob mode only.
    const watchdog = isBlobMode
      ? setTimeout(() => { if (alive) setIframeBlocked(true); }, 6000)
      : null;
    // Mode 2 — caller-supplied same-origin URL. Render immediately.
    if (directUrl) {
      setSrc(directUrl);
      return () => { alive = false; if (watchdog) clearTimeout(watchdog); };
    }
    // Mode 3 — caller-supplied blob URL. Render but keep the watchdog on
    // because ad blockers routinely refuse blob: URLs.
    if (blobUrl) {
      setSrc(blobUrl);
      return () => { alive = false; if (watchdog) clearTimeout(watchdog); };
    }
    // Mode 1 — fetch a signed preview token.
    // v150 — skip if the caller hasn't provided a real file id. This
    // happens when a wrapper (SitePrintModal / SupplierPrintModal)
    // delegates with directUrl=null while it computes the stash URL.
    if (!file.id) return () => { alive = false; if (watchdog) clearTimeout(watchdog); };
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
        // v149 — this parallel fetch also serves as our "PDF is ready"
        // signal. Chrome's PDF viewer plugin intercepts iframe PDF
        // rendering and often doesn't fire `onLoad`, so we can't rely on
        // that alone to hide the "Preparing…" overlay. When this fetch
        // resolves the backend has finished the LibreOffice conversion
        // (or served from cache), so we mark the iframe as loaded too.
        api.get(`/files/${file.id}/pdf`, { responseType: 'blob' })
          .then((rr) => {
            if (!alive) return;
            setPipeline(rr.headers?.['x-pipeline'] || null);
            setIframeLoaded(true);
          })
          .catch(() => {});
      } catch (e) {
        if (alive) setErr(apiError(e));
      }
    })();
    return () => { alive = false; if (watchdog) clearTimeout(watchdog); };
  }, [file, blobUrl, directUrl, isBlobMode]);

  // v151 — pdfjs render effect. Whenever `src` changes we fetch the bytes
  // and load them into pdfjs. Canvas render is then handled inside
  // <PdfCanvasView/> below. If any step fails we flip `pdfError` which
  // shows the legacy iframe fallback + a one-time toast.
  useEffect(() => {
    if (!src) return;
    let alive = true;
    setPdfDoc(null);
    setPdfError(false);
    (async () => {
      try {
        const resp = await fetch(src);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const hdrPipeline = resp.headers.get('x-pipeline');
        if (hdrPipeline && alive) setPipeline(hdrPipeline);
        const buf = await resp.arrayBuffer();
        if (!alive) return;
        const doc = await pdfjsLib.getDocument({ data: buf }).promise;
        if (!alive) { try { doc.destroy(); } catch (_) {} return; }
        setPdfDoc(doc);
        setIframeLoaded(true);
      } catch (e) {
        if (!alive) return;
        console.warn('pdfjs render failed; falling back to iframe', e);
        setPdfError(true);
        toast.info('Using compatibility mode — inline preview may not render on this browser.');
      }
    })();
    return () => { alive = false; };
  }, [src]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const downloadPdf = async () => {
    // v150 — directUrl mode → we already have a same-origin stash URL.
    // Trigger a download from it directly; browser honours the `download`
    // attribute despite the response's inline Content-Disposition.
    if (directUrl) {
      const a = document.createElement('a');
      a.href = directUrl;
      a.download = (file.filename || 'document').replace(/\.[^.]+$/, '') + '.pdf';
      document.body.appendChild(a); a.click(); a.remove();
      return;
    }
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
          {/* v150 — optional caller-supplied header controls (e.g. layout
              tabs for the Site/Supplier QR flows). Rendered between the
              built-in New tab / Download buttons and the Close X. */}
          {headerExtras}
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
          ) : pdfError ? (
            // v151 — pdfjs load or render failed. Fall back to the legacy
            // iframe path so users on browsers where pdfjs is broken still
            // see something. The "New tab" / "Download PDF" buttons above
            // remain functional regardless.
            <>
              <iframe data-testid="pdf-modal-iframe"
                title={file.filename || 'PDF preview'}
                src={src}
                onLoad={() => { setIframeBlocked(false); setIframeLoaded(true); }}
                className="w-full h-full border-0" />
              {!isBlobMode && !iframeLoaded && (
                <div className="absolute inset-0 grid place-items-center bg-slate-100/85 pointer-events-none"
                     data-testid="pdf-modal-converting">
                  <div className="text-center max-w-sm px-6">
                    <Loader2 size={24} className="text-blue-600 animate-spin mx-auto" />
                    <div className="text-[13px] font-semibold text-slate-800 mt-2">Preparing PDF…</div>
                    <p className="text-[11px] text-slate-500 mt-1 leading-snug">
                      Converting document to PDF. This can take up to 30 seconds on first open.
                    </p>
                  </div>
                </div>
              )}
            </>
          ) : pdfDoc ? (
            // v151 — primary render: pdfjs-dist to <canvas>. Works
            // regardless of the browser's built-in PDF viewer, ad
            // blockers, corporate PDF-download policy, or extensions.
            <PdfCanvasView doc={pdfDoc} />
          ) : (
            // pdfjs is parsing the bytes — brief spinner (usually <1 s
            // for cached ReportLab PDFs, 5–15 s for cold LibreOffice DOCX).
            <div className="absolute inset-0 grid place-items-center" data-testid="pdf-modal-parsing">
              <div className="text-center max-w-sm px-6">
                <Loader2 size={24} className="text-blue-600 animate-spin mx-auto" />
                <div className="text-[13px] font-semibold text-slate-800 mt-2">Preparing PDF…</div>
                <p className="text-[11px] text-slate-500 mt-1 leading-snug">
                  Converting document to PDF. This can take up to 30 seconds on first open.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* v150 — optional caller-supplied footer strip (e.g. the "Token: <t>"
            hint on the Site QR modal). Rendered below the body area. */}
        {footerExtras}
      </div>
    </div>
  );
}

// ─────────────────── v151 — pdfjs canvas renderer ───────────────────
// Renders every page of a PDFDocumentProxy to a <canvas>, fit-to-width
// based on the container's live width. Pages are laid out vertically
// with soft separators. No zoom or nav — user can Ctrl+scroll in-browser
// or hit "New tab" for the browser's own viewer.
function PdfCanvasView({ doc }) {
  const containerRef = useRef(null);
  const canvasRefs = useRef([]);
  const [containerWidth, setContainerWidth] = useState(0);
  const numPages = doc?.numPages || 0;

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    setContainerWidth(el.clientWidth);
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setContainerWidth(e.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!doc || !containerWidth) return;
    let cancelled = false;
    const activeTasks = [];
    (async () => {
      for (let i = 1; i <= numPages; i++) {
        if (cancelled) break;
        try {
          const page = await doc.getPage(i);
          const canvas = canvasRefs.current[i - 1];
          if (!canvas) continue;
          const base = page.getViewport({ scale: 1 });
          // Fit page width to container minus a bit of horizontal padding.
          const targetWidth = Math.max(240, containerWidth - 32);
          const scale = targetWidth / base.width;
          const viewport = page.getViewport({ scale });
          const dpr = window.devicePixelRatio || 1;
          canvas.width = Math.floor(viewport.width * dpr);
          canvas.height = Math.floor(viewport.height * dpr);
          canvas.style.width = `${viewport.width}px`;
          canvas.style.height = `${viewport.height}px`;
          const ctx = canvas.getContext('2d');
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          // v151.1 — track the render task so we can cancel it on effect
          // cleanup (avoids "same canvas during multiple render()" when
          // the ResizeObserver fires mid-render).
          const task = page.render({ canvasContext: ctx, viewport });
          activeTasks.push(task);
          await task.promise;
        } catch (e) {
          if (!cancelled && e?.name !== 'RenderingCancelledException') {
            console.warn(`pdfjs page ${i} render failed`, e);
          }
        }
      }
    })();
    return () => {
      cancelled = true;
      for (const t of activeTasks) { try { t.cancel(); } catch (_) {} }
    };
  }, [doc, numPages, containerWidth]);

  return (
    <div ref={containerRef}
         className="absolute inset-0 overflow-auto bg-slate-100 p-3"
         data-testid="pdf-modal-canvas-container">
      <div className="flex flex-col items-center gap-3">
        {Array.from({ length: numPages }).map((_, i) => (
          <canvas key={i}
            ref={(el) => { canvasRefs.current[i] = el; }}
            data-testid={`pdf-modal-page-${i + 1}`}
            className="shadow-md bg-white" />
        ))}
      </div>
    </div>
  );
}
