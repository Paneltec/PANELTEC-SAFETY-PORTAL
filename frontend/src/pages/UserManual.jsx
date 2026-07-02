import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  BookOpen24Regular, Search24Regular, ArrowDownload24Regular,
  Dismiss16Regular,
} from '@fluentui/react-icons';
import api from '../lib/api';

// Phase 4.11 (paneltec-v121) — in-app rendering of the User Manual
// sourced from /api/help/manual.md (markdown SOT in
// /app/backend/content/user_manual.md). Three-column layout:
//   · left  — sticky table of contents (every H2 anchor)
//   · main  — the rendered markdown with stable slug ids on H2/H3
//   · right — "On this page" H3 anchor rail (hidden on small screens)
// Header carries a search input that highlights matches in-page and
// scrolls to the first hit, plus a Download PDF button that streams
// /api/help/manual.pdf.

function slugify(s = '') {
  return s.toString().toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function highlight(node, query) {
  if (!query || typeof node !== 'string') return node;
  const rx = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  const parts = node.split(rx);
  return parts.map((p, i) =>
    rx.test(p)
      ? <mark key={i} className="bg-orange-200 text-slate-900 px-0.5 rounded-sm">{p}</mark>
      : p
  );
}

export default function UserManual() {
  const [md, setMd] = useState('');
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const contentRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get('/help/manual.md', { responseType: 'text' });
        setMd(typeof r.data === 'string' ? r.data : '');
      } catch {
        setMd('# Unable to load manual\n\nPlease retry in a moment.');
      } finally { setLoading(false); }
    })();
  }, []);

  // Build TOC from the markdown source (cheaper than walking the DOM).
  const toc = useMemo(() => {
    const out = [];
    md.split('\n').forEach((ln) => {
      const m = ln.match(/^(#{2,3})\s+(.+)$/);
      if (m) {
        const lvl = m[1].length;            // 2 or 3
        const text = m[2].trim();
        out.push({ lvl, text, slug: slugify(text) });
      }
    });
    return out;
  }, [md]);

  const h2s = toc.filter((t) => t.lvl === 2);
  const h3s = toc.filter((t) => t.lvl === 3);

  // Jump to first match on query change (debounced via useEffect timing).
  useEffect(() => {
    if (!query || !contentRef.current) return;
    const root = contentRef.current;
    const mark = root.querySelector('mark');
    if (mark) mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [query]);

  // react-markdown component overrides — apply slug ids + brand classes.
  const components = {
    h1: ({ node, children, ...p }) => (
      <h1 {...p} className="font-display text-3xl sm:text-4xl font-bold text-slate-900 mt-2 mb-4"
        data-testid="manual-h1">{highlight(children?.toString?.() || children, query)}</h1>
    ),
    h2: ({ node, children, ...p }) => {
      const text = children?.toString?.() || (Array.isArray(children) ? children.join('') : '');
      const id = slugify(text);
      return (
        <h2 {...p} id={id} className="font-display text-2xl font-semibold text-slate-900 mt-10 mb-3 scroll-mt-24 border-b border-slate-200 pb-2"
          data-testid={`manual-h2-${id}`}>{highlight(text, query)}</h2>
      );
    },
    h3: ({ node, children, ...p }) => {
      const text = children?.toString?.() || (Array.isArray(children) ? children.join('') : '');
      const id = slugify(text);
      return (
        <h3 {...p} id={id} className="text-lg font-semibold text-orange-600 mt-6 mb-2 scroll-mt-24"
          data-testid={`manual-h3-${id}`}>{highlight(text, query)}</h3>
      );
    },
    p:  ({ node, children, ...p }) => <p {...p} className="text-[15px] leading-relaxed text-slate-700 mb-3">{
      Array.isArray(children) ? children.map((c, i) => <React.Fragment key={i}>{typeof c === 'string' ? highlight(c, query) : c}</React.Fragment>) : children
    }</p>,
    ul: ({ node, children, ...p }) => <ul {...p} className="list-disc pl-6 mb-3 space-y-1.5 text-[15px] text-slate-700">{children}</ul>,
    ol: ({ node, children, ...p }) => <ol {...p} className="list-decimal pl-6 mb-3 space-y-1.5 text-[15px] text-slate-700">{children}</ol>,
    li: ({ node, children, ...p }) => <li {...p} className="leading-relaxed">{
      Array.isArray(children) ? children.map((c, i) => <React.Fragment key={i}>{typeof c === 'string' ? highlight(c, query) : c}</React.Fragment>) : children
    }</li>,
    code: ({ inline, children, ...p }) => inline
      ? <code {...p} className="px-1.5 py-0.5 rounded bg-slate-100 text-orange-700 text-[13px] font-mono">{children}</code>
      : <pre className="my-3 p-3 rounded-lg bg-slate-900 text-slate-100 text-[13px] font-mono overflow-x-auto"><code>{children}</code></pre>,
    strong: ({ children }) => <strong className="font-semibold text-slate-900">{children}</strong>,
    em: ({ children }) => <em className="italic text-slate-600">{children}</em>,
    hr: () => <hr className="my-8 border-slate-200" />,
    blockquote: ({ children }) => <blockquote className="border-l-4 border-orange-500 bg-orange-50 pl-4 py-2 my-3 text-slate-700 italic">{children}</blockquote>,
    // Phase 4.11.5 (paneltec-v130) — Full-width schematic renderer for the
    // architecture + user-journey diagrams at the top of the manual. Falls
    // back to the browser default for any other image.
    img: ({ node, src, alt, ...p }) => (
      <img
        {...p}
        src={src}
        alt={alt || ''}
        loading="lazy"
        data-testid={src?.includes('/schematics/') ? `manual-schematic-${(src.split('/').pop() || '').replace(/\.png$/, '')}` : undefined}
        className="block w-full max-w-full h-auto my-6 rounded-2xl border border-slate-200 shadow-sm bg-white"
      />
    ),
  };

  const onDownload = async () => {
    try {
      const r = await api.get('/help/manual.pdf', { responseType: 'blob' });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement('a');
      a.href = url; a.download = 'paneltec-civil-user-manual.pdf';
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch { /* network errors surface via api interceptor */ }
  };

  return (
    <div className="max-w-[1280px] mx-auto" data-testid="user-manual-page">
      {/* Header strip */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6 pb-5 border-b border-slate-200">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-xl bg-orange-100 flex items-center justify-center shrink-0">
            <BookOpen24Regular className="text-orange-600" />
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-orange-500">PANELTEC CIVIL HELP</div>
            <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 mt-0.5 leading-tight">User Manual</h1>
            <div className="text-xs text-slate-500 mt-1">A friendly walkthrough of every screen and feature.</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search24Regular className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the manual…"
              className="pl-10 pr-9 py-2 w-[260px] sm:w-[320px] rounded-lg border border-slate-300 bg-white text-sm focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
              data-testid="manual-search" />
            {query && (
              <button onClick={() => setQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700"
                data-testid="manual-search-clear">
                <Dismiss16Regular />
              </button>
            )}
          </div>
          <button onClick={onDownload} data-testid="manual-download-pdf"
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold transition-colors">
            <ArrowDownload24Regular />
            Download PDF
          </button>
        </div>
      </div>

      {/* 3-col layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr_200px] gap-8 items-start">
        {/* TOC (left) — Phase 4.11.3 (v124) — `sticky top-20` now lives
            on the <aside> directly (not on an inner <div>) plus
            `self-start max-h-[calc(100vh-6rem)] overflow-y-auto` so a
            long TOC scrolls internally instead of pushing the page,
            and grid stretching can't swallow the sticky anchor. The
            parent grid carries `items-start` for the same reason. */}
        <aside className="hidden lg:block sticky top-20 self-start max-h-[calc(100vh-6rem)] overflow-y-auto pr-1"
               data-testid="manual-toc">
          <div className="text-[11px] uppercase tracking-[0.18em] font-semibold text-slate-500 mb-2">Contents</div>
          <ul className="space-y-1.5">
            {h2s.map((t) => (
              <li key={t.slug}>
                <a href={`#${t.slug}`}
                  className="block text-sm text-slate-700 hover:text-orange-600 py-1 leading-snug">
                  {t.text}
                </a>
              </li>
            ))}
          </ul>
        </aside>

        {/* Main pane */}
        <main ref={contentRef} data-testid="manual-content" className="min-w-0">
          {loading
            ? <div className="text-slate-500 text-sm py-20 text-center">Loading manual…</div>
            : <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{md}</ReactMarkdown>
          }
        </main>

        {/* Right anchor rail — same sticky pattern as the TOC. */}
        <aside className="hidden lg:block sticky top-20 self-start max-h-[calc(100vh-6rem)] overflow-y-auto pr-1"
               data-testid="manual-anchors">
          <div className="text-[11px] uppercase tracking-[0.18em] font-semibold text-slate-500 mb-2">On this page</div>
          <ul className="space-y-1.5">
            {h3s.slice(0, 12).map((t) => (
              <li key={t.slug}>
                <a href={`#${t.slug}`}
                  className="block text-[13px] text-slate-500 hover:text-orange-600 py-0.5 leading-snug truncate">
                  {t.text}
                </a>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}
