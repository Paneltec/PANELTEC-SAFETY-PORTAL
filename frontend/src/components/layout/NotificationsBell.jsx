// v160.3.9.57.2 — Notifications bell + dropdown panel.
//
// Consumes `GET /api/notifications` from the header bell in
// `AppShell.jsx`. Right-anchored ~380px dropdown, max-height 60vh
// scroll, grouped by category. Click a row → navigate to `link`
// AND optimistically POST `/api/notifications/{id}/read`. Bell badge
// = `unread_count` (hidden if 0). Polls every 60s while the tab is
// visible (paused on `visibilitychange` to hidden).

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api';

const CATEGORY_META = {
  expiring_certs:      { label: 'Certifications', pill: '#f59e0b' },
  overdue_renewals:    { label: 'Renewals',       pill: '#ef4444' },
  failed_integrations: { label: 'Integrations',   pill: '#7c3aed' },
  pending_approvals:   { label: 'Approvals',      pill: '#0ea5e9' },
};
const SEVERITY_DOT = {
  danger:  '#ef4444',
  warning: '#f59e0b',
  info:    '#0ea5e9',
};

function relTime(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  const min = Math.round(Math.abs(diff) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

export default function NotificationsBell() {
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unreadCount, setUnread] = useState(0);
  // v57.4 — per-category unread counts from the same GET response;
  // enables the pill row in the header and a client-side category
  // filter without a re-fetch.
  const [perCategory, setPerCategory] = useState({});
  const [categoryFilter, setCategoryFilter] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const panelRef = useRef(null);
  const buttonRef = useRef(null);

  const fetchNow = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get('/notifications');
      setItems(data.items || []);
      setUnread(data.unread_count || 0);
      setPerCategory(data.per_category_unread || {});
    } catch (e) {
      setError('Unable to load notifications.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch + 60s poll while tab visible.
  useEffect(() => {
    fetchNow();
    let interval = null;
    const start = () => {
      if (interval) return;
      interval = setInterval(fetchNow, 60000);
    };
    const stop = () => { if (interval) { clearInterval(interval); interval = null; } };
    const onVis = () => (document.visibilityState === 'visible' ? (fetchNow(), start()) : stop());
    start();
    document.addEventListener('visibilitychange', onVis);
    return () => { stop(); document.removeEventListener('visibilitychange', onVis); };
  }, [fetchNow]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (!panelRef.current || !buttonRef.current) return;
      if (panelRef.current.contains(e.target) || buttonRef.current.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const onItemClick = async (item) => {
    // Optimistic mark-read; on failure, restore.
    if (!item.read) {
      setItems((prev) => prev.map((it) => it.id === item.id ? { ...it, read: true } : it));
      setUnread((n) => Math.max(0, n - 1));
      api.post(`/notifications/${item.id}/read`).catch(() => {
        setItems((prev) => prev.map((it) => it.id === item.id ? { ...it, read: false } : it));
        setUnread((n) => n + 1);
      });
    }
    setOpen(false);
    if (item.link) nav(item.link);
  };

  const onMarkAll = async () => {
    if (!unreadCount) return;
    setItems((prev) => prev.map((it) => ({ ...it, read: true })));
    setUnread(0);
    try { await api.post('/notifications/mark-all-read'); } catch { fetchNow(); }
  };

  // Group items by category, preserving unread-first order. When a
  // category filter is active, only that category's items render.
  const filteredItems = categoryFilter
    ? items.filter((it) => it.category === categoryFilter)
    : items;
  const grouped = filteredItems.reduce((acc, it) => {
    (acc[it.category] = acc[it.category] || []).push(it);
    return acc;
  }, {});

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => setOpen((o) => !o)}
        className="relative p-2 rounded-md hover:bg-slate-100 text-slate-500"
        data-testid="notifications-bell"
        aria-label={`Notifications — ${unreadCount} unread`}
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span
            data-testid="notifications-bell-badge"
            className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          data-testid="notifications-panel"
          className="absolute right-0 mt-2 w-[380px] max-w-[90vw] bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden z-50"
          style={{ maxHeight: '60vh', display: 'flex', flexDirection: 'column' }}
        >
          <div className="px-4 py-3 border-b border-slate-100 flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-slate-800" data-testid="notifications-panel-title">
                Notifications — {unreadCount} unread
              </div>
              <div className="text-[11px] text-slate-500 leading-snug mt-0.5">
                Live signals that need your attention. Click an item to jump to it.
              </div>
              {/* v57.4 — per-category pill row. Only categories with >0
                  unread render. Click a pill → filter to that category.
                  "All" chip clears the filter. */}
              {(() => {
                const catShorts = {
                  expiring_certs:      { label: 'certs', pill: '#f59e0b' },
                  overdue_renewals:    { label: 'renewals', pill: '#ef4444' },
                  failed_integrations: { label: 'integrations', pill: '#7c3aed' },
                  pending_approvals:   { label: 'approvals', pill: '#0ea5e9' },
                };
                const activeCats = Object.entries(perCategory).filter(([, n]) => n > 0);
                if (activeCats.length === 0) return null;
                return (
                  <div className="flex flex-wrap gap-1 mt-2" data-testid="notifications-category-pills">
                    {categoryFilter && (
                      <button
                        onClick={() => setCategoryFilter(null)}
                        className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-900 text-white"
                        data-testid="notifications-pill-all"
                      >
                        Show all
                      </button>
                    )}
                    {activeCats.map(([cat, n]) => {
                      const meta = catShorts[cat] || { label: cat, pill: '#94a3b8' };
                      const isActive = categoryFilter === cat;
                      return (
                        <button
                          key={cat}
                          onClick={() => setCategoryFilter(isActive ? null : cat)}
                          data-testid={`notifications-pill-${cat}`}
                          className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full transition"
                          style={{
                            background: isActive ? meta.pill : `${meta.pill}22`,
                            color: isActive ? '#FFFFFF' : meta.pill,
                            border: `1px solid ${meta.pill}55`,
                          }}
                        >
                          {n} {meta.label}
                        </button>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
            <button
              onClick={() => setOpen(false)}
              className="p-1 rounded hover:bg-slate-100 text-slate-400"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>

          <div className="overflow-y-auto flex-1" data-testid="notifications-panel-scroll">
            {loading && !items.length && (
              <div className="p-6 text-center text-sm text-slate-400">Loading…</div>
            )}
            {error && (
              <div className="p-6 text-center text-sm text-red-500" data-testid="notifications-panel-error">{error}</div>
            )}
            {!loading && !error && !items.length && (
              <div className="p-8 text-center text-sm text-slate-500" data-testid="notifications-panel-empty">
                <div className="text-2xl mb-2">✓</div>
                <div className="font-semibold text-slate-700">You&apos;re all caught up</div>
                <div className="text-xs mt-1">Nothing needs attention right now.</div>
              </div>
            )}
            {Object.entries(grouped).map(([cat, list]) => {
              const meta = CATEGORY_META[cat] || { label: cat, pill: '#94a3b8' };
              return (
                <div key={cat} className="border-b border-slate-100 last:border-b-0">
                  <div className="px-4 pt-3 pb-1.5 flex items-center gap-2">
                    <span
                      className="inline-block w-2 h-2 rounded-full"
                      style={{ background: meta.pill }}
                    />
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      {meta.label} · {list.length}
                    </span>
                  </div>
                  {list.map((it) => (
                    <button
                      key={it.id}
                      onClick={() => onItemClick(it)}
                      data-testid={`notifications-item-${it.id}`}
                      className={`w-full text-left px-4 py-2.5 hover:bg-slate-50 flex items-start gap-2.5 transition ${it.read ? 'opacity-60' : ''}`}
                    >
                      <span
                        className="mt-1 inline-block w-2 h-2 rounded-full flex-shrink-0"
                        style={{ background: SEVERITY_DOT[it.severity] || SEVERITY_DOT.info }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-semibold text-slate-800 leading-tight truncate">{it.title}</div>
                        {it.subtitle && (
                          <div className="text-[11px] text-slate-500 leading-snug mt-0.5 line-clamp-2">{it.subtitle}</div>
                        )}
                        <div className="text-[10px] text-slate-400 mt-1">{relTime(it.created_at)}</div>
                      </div>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>

          {items.length > 0 && unreadCount > 0 && (
            <button
              onClick={onMarkAll}
              data-testid="notifications-mark-all"
              className="border-t border-slate-100 px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-slate-500 hover:bg-slate-50"
            >
              Mark all as read
            </button>
          )}
        </div>
      )}
    </div>
  );
}
