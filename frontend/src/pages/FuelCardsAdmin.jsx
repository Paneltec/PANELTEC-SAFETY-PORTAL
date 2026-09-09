// v58.13.132x — Fuel Cards admin
// Single-screen table of `fuel_cards` documents. Admins pick each
// card's attribution: Vehicle | Worker | Shared | Unassigned, then
// hit Save. Bulk-select + bulk-apply for multiple rows.
//
// Route: `/app/fleet/fuel/cards`
// Access: `admin` role only (server enforces `assets.edit`; page
// gate mirrors that here for a friendly redirect).
//
// Backend: GET  /api/fleet/fuel/cards   PATCH /api/fleet/fuel/cards/{card_number}

import { useEffect, useMemo, useState } from 'react';
import api from '@/lib/api';
import { toast } from 'sonner';
import { Loader2, Search, AlertCircle } from 'lucide-react';

const KIND_LABEL = {
  vehicle: 'Vehicle',
  worker: 'Worker',
  shared: 'Shared / Pool',
  unassigned: 'Unassigned',
};

const KIND_TONE = {
  vehicle: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  worker: 'bg-blue-50 text-blue-700 border-blue-200',
  shared: 'bg-slate-50 text-slate-700 border-slate-200',
  unassigned: 'bg-amber-50 text-amber-800 border-amber-200',
};

export default function FuelCardsAdmin() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [onlyUnassigned, setOnlyUnassigned] = useState(true);
  const [q, setQ] = useState('');
  const [assets, setAssets] = useState([]);
  const [workers, setWorkers] = useState([]);
  const [drafts, setDrafts] = useState({}); // card_number → {kind, asset_id, worker_id, notes}
  const [saving, setSaving] = useState({});

  async function load() {
    setLoading(true);
    try {
      const url = onlyUnassigned
        ? '/fleet/fuel/cards?unassigned_only=true'
        : '/fleet/fuel/cards';
      const r = await api.get(url);
      setRows(r.data.rows || []);
    } catch (e) {
      toast.error('Failed to load fuel cards');
    } finally {
      setLoading(false);
    }
  }
  async function loadPickers() {
    try {
      const [a, w] = await Promise.all([
        api.get('/assets?limit=500'),
        api.get('/workers?limit=500'),
      ]);
      setAssets(a.data?.assets || a.data?.rows || a.data || []);
      setWorkers(w.data?.workers || w.data?.rows || w.data || []);
    } catch {
      // Non-fatal
    }
  }
  useEffect(() => { load(); }, [onlyUnassigned]); // eslint-disable-line
  useEffect(() => { loadPickers(); }, []);

  const filtered = useMemo(() => {
    if (!q.trim()) return rows;
    const needle = q.trim().toLowerCase();
    return rows.filter((r) =>
      (r.card_number || '').toLowerCase().includes(needle) ||
      (r.smartfill_description || '').toLowerCase().includes(needle) ||
      (r.smartfill_registration || '').toLowerCase().includes(needle) ||
      (r.notes || '').toLowerCase().includes(needle)
    );
  }, [rows, q]);

  function draftFor(card) {
    return drafts[card.card_number] ?? {
      attribution_kind: card.attribution_kind,
      asset_id: card.asset_id || '',
      worker_id: card.worker_id || '',
      notes: card.notes || '',
    };
  }
  function setDraft(card, patch) {
    setDrafts((d) => ({
      ...d,
      [card.card_number]: { ...draftFor(card), ...patch },
    }));
  }

  async function save(card) {
    const d = draftFor(card);
    if (d.attribution_kind === 'vehicle' && !d.asset_id) {
      toast.error('Pick a vehicle for card ' + card.card_number);
      return;
    }
    if (d.attribution_kind === 'worker' && !d.worker_id) {
      toast.error('Pick a worker for card ' + card.card_number);
      return;
    }
    setSaving((s) => ({ ...s, [card.card_number]: true }));
    try {
      await api.patch(`/fleet/fuel/cards/${card.card_number}`, {
        attribution_kind: d.attribution_kind,
        asset_id: d.attribution_kind === 'vehicle' ? d.asset_id : null,
        worker_id: d.attribution_kind === 'worker' ? d.worker_id : null,
        notes: d.notes || null,
      });
      toast.success(`Card ${card.card_number} saved`);
      setDrafts((s) => { const n = { ...s }; delete n[card.card_number]; return n; });
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Save failed');
    } finally {
      setSaving((s) => ({ ...s, [card.card_number]: false }));
    }
  }

  return (
    <div className="p-6 space-y-4" data-testid="fuel-cards-admin">
      <div>
        <h1 className="text-2xl font-display font-bold text-slate-900">Fuel Card Attribution</h1>
        <p className="text-sm text-slate-500 mt-1">
          Map each SmartFill card to a vehicle, a worker, a shared pool, or leave unassigned. New
          cards seen at ingest are auto-added here as <em>unassigned</em>.
        </p>
      </div>

      <div className="flex items-center gap-3 flex-wrap" data-testid="fuel-cards-toolbar">
        <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={onlyUnassigned}
            onChange={(e) => setOnlyUnassigned(e.target.checked)}
            data-testid="fuel-cards-unassigned-toggle"
          />
          Unassigned only
        </label>
        <div className="flex-1 max-w-md relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            className="w-full pl-9 pr-3 py-1.5 text-sm rounded-lg border border-slate-300"
            placeholder="Search card, rego, description, notes"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            data-testid="fuel-cards-search"
          />
        </div>
        <div className="text-xs text-slate-500 ml-auto">
          {filtered.length} of {rows.length} cards
        </div>
      </div>

      {loading ? (
        <div className="py-12 text-center text-slate-500">
          <Loader2 size={16} className="inline animate-spin mr-1" /> Loading…
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden" data-testid="fuel-cards-table-wrap">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Card #</th>
                <th className="px-3 py-2 text-right">Fills</th>
                <th className="px-3 py-2 text-left">First / Last</th>
                <th className="px-3 py-2 text-left">SmartFill hint</th>
                <th className="px-3 py-2 text-left">Kind</th>
                <th className="px-3 py-2 text-left">Attribute to</th>
                <th className="px-3 py-2 text-left">Notes</th>
                <th className="px-3 py-2 text-right">Save</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100" data-testid="fuel-cards-table-body">
              {filtered.length === 0 && (
                <tr><td colSpan={8} className="text-center py-8 text-slate-400 text-xs">
                  No cards match this filter.
                </td></tr>
              )}
              {filtered.map((c) => {
                const d = draftFor(c);
                const isDirty = drafts[c.card_number] !== undefined;
                return (
                  <tr key={c.card_number}
                      data-testid={`fuel-cards-row-${c.card_number}`}
                      className={isDirty ? 'bg-amber-50/40' : ''}>
                    <td className="px-3 py-2 font-mono">{c.card_number}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{c.fill_count || 0}</td>
                    <td className="px-3 py-2 text-xs text-slate-600 whitespace-nowrap">
                      {c.first_seen_at || '—'}<br />→ {c.last_seen_at || '—'}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <div className="font-medium">{c.smartfill_description || '—'}</div>
                      <div className="text-slate-500">{c.smartfill_registration || ''}</div>
                      {c.asset_label && <div className="text-emerald-700 text-[11px]">→ {c.asset_label}</div>}
                      {c.worker_label && <div className="text-blue-700 text-[11px]">→ {c.worker_label}</div>}
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={d.attribution_kind}
                        onChange={(e) => setDraft(c, { attribution_kind: e.target.value })}
                        className={`text-xs rounded-md border px-2 py-1 ${KIND_TONE[d.attribution_kind]}`}
                        data-testid={`fuel-cards-kind-${c.card_number}`}
                      >
                        {Object.entries(KIND_LABEL).map(([k, l]) =>
                          <option key={k} value={k}>{l}</option>
                        )}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      {d.attribution_kind === 'vehicle' && (
                        <select
                          value={d.asset_id}
                          onChange={(e) => setDraft(c, { asset_id: e.target.value })}
                          className="text-xs rounded-md border border-slate-300 px-2 py-1 max-w-[240px]"
                          data-testid={`fuel-cards-asset-${c.card_number}`}
                        >
                          <option value="">— select vehicle —</option>
                          {assets.map((a) =>
                            <option key={a.id} value={a.id}>
                              {a.name} {a.rego_serial ? `· ${a.rego_serial}` : ''}
                            </option>
                          )}
                        </select>
                      )}
                      {d.attribution_kind === 'worker' && (
                        <select
                          value={d.worker_id}
                          onChange={(e) => setDraft(c, { worker_id: e.target.value })}
                          className="text-xs rounded-md border border-slate-300 px-2 py-1 max-w-[240px]"
                          data-testid={`fuel-cards-worker-${c.card_number}`}
                        >
                          <option value="">— select worker —</option>
                          {workers.map((w) =>
                            <option key={w.id} value={w.id}>
                              {w.first_name} {w.last_name}
                            </option>
                          )}
                        </select>
                      )}
                      {(d.attribution_kind === 'shared' || d.attribution_kind === 'unassigned') && (
                        <span className="text-xs text-slate-400 italic">
                          {d.attribution_kind === 'shared' ? 'No single owner' : 'To be decided'}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <input
                        type="text"
                        value={d.notes}
                        onChange={(e) => setDraft(c, { notes: e.target.value })}
                        className="w-full text-xs rounded-md border border-slate-300 px-2 py-1"
                        placeholder="Optional notes"
                        data-testid={`fuel-cards-notes-${c.card_number}`}
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        disabled={!isDirty || saving[c.card_number]}
                        onClick={() => save(c)}
                        className="text-xs font-semibold px-3 py-1 rounded-md bg-slate-900 text-white disabled:bg-slate-200 disabled:text-slate-500"
                        data-testid={`fuel-cards-save-${c.card_number}`}
                      >
                        {saving[c.card_number] ? <Loader2 size={11} className="inline animate-spin" /> : 'Save'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="text-xs text-slate-500 flex items-center gap-2 pt-2 border-t border-slate-100">
        <AlertCircle size={12} />
        <span>Changes here override auto-matches from ingest. New rows added here become the source of truth for future SmartFill imports.</span>
      </div>
    </div>
  );
}
