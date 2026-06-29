// Phase 3.14 — Import suppliers from Simpro into the contractor pool that
// backs Renewal Links. Top-level layout: search box + Refresh button at top,
// virtualised checkbox list in the middle, "Import N suppliers" at the
// bottom. Rows already promoted to contractors show a green "✓ Imported"
// badge with checkbox disabled.
import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Loader2, RefreshCw, Check, Search, Download } from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../lib/api';
import { getUser } from '../lib/auth';

const WRITE_ROLES = new Set(['admin', 'manager']);
const ROW_HEIGHT = 60; // px — used for windowed scroll calculation

export default function SimproSupplierImportModal({ onClose, onImported }) {
  const user = getUser();
  const canImport = WRITE_ROLES.has(user?.role);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const scrollRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get('/integrations/simpro/suppliers/cached', { params: { limit: 2000 } });
      setRows(r.data?.suppliers || []);
    } catch (e) { toast.error(apiError(e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  // ESC closes.
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter((r) =>
      (r.name || '').toLowerCase().includes(q) ||
      (r.abn || '').toLowerCase().includes(q) ||
      (r.email || '').toLowerCase().includes(q),
    );
  }, [rows, search]);

  const refresh = async () => {
    if (user?.role !== 'admin') {
      toast.error('Only admin can refresh from Simpro');
      return;
    }
    setRefreshing(true);
    try {
      const r = await api.post('/integrations/simpro/sync-suppliers');
      toast.success(`Synced from Simpro · imported ${r.data?.imported} / updated ${r.data?.updated}`);
      await load();
    } catch (e) { toast.error(apiError(e)); }
    finally { setRefreshing(false); }
  };

  const toggle = (id, isImported) => {
    if (isImported) return; // can't re-tick already-imported rows
    const n = new Set(selected);
    if (n.has(id)) n.delete(id); else n.add(id);
    setSelected(n);
  };

  const doImport = async () => {
    if (selected.size === 0) return;
    setImporting(true);
    try {
      const r = await api.post('/contractors/import-from-simpro',
        { vendor_ids: [...selected] });
      const { created, updated, skipped } = r.data || {};
      toast.success(`Imported ${created} new · updated ${updated} · skipped ${skipped}`);
      onImported?.(r.data?.contractors || []);
      onClose?.();
    } catch (e) { toast.error(apiError(e)); }
    finally { setImporting(false); }
  };

  // Windowed scroll — show 12 extra rows above/below to keep momentum smooth.
  const overscan = 12;
  const totalHeight = filtered.length * ROW_HEIGHT;
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - overscan);
  const end = Math.min(filtered.length, start + 30 + overscan * 2);
  const slice = filtered.slice(start, end);

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 grid place-items-center p-0 md:p-6"
         data-testid="simpro-supplier-modal"
         onClick={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="w-full h-full md:max-w-3xl md:h-[88vh] bg-white md:rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-[0.16em] font-semibold text-slate-500">Simpro · vendors</div>
            <h2 className="text-lg font-bold text-slate-900">Import suppliers</h2>
          </div>
          <button onClick={refresh} disabled={refreshing || user?.role !== 'admin'}
            data-testid="simpro-supplier-refresh"
            title={user?.role !== 'admin' ? 'Admin only' : 'Pull latest vendor list from Simpro'}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            {refreshing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Refresh from Simpro
          </button>
          <button onClick={onClose} className="w-9 h-9 grid place-items-center rounded-lg text-slate-500 hover:bg-slate-200">
            <X size={16} />
          </button>
        </div>

        {/* Search */}
        <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
          <div className="flex-1 relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              data-testid="simpro-supplier-search"
              placeholder="Search by name, ABN or email…"
              className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e4a8c]/30" />
          </div>
          <div className="text-[11px] text-slate-500 whitespace-nowrap">
            {filtered.length} of {rows.length}
          </div>
        </div>

        {/* Body — windowed list */}
        <div ref={scrollRef} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
             className="flex-1 overflow-y-auto bg-slate-50">
          {loading ? (
            <div className="grid place-items-center h-full text-slate-400">
              <div className="inline-flex items-center gap-2 text-sm">
                <Loader2 size={14} className="animate-spin" /> Loading suppliers…
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="grid place-items-center h-full text-slate-400 text-sm">
              {rows.length === 0
                ? <span>No suppliers cached. Click <b>Refresh from Simpro</b> to pull the latest.</span>
                : <span>No matches for "{search}"</span>}
            </div>
          ) : (
            <div style={{ height: totalHeight, position: 'relative' }}>
              <div style={{ transform: `translateY(${start * ROW_HEIGHT}px)` }}>
                {slice.map((s) => {
                  const isImported = !!s.imported_contractor_id;
                  const checked = selected.has(s.simpro_vendor_id);
                  return (
                    <div key={s.simpro_vendor_id}
                      data-testid={`simpro-supplier-row-${s.simpro_vendor_id}`}
                      data-imported={isImported ? 'true' : 'false'}
                      onClick={() => toggle(s.simpro_vendor_id, isImported)}
                      className={`flex items-start gap-3 px-5 py-2 border-b border-slate-100 bg-white ${isImported ? 'opacity-60 cursor-default' : 'cursor-pointer hover:bg-[#f5f9ff]'}`}
                      style={{ height: ROW_HEIGHT }}>
                      <input type="checkbox" checked={checked} disabled={isImported}
                        readOnly onChange={() => {}}
                        className="mt-1 w-4 h-4 accent-[#1e4a8c]" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <div className="font-medium text-sm text-slate-900 truncate">{s.name}</div>
                          {isImported && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#d8ecdd] text-[#1f7a3f]">
                              <Check size={10} /> Imported
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500 truncate">
                          {s.abn ? `ABN ${s.abn} · ` : ''}{s.email || 'no email'}{s.phone ? ` · ${s.phone}` : ''}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2">
          <div className="flex-1 text-[11px] text-slate-500">
            {selected.size === 0 ? 'Tick suppliers to import.' : `${selected.size} selected.`}
          </div>
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-100">
            Cancel
          </button>
          <button onClick={doImport} disabled={!canImport || importing || selected.size === 0}
            data-testid="simpro-import-confirm"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#1e4a8c] text-white text-sm font-semibold uppercase tracking-wider hover:bg-[#143263] disabled:opacity-60">
            {importing ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
            Import {selected.size > 0 ? `${selected.size} suppliers` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
