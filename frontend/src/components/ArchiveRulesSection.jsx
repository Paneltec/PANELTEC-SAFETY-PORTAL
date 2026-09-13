import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import api from '@/lib/api';

/**
 * v58.13.132ed — ArchiveRulesSection
 *
 * Admin-only surface on Org Settings for the per-module auto-archive
 * rules that feed the nightly APScheduler job (`org_archive_rules_daily`
 * at 03:30 UTC — see server.py).
 *
 * One row per module × Enabled toggle × "older than N days" input × Save.
 * Fetches the effective rule set via `GET /api/org/archive-rules` and
 * persists changes via `PUT /api/org/archive-rules/{module}`.
 */
export default function ArchiveRulesSection() {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingModule, setSavingModule] = useState('');

  useEffect(() => {
    api.get('/org/archive-rules')
      .then((r) => setRules(r.data.rules || []))
      .catch((e) => {
        if (e?.response?.status === 403) {
          setRules([]);
        } else {
          toast.error('Failed to load archive rules');
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const update = (module, patch) => {
    setRules((prev) => prev.map((r) => (r.module === module ? { ...r, ...patch } : r)));
  };

  const save = async (rule) => {
    setSavingModule(rule.module);
    try {
      await api.put(`/org/archive-rules/${rule.module}`, {
        enabled: rule.enabled,
        older_than_days: Number(rule.older_than_days) || 365,
      });
      toast.success(`Archive rule saved for ${rule.module}`);
    } catch (e) {
      toast.error(`Save failed for ${rule.module}`, {
        description: e?.response?.data?.detail || e.message,
      });
    } finally {
      setSavingModule('');
    }
  };

  if (loading) return null;
  if (!rules.length) return null;

  return (
    <div
      data-testid="archive-rules-section"
      className="rounded-lg border border-slate-200 bg-white p-5 mt-6"
    >
      <div className="mb-3">
        <h2 className="text-lg font-semibold text-slate-900">Archive rules</h2>
        <p className="text-sm text-slate-500 mt-0.5">
          Nightly auto-archive per module. Job runs at 03:30 UTC.
          Records older than N days with no archive date get archived
          automatically. Admin-only.
        </p>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-slate-500 border-b border-slate-200">
            <th className="py-2 pr-3">Module</th>
            <th className="py-2 pr-3">Enabled</th>
            <th className="py-2 pr-3">Older than (days)</th>
            <th className="py-2 pr-3">Last run</th>
            <th className="py-2 pr-3 text-right">Save</th>
          </tr>
        </thead>
        <tbody>
          {rules.map((r) => (
            <tr key={r.module} className="border-b border-slate-100"
                data-testid={`archive-rule-row-${r.module}`}>
              <td className="py-2 pr-3 font-mono text-xs">{r.module}</td>
              <td className="py-2 pr-3">
                <label className="inline-flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={r.enabled}
                    onChange={(e) => update(r.module, { enabled: e.target.checked })}
                    data-testid={`archive-rule-enabled-${r.module}`}
                  />
                  <span>{r.enabled ? 'On' : 'Off'}</span>
                </label>
              </td>
              <td className="py-2 pr-3">
                <input
                  type="number" min="1" max="3650"
                  value={r.older_than_days ?? 365}
                  onChange={(e) => update(r.module, { older_than_days: e.target.value })}
                  className="border border-slate-300 rounded px-2 py-0.5 w-20"
                  data-testid={`archive-rule-days-${r.module}`}
                />
              </td>
              <td className="py-2 pr-3 text-xs text-slate-500">
                {r.last_run_at
                  ? `${r.last_run_at.slice(0, 10)} · ${r.last_affected_count ?? 0} affected`
                  : 'never'}
              </td>
              <td className="py-2 pr-3 text-right">
                <button
                  type="button"
                  onClick={() => save(r)}
                  disabled={savingModule === r.module}
                  data-testid={`archive-rule-save-${r.module}`}
                  className="text-sm px-3 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
                >
                  {savingModule === r.module ? 'Saving…' : 'Save'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
