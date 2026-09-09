/**
 * v58.13.131o — SmartFill Cards section inside `WorkerViewModal`.
 *
 * Admins link one or more SmartFill "Card Numbers" (from the fuel
 * CSV / Transactions:Read API) to a worker so the per-employee fuel
 * report shows "Stephen Guy" instead of "Card 21318 (unlinked)".
 *
 * Historical re-assignment is supported: `assigned_from` /
 * `assigned_to` (both YYYY-MM-DD) bound each entry to a date window.
 * A card with `assigned_to: null` is the currently-active
 * assignment for that card ↔ worker pair.
 *
 * Endpoints (all under `/api/workers/{workerId}/smartfill-cards`):
 *   · GET     — list
 *   · POST    — add   (body: {card_number, assigned_from?, assigned_to?, notes?})
 *   · DELETE  — /:card_number — remove
 */
import React, { useCallback, useEffect, useState } from 'react';
import { CreditCard, Plus, Trash2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../../lib/api';

export default function SmartFillCardsSection({ workerId, canEdit }) {
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ card_number: '', assigned_from: '', assigned_to: '', notes: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!workerId) return;
    setLoading(true);
    try {
      const { data } = await api.get(`/workers/${workerId}/smartfill-cards`);
      setCards(data?.cards || []);
    } catch (err) {
      toast.error(apiError(err) || 'Failed to load cards');
    } finally {
      setLoading(false);
    }
  }, [workerId]);

  useEffect(() => { load(); }, [load]);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.card_number.trim()) {
      toast.error('Card number required');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        card_number: form.card_number.trim(),
        assigned_from: form.assigned_from || null,
        assigned_to: form.assigned_to || null,
        notes: form.notes || null,
      };
      const { data } = await api.post(`/workers/${workerId}/smartfill-cards`, payload);
      setCards(data?.cards || []);
      setForm({ card_number: '', assigned_from: '', assigned_to: '', notes: '' });
      setAdding(false);
      toast.success(`Linked card ${payload.card_number}`);
    } catch (err) {
      toast.error(apiError(err) || 'Failed to link card');
    } finally {
      setSaving(false);
    }
  };

  const removeCard = async (cardNumber) => {
    if (!window.confirm(`Remove card ${cardNumber} from this worker?`)) return;
    try {
      const { data } = await api.delete(`/workers/${workerId}/smartfill-cards/${encodeURIComponent(cardNumber)}`);
      setCards(data?.cards || []);
      toast.success(`Removed card ${cardNumber}`);
    } catch (err) {
      toast.error(apiError(err) || 'Failed to remove card');
    }
  };

  return (
    <section
      className="border border-slate-200 rounded-xl px-4 py-3 bg-white"
      data-testid="view-section-smartfill-cards"
    >
      <div className="flex items-center gap-2 mb-2 text-slate-800 font-semibold text-sm flex-wrap">
        <CreditCard size={14} className="text-slate-500" />
        SmartFill Cards
        <span
          className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-700"
          data-testid="section-smartfill-cards-count"
        >
          {cards.length === 0 ? 'None linked' : `${cards.length} linked`}
        </span>
        {canEdit && !adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="ml-auto inline-flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-800 font-semibold"
            data-testid="smartfill-card-add-toggle"
          >
            <Plus size={12} /> Add card
          </button>
        )}
      </div>

      {loading && (
        <div className="text-xs text-slate-500 flex items-center gap-1.5">
          <Loader2 size={12} className="animate-spin" /> Loading…
        </div>
      )}

      {!loading && cards.length === 0 && !adding && (
        <div className="text-xs text-slate-500">
          No SmartFill cards linked yet. Fuel transactions carrying a Card
          Number for this worker will show as <em>“Card N · unlinked”</em>
          in the per-employee fuel report until you link them here.
        </div>
      )}

      {cards.length > 0 && (
        <ul className="divide-y divide-slate-100" data-testid="smartfill-cards-list">
          {cards.map((c) => {
            const isActive = !c.assigned_to;
            return (
              <li
                key={c.card_number + (c.assigned_from || '') + (c.assigned_to || '')}
                className="py-2 flex items-center gap-3 text-sm"
                data-testid={`smartfill-card-row-${c.card_number}`}
              >
                <span
                  className={
                    'inline-flex items-center px-2 py-0.5 rounded font-mono text-[11px] ' +
                    (isActive
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      : 'bg-slate-100 text-slate-600 border border-slate-200')
                  }
                >
                  {c.card_number}
                </span>
                <span className="text-[11px] text-slate-500">
                  {c.assigned_from || '—'} → {c.assigned_to || 'active'}
                </span>
                {c.notes && (
                  <span className="text-[11px] text-slate-400 truncate">
                    {c.notes}
                  </span>
                )}
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => removeCard(c.card_number)}
                    className="ml-auto inline-flex items-center gap-1 text-[11px] text-rose-600 hover:text-rose-800"
                    data-testid={`smartfill-card-remove-${c.card_number}`}
                  >
                    <Trash2 size={12} /> Remove
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {adding && (
        <form
          onSubmit={submit}
          className="mt-3 grid grid-cols-1 md:grid-cols-4 gap-2 items-end p-2 border border-blue-100 bg-blue-50/40 rounded-lg"
          data-testid="smartfill-card-add-form"
        >
          <label className="text-[11px] font-semibold text-slate-600">
            Card Number
            <input
              type="text"
              value={form.card_number}
              onChange={(e) => setForm((f) => ({ ...f, card_number: e.target.value }))}
              className="mt-0.5 w-full border border-slate-300 rounded px-2 py-1 text-sm"
              autoFocus
              required
              data-testid="smartfill-card-input-number"
            />
          </label>
          <label className="text-[11px] font-semibold text-slate-600">
            Assigned from (optional)
            <input
              type="date"
              value={form.assigned_from}
              onChange={(e) => setForm((f) => ({ ...f, assigned_from: e.target.value }))}
              className="mt-0.5 w-full border border-slate-300 rounded px-2 py-1 text-sm"
              data-testid="smartfill-card-input-from"
            />
          </label>
          <label className="text-[11px] font-semibold text-slate-600">
            Assigned to (optional)
            <input
              type="date"
              value={form.assigned_to}
              onChange={(e) => setForm((f) => ({ ...f, assigned_to: e.target.value }))}
              className="mt-0.5 w-full border border-slate-300 rounded px-2 py-1 text-sm"
              data-testid="smartfill-card-input-to"
            />
          </label>
          <label className="text-[11px] font-semibold text-slate-600 md:col-span-4">
            Notes (optional)
            <input
              type="text"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              className="mt-0.5 w-full border border-slate-300 rounded px-2 py-1 text-sm"
              placeholder="e.g. Replaced physical card 2025-06-01"
              data-testid="smartfill-card-input-notes"
            />
          </label>
          <div className="md:col-span-4 flex items-center gap-2 justify-end">
            <button
              type="button"
              onClick={() => { setAdding(false); setForm({ card_number: '', assigned_from: '', assigned_to: '', notes: '' }); }}
              className="text-[11px] text-slate-600 hover:text-slate-800 font-semibold px-2 py-1"
              data-testid="smartfill-card-cancel"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1 text-[11px] font-semibold bg-blue-600 text-white rounded px-3 py-1 hover:bg-blue-700 disabled:opacity-60"
              data-testid="smartfill-card-submit"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
              {saving ? 'Linking…' : 'Link card'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
