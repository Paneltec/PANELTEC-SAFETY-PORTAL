// v58.13.74 — In-app inline file preview modal.
//
// USER-VISIBLE PAIN (v58.13.73 regression): even though the backend
// returns `Content-Disposition: inline` for PDFs / PNGs, Microsoft
// Edge's `edge://settings/content/pdfDocuments` "Download PDF files"
// setting overrides the header and saves ALL top-level PDF navigations
// to disk. Some corporate Edge policies do the same for images.
// `window.open()` is a top-level navigation, so it inherits the
// browser's PDF-download preference and defeats the whole inline
// experience.
//
// FIX: render the preview INSIDE an iframe/img inside the app, using a
// same-origin `blob:` URL. Browser PDF-download preferences NEVER
// apply to blob-URL iframes — they render in-page always. Same story
// for images and text — a same-tab `<img src=blob>` / `<pre>` bypass
// every popup / download preference the browser might have.
//
// The Bearer JWT is attached via `fetch()` before the blob is created;
// the iframe/img/pre never touches auth, avoiding the cross-origin
// iframe-cookie / referer friction that historically forced us into
// `window.open()` in v58.13.72.

import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Download, Loader2, FileWarning } from 'lucide-react';
import { toast } from 'sonner';
import { API_BASE } from '../lib/api';
import { getToken } from '../lib/auth';
import useLockBodyScroll from '../lib/useLockBodyScroll';

// Kind detection — pure function so callers can pre-guard.
function detectKind(mime, filename) {
  const m = String(mime || '').toLowerCase();
  const n = String(filename || '').toLowerCase();
  if (m === 'application/pdf' || n.endsWith('.pdf')) return 'pdf';
  if (m.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg)$/.test(n)) return 'image';
  if (
    m === 'text/plain' || m === 'application/json' ||
    m === 'application/xml' || m === 'text/xml' ||
    /\.(txt|log|md|json|xml)$/.test(n)
  ) return 'text';
  return null;
}

export function isFileInlinePreviewable(mime, filename) {
  return detectKind(mime, filename) !== null;
}

export default function FilePreviewModal({ file, onClose }) {
  useLockBodyScroll();
  const [blobUrl, setBlobUrl] = useState(null);
  const [textBody, setTextBody] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);
  const abortRef = useRef(null);

  const kind = useMemo(() => detectKind(file?.mime, file?.filename), [file]);

  useEffect(() => {
    if (!file) return undefined;
    const ac = new AbortController();
    abortRef.current = ac;
    let objectUrl = null;
    setLoading(true);
    setErr(null);
    setBlobUrl(null);
    setTextBody(null);

    (async () => {
      try {
        const res = await fetch(
          `${API_BASE}/document-library/files/${file.id}/download`,
          {
            headers: { Authorization: `Bearer ${getToken()}` },
            signal: ac.signal,
          },
        );
        if (!res.ok) throw new Error(`Load failed (${res.status})`);
        if (kind === 'text') {
          const txt = await res.text();
          if (!ac.signal.aborted) setTextBody(txt);
        } else {
          const blob = await res.blob();
          objectUrl = URL.createObjectURL(blob);
          if (!ac.signal.aborted) setBlobUrl(objectUrl);
        }
      } catch (e) {
        if (e.name !== 'AbortError') setErr(e.message || 'Could not load file');
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    })();

    return () => {
      ac.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file, kind]);

  // ESC to close.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const download = async () => {
    try {
      const res = await fetch(
        `${API_BASE}/document-library/files/${file.id}/download?download=1`,
        { headers: { Authorization: `Bearer ${getToken()}` } },
      );
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const b = await res.blob();
      const u = URL.createObjectURL(b);
      const a = document.createElement('a');
      a.href = u; a.download = file.filename;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(u);
    } catch (e) {
      toast.error(e.message || 'Could not download');
    }
  };

  if (!file) return null;

  return (
    <div
      className="fixed inset-0 z-[80] bg-slate-950/70 flex items-center justify-center p-4"
      onClick={onClose}
      data-testid="file-preview-modal"
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-5xl h-[92vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 shrink-0">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-slate-900 truncate" title={file.filename}>
              {file.filename}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5 uppercase tracking-wider">
              {kind ? `${kind} preview` : 'preview'}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0 ml-3">
            <button
              onClick={download}
              className="p-2 rounded hover:bg-slate-100 text-slate-600"
              title="Download original"
              data-testid="file-preview-download"
            >
              <Download size={16} />
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded hover:bg-slate-100 text-slate-600"
              title="Close (Esc)"
              data-testid="file-preview-close"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 bg-slate-50 relative">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center gap-2 text-slate-500">
              <Loader2 className="animate-spin" size={18} /> Loading…
            </div>
          )}
          {err && !loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-slate-600">
              <FileWarning className="text-amber-500" />
              <div>{err}</div>
            </div>
          )}
          {!loading && !err && kind === 'pdf' && blobUrl && (
            <iframe
              title={file.filename}
              src={blobUrl}
              className="w-full h-full border-0 bg-white"
              data-testid="file-preview-iframe"
            />
          )}
          {!loading && !err && kind === 'image' && blobUrl && (
            <div className="w-full h-full overflow-auto flex items-center justify-center p-4">
              <img
                src={blobUrl}
                alt={file.filename}
                className="max-w-full max-h-full object-contain"
                data-testid="file-preview-image"
              />
            </div>
          )}
          {!loading && !err && kind === 'text' && textBody !== null && (
            <pre
              className="w-full h-full overflow-auto p-4 text-[12px] leading-5 font-mono text-slate-900 bg-white whitespace-pre-wrap break-words"
              data-testid="file-preview-text"
            >{textBody}</pre>
          )}
        </div>
      </div>
    </div>
  );
}
