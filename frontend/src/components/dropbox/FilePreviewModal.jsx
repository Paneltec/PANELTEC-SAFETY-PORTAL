// v58.13.132n4d — Dropbox file preview modal (PDF.js canvas).
//
// PDF rendering switched from `<object type="application/pdf">`
// (which `.132n4c` used) to `react-pdf` / PDF.js canvas.
// Motivation:
//   Both `<iframe src=blob:…>` and `<object>` delegate PDF
//   rendering to the browser's built-in plugin.  That plugin
//   REFUSES to activate in nested-iframe contexts (e.g. the
//   Emergent preview iframe) or when the parent context has
//   certain CSP restrictions — the user sees either a broken-
//   document icon (`.132n2b`) or the `<object>` child fallback
//   (`.132n4c`), even for well-formed PDFs.
//
//   PDF.js is a pure JS implementation of the PDF spec by
//   Mozilla, running entirely in the client's JS engine + a
//   Web Worker.  No plugin involved, so it works in every
//   context that runs JS.
//
// Everything else is unchanged from `.132n4c`:
//   · 50 MB size guard (backend 413 + FE skip)
//   · retry-once on 5xx/network
//   · per-kind error panels with Download CTA
//   · office types still ride through Dropbox `get_preview`
//     which returns a PDF — now also rendered by PDF.js
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Document, Page, pdfjs } from 'react-pdf';
import api, { apiError } from '@/lib/api';
import {
  Dismiss20Regular, ArrowDownload20Regular,
  ChevronLeft16Regular, ChevronRight16Regular,
} from '@fluentui/react-icons';

// PDF.js Web Worker.  We pin to `pdfjs.version` (bundled by
// `react-pdf`) so the worker + main-thread PDF.js APIs never
// drift, and pull the compiled worker from unpkg's CDN so we
// don't have to configure CRA to emit it as an asset.
//
// react-pdf 7.x / pdfjs-dist 3.x ship a plain `.js` worker
// (v6+ moved to `.mjs` which CRA's webpack can't resolve out
// of the box — hence the pin).
pdfjs.GlobalWorkerOptions.workerSrc =
  `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.js`;

const EXT = (name) => (name || '').toLowerCase().match(/\.[^.]+$/)?.[0] || '';

const PREVIEW_MAX_BYTES = 50 * 1024 * 1024;   // matches backend guard

const KIND_MAP = {
  pdf:   ['.pdf'],
  image: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.heic', '.heif'],
  video: ['.mp4', '.webm', '.mov'],
  audio: ['.mp3', '.wav', '.ogg', '.m4a'],
  text:  ['.txt', '.csv', '.md', '.json', '.xml', '.yaml', '.yml', '.log',
          '.html', '.htm', '.js', '.jsx', '.ts', '.tsx', '.py', '.java',
          '.rb', '.go', '.rs', '.css', '.scss', '.sql', '.sh', '.ini', '.conf'],
  // Office file types.  Backend converts these to PDF via Dropbox's
  // `get_preview` — from the FE's perspective the response body IS
  // a PDF, so we render it exactly the same way as a native PDF.
  office: ['.doc', '.docx', '.rtf', '.ppt', '.pptx', '.xls', '.xlsm', '.xlsx',
           '.ods', '.odt', '.odp'],
};

function fileKind(name) {
  const ext = EXT(name);
  for (const [kind, exts] of Object.entries(KIND_MAP)) {
    if (exts.includes(ext)) return kind;
  }
  return 'unsupported';
}

function classifyError(err) {
  const status = err?.response?.status;
  if (status === 413) return { kind: 'too_big', message: 'This file is too large to preview (>50 MB).' };
  if (status === 415) return { kind: 'unsupported', message: 'Dropbox can\'t preview this file type.' };
  if (status === 404) return { kind: 'not_found', message: 'This file no longer exists in Dropbox.' };
  return { kind: 'generic', message: apiError(err) };
}

export default function FilePreviewModal({ entry, onClose }) {
  const kind = useMemo(() => (entry ? fileKind(entry.name) : 'unsupported'), [entry]);

  const [state, setState] = useState({
    loading: true,
    errorInfo: null,
    // For PDF (native + office-converted) we hold the raw Blob and
    // hand it to `<Document file={blob}>` — react-pdf accepts a Blob
    // directly, so we skip the URL.createObjectURL dance for PDFs.
    pdfBlob: null,
    // Non-PDF kinds still use the blob URL path.
    url: null,
    text: null,
  });
  const objectUrlsRef = useRef([]);

  useEffect(() => {
    if (!entry) return undefined;
    let cancelled = false;
    setState({ loading: true, errorInfo: null, pdfBlob: null, url: null, text: null });

    const revokePrevious = () => {
      for (const u of objectUrlsRef.current) {
        try { URL.revokeObjectURL(u); } catch (_) { /* noop */ }
      }
      objectUrlsRef.current = [];
    };
    revokePrevious();

    if (typeof entry.size === 'number' && entry.size > PREVIEW_MAX_BYTES) {
      setState({
        loading: false,
        errorInfo: { kind: 'too_big', message:
          `This file is ${(entry.size / (1024*1024)).toFixed(1)} MB — larger than the 50 MB preview limit.` },
        pdfBlob: null, url: null, text: null,
      });
      return undefined;
    }

    const run = async (attempt = 0) => {
      try {
        if (kind === 'unsupported') {
          if (!cancelled) setState({ loading: false, errorInfo: null, pdfBlob: null, url: null, text: null });
          return;
        }

        const resp = await api.get('/dropbox/browse/preview', {
          params: { path: entry.path },
          responseType: 'blob',
        });

        if (resp.data.type === 'application/json') {
          const txt = await resp.data.text();
          try {
            const parsed = JSON.parse(txt);
            const synthetic = new Error(parsed.detail || 'preview failed');
            synthetic.response = { status: resp.status, data: parsed };
            throw synthetic;
          } catch (parseErr) {
            throw new Error(txt);
          }
        }

        if (kind === 'text') {
          const txt = await resp.data.text();
          if (!cancelled) setState({ loading: false, errorInfo: null, pdfBlob: null, url: null, text: txt });
          return;
        }

        // `.132n4d` — PDFs (native + office-converted) go through
        // react-pdf.  We normalise the Blob type so PDF.js's
        // internal fetch (which trusts the Blob's `type`) doesn't
        // trip on `application/octet-stream` responses from axios.
        if (kind === 'pdf' || kind === 'office') {
          let blob = resp.data;
          if (blob.type !== 'application/pdf') {
            blob = new Blob([blob], { type: 'application/pdf' });
          }
          if (!cancelled) setState({ loading: false, errorInfo: null, pdfBlob: blob, url: null, text: null });
          return;
        }

        const url = URL.createObjectURL(resp.data);
        objectUrlsRef.current.push(url);
        if (!cancelled) setState({ loading: false, errorInfo: null, pdfBlob: null, url, text: null });
      } catch (err) {
        if (cancelled) return;
        const status = err?.response?.status;
        const isRetryable = !status || status >= 500;
        if (isRetryable && attempt < 1) {
          await new Promise((r) => setTimeout(r, 1000));
          if (!cancelled) run(attempt + 1);
          return;
        }
        setState({
          loading: false,
          errorInfo: classifyError(err),
          pdfBlob: null, url: null, text: null,
        });
      }
    };
    run();

    return () => {
      cancelled = true;
      for (const u of objectUrlsRef.current) {
        try { URL.revokeObjectURL(u); } catch (_) { /* noop */ }
      }
      objectUrlsRef.current = [];
    };
  }, [entry, kind]);

  useEffect(() => {
    if (!entry) return undefined;
    const onKey = (ev) => { if (ev.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [entry, onClose]);

  const doDownload = async () => {
    try {
      const { data } = await api.get('/dropbox/browse/download', {
        params: { path: entry.path },
      });
      window.open(data.url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      toast.error(`Download failed: ${apiError(err)}`);
    }
  };

  // Escalates PDF.js parse failure into the standard errorInfo
  // surface so the FE renders the same "Preview failed — Download"
  // panel as any other kind.
  const markPdfFailed = (err) => {
    setState((s) => ({
      ...s,
      errorInfo: { kind: 'generic', message:
        `PDF renderer error: ${err?.message || 'unknown'}` },
      pdfBlob: null,
    }));
  };

  if (!entry) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      data-testid="dropbox-preview-modal"
    >
      <div className="w-full max-w-6xl bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col"
           style={{ height: '92vh' }}>
        <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-200 shrink-0">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-slate-800 truncate"
                 title={entry.name}
                 data-testid="dropbox-preview-name">
              {entry.name}
            </div>
            <div className="text-xs text-slate-500 truncate font-mono">
              {entry.path}
            </div>
          </div>
          <button
            type="button"
            onClick={doDownload}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg
                       text-xs font-medium text-slate-700 bg-slate-100
                       hover:bg-slate-200 active:bg-slate-300 transition"
            data-testid="dropbox-preview-download-btn"
          >
            <ArrowDownload20Regular className="w-4 h-4" />
            Download
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100
                       hover:text-slate-800 transition"
            aria-label="Close preview"
            data-testid="dropbox-preview-close-btn"
          >
            <Dismiss20Regular className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 min-h-0 bg-slate-100 overflow-hidden"
             data-testid="dropbox-preview-body">
          <PreviewBody
            kind={kind}
            state={state}
            entry={entry}
            onDownload={doDownload}
            onPdfFailed={markPdfFailed}
          />
        </div>
      </div>
    </div>
  );
}

function PreviewBody({ kind, state, entry, onDownload, onPdfFailed }) {
  if (state.loading) {
    return (
      <div className="w-full h-full flex items-center justify-center text-slate-500 text-xs"
           data-testid="dropbox-preview-loading">
        <div className="flex items-center gap-3">
          <div className="w-4 h-4 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />
          <span>Loading preview…</span>
        </div>
      </div>
    );
  }
  if (state.errorInfo) {
    const { kind: errKind, message } = state.errorInfo;
    const headings = {
      too_big:      'Too large to preview',
      unsupported:  'Preview not supported',
      not_found:    'File not found',
      generic:      'Preview failed',
    };
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-sm text-slate-600 px-6 text-center"
           data-testid={`dropbox-preview-error-${errKind}`}>
        <div className="font-semibold text-rose-600">
          {headings[errKind] || headings.generic}
        </div>
        <div className="text-xs text-slate-500 max-w-md">{message}</div>
        <button
          type="button"
          onClick={onDownload}
          className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg
                     text-xs font-medium text-white bg-slate-800 hover:bg-slate-900"
          data-testid="dropbox-preview-error-download-btn"
        >
          <ArrowDownload20Regular className="w-4 h-4" />
          Download instead
        </button>
      </div>
    );
  }

  if (kind === 'unsupported') {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-sm text-slate-600 px-6 text-center"
           data-testid="dropbox-preview-unsupported">
        <div className="font-semibold text-slate-800">No preview available</div>
        <div className="text-xs text-slate-500 max-w-md">
          This file type can't be previewed in the browser. Use Download to
          open it locally with the right application.
        </div>
        <button
          type="button"
          onClick={onDownload}
          className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg
                     text-xs font-medium text-white bg-slate-800 hover:bg-slate-900"
          data-testid="dropbox-preview-unsupported-download-btn"
        >
          <ArrowDownload20Regular className="w-4 h-4" />
          Download
        </button>
      </div>
    );
  }

  if (kind === 'pdf' || kind === 'office') {
    // Both go through `react-pdf`.  Native PDFs use their own
    // bytes; office types use the PDF Dropbox rendered for them.
    return (
      <PdfCanvasView
        blob={state.pdfBlob}
        entryName={entry.name}
        onFailed={onPdfFailed}
      />
    );
  }

  if (kind === 'image') {
    return (
      <div className="w-full h-full flex items-center justify-center p-4">
        <img
          src={state.url}
          alt={entry.name}
          className="max-w-full max-h-full object-contain"
          data-testid="dropbox-preview-image"
        />
      </div>
    );
  }

  if (kind === 'video') {
    return (
      <div className="w-full h-full flex items-center justify-center bg-black">
        <video
          src={state.url}
          controls
          className="max-w-full max-h-full"
          data-testid="dropbox-preview-video"
        />
      </div>
    );
  }

  if (kind === 'audio') {
    return (
      <div className="w-full h-full flex items-center justify-center p-6">
        <audio
          src={state.url}
          controls
          className="w-full max-w-xl"
          data-testid="dropbox-preview-audio"
        />
      </div>
    );
  }

  if (kind === 'text') {
    return (
      <pre
        className="w-full h-full overflow-auto bg-white p-4 text-xs font-mono
                   text-slate-800 whitespace-pre-wrap break-words"
        data-testid="dropbox-preview-text"
      >
        {state.text}
      </pre>
    );
  }

  return null;
}

// PDF.js canvas renderer.  Uses react-pdf's `<Document>` +
// `<Page>` under the hood — pure JS, no plugin, works in every
// browser context (including nested iframes like the Emergent
// preview shell).
//
//   · Continuous-scroll: renders every page in a scrollable
//     column.  Feels more familiar than paged nav to non-technical
//     users, and there's no "surprise" of stopping at page 1 when
//     the doc has 12 pages.
//   · Sticky footer shows "Page N of M" — updated via an
//     `IntersectionObserver` so the currently-most-visible page
//     surfaces the number.
//   · Prev / Next buttons scroll the sticky "current page" up or
//     down for keyboard-averse users.
function PdfCanvasView({ blob, entryName, onFailed }) {
  const [numPages, setNumPages] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [width, setWidth] = useState(0);
  const containerRef = useRef(null);
  const pageRefs = useRef({});   // {pageNumber: DOM node}

  // `<Document file>` accepts either a Blob directly or an
  // `{data}` object.  We pass Blob directly — react-pdf 11 handles
  // the conversion.
  const fileProp = useMemo(() => (blob ? blob : null), [blob]);

  // Responsive width — measure the container so page bitmaps
  // match the modal's actual width at any zoom.
  useEffect(() => {
    if (!containerRef.current) return undefined;
    const el = containerRef.current;
    const measure = () => {
      // Leave a 32 px gutter so the scrollbar + shadow don't
      // clip pages.  Fall back to 900 px if the container hasn't
      // laid out yet.
      const w = el.clientWidth - 32;
      setWidth(w > 300 ? w : 900);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Track which page is currently most-visible so the footer
  // "Page N of M" indicator stays in sync with scroll position.
  useEffect(() => {
    if (!containerRef.current || !numPages) return undefined;
    const obs = new IntersectionObserver(
      (entries) => {
        // Pick the entry with the largest intersection ratio.
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible.length > 0) {
          const n = Number(visible[0].target.getAttribute('data-page'));
          if (n) setCurrentPage(n);
        }
      },
      { root: containerRef.current, threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    for (const node of Object.values(pageRefs.current)) {
      if (node) obs.observe(node);
    }
    return () => obs.disconnect();
  }, [numPages]);

  const scrollToPage = (n) => {
    const node = pageRefs.current[n];
    if (node) node.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleLoadSuccess = ({ numPages: n }) => {
    setNumPages(n);
    setCurrentPage(1);
  };
  const handleLoadError = (err) => {
    // Any parse failure lands the user in the shared errorInfo
    // pane with a Download CTA rather than a blank canvas.
    onFailed(err);
  };

  return (
    <div className="w-full h-full flex flex-col bg-slate-100"
         data-testid="dropbox-preview-pdfjs">
      <div ref={containerRef}
           className="flex-1 min-h-0 overflow-auto px-4 py-4">
        {fileProp && width > 0 && (
          <Document
            file={fileProp}
            onLoadSuccess={handleLoadSuccess}
            onLoadError={handleLoadError}
            loading={
              <div className="w-full h-full flex items-center justify-center text-slate-500 text-xs">
                <div className="flex items-center gap-3">
                  <div className="w-4 h-4 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />
                  <span>Parsing PDF…</span>
                </div>
              </div>
            }
            error={
              <div className="w-full h-full flex items-center justify-center text-rose-600 text-xs">
                Failed to render PDF.
              </div>
            }
            noData={<span className="text-slate-500 text-xs">No PDF data.</span>}
          >
            {numPages && Array.from({ length: numPages }, (_, i) => i + 1).map((n) => (
              <div
                key={n}
                data-page={n}
                ref={(el) => { if (el) pageRefs.current[n] = el; }}
                className="mb-4 flex justify-center"
              >
                <div className="shadow-lg bg-white">
                  <Page
                    pageNumber={n}
                    width={width}
                    renderTextLayer={false}
                    renderAnnotationLayer={false}
                  />
                </div>
              </div>
            ))}
          </Document>
        )}
      </div>
      {numPages && numPages > 0 && (
        <div className="shrink-0 border-t border-slate-200 bg-white px-4 py-2 flex items-center gap-3"
             data-testid="dropbox-preview-pdf-footer">
          <button
            type="button"
            onClick={() => scrollToPage(Math.max(1, currentPage - 1))}
            disabled={currentPage <= 1}
            className="p-1.5 rounded-md text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Previous page"
            data-testid="dropbox-preview-pdf-prev"
          >
            <ChevronLeft16Regular style={{ width: 14, height: 14 }} />
          </button>
          <div className="text-xs text-slate-600 font-medium"
               data-testid="dropbox-preview-pdf-page-label">
            Page {currentPage} of {numPages}
          </div>
          <button
            type="button"
            onClick={() => scrollToPage(Math.min(numPages, currentPage + 1))}
            disabled={currentPage >= numPages}
            className="p-1.5 rounded-md text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Next page"
            data-testid="dropbox-preview-pdf-next"
          >
            <ChevronRight16Regular style={{ width: 14, height: 14 }} />
          </button>
          <div className="ml-auto text-[11px] text-slate-400 font-mono truncate max-w-xs"
               title={entryName}>
            {entryName}
          </div>
        </div>
      )}
    </div>
  );
}
