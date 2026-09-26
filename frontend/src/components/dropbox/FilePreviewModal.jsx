// v58.13.132n4c — Dropbox file preview modal (reliability fix).
//
// Changes vs `.132n2b`:
//   1. **Size guard** — `PREVIEW_MAX_BYTES = 50 MB`. Files above
//      this skip the preview fetch entirely and render a clean
//      "Download instead" panel. Backend enforces the same cap
//      via a 413 response for defence-in-depth.
//   2. **PDF viewer switched from `<iframe>` to `<object>`** —
//      `<object type="application/pdf" data={blobUrl}>`. `<object>`
//      lets browsers hand-off to their native PDF plugin AND
//      renders a proper "Download to view" text fallback when the
//      plugin can't paint. Fixes the "blank iframe + broken-doc
//      icon" symptom that plain `<iframe src=blob>` produces on
//      Firefox / some Chrome PDF-viewer configurations.
//   3. **Retry-once on fetch failure** — 1 s backoff.
//   4. **Specific error surfaces** — 413 (too large), 415
//      (unsupported by Dropbox), other 4xx/5xx → distinct
//      messages with a Download CTA.
//   5. **Object load error handler** — if the browser can't paint
//      the PDF (`onError` fires on `<object>` before the fallback
//      child renders), we swap to the "Preview failed" panel with
//      the Download CTA rather than leaving a blank pane.
//
// Type dispatch by extension (unchanged from `.132n2b`):
//   · PDF                                     → proxy → <object>
//   · Image (png/jpg/gif/webp/svg/bmp/heic)   → proxy → <img> blob
//   · Video (mp4/webm/mov)                    → proxy → <video> blob
//   · Audio (mp3/wav/ogg/m4a)                 → proxy → <audio> blob
//   · Text / code (txt/csv/md/json/xml/yml/…) → proxy → <pre> text
//   · Office (docx/xlsx/pptx/doc/xls/ppt/rtf) → proxy (get_preview)
//                                                 → PDF/HTML → <iframe>
//   · anything else                           → "no preview" panel
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import api, { apiError } from '@/lib/api';
import { Dismiss20Regular, ArrowDownload20Regular } from '@fluentui/react-icons';

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

// `.132n4c` — Distinguish HTTP failure modes so the FE can
// surface the right guidance:
//   413 → too big (from backend guard)
//   415 → Dropbox can't preview this
//   404 → file gone
//   other → generic
function classifyError(err) {
  const status = err?.response?.status;
  if (status === 413) return { kind: 'too_big', message: 'This file is too large to preview (>50 MB).' };
  if (status === 415) return { kind: 'unsupported', message: 'Dropbox can\'t preview this file type.' };
  if (status === 404) return { kind: 'not_found', message: 'This file no longer exists in Dropbox.' };
  return { kind: 'generic', message: apiError(err) };
}

export default function FilePreviewModal({ entry, onClose }) {
  const kind = useMemo(() => (entry ? fileKind(entry.name) : 'unsupported'), [entry]);

  // `errorInfo` is `{kind, message}` or null; `state.error` holds
  // the underlying axios error only for logging. The FE reads
  // `errorInfo.kind` to decide which panel to render.
  const [state, setState] = useState({
    loading: true,
    errorInfo: null,
    url: null,
    text: null,
  });
  const objectUrlsRef = useRef([]);

  useEffect(() => {
    if (!entry) return undefined;
    let cancelled = false;
    setState({ loading: true, errorInfo: null, url: null, text: null });

    const revokePrevious = () => {
      for (const u of objectUrlsRef.current) {
        try { URL.revokeObjectURL(u); } catch (_) { /* noop */ }
      }
      objectUrlsRef.current = [];
    };
    revokePrevious();

    // `.132n4c` — early size guard, matches backend 413 threshold.
    // Skip the fetch entirely when we already know the file is too
    // big — spares the user a 50 MB blob allocation and a wasted
    // Dropbox `get_preview` request.
    if (typeof entry.size === 'number' && entry.size > PREVIEW_MAX_BYTES) {
      setState({
        loading: false,
        errorInfo: { kind: 'too_big', message:
          `This file is ${(entry.size / (1024*1024)).toFixed(1)} MB — larger than the 50 MB preview limit.` },
        url: null, text: null,
      });
      return undefined;
    }

    const run = async (attempt = 0) => {
      try {
        if (kind === 'unsupported') {
          if (!cancelled) setState({ loading: false, errorInfo: null, url: null, text: null });
          return;
        }

        const resp = await api.get('/dropbox/browse/preview', {
          params: { path: entry.path },
          responseType: 'blob',
        });

        // `.132n4c` — axios treats non-2xx blob responses by
        // returning a Blob of the JSON error body. Detect that
        // and coerce into a normal error path.
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
          if (!cancelled) setState({ loading: false, errorInfo: null, url: null, text: txt });
          return;
        }

        // `.132n4c` — ensure the blob carries the right MIME so
        // `URL.createObjectURL` produces a URL the browser's PDF
        // viewer will accept. Axios sometimes gives us
        // `application/octet-stream` blobs even when the response
        // header was `application/pdf` (CORS pre-flight quirk on
        // some browsers).
        let effectiveBlob = resp.data;
        if (kind === 'pdf' && effectiveBlob.type !== 'application/pdf') {
          effectiveBlob = new Blob([effectiveBlob], { type: 'application/pdf' });
        }
        const url = URL.createObjectURL(effectiveBlob);
        objectUrlsRef.current.push(url);
        if (!cancelled) setState({ loading: false, errorInfo: null, url, text: null });
      } catch (err) {
        if (cancelled) return;
        // `.132n4c` — retry once on network / 5xx after a 1 s
        // backoff. Don't retry on hard failures (413/415/404) that
        // won't get better with a repeat.
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
          url: null,
          text: null,
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

  // Backdrop / esc close
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

  // `.132n4c` — Called from the `<object>` onError handler when
  // the browser fails to paint the PDF (plugin disabled, etc.).
  const markPluginFailed = () => {
    setState((s) => ({
      ...s,
      errorInfo: { kind: 'plugin', message:
        'Your browser couldn\'t render this PDF inline. Try Download instead.' },
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
            onPluginFailed={markPluginFailed}
          />
        </div>
      </div>
    </div>
  );
}

function PreviewBody({ kind, state, entry, onDownload, onPluginFailed }) {
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
      plugin:       'Your browser can\'t render this',
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

  if (kind === 'pdf') {
    // `.132n4c` — `<object>` hands off to the browser's native PDF
    // viewer AND renders the child content as fallback when the
    // viewer can't paint. Both `onError` and the child fallback
    // route to the same "Download instead" CTA.
    return (
      <object
        type="application/pdf"
        data={state.url}
        className="w-full h-full bg-white"
        aria-label={entry.name}
        data-testid="dropbox-preview-pdf-object"
        onError={onPluginFailed}
      >
        <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-sm text-slate-600 px-6 text-center"
             data-testid="dropbox-preview-pdf-fallback">
          <div className="font-semibold text-slate-800">
            PDF preview isn't supported by this browser
          </div>
          <div className="text-xs text-slate-500 max-w-md">
            Use Download to open the PDF in your default reader.
          </div>
          <button
            type="button"
            onClick={onDownload}
            className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg
                       text-xs font-medium text-white bg-slate-800 hover:bg-slate-900"
          >
            <ArrowDownload20Regular className="w-4 h-4" />
            Download PDF
          </button>
        </div>
      </object>
    );
  }

  if (kind === 'office') {
    // Office gets a plain <iframe> because Dropbox's get_preview
    // returns either a rendered PDF (docs) or an HTML page
    // (spreadsheets) — the latter needs iframe not object.
    return (
      <iframe
        src={state.url}
        title={entry.name}
        className="w-full h-full border-0 bg-white"
        data-testid="dropbox-preview-iframe"
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
