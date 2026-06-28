// Phase 3.9 — "My forms" preference picker.
//
// Lists every active template in the org grouped by category. Each row is a
// checkbox. The footer has a "Use these settings on this device only" toggle:
//
//   • OFF (default) → writes via PUT /api/users/me/form-preferences
//   • ON            → writes to localStorage `paneltec.form_prefs_device` and
//                     leaves the server doc untouched.
//
// Admins can pass `targetUser={id,name,role}` to edit *another* worker's
// server prefs. The device-only toggle is hidden in that case (it's a
// personal/device concept, not org-wide).

import React, { useEffect, useMemo, useState } from 'react';
import {
  X, Save, RotateCcw, Loader2, ClipboardCheck, Truck, Wrench, AlertOctagon,
  AlertTriangle, FileText, Check, Smartphone,
} from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../../lib/api';
import { saveDevicePrefs, clearDevicePrefs, getDevicePrefs } from '../../lib/formPrefs';

const CATEGORY_LABEL = {
  pre_use:         { label: 'Pre-Use Inspections',     icon: ClipboardCheck, tint: 'text-blue-700 bg-blue-50' },
  daily_check:     { label: 'Daily Checks',            icon: Truck,          tint: 'text-indigo-700 bg-indigo-50' },
  plant_pre_start: { label: 'Plant Pre-Start',         icon: Wrench,         tint: 'text-emerald-700 bg-emerald-50' },
  incident:        { label: 'Incidents',               icon: AlertOctagon,   tint: 'text-rose-700 bg-rose-50' },
  near_miss:       { label: 'Near Miss',               icon: AlertTriangle,  tint: 'text-amber-700 bg-amber-50' },
  general:         { label: 'General',                 icon: FileText,       tint: 'text-slate-700 bg-slate-100' },
  inspection:      { label: 'Inspections',             icon: ClipboardCheck, tint: 'text-blue-700 bg-blue-50' },
  permit:          { label: 'Permits',                 icon: ClipboardCheck, tint: 'text-purple-700 bg-purple-50' },
  attendance:      { label: 'Attendance & Sign-On',    icon: ClipboardCheck, tint: 'text-emerald-700 bg-emerald-50' },
  other:           { label: 'Other',                   icon: FileText,       tint: 'text-slate-700 bg-slate-100' },
};

function groupByCategory(templates) {
  const groups = new Map();
  (templates || []).forEach((t) => {
    const cat = (t.category || 'other').toLowerCase();
    const bucket = groups.get(cat) || [];
    bucket.push(t);
    groups.set(cat, bucket);
  });
  // Sort categories in a stable, useful order (the "daily-use" ones first).
  const ORDER = [
    'pre_use', 'daily_check', 'plant_pre_start', 'inspection',
    'incident', 'near_miss', 'permit', 'attendance', 'general', 'other',
  ];
  return Array.from(groups.entries()).sort(
    (a, b) => (ORDER.indexOf(a[0]) === -1 ? 999 : ORDER.indexOf(a[0]))
            - (ORDER.indexOf(b[0]) === -1 ? 999 : ORDER.indexOf(b[0])),
  );
}

export default function FormPreferencesDialog({ open, onClose, targetUser, onSaved }) {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(new Set());
  const [deviceOnly, setDeviceOnly] = useState(false);
  const [saving, setSaving] = useState(false);

  const isAdminEditingOther = !!targetUser;

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    setDeviceOnly(false);
    (async () => {
      try {
        // Always load full template list (we need to render every row).
        const [tplRes, prefRes] = await Promise.all([
          api.get('/forms/templates'),
          api.get(isAdminEditingOther
            ? `/users/${targetUser.id}/form-preferences`
            : '/users/me/form-preferences'),
        ]);
        if (!alive) return;
        setTemplates(tplRes.data || []);
        // Bootstrap initial state: device override (if present and editing self)
        // takes precedence over server prefs.
        let ids = prefRes.data?.enabled_template_ids || [];
        if (!isAdminEditingOther) {
          const dev = getDevicePrefs();
          if (dev) { ids = dev.enabled_template_ids; }
        }
        // Empty list is a sentinel for "all enabled" — seed checkboxes with
        // every template so the dialog visibly reflects that.
        if (!ids.length) ids = (tplRes.data || []).map((t) => t.id);
        setEnabled(new Set(ids));
      } catch (e) { toast.error(apiError(e)); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [open, isAdminEditingOther, targetUser?.id]);

  const grouped = useMemo(() => groupByCategory(templates), [templates]);

  const toggle = (id) => {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleGroup = (rows, on) => {
    setEnabled((prev) => {
      const next = new Set(prev);
      rows.forEach((r) => { if (on) next.add(r.id); else next.delete(r.id); });
      return next;
    });
  };

  const resetAll = () => {
    setEnabled(new Set(templates.map((t) => t.id)));
    if (!isAdminEditingOther) clearDevicePrefs();
    toast.success('All forms enabled');
  };

  const save = async () => {
    setSaving(true);
    try {
      const ids = Array.from(enabled);
      if (deviceOnly && !isAdminEditingOther) {
        saveDevicePrefs(ids);
        toast.success('Saved on this device only');
      } else {
        const url = isAdminEditingOther
          ? `/users/${targetUser.id}/form-preferences`
          : '/users/me/form-preferences';
        await api.put(url, { enabled_template_ids: ids, device_only: false });
        // Switching off device-only also clears any prior localStorage.
        if (!isAdminEditingOther) clearDevicePrefs();
        toast.success(isAdminEditingOther
          ? `Saved preferences for ${targetUser.name || 'user'}`
          : 'Preferences saved');
      }
      onSaved?.({ enabled_ids: ids, device_only: deviceOnly });
      onClose();
    } catch (e) { toast.error(apiError(e)); }
    finally { setSaving(false); }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 p-3"
         onClick={(e) => e.target === e.currentTarget && onClose()}
         data-testid="form-prefs-dialog">
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-200 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-5 sm:px-6 py-4 border-b border-slate-200 flex items-start gap-3">
          <div className="flex-1">
            <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-400">
              {isAdminEditingOther ? `Editing ${targetUser.name || 'worker'}` : 'Your account'}
            </div>
            <h3 className="font-display text-xl font-bold text-slate-900">My forms</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Tick the forms you personally use. Untouched forms stay hidden when you scan an asset
              — but the asset-type filter still applies, so you can&apos;t accidentally launch a plant
              checklist on a vehicle.
            </p>
          </div>
          <button onClick={resetAll}
            className="hidden sm:inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-700"
            data-testid="form-prefs-reset">
            <RotateCcw size={12} /> Reset to defaults
          </button>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"
            data-testid="form-prefs-close"><X size={18} /></button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-4">
          {loading ? (
            <div className="py-8 text-center text-sm text-slate-500">
              <Loader2 size={18} className="inline animate-spin mr-2 text-blue-600" /> Loading…
            </div>
          ) : grouped.length === 0 ? (
            <div className="py-8 text-center text-sm text-slate-500">No templates in this org.</div>
          ) : (
            <div className="space-y-5" data-testid="form-prefs-groups">
              {grouped.map(([cat, rows]) => {
                const meta = CATEGORY_LABEL[cat] || CATEGORY_LABEL.other;
                const Icon = meta.icon;
                const enabledCount = rows.filter((r) => enabled.has(r.id)).length;
                const allOn = enabledCount === rows.length;
                return (
                  <div key={cat} data-testid={`form-prefs-group-${cat}`}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`inline-flex w-7 h-7 rounded-lg items-center justify-center ${meta.tint}`}>
                        <Icon size={14} />
                      </span>
                      <h4 className="font-bold text-sm text-slate-900 flex-1">
                        {meta.label}
                        <span className="ml-2 text-[11px] font-normal text-slate-500">
                          {enabledCount} enabled of {rows.length}
                        </span>
                      </h4>
                      <button onClick={() => toggleGroup(rows, !allOn)}
                        className="text-[11px] font-semibold text-blue-700 hover:text-blue-800"
                        data-testid={`form-prefs-toggle-group-${cat}`}>
                        {allOn ? 'Disable all' : 'Enable all'}
                      </button>
                    </div>
                    <div className="space-y-1.5">
                      {rows.map((t) => {
                        const on = enabled.has(t.id);
                        return (
                          <label key={t.id}
                            className={`flex items-start gap-3 px-3 py-2.5 rounded-xl border cursor-pointer transition ${
                              on ? 'bg-blue-50/40 border-blue-200' : 'bg-white border-slate-200 hover:bg-slate-50'
                            }`}
                            data-testid={`form-prefs-row-${t.id}`}>
                            <span className={`w-4 h-4 mt-0.5 flex-shrink-0 rounded border flex items-center justify-center ${
                              on ? 'bg-blue-600 border-blue-600 text-white' : 'border-slate-300 bg-white'
                            }`}>
                              {on && <Check size={11} strokeWidth={3} />}
                            </span>
                            <input type="checkbox" className="sr-only" checked={on} onChange={() => toggle(t.id)} />
                            <span className="flex-1 min-w-0">
                              <span className="block text-sm font-semibold text-slate-900 truncate">{t.name}</span>
                              {t.description && (
                                <span className="block text-[11px] text-slate-500 truncate">{t.description}</span>
                              )}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 sm:px-6 py-3 border-t border-slate-200 bg-slate-50 rounded-b-2xl flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-2">
          {!isAdminEditingOther ? (
            <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer flex-1"
              data-testid="form-prefs-device-only-row">
              <input type="checkbox" checked={deviceOnly} onChange={(e) => setDeviceOnly(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-blue-600"
                data-testid="form-prefs-device-only" />
              <Smartphone size={13} className="text-slate-500" />
              <span><strong className="font-semibold">Use these settings on this device only</strong></span>
            </label>
          ) : <div className="flex-1 text-xs text-slate-500">Saving as admin — applies to all of this worker&apos;s devices.</div>}
          <div className="flex items-center gap-2 justify-end">
            <button onClick={onClose}
              className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-100"
              data-testid="form-prefs-cancel">Cancel</button>
            <button onClick={save} disabled={saving || loading}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 disabled:opacity-50"
              data-testid="form-prefs-save">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              Save preferences
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
