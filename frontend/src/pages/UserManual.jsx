import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Search24Regular, ArrowDownload24Regular, Dismiss16Regular,
  Dismiss24Regular,
} from '@fluentui/react-icons';
import api from '../lib/api';
import { stashInlinePdf } from '../lib/pdfStash';
import useLockBodyScroll from '../lib/useLockBodyScroll';
import styles from './UserManual.module.css';
import { CALLOUT_TONE_RULES, accentForIndex } from '../lib/manualTheme';
import { APP_FEATURE_REGISTRY } from '../lib/appFeatureRegistry';
import { RUNNING_VERSION } from '../lib/version';
import {
  hotspotsFor, loadHotspotsVisible, saveHotspotsVisible, isHotspotEditMode,
} from '../lib/manualImageHotspots';

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
// v51 — multi-token AND-match. `highlight("HR Employees", "hr employees")`
// now wraps BOTH "HR" and "Employees" via a per-token regex loop; the
// v50 single-regex version couldn't match tokens separated by other
// text.
function highlight(children, query) {
  if (!query || !query.trim()) return children;
  const tokens = query.trim().split(/\s+/)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .filter(Boolean);
  if (!tokens.length) return children;
  const rx = new RegExp(`(${tokens.join('|')})`, 'gi');
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

// v51 — AND-match test: section matches only when EVERY whitespace
// token in the query appears (case-insensitively) somewhere in the
// section's title or body markdown. Used by the search filter to hide
// non-matching sections + chips.
function sectionMatchesQuery(section, query) {
  if (!query || !query.trim()) return true;
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const haystack = `${section.title} ${section.body}`.toLowerCase();
  return tokens.every((t) => haystack.includes(t));
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
  // v51 — debounced query (150 ms) drives the filter to keep typing
  // smooth even on 17-section content trees. Highlight callbacks
  // still fire on the raw `query` so the mark-wrap happens in step
  // with keystrokes; filtering just waits a beat.
  const [debouncedQuery, setDebouncedQuery] = useState('');
  // v56 — Track whether we're mid-debounce so a "Searching…" pill can
  // render next to the input while the 150 ms timer settles.
  const [isDebouncing, setIsDebouncing] = useState(false);
  useEffect(() => {
    setIsDebouncing(query !== debouncedQuery);
    const t = setTimeout(() => setDebouncedQuery(query), 150);
    return () => clearTimeout(t);
  }, [query, debouncedQuery]);
  const contentRef = useRef(null);
  // v56 — Remember the last query we auto-scrolled for so a match at
  // the top of the manual doesn't jump back to the top on every
  // keystroke *after* the initial reveal.
  const lastScrolledQueryRef = useRef('');

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

  // v51 — Filter sections by AND-matching every whitespace token in
  // the debounced query against title+body. `sections` remains
  // authoritative for the PDF export (Download PDF always prints the
  // full manual regardless of the current search); `visibleSections`
  // drives the visible cards + toc chips + summary line.
  const visibleSections = useMemo(
    () => sections.filter((s) => sectionMatchesQuery(s, debouncedQuery)),
    [sections, debouncedQuery],
  );
  const isFiltering = Boolean(debouncedQuery && debouncedQuery.trim());
  const visibleSlugs = useMemo(
    () => new Set(visibleSections.map((s) => s.slug)),
    [visibleSections],
  );

  // v56 — Scroll to the first match once the debounced query settles.
  // Fires on `debouncedQuery` (not `query`) so the DOM has actually
  // rendered the fresh <mark>s before we look them up, and only when
  // the query text actually changes (typing further into the SAME
  // starting substring shouldn't yank the page back to the top).
  useEffect(() => {
    if (!debouncedQuery || !debouncedQuery.trim()) {
      lastScrolledQueryRef.current = '';
      return;
    }
    if (lastScrolledQueryRef.current === debouncedQuery) return;
    lastScrolledQueryRef.current = debouncedQuery;
    // Defer one tick so react-markdown has committed the new <mark>s.
    const t = setTimeout(() => {
      const root = contentRef.current || document;
      const mark = root.querySelector('mark');
      if (mark) mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 60);
    return () => clearTimeout(t);
  }, [debouncedQuery]);

  // v56 — Live count of every <mark> in the rendered content, for
  // the match-summary line. Recomputed after each debounce settle.
  const [markCount, setMarkCount] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => {
      const root = contentRef.current || document;
      setMarkCount(root.querySelectorAll('mark').length);
    }, 80);
    return () => clearTimeout(t);
  }, [debouncedQuery, visibleSections]);

  // react-markdown component overrides. NOTE: only in-card renderers
  // — the outer page title / preamble use plain <h1>/<p> in the layout.
  // v51 — highlight uses `debouncedQuery` so body mark-wrapping fires
  // in step with the filter (150ms debounce) rather than on every
  // keystroke. Feels snappier on 17-section content trees.
  const components = useMemo(() => ({
    h3: ({ children, ...p }) => {
      const text = Array.isArray(children) ? children.join('') : String(children ?? '');
      const id = slugify(text);
      return <h3 {...p} id={id}>{highlight(text, debouncedQuery)}</h3>;
    },
    p:  ({ children, ...p }) => <p {...p}>{highlight(children, debouncedQuery)}</p>,
    li: ({ children, ...p }) => <li {...p}>{highlight(children, debouncedQuery)}</li>,
    strong: ({ children }) => <strong>{highlight(children, debouncedQuery)}</strong>,
    em: ({ children }) => <em>{highlight(children, debouncedQuery)}</em>,
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
      <ManualImage
        {...p}
        src={src}
        alt={alt || ''}
        // v160.3.8.8 — Preserve schematic-image testid for
        // existing regression tests.
        dataTestId={src?.includes('/schematics/') ? `manual-schematic-${(src.split('/').pop() || '').replace(/\.png$/, '')}` : undefined}
      />
    ),
  }), [debouncedQuery]);

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
            {sections
              .filter((s) => !isFiltering || visibleSlugs.has(s.slug))
              .map((s) => (
                <a
                  key={s.slug}
                  href={`#${s.slug}`}
                  className={styles.tocChip}
                  data-testid={`manual-toc-${s.slug}`}
                >
                  {sections.indexOf(s) + 1}. {s.title}
                </a>
              ))}
            {/* v160.3.9.2 — Feature Index now opens the manual, so
                the chip reads as an in-page anchor rather than a
                jump-to-bottom. */}
            <a
              href="#feature-index"
              className={styles.tocChip}
              data-testid="manual-toc-feature-index"
            >
              ↑ Contents
            </a>
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
          {/* v56 — Debounce activity pill. Sits INSIDE the search
              wrapper below the input as an inline-status caption. */}
        </div>
        {isDebouncing && query && (
          <span
            data-testid="manual-search-debouncing"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              background: '#16A34A',
              color: '#FFFFFF',
              padding: '4px 10px',
              borderRadius: 999,
              boxShadow: '0 0 8px rgba(22,163,74,0.35)',
            }}
          >
            <span
              style={{
                width: 8, height: 8, borderRadius: 999,
                background: '#FFFFFF',
                animation: 'pulse 1s ease-in-out infinite',
              }}
              aria-hidden
            />
            Searching…
          </span>
        )}
        <button onClick={onDownload} data-testid="manual-download-pdf" className={styles.pdfBtn}>
          <ArrowDownload24Regular style={{ width: 16, height: 16 }} />
          Download PDF
        </button>
      </div>

      {/* v51 — Filter summary. Only rendered when the search field is
          non-empty; keeps the toolbar quiet in the default state. */}
      {isFiltering && (
        <div
          className={styles.searchSummary}
          data-testid="manual-search-summary"
          style={{
            margin: '0 0 12px', fontSize: 13, color: '#5A554D',
            display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
          }}
        >
          {visibleSections.length > 0 ? (
            <>
              <span data-testid="manual-search-count">
                <strong style={{ color: '#0F5132' }}>{markCount}</strong>{' '}
                match{markCount === 1 ? '' : 'es'} across{' '}
                <strong style={{ color: '#0F5132' }}>{visibleSections.length}</strong>{' '}
                section{visibleSections.length === 1 ? '' : 's'} for “{debouncedQuery}”
              </span>
              <span aria-hidden style={{ opacity: 0.4 }}>·</span>
              <span style={{ color: '#8B857A' }}>
                PDF export always includes the full manual.
              </span>
            </>
          ) : (
            <span data-testid="manual-search-empty" style={{ color: '#B84F1E' }}>
              No sections match “{debouncedQuery}”. Try a shorter term.
            </span>
          )}
        </div>
      )}

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
          {/* v160.3.9.2 — Feature Index now opens the manual as an
              unnumbered "Contents" card. Sections 1-17 keep their
              original numbering because the Index doesn't consume
              an accent slot in the rotation. */}
          <FeatureIndexCard
            accent={{ key: 'orange', ink: '#E9782E', wash: '#FBE6CE' }}
            query={query}
          />
          {sections
            .filter((s) => !isFiltering || visibleSlugs.has(s.slug))
            .map((s) => {
              // Original index preserved so numbering stays stable
              // across filter states (e.g. "5. HR Employees" still
              // reads as 5 even when it's the only visible card).
              const originalIdx = sections.indexOf(s);
              const accent = accentForIndex(originalIdx);
              return (
                <ManualSectionCard
                  key={s.slug}
                  number={originalIdx + 1}
                  title={highlight(s.title, debouncedQuery)}
                  icon={s.icon}
                  slug={s.slug}
                  accent={accent}
                >
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
                    {s.body}
                  </ReactMarkdown>
                </ManualSectionCard>
              );
            })}
          {/* v160.3.9.2 — Feature Index moved to the top; see the
              opening `<FeatureIndexCard>` above sections.map. */}
        </div>
      )}
      <BackToIndexPill />
    </div>
  );
}

/**
 * v160.3.9.2 — Floating "↑ Feature Index" pill.
 *
 * Uses `IntersectionObserver` on `#feature-index` so the pill only
 * appears when the reader has scrolled past the Contents card at the
 * top. No scroll listeners = cheap. Hidden on narrow-mobile touch
 * devices (<768px + coarse pointer) so it doesn't compete with the
 * on-screen keyboard. Print stylesheet also hides it.
 */
function BackToIndexPill() {
  const [visible, setVisible] = useState(false);
  const [hiddenForMobile, setHiddenForMobile] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia('(pointer: coarse) and (max-width: 767px)');
    const update = () => setHiddenForMobile(mql.matches);
    update();
    mql.addEventListener?.('change', update);
    return () => mql.removeEventListener?.('change', update);
  }, []);

  useEffect(() => {
    // The Feature Index card lives inside a CSS multi-column container,
    // so `getBoundingClientRect` can be quirky. IntersectionObserver
    // handles column-layouts correctly and is cheaper than scroll.
    const target = document.getElementById('feature-index');
    if (!target) return undefined;
    const io = new IntersectionObserver(
      (entries) => setVisible(!entries[0].isIntersecting),
      { threshold: 0 },
    );
    io.observe(target);
    return () => io.disconnect();
  }, []);

  if (hiddenForMobile) return null;

  const scrollBack = () => {
    const el = document.getElementById('feature-index');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <button
      type="button"
      onClick={scrollBack}
      aria-label="Return to Feature Index"
      data-testid="manual-back-to-index-pill"
      className={styles.backToIndexPill}
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        zIndex: 40,
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? 'auto' : 'none',
        transition: 'opacity 200ms ease, transform 200ms ease, background 120ms ease',
        background: '#2563EB',
        color: '#FFFFFF',
        border: 'none',
        borderRadius: 999,
        padding: '12px 16px',
        fontSize: 13,
        fontWeight: 700,
        letterSpacing: '0.02em',
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = '#1D4ED8';
        e.currentTarget.style.transform = 'translateY(-1px)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = '#2563EB';
        e.currentTarget.style.transform = 'translateY(0)';
      }}
    >
      <span aria-hidden style={{ fontSize: 15, lineHeight: 1 }}>↑</span>
      Feature Index
    </button>
  );
}

/**
 * v160.3.8.2 — One cheat-sheet card. Header carries the orange
 * numbered pill + uppercase title + optional emoji icon; body is
 * rendered from the caller (typically <ReactMarkdown …/>) so the
 * copy stays SOT-driven.
 */
export function ManualSectionCard({ number, title, icon, slug, accent, children }) {
  // v160.3.8.3 — Accent piped in as CSS custom properties. Callers
  // that omit the prop get the default orange from the CSS fallback.
  const cardStyle = accent
    ? { '--accent-ink': accent.ink, '--accent-wash': accent.wash }
    : undefined;
  return (
    <section
      className={styles.card}
      id={slug}
      data-testid={`manual-section-${slug}`}
      data-accent={accent?.key || 'orange'}
      style={cardStyle}
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
 * v160.3.9.0 — Feature Index card.
 *
 * Pulls its content live from `APP_FEATURE_REGISTRY` so devs never
 * need to hand-edit the manual to reflect a new page or integration.
 * Rendered as an ordinary numbered card so it participates in the
 * accent-rotation, TOC chip listing, search highlight, and PDF export
 * the same way as every SOT-driven section.
 *
 * Each group renders as an H3 followed by a two-column table. Feature
 * labels linking to a route are anchored with `<a>` so the reader can
 * click through — the printed version strips the underline (see the
 * `.card a` block in UserManual.module.css handled globally).
 */
function FeatureIndexCard({ accent, query }) {
  const slug = 'feature-index';
  const cardStyle = { '--accent-ink': accent.ink, '--accent-wash': accent.wash };
  return (
    <section
      className={styles.card}
      id={slug}
      data-testid="manual-feature-index-card"
      data-accent={accent.key}
      style={cardStyle}
    >
      <header className={styles.cardHeader}>
        {/* v160.3.9.2 — Feature Index is unnumbered ("Contents"
            card). Sections 1-17 retain their canonical numbering. */}
        <span className={styles.cardTitle}>{highlight('Contents', query)}</span>
        <span className={styles.cardIcon} aria-hidden>🗂️</span>
      </header>
      <div
        className={`${styles.callout} ${styles.calloutExample}`}
        role="note"
        data-testid="manual-feature-index-caption"
      >
        <span className={styles.calloutIcon} aria-hidden>⚙️</span>
        <div>
          Auto-generated from the app registry — regenerates every visit.
          Last read: <strong>{RUNNING_VERSION}</strong>
        </div>
      </div>
      {APP_FEATURE_REGISTRY.map((group) => {
        // v160.3.9.1 — Anchor id uses the slugified group LABEL
        // (e.g. "Main App Pages" → `main-app-pages`) so hotspot
        // `target` strings can reference the reader-facing name
        // rather than the internal enum id.
        const anchorId = (group.label || group.id)
          .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        return (
        <div key={group.id}>
          <h3
            id={anchorId}
            data-testid={`manual-feature-index-group-${group.id}`}
          >
            {highlight(group.label, query)}
          </h3>
          <table>
            <thead>
              <tr>
                <th style={{ width: '38%' }}>Feature</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {group.items.map((it) => (
                <tr key={it.key}>
                  <td>
                    {it.route
                      ? <a href={it.route} style={{ color: 'var(--accent-ink, #E9782E)', fontWeight: 600, textDecoration: 'none' }}>
                          {highlight(it.label, query)}
                        </a>
                      : <strong>{highlight(it.label, query)}</strong>}
                  </td>
                  <td>{highlight(it.description || '', query)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );})}
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


/**
 * v160.3.8.9 — Zoomable manual thumbnail.
 *
 * Renders inline exactly like the previous plain `<img>` (styled by
 * `.card img` in UserManual.module.css) but is now a keyboard- and
 * click-activated button that opens `<ManualLightbox>` at full size.
 * On close, focus returns to this thumbnail so keyboard-only users
 * pick up where they left off. Because the lightbox is a portal to
 * `document.body`, the underlying manual scroll position is
 * preserved automatically — clicking through and back leaves the
 * user exactly where they were.
 *
 * The thumbnail is a native `<button>` (not just role=button on a
 * div) so screen readers announce it as clickable and Enter/Space
 * work out of the box.
 */
function ManualImage({ src, alt, dataTestId, ...rest }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef(null);
  const close = useCallback(() => {
    setOpen(false);
    // Return focus AFTER the lightbox unmounts.
    requestAnimationFrame(() => { btnRef.current?.focus?.(); });
  }, []);
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen(true)}
        data-testid={dataTestId}
        aria-label={alt ? `Enlarge image: ${alt}` : 'Enlarge manual image'}
        // Reset native button chrome so the img inside inherits the
        // .card img styling (rounded corners, tan border, spacing).
        style={{
          all: 'unset',
          display: 'block',
          width: '100%',
          cursor: 'zoom-in',
        }}
      >
        <img
          {...rest}
          src={src}
          alt={alt || ''}
          loading="lazy"
          draggable={false}
        />
      </button>
      {open && <ManualLightbox src={src} alt={alt} onClose={close} />}
    </>
  );
}

/**
 * v160.3.8.9 — Fullscreen lightbox for one manual image.
 *
 * Portaled to `document.body` so the fixed-position overlay isn't
 * clipped by the manual's `column-count` masonry container (columns
 * establish a new stacking context that can chop overflow-visible
 * children — a real gotcha with column layouts).
 *
 * Focus is trapped inside via `keydown[Tab]` cycling between the
 * close button and the image. Esc closes. Backdrop click closes.
 * Body scroll is locked while open (`useLockBodyScroll(true)`).
 * Fade-in via a one-frame delayed `opacity` toggle so the transition
 * fires on mount.
 */
function ManualLightbox({ src, alt, onClose }) {
  useLockBodyScroll(true);
  const closeBtnRef = useRef(null);
  const imgRef = useRef(null);
  const [visible, setVisible] = useState(false);

  // v160.3.9.1 — Hotspot layer state. Empty registry → behaves like
  // v160.3.8.9 (no toggle, no overlays). Non-empty → shows dashed
  // peach rectangles + a "Show hotspots" toggle.
  const hotspots = useMemo(() => hotspotsFor(src), [src]);
  const editMode = isHotspotEditMode();
  const [showHotspots, setShowHotspots] = useState(loadHotspotsVisible);

  const toggleHotspots = () => {
    const nv = !showHotspots;
    setShowHotspots(nv);
    saveHotspotsVisible(nv);
  };

  const activateHotspot = (target) => {
    onClose();
    // 60ms lets React unmount the portal and detach body-scroll lock
    // BEFORE we ask the browser to scroll — otherwise the scroll
    // target's `scrollIntoView` competes with the portal removal.
    setTimeout(() => {
      const el = document.getElementById(target);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 60);
  };

  useEffect(() => {
    const rafId = requestAnimationFrame(() => {
      setVisible(true);
      closeBtnRef.current?.focus?.();
    });
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key === 'Tab') {
        e.preventDefault();
        const els = [closeBtnRef.current, imgRef.current].filter(Boolean);
        if (els.length === 0) return;
        const idx = els.indexOf(document.activeElement);
        const nextIdx = e.shiftKey
          ? (idx <= 0 ? els.length - 1 : idx - 1)
          : (idx === -1 ? 0 : (idx + 1) % els.length);
        els[nextIdx].focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(rafId);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const overlay = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt || 'Enlarged manual image'}
      onClick={onClose}
      data-testid="manual-image-lightbox"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(20, 17, 13, 0.85)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        padding: 24,
        zIndex: 9999,
        opacity: visible ? 1 : 0,
        transition: 'opacity 150ms ease',
      }}
    >
      <button
        ref={closeBtnRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        aria-label="Close enlarged image"
        data-testid="manual-image-lightbox-close"
        style={{
          position: 'absolute',
          top: 16,
          right: 16,
          width: 40, height: 40,
          borderRadius: 999,
          background: 'rgba(255,255,255,0.14)',
          color: '#FBF6EC',
          border: '1px solid rgba(255,255,255,0.35)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer',
        }}
      >
        <Dismiss24Regular />
      </button>
      {/* v160.3.9.1 — Show-hotspots toggle. Only rendered if this
          image has any registered hotspots. */}
      {hotspots.length > 0 && !editMode && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); toggleHotspots(); }}
          data-testid="manual-image-lightbox-hotspots-toggle"
          aria-pressed={showHotspots}
          style={{
            position: 'absolute',
            top: 16, left: 16,
            padding: '6px 12px',
            borderRadius: 999,
            background: showHotspots ? 'rgba(233,120,46,0.85)' : 'rgba(255,255,255,0.14)',
            color: '#FBF6EC',
            border: '1px solid rgba(255,255,255,0.35)',
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: '0.04em',
            cursor: 'pointer',
          }}
        >
          {showHotspots ? '● Hotspots on' : '○ Hotspots off'}
        </button>
      )}
      {/* v160.3.9.1 — Image + hotspot overlay wrapper. Positioned
          `relative` so absolutely-positioned hotspots inherit its
          computed pixel size. */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'relative',
          maxWidth: 'min(1200px, 92vw)',
          maxHeight: '86vh',
          display: 'inline-block',
        }}
      >
        <img
          ref={imgRef}
          src={src}
          alt={alt || ''}
          tabIndex={0}
          draggable={false}
          style={{
            display: 'block',
            maxWidth: 'min(1200px, 92vw)',
            maxHeight: '86vh',
            objectFit: 'contain',
            borderRadius: 8,
            boxShadow: '0 10px 40px rgba(0,0,0,0.45)',
            background: '#FFFCF5',
            outline: 'none',
          }}
        />
        {(editMode || showHotspots) && hotspots.map((h) => (
          <button
            key={h.id}
            type="button"
            onClick={(e) => { e.stopPropagation(); activateHotspot(h.target); }}
            aria-label={h.label}
            title={h.label}
            data-testid={`manual-image-hotspot-${h.id}`}
            style={{
              position: 'absolute',
              left:   `${h.x}%`,
              top:    `${h.y}%`,
              width:  `${h.w}%`,
              height: `${h.h}%`,
              // v160.3.9.1 — Edit mode: solid fill + big id label so
              // authors can eyeball coord placement. Normal mode:
              // dashed peach outline that lights up on hover.
              background: editMode ? 'rgba(233,120,46,0.55)' : 'rgba(233,120,46,0)',
              border: `2px dashed rgba(233,120,46,${editMode ? 1 : 0.4})`,
              borderRadius: 8,
              cursor: 'pointer',
              padding: 0,
              transition: 'background 120ms ease, border-color 120ms ease',
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'flex-start',
              color: '#FBF6EC',
              fontSize: 11,
              fontWeight: 700,
            }}
            onMouseEnter={(e) => {
              if (editMode) return;
              e.currentTarget.style.background = 'rgba(233,120,46,0.18)';
              e.currentTarget.style.borderColor = 'rgba(233,120,46,1)';
            }}
            onMouseLeave={(e) => {
              if (editMode) return;
              e.currentTarget.style.background = 'rgba(233,120,46,0)';
              e.currentTarget.style.borderColor = 'rgba(233,120,46,0.4)';
            }}
          >
            {editMode && (
              <span style={{ padding: '2px 6px', background: 'rgba(0,0,0,0.55)', borderRadius: 4, margin: 4 }}>
                {h.id} → {h.target}
              </span>
            )}
          </button>
        ))}
      </div>
      {alt && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            maxWidth: 'min(1200px, 92vw)',
            padding: '6px 12px',
            borderRadius: 8,
            background: '#FBE6CE',
            color: '#7A3A0F',
            fontSize: 13,
            fontWeight: 500,
            textAlign: 'center',
          }}
        >
          {alt}
        </div>
      )}
    </div>
  );

  return createPortal(overlay, document.body);
}
