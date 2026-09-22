import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, Search, X, FileText } from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../lib/api';
import CaptureCard, { CaptureCardGrid, CaptureSticky } from '../components/CaptureCard';
import CaptureDensityControl from '../components/CaptureDensityControl';
import TotalCountChip from '../components/TotalCountChip';  // v58.13.132eb
import ShowArchivedToggle from '../components/ShowArchivedToggle';  // v58.13.132ec
import ArchiveDialog from '../components/ArchiveDialog';  // v58.13.132ee
import ViewOriginalPdfButton from '../components/ViewOriginalPdfButton';  // v58.13.132ki
import PaginationBar, { usePersistedPageSize } from '../components/PaginationBar';  // v58.13.132eh
import useArchiveActions from '../lib/useArchiveActions';  // v58.13.132ec
import useCaptureDensity from '../lib/useCaptureDensity';
import useDeepLinkOpen from '../lib/useDeepLinkOpen';
import { getUser } from '../lib/auth';
import { PageHeader, NewButton, BackButton, PrimaryButton, Field, inputClass, EmptyState, GhostButton } from '../components/capture/Ui';
import { inferTemplateType, paletteForType } from '../lib/preStartsPalette';

// v160.3.9.58.10.2 — Daily Pre-Starts UX refactor.
//
//   · Tiles no longer expose the worker/lead name. The underlying
//     `crew_lead` field stays on the record so free-text search still
//     matches on it, but the display is intentionally anonymised so
//     4,000+ imported tiles read as compliance data rather than a
//     public roll-call.
//   · Tiles are grouped and coloured by TEMPLATE TYPE (not by parent
//     zip like v58.9.1). Colour resolution lives in
//     `lib/preStartsPalette.js` — explicit map for the 9 template
//     families the user named, deterministic hash-based fallback for
//     anything new so refreshes stay stable.
//   · Header shows a chip row of every type with its count and colour
//     pill. Clicking a chip filters the grid. Persists to
//     `localStorage['pt.prestarts.type_filter']`.
//   · Toolbar: date-from / date-to inputs + free-text name search.
//     Name search AND-matches multi-token across crew_lead,
//     work_summary, metadata.src_filename, metadata.batch_label, plus
//     the derived template type. Matching text is <mark>-highlighted
//     inline on tiles.
//
// Preserved: click-to-view (SubmissionViewer), PDF actions, delete,
// and the New Pre-Start form below (untouched).

const LS_TYPE_KEY = 'pt.prestarts.type_filter';

// v160.3.9.58.10.2 — Split the search string into whitespace tokens
// (drop empties). Case-insensitive AND-match.
function tokenize(q) {
  return (q || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
}

function matchesAllTokens(hay, tokens) {
  if (tokens.length === 0) return true;
  const low = hay.toLowerCase();
  return tokens.every((t) => low.includes(t));
}

// v160.3.9.58.10.2 — Render `text` with case-insensitive <mark>
// highlights around every token match. Reuses the styling from the
// User Manual / Users search: bg-emerald-100 + text-emerald-900.
function Highlight({ text, tokens }) {
  const str = String(text || '');
  if (!str || tokens.length === 0) return <>{str}</>;
  // Build a single alternation regex, escaping regex meta chars.
  const escaped = tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`(${escaped.join('|')})`, 'gi');
  const parts = str.split(re);
  return (
    <>
      {parts.map((p, i) => {
        if (i % 2 === 1) {
          return (
            <mark key={i} className="bg-emerald-100 text-emerald-900 rounded-sm px-0.5" data-testid="prestarts-mark">
              {p}
            </mark>
          );
        }
        return <React.Fragment key={i}>{p}</React.Fragment>;
      })}
    </>
  );
}

export default function PreStartsList() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  // v58.13.132eb — total server count from X-Total-Count header.
  const [serverTotal, setServerTotal] = useState(null);
  // v58.13.132ee — archived count from X-Archived-Count header.
  const [archivedCount, setArchivedCount] = useState(null);
  // v58.13.132ee — Archive lifecycle. Admin-only.
  const isAdmin = (getUser()?.role || '').toLowerCase() === 'admin';
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  // v58.13.132eh — Load-more pagination. Page size persists per module
  // via localStorage. `offset` counts rows appended so far; a page-size
  // change resets both.
  const [pageSize, setPageSize] = usePersistedPageSize('pre-starts:pageSize', 5000);
  const [q, setQ] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [typeFilter, setTypeFilter] = useState(() => {
    try { return localStorage.getItem(LS_TYPE_KEY) || 'All'; } catch { return 'All'; }
  });

  // v160.3.9.58.11.1 — Retry-on-fetch-error. The on-mount fetch was
  // previously fire-and-forget; if the backend blipped mid-load
  // (Cloudflare 502 during a supervisor restart, upstream timeout),
  // `items` stayed `[]`, `loading` flipped to `false`, and the UI
  // rendered the "No pre-starts yet" empty-state — which looked
  // exactly like a data-loss event to the user. We now:
  //   · surface a distinct `loadError` state so the empty-state can't
  //     collide with a network failure,
  //   · auto-retry twice (3s, then 10s), same params,
  //   · offer a manual `Retry` button once both retries fail.
  // Retries fire on initial mount OR manual click only — no polling.
  //
  // v160.3.9.58.13.89 — P0 hotfix: cap `limit` at the backend max.
  // v58.13.84 A3 dropped the list-endpoint cap from 50000 → 5000, so
  // the old `limit: 50000` returned 422 `Input should be less than or
  // equal to 5000`, which the retry loop mis-classified as a network
  // failure. Now:
  //   · `limit: 5000` matches the backend cap exactly.
  //   · 4xx responses (client-side param errors like 422) bypass the
  //     auto-retry and render a distinct amber "Request too large"
  //     banner — retrying a 422 with unchanged params is pointless.
  //   · 5xx / network errors keep the original retry behaviour.
  // Real follow-up: server-side pagination for orgs with >5k
  // pre-starts (preview has ~16.6k). Tracked in the .89 ship report.
  const fetchItems = useCallback(async (attempt = 0, includeArchived = false,
                                         offset = 0, size = 5000, append = false) => {
    setLoading(true);
    try {
      const r = await api.get('/pre-starts', {
        params: { limit: size, offset, include_archived: includeArchived },
      });
      const rows = Array.isArray(r.data) ? r.data : [];
      // v58.13.132eh — Append when Load-More triggered the fetch;
      // replace on the initial + toggle-driven refresh.
      setItems((prev) => (append ? [...prev, ...rows] : rows));
      // v58.13.132eb — X-Total-Count header from crud.py.
      const t = r.headers?.['x-total-count'];
      setServerTotal(t != null ? Number(t) : rows.length);
      // v58.13.132ee — X-Archived-Count header.
      const a = r.headers?.['x-archived-count'];
      setArchivedCount(a != null ? Number(a) : null);
      setLoadError(null);
      setLoading(false);
      return true;
    } catch (err) {
      const status = err?.response?.status;
      const message = apiError(err) || 'Network error';
      // Classify the error so the banner and retry logic can react
      // sensibly. 4xx = the request itself was rejected (bad param,
      // permission, bad path); retrying it will just fail again.
      // 0 / 5xx = transient — worth retrying.
      const isClientError = typeof status === 'number' && status >= 400 && status < 500;
      setLoadError({ message, attempt, status, kind: isClientError ? 'client' : 'network' });
      setLoading(false);
      if (!isClientError) {
        if (attempt === 0) {
          setTimeout(() => { fetchItems(1, includeArchived, offset, size, append); }, 3000);
        } else if (attempt === 1) {
          setTimeout(() => { fetchItems(2, includeArchived, offset, size, append); }, 10000);
        }
      }
      return false;
    }
  }, []);

  // v58.13.132ee — Archive hook needs a stable refetch; wire it AFTER
  // fetchItems is defined so its useCallback sees the ref.
  const { showArchived, setShowArchived, onArchive, onUnarchive } =
    useArchiveActions('/pre-starts', setItems, () => {
      // Refetch from offset 0 — cleanest way to re-sync counts.
      fetchItems(0, showArchived, 0, pageSize, false);
      fetchCategoryCounts(showArchived);
    });

  useEffect(() => {
    // Initial + toggle-driven refresh always starts at offset 0.
    fetchItems(0, showArchived, 0, pageSize, false);
  }, [fetchItems, showArchived, pageSize]);

  // v58.13.132eh — Load-more handler. Appends the next page.
  const onLoadMore = useCallback(() => {
    fetchItems(0, showArchived, items.length, pageSize, true);
  }, [fetchItems, showArchived, items.length, pageSize]);

  // v58.13.132eg — Server-side category counts.
  // The client-side `typeIndex` derived from `decorated` only ever
  // saw the pagination-capped page (5,000 rows) so the pill counts
  // summed to 5,000 instead of the true DB total (~16k). This
  // endpoint runs the aggregation server-side; we merge its palette
  // via the existing `paletteForType` helper on render so colours
  // stay consistent with the FE inference.
  const [categoryCounts, setCategoryCounts] = useState(null);
  const fetchCategoryCounts = useCallback(async (includeArchived) => {
    try {
      const r = await api.get('/pre-starts/category-counts',
                              { params: { include_archived: includeArchived } });
      setCategoryCounts(r.data);
    } catch (e) {
      // v58.13.132eg — Fall back silently to client-side derivation
      // so a preview blip doesn't blank the chip row. The
      // FE typeIndex will still render (capped at 5,000 as before).
      setCategoryCounts(null);
    }
  }, []);
  useEffect(() => {
    fetchCategoryCounts(showArchived);
  }, [fetchCategoryCounts, showArchived]);

  // Persist type filter across sessions.
  useEffect(() => {
    try { localStorage.setItem(LS_TYPE_KEY, typeFilter); } catch { /* noop */ }
  }, [typeFilter]);

  const evict = useCallback((id) => {
    setItems((prev) => prev.filter((x) => x.id !== id));
  }, []);

  // Decorate each row with its inferred type + palette. Cached in a
  // useMemo so we only recompute when the raw items change (not on
  // every keystroke).
  const decorated = useMemo(() => {
    return items.map((row) => {
      const type = inferTemplateType(row) || 'Unclassified';
      const palette = paletteForType(type);
      return { row, type, palette };
    });
  }, [items]);

  // Build the type index — every distinct type + its unfiltered count.
  // v58.13.132eg — Prefer the server-side category-counts response
  // (true DB aggregate) when it's loaded; fall back to the client-side
  // `decorated` bucket sums when the endpoint hasn't answered yet.
  const typeIndex = useMemo(() => {
    if (categoryCounts?.categories?.length) {
      return categoryCounts.categories.map((c) => ({
        type: c.label,
        palette: paletteForType(c.label),
        count: c.count,
      }));
    }
    const buckets = new Map();
    for (const d of decorated) {
      const key = d.type;
      if (!buckets.has(key)) buckets.set(key, { type: key, palette: d.palette, count: 0 });
      buckets.get(key).count += 1;
    }
    return Array.from(buckets.values()).sort((a, b) => b.count - a.count);
  }, [decorated, categoryCounts]);

  // Apply filters (type + date range + name tokens).
  const tokens = useMemo(() => tokenize(q), [q]);

  const filtered = useMemo(() => {
    return decorated.filter(({ row, type }) => {
      if (typeFilter !== 'All' && type !== typeFilter) return false;
      const d = row.date || (row.submitted_at || '').substring(0, 10) || '';
      if (dateFrom && d && d < dateFrom) return false;
      if (dateTo && d && d > dateTo) return false;
      if (tokens.length === 0) return true;
      const meta = row.metadata || {};
      const hay = [
        row.crew_lead, row.work_summary, row.description,
        meta.src_filename, meta.batch_label, meta.filename,
        row.site_name, row.site_address, row.workspace_name,
        row.submitted_by_name,
        type,
        d,
      ].filter(Boolean).join(' ');
      return matchesAllTokens(hay, tokens);
    });
  }, [decorated, typeFilter, dateFrom, dateTo, tokens]);

  // Group filtered rows by type. Section order follows unfiltered
  // count desc so colour position is stable across filter changes.
  const grouped = useMemo(() => {
    const buckets = new Map();
    for (const f of filtered) {
      if (!buckets.has(f.type)) buckets.set(f.type, { type: f.type, palette: f.palette, rows: [] });
      buckets.get(f.type).rows.push(f.row);
    }
    const orderMap = new Map(typeIndex.map((t, i) => [t.type, i]));
    return Array.from(buckets.values())
      .map((g) => ({
        ...g,
        rows: g.rows.sort((a, b) => (b.date || '').localeCompare(a.date || '')),
      }))
      .sort((a, b) => (orderMap.get(a.type) ?? 999) - (orderMap.get(b.type) ?? 999));
  }, [filtered, typeIndex]);

  // v58.13.132eg — Prefer server-total for the "All" chip; client
  // decorated-length is capped by the pagination limit so it under-
  // counts on any org with >5k pre-starts (prod has ~16k).
  const totalCount = categoryCounts?.all_count ?? decorated.length;
  const filteredCount = filtered.length;

  // v58.13.41 — density hook. Drives the per-group grid class + card
  // min-height + subtitle clamp. Manual override via the segmented
  // control in the toolbar row.
  const density = useCaptureDensity('pre-starts', filteredCount);
  // v58.13.119 — Ask Intelligence deep-link (`?open=<id>`).
  const { deepLinkId } = useDeepLinkOpen({
    items, loading, notFoundMessage: 'Linked pre-start not found',
  });

  const clearAll = () => {
    setQ(''); setDateFrom(''); setDateTo(''); setTypeFilter('All');
  };
  const hasActiveFilter = Boolean(q || dateFrom || dateTo || typeFilter !== 'All');

  return (
    <div className="max-w-7xl mx-auto" data-testid="prestarts-list">
      <CaptureSticky testid="prestarts-sticky">
        <PageHeader
          crumb="Capture / Daily Pre-Starts"
          title="Daily Pre-Starts"
          subtitle="Grouped by template type. Search by date, name, or type."
          action={
            <div className="flex items-center gap-2">
              {isAdmin && (
                <button type="button" onClick={() => setArchiveDialogOpen(true)}
                        data-testid="prestarts-archive-header-btn"
                        className="text-sm px-3 py-1.5 rounded border border-slate-300 text-slate-700 hover:bg-slate-50">
                  Archive…
                </button>
              )}
              <NewButton to="/app/pre-starts/new" label="New pre-start" testid="prestart-create-btn" />
            </div>
          }
        />
        {/* v58.13.132ee — Bulk archive dialog. */}
        {isAdmin && (
          <ArchiveDialog open={archiveDialogOpen} onClose={() => setArchiveDialogOpen(false)}
            apiPath="/pre-starts" moduleLabel="pre-starts"
            knownStatuses={[]}
            knownCategories={[]}
            onArchived={() => fetchItems(0, showArchived)} />
        )}
        {/* v58.13.132eb — total-count chip + Admin-only show-archived toggle. */}
        <div className="mt-1 mb-2 flex items-center gap-2">
          <TotalCountChip
            showing={items.length}
            total={serverTotal}
            testid="prestarts-total-count-chip"
          />
          {isAdmin && (
            <ShowArchivedToggle
              value={showArchived}
              onChange={setShowArchived}
              count={archivedCount}
              testid="prestarts-show-archived-toggle"
            />
          )}
        </div>
        {items.length > 0 && (
          <div className="mb-3" data-testid="prestarts-toolbar">
            {/* Row 1 — search inputs */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[220px]">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
                <input
                  type="search"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search name, work, filename…"
                  className="w-full pl-8 pr-3 py-2 rounded-lg border border-slate-200 bg-white text-sm outline-none focus:ring-2 focus:ring-slate-300"
                  data-testid="prestarts-search-name"
                />
              </div>
              <label className="flex items-center gap-1 text-xs text-slate-500">
                <span>From</span>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="px-2 py-2 rounded-lg border border-slate-200 bg-white text-sm"
                  data-testid="prestarts-search-date-from"
                />
              </label>
              <label className="flex items-center gap-1 text-xs text-slate-500">
                <span>To</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="px-2 py-2 rounded-lg border border-slate-200 bg-white text-sm"
                  data-testid="prestarts-search-date-to"
                />
              </label>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="px-2 py-2 rounded-lg border border-slate-200 bg-white text-sm max-w-[240px]"
                data-testid="prestarts-search-type"
              >
                <option value="All">All types</option>
                {typeIndex.map((t) => (
                  <option key={t.type} value={t.type}>{t.type}</option>
                ))}
              </select>
              {hasActiveFilter && (
                <button
                  type="button"
                  onClick={clearAll}
                  className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900 px-2 py-1.5"
                  data-testid="prestarts-clear-filters"
                >
                  <X size={12} /> Clear
                </button>
              )}
              <div className="text-xs text-slate-500 tabular-nums ml-auto" data-testid="prestarts-count">
                Showing {filteredCount} of {totalCount} pre-starts
              </div>
              <CaptureDensityControl
                mode={density.mode}
                onChange={density.setMode}
                testidPrefix="pre-starts"
              />
            </div>
            {/* Row 2 — coloured type chips */}
            {typeIndex.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2" data-testid="prestarts-type-chips">
                <TypeChip
                  active={typeFilter === 'All'}
                  label="All"
                  count={totalCount}
                  palette={{ hex: '#0F172A', chipBg: '#F1F5F9', chipText: '#0F172A', border: '#0F172A' }}
                  onClick={() => setTypeFilter('All')}
                  testid="prestarts-chip-all"
                />
                {typeIndex.map((t) => (
                  <TypeChip
                    key={t.type}
                    active={typeFilter === t.type}
                    label={t.type}
                    count={t.count}
                    palette={t.palette}
                    onClick={() => setTypeFilter(t.type)}
                    testid={`prestarts-chip-${t.palette.key}`}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </CaptureSticky>
      <div className="mt-3">
        {loading ? (
          <div className="text-sm text-slate-500">Loading…</div>
        ) : loadError && items.length === 0 ? (
          // v58.11.1 — Network / server failure. Distinct from the
          // "genuinely empty" case so the user isn't misled into
          // thinking data was lost. Auto-retries fire in the
          // background at 3s / 10s; the manual Retry button re-runs
          // the same fetch immediately.
          //
          // v58.13.89 — Branch on error kind. A 4xx (e.g. 422 param
          // validation) is a client-side problem — retrying with the
          // same params will fail identically, so we suppress the
          // "Retrying automatically…" copy and reword the banner.
          <div
            className={
              loadError.kind === 'client'
                ? "rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center"
                : "rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center"
            }
            data-testid="prestarts-load-error"
            data-error-kind={loadError.kind || 'network'}
          >
            <div className={
              loadError.kind === 'client'
                ? "font-display font-semibold text-rose-900"
                : "font-display font-semibold text-amber-900"
            }>
              {loadError.kind === 'client'
                ? 'Request too large.'
                : "Couldn't reach the server."}
            </div>
            <div className={
              loadError.kind === 'client'
                ? "text-sm text-rose-800 mt-1"
                : "text-sm text-amber-800 mt-1"
            }>
              {loadError.kind === 'client'
                ? "The server rejected the request — please contact support if this keeps happening."
                : (loadError.attempt < 2
                    ? `Retrying automatically… (attempt ${loadError.attempt + 1} of 2)`
                    : "We tried twice and still couldn't load your pre-starts.")}
            </div>
            {loadError.message && (
              <div className={
                loadError.kind === 'client'
                  ? "text-xs text-rose-700 mt-2 font-mono"
                  : "text-xs text-amber-700 mt-2 font-mono"
              }>
                {loadError.message}
              </div>
            )}
            <div className="mt-4">
              <button
                type="button"
                onClick={() => fetchItems(0)}
                className={
                  loadError.kind === 'client'
                    ? "inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-rose-600 text-white text-sm font-semibold hover:bg-rose-700"
                    : "inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-600 text-white text-sm font-semibold hover:bg-amber-700"
                }
                data-testid="prestarts-load-error-retry"
              >
                Retry
              </button>
            </div>
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            title="No pre-starts yet"
            body="Capture your first daily pre-start with crew sign-ons."
            action={<NewButton to="/app/pre-starts/new" label="New pre-start" testid="prestart-empty-create" />}
          />
        ) : filtered.length === 0 ? (
          <div className="text-sm text-slate-500 border border-slate-200 rounded-2xl p-6 bg-slate-50 text-center" data-testid="prestarts-empty-filtered">
            No pre-starts match the current filters.
          </div>
        ) : (
          <div className="space-y-6" data-testid="prestarts-grouped">
            {grouped.map((g) => (
              <section
                key={g.type}
                data-testid={`prestarts-group-${g.palette.key}`}
                data-type={g.type}
                className="rounded-2xl border p-4"
                style={{ background: g.palette.tint, borderColor: g.palette.border }}
              >
                <div className="flex items-baseline justify-between mb-3">
                  <h2 className="font-display font-semibold text-slate-900 flex items-center gap-2">
                    <span
                      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-sm font-semibold"
                      style={{ background: g.palette.hex, color: '#ffffff' }}
                      data-testid={`prestarts-group-pill-${g.palette.key}`}
                    >
                      {g.type}
                    </span>
                    <span className="text-xs font-normal text-slate-500 tabular-nums">
                      · {g.rows.length} record{g.rows.length === 1 ? '' : 's'}
                    </span>
                  </h2>
                </div>
                <CaptureCardGrid testid={`prestarts-grid-${g.palette.key}`} gridClass={density.gridClass}>
                  {g.rows.map((p) => {
                    const ws = p.work_summary || '';
                    const shortSummary = ws.length > 90 ? ws.substring(0, 87) + '…' : ws;
                    return (
                      <div key={p.id} data-testid={`prestarts-card-wrap-${p.id}`}>
                      <CaptureCard
                        key={p.id}
                        record={p}
                        resourceKind="pre_starts"
                        apiPath="pre-starts"
                        subject={`Daily Pre-Start — ${p.date}`}
                        body={`Daily pre-start summary.\n\nDate: ${p.date}\nType: ${g.type}\nWork: ${ws}`}
                        subtitle={shortSummary ? <Highlight text={shortSummary} tokens={tokens} /> : null}
                        subtitleLines={density.subtitleLines}
                        minH={density.cardMinH}
                        titleNode={<Highlight text={g.type} tokens={tokens} />}
                        hideOperator
                        stripeStyle={{ backgroundColor: g.palette.hex }}
                        onDeleted={evict}
                        onArchive={isAdmin ? onArchive : undefined}
                        onUnarchive={isAdmin ? onUnarchive : undefined}
                        openInitially={deepLinkId === p.id}
                      />
                      {/* v58.13.132ic — Source filename affordance for
                          records ingested via /api/imports/pdf.
                          Mirrors the Incidents .132ia + SSRA .132hz
                          patterns. Text-only display; making it a
                          clickable preview requires storing the
                          source PDF in GridFS (queued for .132id). */}
                      {p.imported_from_pdf && (
                        <div className="mt-1 text-[10px] text-slate-500 truncate flex items-center gap-1"
                          data-testid={`prestarts-original-doc-${p.id}`}
                          title={p.imported_from_pdf}>
                          <FileText size={10} className="shrink-0 text-slate-400" />
                          <span className="truncate">Source: {p.imported_from_pdf}</span>
                        </div>
                      )}
                      {/* v58.13.132ki — View original PDF button.
                          Opens the source upload in a new tab via
                          `GET /api/imports/original-pdf/{id}`. Legacy
                          submissions (pre-.132ki) 404 with a friendly
                          toast. */}
                      {p.imported && (
                        <div className="mt-0.5 flex">
                          <ViewOriginalPdfButton
                            submissionId={p.id}
                            testid={`prestarts-view-original-${p.id}`}
                          />
                        </div>
                      )}
                      </div>
                    );
                  })}
                </CaptureCardGrid>
              </section>
            ))}
          </div>
        )}
        {/* v58.13.132eh — Load-more pager. Appears after the last
            group so it sits at the natural bottom of the scroll. */}
        {!loading && items.length > 0 && (
          <PaginationBar
            showing={items.length}
            total={serverTotal ?? items.length}
            pageSize={pageSize}
            onPageSize={setPageSize}
            onLoadMore={onLoadMore}
            loading={loading}
            testidPrefix="pre-starts"
            storageKey="pre-starts:pageSize"
          />
        )}
      </div>
    </div>
  );
}

function TypeChip({ active, label, count, palette, onClick, testid }) {
  const style = active
    ? { background: palette.hex, color: '#ffffff', borderColor: palette.hex }
    : { background: palette.chipBg, color: palette.chipText, borderColor: palette.border };
  return (
    <button
      type="button"
      onClick={onClick}
      style={style}
      className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border transition-shadow hover:shadow-sm"
      data-testid={testid}
      title={label}
    >
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{ background: active ? '#ffffff' : palette.hex }}
        aria-hidden
      />
      <span className="max-w-[220px] truncate">{label}</span>
      <span
        className="tabular-nums px-1.5 py-0.5 rounded-full text-[10px] font-semibold"
        style={{
          background: active ? 'rgba(255,255,255,0.22)' : '#ffffff',
          color: active ? '#ffffff' : palette.chipText,
        }}
      >
        {count}
      </span>
    </button>
  );
}

export function PreStartNew() {
  const navigate = useNavigate();
  const user = getUser();
  const wsId = user?.workspace_ids?.[0];
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    crew_lead: user?.name || '', work_summary: '', hazards_discussed: '', notes: '',
    linked_swms_ids: [], linked_permits: [],
    sign_ons: [{ name: '', role: '', signature_ts: null }],
  });
  const [swmsList, setSwmsList] = useState([]);
  useEffect(() => { api.get('/swms?status=approved&limit=20').then((r) => setSwmsList(r.data)).catch(() => {}); }, []);

  const updSign = (i, patch) => setForm((f) => ({ ...f, sign_ons: f.sign_ons.map((s, j) => j === i ? { ...s, ...patch } : s) }));
  const addSign = () => setForm((f) => ({ ...f, sign_ons: [...f.sign_ons, { name: '', role: '', signature_ts: null }] }));
  const delSign = (i) => setForm((f) => ({ ...f, sign_ons: f.sign_ons.filter((_, j) => j !== i) }));
  const sign = (i) => updSign(i, { signature_ts: new Date().toISOString() });

  const submit = async (e) => {
    e?.preventDefault();
    if (!form.work_summary || !form.crew_lead) { toast.error('Crew lead and work summary are required'); return; }
    setBusy(true);
    try {
      await api.post('/pre-starts', { ...form, workspace_id: wsId });
      toast.success('Pre-start saved');
      navigate('/app/pre-starts');
    } catch (err) { toast.error(apiError(err)); }
    finally { setBusy(false); }
  };

  const toggleSwms = (id) => setForm((f) => ({ ...f, linked_swms_ids: f.linked_swms_ids.includes(id) ? f.linked_swms_ids.filter((x) => x !== id) : [...f.linked_swms_ids, id] }));

  return (
    <div className="max-w-3xl mx-auto" data-testid="prestart-new">
      <BackButton to="/app/pre-starts" />
      <PageHeader crumb="Capture / Daily Pre-Starts / New" title="New pre-start" />
      <form onSubmit={submit} className="space-y-5">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 grid sm:grid-cols-2 gap-4">
          <Field label="Date" required><input data-testid="ps-date" type="date" className={inputClass} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
          <Field label="Crew lead" required><input data-testid="ps-crew-lead" className={inputClass} value={form.crew_lead} onChange={(e) => setForm({ ...form, crew_lead: e.target.value })} /></Field>
          <div className="sm:col-span-2"><Field label="Work summary" required><textarea data-testid="ps-summary" rows={3} className={inputClass} value={form.work_summary} onChange={(e) => setForm({ ...form, work_summary: e.target.value })} placeholder="What's the crew doing today?" /></Field></div>
          <div className="sm:col-span-2"><Field label="Hazards discussed"><textarea data-testid="ps-hazards" rows={2} className={inputClass} value={form.hazards_discussed} onChange={(e) => setForm({ ...form, hazards_discussed: e.target.value })} placeholder="What did toolbox cover?" /></Field></div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h3 className="font-display font-semibold mb-3">Link SWMS</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto">
            {swmsList.length === 0 && <div className="text-sm text-slate-400 italic">No approved SWMS available.</div>}
            {swmsList.map((s) => (
              <label key={s.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.linked_swms_ids.includes(s.id)} onChange={() => toggleSwms(s.id)} data-testid={`ps-swms-${s.id}`} />
                <span className="truncate">{s.title}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-display font-semibold">Crew sign-ons</h3>
            <button type="button" onClick={addSign} className="inline-flex items-center gap-1 text-sm text-brand-blue hover:underline"><Plus size={14} /> Add row</button>
          </div>
          <div className="space-y-2">
            {form.sign_ons.map((s, i) => (
              <div key={i} className="flex items-center gap-2" data-testid={`ps-signon-${i}`}>
                <input className={inputClass} placeholder="Name" value={s.name} onChange={(e) => updSign(i, { name: e.target.value })} />
                <input className={`${inputClass} w-40`} placeholder="Role" value={s.role || ''} onChange={(e) => updSign(i, { role: e.target.value })} />
                {s.signature_ts
                  ? <span className="text-xs text-emerald-700 bg-brand-green-mint border border-emerald-200 px-2 py-1 rounded-full whitespace-nowrap">Signed {new Date(s.signature_ts).toLocaleTimeString()}</span>
                  : <button type="button" onClick={() => sign(i)} className="text-xs px-3 py-1.5 rounded-lg border border-brand-blue text-brand-blue hover:bg-brand-blue-soft" data-testid={`ps-sign-${i}`}>Sign</button>}
                <button type="button" onClick={() => delSign(i)} className="p-2 text-slate-400 hover:text-brand-red"><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <GhostButton onClick={() => navigate('/app/pre-starts')} testid="ps-cancel">Cancel</GhostButton>
          <PrimaryButton type="submit" busy={busy} testid="ps-submit">Save pre-start</PrimaryButton>
        </div>
      </form>
    </div>
  );
}
