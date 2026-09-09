// v58.13.132bk — Per-role Form allowlist tab in Permissions Matrix.
// Tabs now hydrate from `/api/admin/roles` filtered to `is_system=true`
// (same pattern as `.132bg`), replacing the legacy hardcoded list of
// worker/supervisor/foreman/contractor/hseq.
//
// Tab order (Stephen-locked):
//   1. Admin                     ← read-only "sees everything" tier
//   2. Paneltec Civil
//   3. Viatec Traffic Solutions
//   4. External Contractor
//
// Admin tab renders read-only with all toggles enabled + an info
// banner explaining "Admin sees every form — this list is read-only."
// Backend rejects PUTs against the admin/owner tiers so a stale
// client can't accidentally restrict an admin.
//
// Storage/API contract is unchanged:
//   · GET  /org/role-presets/{role}/forms  → categorised, per-form `enabled` flag
//   · PUT  /org/role-presets/{role}/forms  → `{allowed_form_ids: [...]}`
//
// Legacy tokens (`worker`, `supervisor`, `foreman`, `contractor`,
// `hseq`) are rewritten by `backend/scripts/backfill_forms_per_role_v58_13_132bk.py`.
// The backend endpoint whitelist (`_norm_role` in `org_settings.py`)
// now only accepts the 4 core seed roles + `owner`.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import api, { apiError } from '@/lib/api';
import {
  ChevronDown20Regular,
  ChevronRight20Regular,
  DocumentText20Regular,
  Info20Regular,
} from '@fluentui/react-icons';

// v160.2.6-cat addendum #2 — 7th category `admin` for admin-only forms
// (e.g. Drug & Alcohol Test Record). Workers never see this bucket on
// the mobile forms library, and the Worker allowlist auto-excludes
// every admin-category template.
const CATEGORY_ORDER = ['general', 'pre_start', 'inspection', 'near_miss', 'incident', 'toolbox', 'admin'];

// v58.13.132bk — Deterministic order: Admin → org roles alphabetical
// → External Contractor last. Matches `.132bg` dropdown ordering.
const CORE_ROLE_RANK = (rid) =>
  rid === 'admin' ? 0
  : rid === 'external_contractor' ? 2
  : 1;

export default function RoleFormsSection({ canEdit, can }) {
  // v160.3.9.29-2a — Dual-prop shim during the sub-phase 2a→2b/2c
  // migration. New consumers should pass `can={...}`; legacy consumers
  // (`canEdit={...}`) continue to work unchanged.
  const gate = (can !== undefined) ? can : canEdit;
  const [tabs, setTabs] = useState([]);           // [{role_id, name}, ...]
  const [role, setRole] = useState(null);
  const [data, setData] = useState(null);          // full API response
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(new Set());
  const debounceRef = useRef(null);

  // ── Hydrate tab list from /api/admin/roles ──────────────────
  useEffect(() => {
    let cancelled = false;
    api.get('/admin/roles')
      .then((r) => {
        if (cancelled) return;
        const seeds = (r.data?.roles || [])
          .filter((row) => row.is_system === true && row.is_active !== false)
          .sort((a, b) => {
            const ra = CORE_ROLE_RANK(a.role_id);
            const rb = CORE_ROLE_RANK(b.role_id);
            if (ra !== rb) return ra - rb;
            return (a.name || a.role_id).localeCompare(b.name || b.role_id);
          })
          .map((row) => ({ role_id: row.role_id, name: row.name || row.role_id }));
        setTabs(seeds);
        // Default: open on Admin (leftmost) so the "sees everything"
        // info banner surfaces immediately.
        if (seeds.length > 0 && role == null) setRole(seeds[0].role_id);
      })
      .catch((e) => toast.error(apiError(e) || 'Could not load role list'));
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const isAdminTab = role === 'admin' || role === 'owner';

  const load = useCallback(async (r) => {
    if (!r) return;
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

  useEffect(() => { if (role) load(role); }, [role, load]);

  const toggleCollapsed = (k) => {
    const next = new Set(collapsed);
    next.has(k) ? next.delete(k) : next.add(k);
    setCollapsed(next);
  };

  const saveDebounced = useCallback((updatedData) => {
    if (isAdminTab) return;  // read-only tier — no PUT.
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
  }, [role, isAdminTab]);

  const flip = (formId) => {
    if (!gate || isAdminTab) return;
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

  const currentTab = tabs.find((t) => t.role_id === role);

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
            {tabs.map((t) => (
              <button
                key={t.role_id}
                data-testid={`role-tab-${t.role_id}`}
                onClick={() => setRole(t.role_id)}
                className={`px-3 py-1.5 text-sm font-medium rounded-full border transition ${
                  role === t.role_id
                    ? 'bg-orange-500 text-white border-orange-500'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                }`}
              >
                {t.name}
              </button>
            ))}
          </div>
        </div>

        {/* v58.13.132bk — Admin/Owner info note. Renders on the
            leftmost tab to explain why toggles are frozen. */}
        {isAdminTab && (
          <div
            className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-3 flex items-start gap-2"
            data-testid="role-forms-admin-note"
          >
            <Info20Regular className="text-blue-600 shrink-0 mt-0.5" />
            <div className="text-sm text-blue-900">
              <strong>Admin sees every form</strong> — this list is read-only.
              To restrict form visibility, switch to one of the other role tabs.
            </div>
          </div>
        )}

        {loading ? (
          <div className="text-sm text-slate-500 mt-4">Loading…</div>
        ) : !data ? (
          <div className="text-sm text-slate-500 mt-4">No data.</div>
        ) : (
          <>
            <div className="mt-3 text-xs text-slate-500 flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-orange-500" />
              <strong data-testid="role-forms-enabled-count">
                {isAdminTab ? totalForms : totalEnabled}
              </strong>{' '}
              of <strong>{totalForms}</strong> forms enabled for{' '}
              <strong className="text-slate-700">{currentTab?.name || role}</strong>
              {!data.explicit && !isAdminTab && (
                <span className="ml-2 px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-semibold uppercase tracking-wide">
                  Default: all enabled
                </span>
              )}
              {isAdminTab && (
                <span className="ml-2 px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-[10px] font-semibold uppercase tracking-wide">
                  Read-only
                </span>
              )}
            </div>

            <div className="mt-4 space-y-3">
              {CATEGORY_ORDER.map((catKey) => {
                const cat = data.categories.find((c) => c.key === catKey);
                if (!cat) return null;
                const isCollapsed = collapsed.has(catKey);
                const enabledCount = isAdminTab
                  ? cat.forms.length
                  : cat.forms.filter((f) => f.enabled).length;
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
                        ) : cat.forms.map((f) => {
                          const shownEnabled = isAdminTab ? true : f.enabled;
                          const disabled = !gate || isAdminTab;
                          return (
                            <label
                              key={f.id}
                              data-testid={`form-row-${f.id}`}
                              className={`flex items-center justify-between gap-3 px-4 py-2.5 min-h-[44px] ${
                                disabled
                                  ? 'cursor-default'
                                  : 'hover:bg-orange-50/40 cursor-pointer'
                              }`}
                            >
                              <span className="text-sm text-slate-700">{f.name}</span>
                              <input
                                type="checkbox"
                                className="peer sr-only"
                                checked={shownEnabled}
                                onChange={() => flip(f.id)}
                                disabled={disabled}
                                data-testid={`form-switch-${f.id}`}
                              />
                              <span
                                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${
                                  disabled
                                    ? (shownEnabled ? 'bg-blue-400 opacity-60' : 'bg-slate-300 opacity-60')
                                    : (shownEnabled ? 'bg-orange-500' : 'bg-slate-300')
                                }`}
                                onClick={(e) => { if (!disabled) { e.preventDefault(); flip(f.id); } }}
                                title={isAdminTab ? 'Admin sees every form — read-only' : undefined}
                              >
                                <span
                                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                                    shownEnabled ? 'translate-x-5' : 'translate-x-0.5'
                                  }`}
                                />
                              </span>
                            </label>
                          );
                        })}
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
