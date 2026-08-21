// v58.13.19 — Checklist link picker modal for RichTextEditor.
//
// Fetches `GET /api/forms/templates` (same endpoint Forms.jsx uses at
// L1227), lets the user filter by name substring, and on selection
// calls `onPick(templateId, templateName)`. The caller is responsible
// for inserting the `<a>` into the rich-text buffer — this component
// stays pure/read-only.
//
// v58.13.10 flash-bug guardrail: the trigger that mounts this modal
// (in RichTextEditor toolbar) already calls e.stopPropagation() so
// this modal cannot receive its own opening click; the internal
// close-on-backdrop handler also uses e.target === e.currentTarget
// to avoid closing when the user clicks inside the modal card.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, Search, ClipboardList, Loader2 } from 'lucide-react';
import api, { apiError } from '../lib/api';
import { toast } from 'sonner';
import useLockBodyScroll from '../lib/useLockBodyScroll';

export default function ChecklistLinkPicker({ onPick, onClose }) {
  useLockBodyScroll();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get('/forms/templates');
        if (cancelled) return;
        setRows(Array.isArray(data) ? data : []);
      } catch (e) {
        if (!cancelled) toast.error(apiError(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    // Auto-focus the search field once mounted so the user can start
    // typing immediately.
    const t = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const base = needle
      ? rows.filter((r) => (r.name || '').toLowerCase().includes(needle))
      : rows;
    return base.slice(0, 100);
  }, [rows, q]);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 p-3"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      data-testid="checklist-link-picker">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col max-h-[80vh]">
        <div className="px-5 py-3 border-b flex items-center gap-2">
          <ClipboardList size={16} className="text-blue-600 shrink-0" />
          <h3 className="font-display font-bold text-slate-900 flex-1">
            Link a checklist
          </h3>
          <button onClick={onClose}
            data-testid="checklist-picker-close"
            className="p-1 rounded hover:bg-slate-100 text-slate-500">
            <X size={16} />
          </button>
        </div>
        <div className="px-5 py-3 border-b border-slate-100">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              ref={inputRef}
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter checklists by name…"
              data-testid="checklist-picker-search"
              className="w-full pl-8 pr-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>
          <p className="mt-1.5 text-[11px] text-slate-500">
            Inserts a link the reader can click to view this checklist.
          </p>
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {loading && (
            <div className="p-5 text-center text-xs text-slate-500"
              data-testid="checklist-picker-loading">
              <Loader2 size={14} className="inline animate-spin mr-1" />
              Loading form templates…
            </div>
          )}
          {!loading && filtered.length === 0 && (
            <div className="p-5 text-center text-xs text-slate-500"
              data-testid="checklist-picker-empty">
              {q ? `No templates matching "${q}".` : 'No form templates available.'}
            </div>
          )}
          {!loading && filtered.length > 0 && (
            <ul className="space-y-1" data-testid="checklist-picker-list">
              {filtered.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      onPick(t.id, t.name);
                    }}
                    className="w-full text-left px-3 py-2 rounded-lg border border-slate-200 hover:bg-blue-50 hover:border-blue-300 transition-colors"
                    data-testid={`checklist-picker-item-${t.id}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-slate-900 flex-1 truncate">
                        {t.name}
                      </span>
                      {t.category && (
                        <span className="text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                          {t.category}
                        </span>
                      )}
                    </div>
                    {t.description && (
                      <div className="text-[11px] text-slate-500 mt-0.5 line-clamp-2">
                        {t.description}
                      </div>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="px-5 py-3 border-t bg-slate-50 flex justify-end">
          <button onClick={onClose}
            data-testid="checklist-picker-cancel"
            className="px-3 py-2 rounded-lg border border-slate-300 text-sm font-semibold hover:bg-white">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
