import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Copy, X } from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../lib/api';
import { PageHeader, PrimaryButton, GhostButton, Field, inputClass, EmptyState, StatusBadge } from '../components/capture/Ui';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';

const DOC_TYPES = [
  ['public_liability', 'Public liability'], ['workers_comp', 'Workers comp'],
  ['white_card', 'White card'], ['sw_license', 'SafeWork licence'],
  ['induction', 'Induction'], ['other', 'Other'],
];

export default function Renewals() {
  const [items, setItems] = useState([]);
  const [contractors, setContractors] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ contractor_id: '', doc_types_requested: [], expires_in_days: 14 });
  const [created, setCreated] = useState(null);

  const load = () => api.get('/renewals').then((r) => setItems(r.data));
  useEffect(() => { load(); api.get('/contractors').then((r) => setContractors(r.data)); }, []);

  const toggleType = (t) => setForm((f) => ({ ...f, doc_types_requested: f.doc_types_requested.includes(t) ? f.doc_types_requested.filter((x) => x !== t) : [...f.doc_types_requested, t] }));

  const createLink = async () => {
    if (!form.contractor_id || form.doc_types_requested.length === 0) { toast.error('Pick contractor + at least one doc type'); return; }
    try { const { data } = await api.post('/renewals', form); setCreated(data); load(); }
    catch (e) { toast.error(apiError(e)); }
  };

  const revoke = async (id) => {
    if (!window.confirm('Revoke this link?')) return;
    try { await api.post(`/renewals/${id}/revoke`); toast.success('Revoked'); load(); }
    catch (e) { toast.error(apiError(e)); }
  };

  return (
    <div className="max-w-6xl mx-auto" data-testid="renewals-list">
      <PageHeader crumb="Compliance / Renewal Links" title="Renewal Links"
        subtitle="Single-use links contractors can use to upload renewed documents without a login."
        action={<button onClick={() => { setOpen(true); setCreated(null); }} className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-brand-blue text-white text-sm font-medium hover:bg-blue-600" data-testid="renewal-create-btn">+ Create renewal link</button>} />

      {items.length === 0 ? <EmptyState title="No renewal links yet" body="Create a link and send it to a contractor." />
       : (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider"><tr><th className="text-left px-4 py-3">Contractor</th><th className="text-left px-4 py-3">Docs requested</th><th className="text-left px-4 py-3">Status</th><th className="text-left px-4 py-3">Expires</th><th className="text-left px-4 py-3"></th></tr></thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id} className="border-t border-slate-100" data-testid={`renewal-row-${r.id}`}>
                  <td className="px-4 py-3 font-medium">{r.contractor_name}</td>
                  <td className="px-4 py-3 text-slate-600 text-xs">{(r.doc_types_requested || []).join(' · ')}</td>
                  <td className="px-4 py-3"><StatusBadge value={r.status} /></td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{(r.expires_at || '').slice(0, 10)}</td>
                  <td className="px-4 py-3 text-right">
                    {r.status === 'pending' && (
                      <div className="inline-flex gap-1">
                        <button onClick={() => { navigator.clipboard.writeText(r.public_url); toast.success('Link copied'); }} className="px-2 py-1 text-xs rounded border border-slate-200 hover:bg-slate-50 inline-flex items-center gap-1"><Copy size={12} /> Copy</button>
                        <button onClick={() => revoke(r.id)} className="px-2 py-1 text-xs rounded border border-red-200 text-red-700 hover:bg-red-50 inline-flex items-center gap-1" data-testid={`revoke-${r.id}`}><X size={12} /> Revoke</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
       )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="renewal-create-modal">
          <DialogHeader>
            <DialogTitle className="font-display">Create renewal link</DialogTitle>
            <DialogDescription>Email delivery via TextMagic/M365 is pending — copy the link for now.</DialogDescription>
          </DialogHeader>
          {!created ? (
            <div className="space-y-3 pt-2">
              <Field label="Contractor" required>
                <select className={inputClass} value={form.contractor_id} onChange={(e) => setForm({ ...form, contractor_id: e.target.value })} data-testid="renewal-contractor">
                  <option value="">Select…</option>
                  {contractors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <Field label="Documents requested" required>
                <div className="grid grid-cols-2 gap-1 mt-1">
                  {DOC_TYPES.map(([k, l]) => (
                    <label key={k} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={form.doc_types_requested.includes(k)} onChange={() => toggleType(k)} /> {l}
                    </label>
                  ))}
                </div>
              </Field>
              <Field label="Expires in (days)"><input type="number" min={1} max={90} className={inputClass} value={form.expires_in_days} onChange={(e) => setForm({ ...form, expires_in_days: Number(e.target.value) })} /></Field>
            </div>
          ) : (
            <div className="space-y-2 pt-2">
              <div className="text-xs text-slate-500">Public link (single-use, expires {created.expires_at?.slice(0, 10)}):</div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs break-all" data-testid="generated-public-url">{created.public_url}</div>
              <button onClick={() => { navigator.clipboard.writeText(created.public_url); toast.success('Link copied'); }} className="text-xs text-brand-blue hover:underline">Copy link</button>
            </div>
          )}
          <DialogFooter>
            {!created
              ? (<><GhostButton onClick={() => setOpen(false)}>Cancel</GhostButton><PrimaryButton onClick={createLink} testid="renewal-submit">Create link</PrimaryButton></>)
              : <PrimaryButton onClick={() => setOpen(false)}>Done</PrimaryButton>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
