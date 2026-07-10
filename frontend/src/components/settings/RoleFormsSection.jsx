// v160.0.13 — Per-role Form allowlist tab in Permissions Matrix.
// Admins pick a role, then flip switches per template grouped by category
// to control which forms that role can view and fill on mobile. Save is
// debounced (300 ms) — no separate save button.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import api, { apiError } from '@/lib/api';
import {
  ChevronDown20Regular,
  ChevronRight20Regular,
  DocumentText20Regular,
} from '@fluentui/react-icons';

const ROLES = [
  { key: 'worker',     label: 'Worker'     },
  { key: 'supervisor', label: 'Supervisor' },
  { key: 'foreman',    label: 'Foreman'    },
  { key: 'contractor', label: 'Contractor' },
  { key: 'hseq',       label: 'HSEQ'       },
];

const CATEGORY_ORDER = ['general', 'pre_start', 'inspection', 'near_miss', 'incident', 'toolbox'];

export default function RoleFormsSection({ canEdit }) {
  const [role, setRole] = useState('worker');
  const [data, setData] = useState(null);         // full API response
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(new Set());
  const debounceRef = useRef(null);

  const load = useCallback(async (r) => {
    setLoading(true);
    try {
      const resp = await api.get(`/org/role-presets/${r}/forms`);
      setData(resp.data);
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(role); }, [role, load]);

  const toggleCollapsed = (k) => {
    const next = new Set(collapsed);
    next.has(k) ? next.delete(k) : next.add(k);
    setCollapsed(next);
  };

  const saveDebounced = useCallback((updatedData) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const enabledIds = updatedData.categories
        .flatMap((c) => c.forms.filter((f) => f.enabled).map((f) => f.id));
      try {
        await api.put(`/org/role-presets/${role}/forms`, { allowed_form_ids: enabledIds });
        toast.success('Saved', { duration: 1200 });
      } catch (e) {
        toast.error(`Save failed — ${apiError(e)}`);
      }
    }, 300);
  }, [role]);

  const flip = (formId) => {
    if (!canEdit) return;
    setData((prev) => {
      if (!prev) return prev;
      const next = {
        ...prev,
        explicit: true,
        categories: prev.categories.map((c) => ({
          ...c,
          forms: c.forms.map((f) => f.id === formId ? { ...f, enabled: !f.enabled } : f),
        })),
      };
      saveDebounced(next);
      return next;
    });
  };

  const totalEnabled = useMemo(() => {
    if (!data) return 0;
    return data.categories.reduce((n, c) => n + c.forms.filter((f) => f.enabled).length, 0);
  }, [data]);
  const totalForms = useMemo(() => {
    if (!data) return 0;
    return data.categories.reduce((n, c) => n + c.forms.length, 0);
  }, [data]);

  return (
    <div className="space-y-4" data-testid="role-forms-section">
      <div className="rounded-2xl bg-white border border-slate-200 p-5">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
              <DocumentText20Regular className="text-orange-500" />
              Forms per role
            </h2>
            <p className="text-sm text-slate-500 mt-0.5">
              Choose which forms each role can view and fill on mobile. Admin/Owner always see everything.
            </p>
          </div>
          <div className="flex gap-1 flex-wrap" data-testid="role-forms-role-picker">
            {ROLES.map((r) => (
              <button
                key={r.key}
                data-testid={`role-tab-${r.key}`}
                onClick={() => setRole(r.key)}
                className={`px-3 py-1.5 text-sm font-medium rounded-full border transition ${
                  role === r.key
                    ? 'bg-orange-500 text-white border-orange-500'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="text-sm text-slate-500 mt-4">Loading…</div>
        ) : !data ? (
          <div className="text-sm text-slate-500 mt-4">No data.</div>
        ) : (
          <>
            <div className="mt-3 text-xs text-slate-500 flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-orange-500" />
              <strong>{totalEnabled}</strong> of <strong>{totalForms}</strong> forms enabled for{' '}
              <strong className="text-slate-700">{ROLES.find((r) => r.key === role)?.label}</strong>
              {!data.explicit && (
                <span className="ml-2 px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-semibold uppercase tracking-wide">
                  Default: all enabled
                </span>
              )}
            </div>

            <div className="mt-4 space-y-3">
              {CATEGORY_ORDER.map((catKey) => {
                const cat = data.categories.find((c) => c.key === catKey);
                if (!cat) return null;
                const isCollapsed = collapsed.has(catKey);
                const enabledCount = cat.forms.filter((f) => f.enabled).length;
                return (
                  <div key={catKey} data-testid={`cat-${catKey}`} className="rounded-xl border border-slate-200 overflow-hidden">
                    <button
                      onClick={() => toggleCollapsed(catKey)}
                      className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-50 hover:bg-slate-100 transition"
                      data-testid={`cat-${catKey}-header`}
                    >
                      <div className="flex items-center gap-2">
                        {isCollapsed ? <ChevronRight20Regular /> : <ChevronDown20Regular />}
                        <span className="font-semibold text-slate-800">{cat.label}</span>
                        <span className="text-xs text-slate-500">
                          · {enabledCount}/{cat.forms.length}
                        </span>
                      </div>
                    </button>
                    {!isCollapsed && (
                      <div className="divide-y divide-slate-100">
                        {cat.forms.length === 0 ? (
                          <div className="px-4 py-3 text-sm text-slate-400 italic">No forms in this category yet</div>
                        ) : cat.forms.map((f) => (
                          <label
                            key={f.id}
                            data-testid={`form-row-${f.id}`}
                            className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-orange-50/40 cursor-pointer min-h-[44px]"
                          >
                            <span className="text-sm text-slate-700">{f.name}</span>
                            <input
                              type="checkbox"
                              className="peer sr-only"
                              checked={f.enabled}
                              onChange={() => flip(f.id)}
                              disabled={!canEdit}
                              data-testid={`form-switch-${f.id}`}
                            />
                            <span
                              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${
                                f.enabled ? 'bg-orange-500' : 'bg-slate-300'
                              }`}
                              onClick={(e) => { e.preventDefault(); flip(f.id); }}
                            >
                              <span
                                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                                  f.enabled ? 'translate-x-5' : 'translate-x-0.5'
                                }`}
                              />
                            </span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
