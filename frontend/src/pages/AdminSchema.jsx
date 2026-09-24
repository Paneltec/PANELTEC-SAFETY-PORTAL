/* v58.13.132mt — Admin schema inspector.
 *
 * Read-only reference documentation of the entire database. Built for
 * a future handover to another software team (MySQL shop). All data
 * fetched from `/api/schema/*` admin-only endpoints.
 *
 * Structure:
 *   · Toolbar: Refresh · Export JSON · Export Markdown · Print All
 *   · Left rail: search + alphabetized collection list (badge = doc count)
 *   · Main pane: tabs (Fields / Indexes / Sample doc)
 *
 * Print CSS: the `.no-print` class hides toolbar + sidebar during
 * `window.print()`; the main pane expands to full width and every
 * collection tab is rendered inline.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Download, Printer, Search, Database as DatabaseIcon } from 'lucide-react';
import { toast } from 'sonner';
import api from '../lib/api';
import { getToken } from '../lib/auth';

const REACT_APP_BACKEND_URL = process.env.REACT_APP_BACKEND_URL;

function fmtBytes(n) {
  if (!n) return '0';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function fmtRelative(iso) {
  if (!iso) return 'never';
  const then = new Date(iso).getTime();
  if (!then) return iso;
  const delta = Math.max(0, Date.now() - then);
  const m = Math.floor(delta / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export default function AdminSchema() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [collections, setCollections] = useState([]);
  const [failed, setFailed] = useState([]);
  const [generatedAt, setGeneratedAt] = useState(null);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState('fields');

  async function loadList(refresh = false) {
    setLoading(!refresh);
    setRefreshing(refresh);
    try {
      const { data } = await api.get('/schema/collections', { params: { refresh: refresh || undefined } });
      setCollections(data.collections || []);
      setFailed(data.failed || []);
      setGeneratedAt(data.generated_at);
      if (!selected && (data.collections || []).length) {
        setSelected(data.collections[0].name);
      }
      if (refresh) toast.success('Schema refreshed');
    } catch (e) {
      toast.error(`Failed to load schema: ${e?.response?.data?.detail || e.message}`);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function loadDetail(name, refresh = false) {
    if (!name) return;
    setDetailLoading(true);
    setDetail(null);
    try {
      const { data } = await api.get(`/schema/collection/${encodeURIComponent(name)}`, {
        params: { refresh: refresh || undefined },
      });
      setDetail(data);
    } catch (e) {
      toast.error(`Failed to load ${name}: ${e?.response?.data?.detail || e.message}`);
    } finally {
      setDetailLoading(false);
    }
  }

  useEffect(() => { loadList(false); /* eslint-disable-line react-hooks/exhaustive-deps */ }, []);
  useEffect(() => { if (selected) loadDetail(selected, false); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [selected]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return collections;
    return collections.filter((c) => c.name.toLowerCase().includes(q));
  }, [collections, search]);

  async function download(format) {
    const url = `${REACT_APP_BACKEND_URL}/api/schema/export?format=${format}`;
    try {
      const resp = await fetch(url, { headers: { Authorization: `Bearer ${getToken()}` } });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      const a = document.createElement('a');
      const objUrl = URL.createObjectURL(blob);
      a.href = objUrl;
      a.download = format === 'md' ? 'paneltec_schema.md' : 'paneltec_schema.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objUrl);
      toast.success(`Downloaded schema.${format}`);
    } catch (e) {
      toast.error(`Export failed: ${e.message}`);
    }
  }

  return (
    <div className="max-w-[1400px] mx-auto p-4 sm:p-6" data-testid="admin-schema-page">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .print-full { width: 100% !important; max-width: 100% !important; }
        }
      `}</style>

      {/* Header */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold tracking-[0.18em] text-slate-500 uppercase">ADMIN · SYSTEM REFERENCE</div>
          <h1 className="font-display text-2xl sm:text-3xl font-semibold text-slate-900 mt-1">Database Schema</h1>
          <p className="text-sm text-slate-600 mt-1 max-w-2xl">
            Reference documentation for handover / integration. Sample values in this page are
            redacted for PII (emails, phones, DOBs, names, tokens, hashes → <code className="bg-slate-100 px-1 rounded text-[11px]">REDACTED</code>).
          </p>
        </div>
        <div className="no-print flex items-center gap-2 text-xs text-slate-600">
          <span data-testid="schema-generated-at">Generated: <strong>{fmtRelative(generatedAt)}</strong></span>
        </div>
      </div>

      {/* Toolbar */}
      <div className="no-print flex flex-wrap items-center gap-2 mb-4">
        <button
          type="button"
          data-testid="schema-refresh-btn"
          onClick={() => loadList(true)}
          disabled={refreshing}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-60"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          {refreshing ? 'Refreshing…' : 'Refresh schema'}
        </button>
        <button
          type="button"
          data-testid="schema-export-json-btn"
          onClick={() => download('json')}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold border border-slate-300 text-slate-800 bg-white hover:bg-slate-50"
        >
          <Download size={14} /> Export as JSON
        </button>
        <button
          type="button"
          data-testid="schema-export-md-btn"
          onClick={() => download('md')}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold border border-slate-300 text-slate-800 bg-white hover:bg-slate-50"
        >
          <Download size={14} /> Export as Markdown
        </button>
        <button
          type="button"
          data-testid="schema-print-btn"
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold border border-slate-300 text-slate-800 bg-white hover:bg-slate-50"
        >
          <Printer size={14} /> Print all
        </button>
        <div className="ml-auto text-xs text-slate-500">
          {loading ? 'Loading…' : `${collections.length} collections${failed.length ? ` · ${failed.length} failed` : ''}`}
        </div>
      </div>

      {/* Failure banner */}
      {failed.length > 0 && (
        <div className="no-print mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900" data-testid="schema-failed-banner">
          <strong>Introspection failed for {failed.length} collection{failed.length === 1 ? '' : 's'}:</strong>{' '}
          {failed.map((f) => f.name).join(', ')}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-4">
        {/* Left rail */}
        <aside className="no-print bg-white border border-slate-200 rounded-xl p-3 h-[calc(100vh-260px)] overflow-hidden flex flex-col" data-testid="schema-collections-list">
          <div className="relative mb-2">
            <Search size={14} className="absolute left-2 top-2.5 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search collections…"
              className="w-full pl-7 pr-2 py-2 text-xs border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-300"
              data-testid="schema-search-input"
            />
          </div>
          <div className="flex-1 overflow-y-auto -mr-2 pr-1">
            {loading && <div className="text-xs text-slate-500 py-4 text-center">Loading collections…</div>}
            {!loading && filtered.map((c) => {
              const active = c.name === selected;
              return (
                <button
                  key={c.name}
                  type="button"
                  data-testid={`schema-coll-${c.name}`}
                  onClick={() => setSelected(c.name)}
                  className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-left text-xs mb-0.5 ${
                    active ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <span className="truncate font-mono text-[11px]">{c.name}</span>
                  <span className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                    active ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'
                  }`}>
                    {(c.count ?? 0).toLocaleString()}
                  </span>
                </button>
              );
            })}
            {!loading && filtered.length === 0 && (
              <div className="text-xs text-slate-500 py-4 text-center">No matches.</div>
            )}
          </div>
        </aside>

        {/* Main pane */}
        <section className="print-full bg-white border border-slate-200 rounded-xl p-4 sm:p-6 min-h-[400px]" data-testid="schema-detail-pane">
          {!selected && !detailLoading && (
            <div className="text-sm text-slate-500 flex items-center gap-2">
              <DatabaseIcon size={16} /> Select a collection from the list.
            </div>
          )}
          {detailLoading && (
            <div className="text-sm text-slate-500">Loading collection detail…</div>
          )}
          {detail && (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-3 mb-4">
                <div>
                  <h2 className="text-xl font-semibold font-mono text-slate-900" data-testid="schema-detail-name">{detail.name}</h2>
                  <div className="text-xs text-slate-500 mt-1">
                    {(detail.count ?? 0).toLocaleString()} documents · {fmtBytes(detail.size_bytes)} · avg {fmtBytes(detail.avg_doc_size)} · {detail.index_count} indexes · sampled {detail.sampled_docs}
                  </div>
                </div>
                <div className="no-print flex items-center gap-1 border border-slate-200 rounded-lg p-1">
                  {['fields', 'indexes', 'sample'].map((t) => (
                    <button
                      key={t}
                      type="button"
                      data-testid={`schema-tab-${t}`}
                      onClick={() => setTab(t)}
                      className={`px-3 py-1 rounded-md text-xs font-semibold ${
                        tab === t ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      {t === 'fields' ? 'Fields' : t === 'indexes' ? 'Indexes' : 'Sample doc'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Fields */}
              {(tab === 'fields' || typeof window !== 'undefined') && (
                <div className={tab === 'fields' ? '' : 'hidden print:!block'} data-testid="schema-fields-tab">
                  <div className="overflow-x-auto border border-slate-200 rounded-lg">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 text-slate-600">
                        <tr>
                          <th className="text-left px-3 py-2 font-semibold">Field path</th>
                          <th className="text-left px-3 py-2 font-semibold">Types</th>
                          <th className="text-right px-3 py-2 font-semibold">Null %</th>
                          <th className="text-left px-3 py-2 font-semibold">Array of</th>
                          <th className="text-left px-3 py-2 font-semibold">Sample values</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(detail.field_types || {}).map(([path, meta]) => (
                          <tr key={path} className="border-t border-slate-100 align-top">
                            <td className="px-3 py-2 font-mono text-[11px] text-slate-800">{path}</td>
                            <td className="px-3 py-2">
                              {(meta.types_seen || []).map((t) => (
                                <span key={t} className="inline-block mr-1 mb-1 px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px] font-mono">{t}</span>
                              ))}
                            </td>
                            <td className="px-3 py-2 text-right text-slate-600">{meta.null_pct ?? 0}%</td>
                            <td className="px-3 py-2 text-slate-600">
                              {(meta.array_of || []).length ? (meta.array_of || []).join(', ') : ''}
                            </td>
                            <td className="px-3 py-2 text-slate-600 font-mono text-[11px]">
                              {(meta.sample_values || []).map((v, i) => (
                                <div key={i} className="truncate max-w-[280px]" title={JSON.stringify(v)}>{JSON.stringify(v)}</div>
                              ))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Indexes */}
              <div className={tab === 'indexes' ? 'mt-2' : 'hidden print:!block print:!mt-4'} data-testid="schema-indexes-tab">
                {tab !== 'fields' && <h3 className="hidden print:!block font-semibold text-sm text-slate-900 mb-2">Indexes</h3>}
                <div className="overflow-x-auto border border-slate-200 rounded-lg">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th className="text-left px-3 py-2 font-semibold">Name</th>
                        <th className="text-left px-3 py-2 font-semibold">Keys</th>
                        <th className="text-center px-3 py-2 font-semibold">Unique</th>
                        <th className="text-center px-3 py-2 font-semibold">Sparse</th>
                        <th className="text-center px-3 py-2 font-semibold">TTL (s)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(detail.indexes || []).map((i) => (
                        <tr key={i.name} className="border-t border-slate-100">
                          <td className="px-3 py-2 font-mono text-[11px]">{i.name}</td>
                          <td className="px-3 py-2 font-mono text-[11px] text-slate-700">
                            {(i.keys || []).map((k) => `${k.field}:${k.direction}`).join(', ')}
                          </td>
                          <td className="px-3 py-2 text-center">{i.unique ? '✓' : ''}</td>
                          <td className="px-3 py-2 text-center">{i.sparse ? '✓' : ''}</td>
                          <td className="px-3 py-2 text-center">{i.ttl_seconds ?? ''}</td>
                        </tr>
                      ))}
                      {(!detail.indexes || detail.indexes.length === 0) && (
                        <tr><td colSpan={5} className="px-3 py-3 text-center text-slate-400 text-[11px]">No indexes.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Sample doc */}
              <div className={tab === 'sample' ? 'mt-2' : 'hidden print:!block print:!mt-4'} data-testid="schema-sample-tab">
                {tab !== 'fields' && <h3 className="hidden print:!block font-semibold text-sm text-slate-900 mb-2">Sample document (redacted)</h3>}
                <pre className="text-[11px] font-mono bg-slate-50 border border-slate-200 rounded-lg p-3 overflow-x-auto max-h-[600px]">
{JSON.stringify(detail.sample_document, null, 2)}
                </pre>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
