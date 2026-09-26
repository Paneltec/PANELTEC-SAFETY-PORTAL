// v58.13.132n2b — Dropbox file preview modal.
//
// Renders an inline preview of a Dropbox file inside the app,
// instead of the pre-`.132n2b` behaviour of popping the raw
// temporary link in a new tab (which every browser correctly
// treats as a download for anything that isn't a PDF or image —
// AND, we discovered, Dropbox temp links ship
// `Content-Disposition: attachment` + `Content-Security-Policy:
// sandbox` which force browsers to save-dialog even for PDFs and
// images, so temp links are USELESS for inline preview).
//
// Solution: every previewable type is fetched through the
// backend `/api/dropbox/browse/preview` proxy which re-writes
// the disposition to `inline`. The browser then renders the
// blob URL in-place via <iframe>/<img>/<video>/<audio>/<pre>.
//
// Type dispatch by extension:
//   · PDF                                     → proxy → <iframe> blob
//   · Image (png/jpg/gif/webp/svg/bmp/heic)   → proxy → <img> blob
//   · Video (mp4/webm/mov)                    → proxy → <video> blob
//   · Audio (mp3/wav/ogg/m4a)                 → proxy → <audio> blob
//   · Text / code (txt/csv/md/json/xml/yml/…) → proxy → <pre> text
//   · Office (docx/xlsx/pptx/doc/xls/ppt/rtf) → proxy (get_preview)
//                                                 → PDF/HTML → <iframe>
//   · anything else                           → "no preview" panel
//
// `.132n2a` team-namespace fix means every path the browser
// hands us is namespace-relative (`/Foo/Bar.docx`). We forward
// verbatim to the backend which re-normalises the path anyway.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import api, { apiError } from '@/lib/api';
import { Dismiss20Regular, ArrowDownload20Regular } from '@fluentui/react-icons';

const EXT = (name) => (name || '').toLowerCase().match(/\.[^.]+$/)?.[0] || '';

const KIND_MAP = {
  pdf:   ['.pdf'],
  image: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.heic', '.heif'],
  video: ['.mp4', '.webm', '.mov'],
  audio: ['.mp3', '.wav', '.ogg', '.m4a'],
  text:  ['.txt', '.csv', '.md', '.json', '.xml', '.yaml', '.yml', '.log',
          '.html', '.htm', '.js', '.jsx', '.ts', '.tsx', '.py', '.java',
          '.rb', '.go', '.rs', '.css', '.scss', '.sql', '.sh', '.ini', '.conf'],
  // Office types are converted to PDF/HTML server-side via
  // Dropbox's /2/files/get_preview call.
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

export default function FilePreviewModal({ entry, onClose }) {
  // `entry` shape: { name, path, type: 'file', size, modified, mime_type }
  const kind = useMemo(() => (entry ? fileKind(entry.name) : 'unsupported'), [entry]);

  const [state, setState] = useState({ loading: true, error: null, url: null, text: null });
  // Every objectURL we mint gets tracked so the cleanup pass on
  // unmount (or on entry change) revokes them and doesn't leak
  // blob memory for the life of the tab.
  const objectUrlsRef = useRef([]);

  useEffect(() => {
    if (!entry) return undefined;
    let cancelled = false;
    setState({ loading: true, error: null, url: null, text: null });

    const revokePrevious = () => {
      for (const u of objectUrlsRef.current) {
        try { URL.revokeObjectURL(u); } catch (_) { /* noop */ }
      }
      objectUrlsRef.current = [];
    };
    revokePrevious();

    const run = async () => {
      try {
        if (kind === 'unsupported') {
          if (!cancelled) setState({ loading: false, error: null, url: null, text: null });
          return;
        }

        // Every previewable kind goes through the backend proxy so
        // we get inline Content-Disposition (Dropbox temp links
        // force download otherwise).
        const resp = await api.get('/dropbox/browse/preview', {
          params: { path: entry.path },
          responseType: 'blob',
        });

        if (kind === 'text') {
          const txt = await resp.data.text();
          if (!cancelled) setState({ loading: false, error: null, url: null, text: txt });
          return;
        }

        const url = URL.createObjectURL(resp.data);
        objectUrlsRef.current.push(url);
        if (!cancelled) setState({ loading: false, error: null, url, text: null });
      } catch (err) {
        if (!cancelled) setState({ loading: false, error: apiError(err), url: null, text: null });
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
    // Download uses the /download temp-link endpoint — that's the
    // one flow where the Dropbox `attachment` Content-Disposition
    // is what we WANT (native "Save as" dialog).
    try {
      const { data } = await api.get('/dropbox/browse/download', {
        params: { path: entry.path },
      });
      window.open(data.url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      toast.error(`Download failed: ${apiError(err)}`);
    }
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
        {/* Header */}
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

        {/* Body */}
        <div className="flex-1 min-h-0 bg-slate-100 overflow-hidden"
             data-testid="dropbox-preview-body">
          <PreviewBody kind={kind} state={state} entry={entry} onDownload={doDownload} />
        </div>
      </div>
    </div>
  );
}

function PreviewBody({ kind, state, entry, onDownload }) {
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
  if (state.error) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-sm text-slate-600 px-6 text-center"
           data-testid="dropbox-preview-error">
        <div className="font-semibold text-rose-600">Preview failed</div>
        <div className="text-xs text-slate-500 max-w-md">{state.error}</div>
        <button
          type="button"
          onClick={onDownload}
          className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg
                     text-xs font-medium text-white bg-slate-800 hover:bg-slate-900"
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

  // Defensive fallback — should never hit given the kind switch above.
  return null;
}
