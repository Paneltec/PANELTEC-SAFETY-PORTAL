import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Search24Regular, ArrowDownload24Regular, Dismiss16Regular,
} from '@fluentui/react-icons';
import api from '../lib/api';
import { stashInlinePdf } from '../lib/pdfStash';
import styles from './UserManual.module.css';
import { CALLOUT_TONE_RULES } from '../lib/manualTheme';

// v160.3.8.2 — Cheat-sheet redesign.
//
// The manual content still comes from `/api/help/manual.md` (SOT lives
// in `/app/backend/content/user_manual.md`) so this refactor never
// rewrites copy — it re-arranges the render. We split the raw markdown
// at `## ` H2 boundaries: everything before the first H2 becomes the
// preamble ribbon, and each subsequent chunk renders as a numbered
// card in a masonry-flow grid (see UserManual.module.css). Blockquotes
// with a "Tip:" / "Warning:" / "Example:" / "Note:" prefix are
// classified into coloured callout boxes; the copy is untouched.
//
// Prior architecture (Phase 4.11 · v121): sticky-ToC + right-anchor
// rail + full-width markdown pane. That layout is preserved in the
// git history; the cheat-sheet look is what the user asked for in
// v160.3.8.2.

function slugify(s = '') {
  return s.toString().toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Highlight matches while walking children. Only string leaves get
// wrapped in <mark>, so React nodes aren't mangled.
function highlight(children, query) {
  if (!query) return children;
  const rx = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  const walk = (node) => {
    if (typeof node !== 'string') return node;
    const parts = node.split(rx);
    return parts.map((p, i) =>
      rx.test(p)
        ? <mark key={i} className={styles.mark}>{p}</mark>
        : p,
    );
  };
  return Array.isArray(children)
    ? children.map((c, i) => <React.Fragment key={i}>{walk(c)}</React.Fragment>)
    : walk(children);
}

// Split raw markdown at `## ` boundaries. Everything before the
// first H2 = preamble; each H2 chunk becomes one section card.
function splitSections(md) {
  const lines = md.split('\n');
  const preamble = [];
  const sections = [];
  let cur = null;
  for (const ln of lines) {
    const m = ln.match(/^##\s+(.+)$/);
    if (m) {
      if (cur) sections.push(cur);
      cur = { rawTitle: m[1].trim(), body: [] };
    } else if (cur) {
      cur.body.push(ln);
    } else {
      preamble.push(ln);
    }
  }
  if (cur) sections.push(cur);
  return {
    preamble: preamble.join('\n').trim(),
    sections: sections.map((s) => {
      // Extract a leading/trailing emoji as the section's icon so
      // "Getting started 🚀" splits into { icon: "🚀", title: "Getting started" }.
      const emojiRx = /(\p{Extended_Pictographic}|[\u{1F300}-\u{1FAFF}])/gu;
      const emojis = s.rawTitle.match(emojiRx) || [];
      const icon = emojis[0] || '';
      const title = s.rawTitle.replace(emojiRx, '').trim();
      return {
        title, icon, slug: slugify(title),
        body: s.body.join('\n'),
      };
    }),
  };
}

// Classify a blockquote's tone based on its leading token so we can
// map to a coloured callout without touching the SOT.
function classifyBlockquote(children) {
  const first = Array.isArray(children) ? children[0] : children;
  const text = typeof first === 'string'
    ? first
    : (first && first.props && Array.isArray(first.props.children)
        ? first.props.children.find((c) => typeof c === 'string') || ''
        : '');
  for (const rule of CALLOUT_TONE_RULES) {
    if (rule.rx.test(text || '')) return rule;
  }
  return { tone: 'info', icon: '💬' };
}

export default function UserManual() {
  const [md, setMd]           = useState('');
  const [loading, setLoading] = useState(true);
  const [query, setQuery]     = useState('');
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

  const { preamble, sections } = useMemo(() => splitSections(md), [md]);

  // Scroll to the first match after a query change.
  useEffect(() => {
    if (!query || !contentRef.current) return;
    const mark = contentRef.current.querySelector('mark');
    if (mark) mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [query]);

  // react-markdown component overrides. NOTE: only in-card renderers
  // — the outer page title / preamble use plain <h1>/<p> in the layout.
  const components = useMemo(() => ({
    h3: ({ children, ...p }) => {
      const text = Array.isArray(children) ? children.join('') : String(children ?? '');
      const id = slugify(text);
      return <h3 {...p} id={id}>{highlight(text, query)}</h3>;
    },
    // Everything below leaves the DOM element untouched so
    // UserManual.module.css can style via `.card h3`, `.card ul` etc.
    p:  ({ children, ...p }) => <p {...p}>{highlight(children, query)}</p>,
    li: ({ children, ...p }) => <li {...p}>{highlight(children, query)}</li>,
    strong: ({ children }) => <strong>{highlight(children, query)}</strong>,
    em: ({ children }) => <em>{highlight(children, query)}</em>,
    code: ({ inline, children, ...p }) =>
      inline
        ? <code {...p}>{children}</code>
        : <pre><code>{children}</code></pre>,
    // Blockquotes → coloured callouts. Tone chosen by leading prefix.
    blockquote: ({ children }) => {
      const t = classifyBlockquote(children);
      const cls = t.tone === 'tip'    ? styles.calloutTip
               : t.tone === 'warn'   ? styles.calloutWarn
               : t.tone === 'example' ? styles.calloutExample
               :                        styles.calloutInfo;
      return (
        <div className={`${styles.callout} ${cls}`} role="note">
          <span className={styles.calloutIcon} aria-hidden>{t.icon}</span>
          <div>{children}</div>
        </div>
      );
    },
    img: ({ src, alt, ...p }) => (
      <img
        {...p}
        src={src}
        alt={alt || ''}
        loading="lazy"
        data-testid={src?.includes('/schematics/') ? `manual-schematic-${(src.split('/').pop() || '').replace(/\.png$/, '')}` : undefined}
      />
    ),
  }), [query]);

  const onDownload = async () => {
    try {
      const r = await api.get('/help/manual.pdf', { responseType: 'blob' });
      const { src } = await stashInlinePdf(r.data, 'paneltec-civil-user-manual.pdf');
      const a = document.createElement('a');
      a.href = src; a.download = 'paneltec-civil-user-manual.pdf';
      document.body.appendChild(a); a.click(); a.remove();
    } catch { /* handled by api interceptor */ }
  };

  return (
    <div className={styles.page} data-testid="user-manual-page">
      {/* Title */}
      <div className={styles.titleWrap}>
        <div className={styles.sparkleRow} aria-hidden>
          <span>✦</span><span>✦</span><span>✦</span>
        </div>
        <h1 className={styles.pageTitle}>Paneltec Civil User Manual</h1>
        <div className={styles.pageSubtitle}>
          The ultimate quick reference guide — one dense, printable cheat
          sheet covering every screen, feature, and shortcut.
        </div>
        {sections.length > 0 && (
          <div className={styles.tocBar} data-testid="manual-toc-bar">
            <span className={styles.tocLabel}>Jump to</span>
            {sections.map((s, i) => (
              <a
                key={s.slug}
                href={`#${s.slug}`}
                className={styles.tocChip}
                data-testid={`manual-toc-${s.slug}`}
              >
                {i + 1}. {s.title}
              </a>
            ))}
          </div>
        )}
      </div>

      {/* Toolbar */}
      <div className={styles.toolbar}>
        <div className={styles.searchWrap}>
          <Search24Regular className={styles.searchIcon} style={{ width: 18, height: 18 }} />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the manual…"
            className={styles.searchInput}
            data-testid="manual-search"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className={styles.searchIcon}
              style={{ left: 'auto', right: 8, pointerEvents: 'auto', background: 'transparent', border: 0, cursor: 'pointer' }}
              data-testid="manual-search-clear"
              aria-label="Clear search"
            >
              <Dismiss16Regular />
            </button>
          )}
        </div>
        <button onClick={onDownload} data-testid="manual-download-pdf" className={styles.pdfBtn}>
          <ArrowDownload24Regular style={{ width: 16, height: 16 }} />
          Download PDF
        </button>
      </div>

      {/* Preamble ribbon */}
      {preamble && (
        <div className={styles.preamble} data-testid="manual-preamble">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{preamble}</ReactMarkdown>
        </div>
      )}

      {/* Cards */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '80px 0', color: '#5A554D' }}>Loading manual…</div>
      ) : (
        <div className={styles.grid} ref={contentRef} data-testid="manual-content">
          {sections.map((s, i) => (
            <ManualSectionCard
              key={s.slug}
              number={i + 1}
              title={highlight(s.title, query)}
              icon={s.icon}
              slug={s.slug}
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
                {s.body}
              </ReactMarkdown>
            </ManualSectionCard>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * v160.3.8.2 — One cheat-sheet card. Header carries the orange
 * numbered pill + uppercase title + optional emoji icon; body is
 * rendered from the caller (typically <ReactMarkdown …/>) so the
 * copy stays SOT-driven.
 */
export function ManualSectionCard({ number, title, icon, slug, children }) {
  return (
    <section
      className={styles.card}
      id={slug}
      data-testid={`manual-section-${slug}`}
    >
      <header className={styles.cardHeader}>
        <span className={styles.pill} aria-hidden>{number}.</span>
        <span className={styles.cardTitle}>{title}</span>
        {icon && <span className={styles.cardIcon} aria-hidden>{icon}</span>}
      </header>
      {children}
    </section>
  );
}

/**
 * v160.3.8.2 — Optional structured table override. Not used by the
 * markdown-driven path (react-markdown's default `<table>` picks up
 * the .card table styles automatically), but exposed for future
 * hand-written manual snippets.
 */
export function ManualTable({ columns, rows }) {
  return (
    <table>
      <thead><tr>{columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            {row.map((cell, j) => <td key={j}>{cell}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * v160.3.8.2 — Standalone callout for hand-authored snippets.
 */
export function ManualCallout({ tone = 'info', icon, children }) {
  const cls = tone === 'tip' ? styles.calloutTip
           : tone === 'warn' ? styles.calloutWarn
           : tone === 'example' ? styles.calloutExample
           :                       styles.calloutInfo;
  return (
    <div className={`${styles.callout} ${cls}`} role="note">
      {icon && <span className={styles.calloutIcon} aria-hidden>{icon}</span>}
      <div>{children}</div>
    </div>
  );
}

/**
 * v160.3.8.2 — Standalone page-title component.
 */
export function ManualPageTitle({ title, subtitle }) {
  return (
    <div className={styles.titleWrap}>
      <div className={styles.sparkleRow} aria-hidden>
        <span>✦</span><span>✦</span><span>✦</span>
      </div>
      <h1 className={styles.pageTitle}>{title}</h1>
      {subtitle && <div className={styles.pageSubtitle}>{subtitle}</div>}
    </div>
  );
}
