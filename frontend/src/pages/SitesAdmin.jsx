// Phase 4.2 + 4.12 (paneltec-v127) — Sites admin page.
//
// List view (`/app/sites`):
//   · Every Simpro-synced + manual site in the org.
//   · Per-row: kind badge, active sign-ons (last 24h), # of sign-on questions,
//     row-level "🖨 Print QR" / "✎ Edit" actions.
//   · Toolbar: search + "+ Add site" + "Recycle bin" + bulk-select delete.
//
// Detail view (`/app/sites/:id`):
//   · Site basics + a "Currently signed on" panel auto-refreshing every 60s
//     with an admin "Sign off" action.
//   · v127 — Same Edit drawer is reachable from the detail header for
//     sign-on questions / GPS override.
import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Loader2, MapPin, Users, ChevronRight, LogOut, ArrowLeft, AlertCircle,
  Plus, Pencil, Trash2, Archive, RotateCcw, X as XIcon, HelpCircle,
} from 'lucide-react';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { toast } from 'sonner';
import api, { apiError } from '../lib/api';
import { getUser } from '../lib/auth';
import { PageHeader } from '../components/capture/Ui';
import PdfPreviewModal from '../components/PdfPreviewModal';
import { stashInlinePdf } from '../lib/pdfStash';

import {
  ArrowSync20Regular as RefreshCcw,
  Print20Regular as Printer,
} from '@fluentui/react-icons';

const EDIT_ROLES = new Set(['admin', 'manager', 'hseq_lead']);

function fmtAgo(iso) {
  if (!iso) return '—';
  try {
    const d = typeof iso === 'string' ? parseISO(iso.replace(' ', 'T')) : iso;
    if (Number.isNaN(d.getTime())) return '—';
    return formatDistanceToNow(d, { addSuffix: true });
  } catch { return '—'; }
}

export default function SitesAdmin() {
  const user = getUser();
  const canEdit = EDIT_ROLES.has(user?.role);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [printFor, setPrintFor] = useState(null);
  const [editFor, setEditFor] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showRecycle, setShowRecycle] = useState(false);
  const [selected, setSelected] = useState(new Set());

  const reload = useCallback(() => {
    setLoading(true);
    return api.get('/sites')
      .then((r) => setRows(r.data || []))
      .catch((e) => toast.error(apiError(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) =>
      (r.name || '').toLowerCase().includes(s)
      || (r.address_full || r.address || '').toLowerCase().includes(s)
      || (r.suburb || '').toLowerCase().includes(s),
    );
  }, [rows, search]);

  const toggleOne = (id) => setSelected((prev) => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
  });
  const toggleAll = () => setSelected((prev) =>
    prev.size === filtered.length ? new Set() : new Set(filtered.map((r) => r.simpro_site_id)));

  const bulkDelete = async () => {
    if (selected.size === 0) return;
    if (!window.confirm(`Move ${selected.size} site(s) to the recycle bin?`)) return;
    try {
      const r = await api.post('/sites/bulk-delete', { site_ids: Array.from(selected) });
      toast.success(`${r.data?.deleted || 0} site(s) moved to bin`);
      if ((r.data?.refused || []).length) {
        toast.warning(`${r.data.refused.length} skipped (active Simpro jobs)`);
      }
      setSelected(new Set());
      reload();
    } catch (e) { toast.error(apiError(e)); }
  };

  if (!canEdit) {
    return (
      <div className="p-8" data-testid="sites-admin-page">
        <PageHeader crumb="Compliance / Sites" title="Sites" />
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800 inline-flex items-start gap-3">
          <AlertCircle size={16} className="mt-0.5" />
          <div>This page is restricted to Admin, Manager and HSEQ Lead roles.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8" data-testid="sites-admin-page">
      <PageHeader
        crumb="Compliance / Sites"
        title="Sites"
        subtitle="Every site (Simpro-synced + manually added) with a printable QR gate-sign, dynamic sign-on questions and a live count of who&rsquo;s signed on right now."
        action={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowRecycle(true)}
              data-testid="sites-recycle-bin-btn"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50">
              <Archive size={13} /> Recycle bin
            </button>
            <button
              type="button"
              onClick={() => setShowAdd(true)}
              data-testid="sites-add-btn"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-orange-500 text-white text-sm font-bold hover:bg-orange-600">
              <Plus size={14} /> Add site
            </button>
          </div>
        }
      />

      <div className="mb-4 flex items-center gap-3">
        <input
          type="text" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by site name, address or suburb"
          data-testid="sites-search"
          className="flex-1 max-w-md px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/30"
        />
        <span className="text-xs text-slate-500">{filtered.length} site{filtered.length === 1 ? '' : 's'}</span>
        {selected.size > 0 && (
          <button
            type="button"
            onClick={bulkDelete}
            data-testid="sites-bulk-delete-btn"
            className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-rose-300 bg-rose-50 text-rose-700 text-xs font-semibold hover:bg-rose-100">
            <Trash2 size={12} /> Delete {selected.size} selected
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-sm text-slate-500"><Loader2 size={14} className="inline animate-spin mr-1" /> Loading sites…</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          No sites yet. Add a manual site or run the Simpro sync to import the org&rsquo;s job sites.
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden" data-testid="sites-list">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-2.5 w-8">
                  <input type="checkbox"
                    checked={filtered.length > 0 && selected.size === filtered.length}
                    onChange={toggleAll}
                    data-testid="sites-select-all" />
                </th>
                <th className="text-left px-4 py-2.5">Site</th>
                <th className="text-left px-4 py-2.5">Address</th>
                <th className="text-left px-4 py-2.5">Kind</th>
                <th className="text-left px-4 py-2.5">On-site</th>
                <th className="text-left px-4 py-2.5">Questions</th>
                <th className="text-right px-4 py-2.5">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((s) => (
                <tr key={s.simpro_site_id} data-testid={`site-row-${s.simpro_site_id}`} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <input type="checkbox"
                      checked={selected.has(s.simpro_site_id)}
                      onChange={() => toggleOne(s.simpro_site_id)}
                      data-testid={`site-select-${s.simpro_site_id}`} />
                  </td>
                  <td className="px-4 py-3">
                    <Link to={`/app/sites/${encodeURIComponent(s.simpro_site_id)}`}
                      className="font-semibold text-slate-900 hover:text-orange-600 inline-flex items-center gap-1.5"
                      data-testid={`site-open-${s.simpro_site_id}`}>
                      {s.name || '(unnamed)'} <ChevronRight size={12} className="text-slate-400" />
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    <span className="inline-flex items-center gap-1"><MapPin size={11} className="text-slate-400" />
                      {s.address_full || s.address || `${s.suburb || ''} ${s.state || ''}`.trim() || '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] uppercase font-semibold ${s.kind === 'manual' ? 'bg-violet-50 text-violet-700 border border-violet-200' : 'bg-slate-50 text-slate-700 border border-slate-200'}`}>
                      {s.kind || 'simpro'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {(s.active_signons_count || 0) > 0 ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 font-bold">
                        <Users size={10} /> {s.active_signons_count}
                      </span>
                    ) : (
                      <span className="text-slate-400">0</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    <span className="inline-flex items-center gap-1">
                      <HelpCircle size={11} className="text-slate-400" />
                      {(s.signon_questions || []).length}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setEditFor(s)}
                        data-testid={`site-edit-btn-${s.simpro_site_id}`}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50">
                        <Pencil size={12} /> Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => setPrintFor(s)}
                        data-testid={`site-print-qr-btn-${s.simpro_site_id}`}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50">
                        <Printer /> Print QR
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {printFor && <SitePrintModal site={printFor} onClose={() => setPrintFor(null)} />}
      {editFor && <EditSiteDrawer site={editFor} onClose={() => setEditFor(null)} onSaved={() => { setEditFor(null); reload(); }} />}
      {showAdd && <AddSiteModal onClose={() => setShowAdd(false)} onCreated={() => { setShowAdd(false); reload(); }} />}
      {showRecycle && <RecycleBinModal onClose={() => setShowRecycle(false)} onRestored={() => reload()} />}
    </div>
  );
}

// ─────────────────── Add Site Modal ───────────────────

function AddSiteModal({ onClose, onCreated }) {
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [suburb, setSuburb] = useState('');
  const [state, setState] = useState('');
  const [postcode, setPostcode] = useState('');
  const [gpsLat, setGpsLat] = useState('');
  const [gpsLong, setGpsLong] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) { toast.error('Site name is required'); return; }
    setBusy(true);
    try {
      await api.post('/sites', {
        name: name.trim(),
        address: address.trim() || null,
        suburb: suburb.trim() || null,
        state: state.trim() || null,
        postcode: postcode.trim() || null,
        gps_lat: gpsLat ? parseFloat(gpsLat) : null,
        gps_long: gpsLong ? parseFloat(gpsLong) : null,
      });
      toast.success(`"${name}" added`);
      onCreated();
    } catch (err) { toast.error(apiError(err)); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 grid place-items-center p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      data-testid="site-add-modal">
      <form onSubmit={submit} className="w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex items-center gap-3">
          <div className="flex-1">
            <div className="text-[10px] uppercase tracking-wider font-bold text-orange-600">Add a site</div>
            <div className="font-bold text-slate-900">Manual site</div>
          </div>
          <button type="button" onClick={onClose}
            className="w-9 h-9 inline-grid place-items-center rounded-lg text-slate-500 hover:bg-slate-200">
            <XIcon size={16} />
          </button>
        </div>
        <div className="p-5 space-y-3">
          <Field label="Site name *">
            <input required value={name} onChange={(e) => setName(e.target.value)}
              data-testid="site-add-name"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/30" />
          </Field>
          <Field label="Address">
            <input value={address} onChange={(e) => setAddress(e.target.value)}
              data-testid="site-add-address"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/30" />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Suburb">
              <input value={suburb} onChange={(e) => setSuburb(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/30" />
            </Field>
            <Field label="State">
              <input value={state} onChange={(e) => setState(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/30" />
            </Field>
            <Field label="Postcode">
              <input value={postcode} onChange={(e) => setPostcode(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/30" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="GPS latitude" hint="Optional — used for the 250m distance warning at sign-on">
              <input value={gpsLat} onChange={(e) => setGpsLat(e.target.value)} type="number" step="any"
                data-testid="site-add-gps-lat"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/30" />
            </Field>
            <Field label="GPS longitude">
              <input value={gpsLong} onChange={(e) => setGpsLong(e.target.value)} type="number" step="any"
                data-testid="site-add-gps-long"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/30" />
            </Field>
          </div>
        </div>
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose}
            className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50">
            Cancel
          </button>
          <button type="submit" disabled={busy}
            data-testid="site-add-submit"
            className="px-4 py-2 rounded-lg bg-orange-500 text-white text-sm font-bold hover:bg-orange-600 disabled:opacity-60 inline-flex items-center gap-1.5">
            {busy && <Loader2 size={13} className="animate-spin" />} Create site
          </button>
        </div>
      </form>
    </div>
  );
}

// ─────────────────── Edit Site Drawer ───────────────────

function EditSiteDrawer({ site, onClose, onSaved }) {
  const isManual = (site.kind || 'simpro') === 'manual';
  const [name, setName] = useState(site.name || '');
  const [manualAddress, setManualAddress] = useState(site.manual_address || site.address || '');
  const [overrideLat, setOverrideLat] = useState(site.gps_override_lat ?? '');
  const [overrideLong, setOverrideLong] = useState(site.gps_override_long ?? '');
  const [questions, setQuestions] = useState(
    () => (site.signon_questions || []).map((q) => ({ ...q, _key: q.id || Math.random().toString(36).slice(2) })),
  );
  const [busy, setBusy] = useState(false);

  const addQ = (type) => {
    setQuestions((qs) => [...qs, {
      _key: Math.random().toString(36).slice(2),
      type, label: '', required: false,
      choices: type === 'choice' ? ['', ''] : undefined,
    }]);
  };
  const updateQ = (key, patch) => setQuestions((qs) => qs.map((q) => q._key === key ? { ...q, ...patch } : q));
  const removeQ = (key) => setQuestions((qs) => qs.filter((q) => q._key !== key));

  const submit = async () => {
    setBusy(true);
    try {
      const payload = {
        signon_questions: questions.map((q) => ({
          id: q.id, type: q.type, label: q.label, required: !!q.required,
          choices: q.type === 'choice' ? (q.choices || []).filter((c) => c && c.trim()) : null,
        })),
        gps_override_lat: overrideLat === '' ? null : parseFloat(overrideLat),
        gps_override_long: overrideLong === '' ? null : parseFloat(overrideLong),
      };
      if (isManual) {
        payload.name = name;
        payload.manual_address = manualAddress;
      }
      await api.patch(`/sites/${encodeURIComponent(site.simpro_site_id)}`, payload);
      toast.success('Site updated');
      onSaved();
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 grid place-items-end md:place-items-center p-0 md:p-6"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      data-testid="site-edit-drawer">
      <div className="w-full md:max-w-2xl md:max-h-[90vh] bg-white md:rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-wider font-bold text-orange-600">Edit site</div>
            <div className="font-bold text-slate-900 truncate">{site.name}</div>
          </div>
          <button type="button" onClick={onClose}
            className="w-9 h-9 inline-grid place-items-center rounded-lg text-slate-500 hover:bg-slate-200">
            <XIcon size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {isManual && (
            <section>
              <SectionTitle>Manual site details</SectionTitle>
              <div className="space-y-3 mt-2">
                <Field label="Site name">
                  <input value={name} onChange={(e) => setName(e.target.value)}
                    data-testid="site-edit-name"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/30" />
                </Field>
                <Field label="Address">
                  <input value={manualAddress} onChange={(e) => setManualAddress(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/30" />
                </Field>
              </div>
            </section>
          )}

          <section>
            <SectionTitle>
              GPS override <span className="text-[10px] font-normal text-slate-500 normal-case ml-1">(used for the 250m sign-on warning)</span>
            </SectionTitle>
            <div className="grid grid-cols-2 gap-3 mt-2">
              <Field label="Override latitude">
                <input type="number" step="any" value={overrideLat}
                  onChange={(e) => setOverrideLat(e.target.value)}
                  data-testid="site-edit-gps-override-lat"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/30" />
              </Field>
              <Field label="Override longitude">
                <input type="number" step="any" value={overrideLong}
                  onChange={(e) => setOverrideLong(e.target.value)}
                  data-testid="site-edit-gps-override-long"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/30" />
              </Field>
            </div>
          </section>

          <section>
            <SectionTitle>Sign-on questions</SectionTitle>
            <p className="text-xs text-slate-500 mt-1 mb-2">
              Workers and visitors will be asked these when they scan the site QR.
            </p>
            <ul className="space-y-2.5">
              {questions.length === 0 && (
                <li className="text-xs text-slate-500 italic px-3 py-2 rounded-lg bg-slate-50 border border-slate-200">
                  No sign-on questions yet — add one below.
                </li>
              )}
              {questions.map((q, idx) => (
                <li key={q._key} data-testid={`signon-q-${idx}`}
                  className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="flex items-start gap-2">
                    <span className="text-[10px] uppercase font-bold text-slate-500 mt-1 w-12">{q.type}</span>
                    <div className="flex-1 space-y-2">
                      <input
                        value={q.label}
                        onChange={(e) => updateQ(q._key, { label: e.target.value })}
                        placeholder="Question label, e.g. Are you fit-for-work today?"
                        data-testid={`signon-q-label-${idx}`}
                        className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/30" />
                      {q.type === 'choice' && (
                        <div className="space-y-1.5">
                          {(q.choices || []).map((c, ci) => (
                            <div key={ci} className="flex items-center gap-2">
                              <input value={c}
                                onChange={(e) => {
                                  const nx = [...(q.choices || [])];
                                  nx[ci] = e.target.value;
                                  updateQ(q._key, { choices: nx });
                                }}
                                placeholder={`Choice ${ci + 1}`}
                                className="flex-1 px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/30" />
                              <button type="button"
                                onClick={() => updateQ(q._key, { choices: (q.choices || []).filter((_, i) => i !== ci) })}
                                className="text-slate-400 hover:text-rose-600 px-1.5">
                                <XIcon size={12} />
                              </button>
                            </div>
                          ))}
                          <button type="button"
                            onClick={() => updateQ(q._key, { choices: [...(q.choices || []), ''] })}
                            className="text-xs font-semibold text-orange-600 hover:text-orange-700">
                            + Add choice
                          </button>
                        </div>
                      )}
                      <label className="inline-flex items-center gap-1.5 text-xs text-slate-700">
                        <input type="checkbox" checked={!!q.required}
                          onChange={(e) => updateQ(q._key, { required: e.target.checked })}
                          data-testid={`signon-q-required-${idx}`} />
                        Required
                      </label>
                    </div>
                    <button type="button" onClick={() => removeQ(q._key)}
                      data-testid={`signon-q-remove-${idx}`}
                      className="text-slate-400 hover:text-rose-600 mt-1">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={() => addQ('yesno')}
                data-testid="signon-q-add-yesno"
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50">
                <Plus size={11} /> Yes / no
              </button>
              <button type="button" onClick={() => addQ('text')}
                data-testid="signon-q-add-text"
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50">
                <Plus size={11} /> Short text
              </button>
              <button type="button" onClick={() => addQ('choice')}
                data-testid="signon-q-add-choice"
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50">
                <Plus size={11} /> Multiple choice
              </button>
            </div>
          </section>
        </div>

        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose}
            className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50">
            Cancel
          </button>
          <button type="button" onClick={submit} disabled={busy}
            data-testid="site-edit-save"
            className="px-4 py-2 rounded-lg bg-orange-500 text-white text-sm font-bold hover:bg-orange-600 disabled:opacity-60 inline-flex items-center gap-1.5">
            {busy && <Loader2 size={13} className="animate-spin" />} Save changes
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────── Recycle Bin Modal ───────────────────

function RecycleBinModal({ onClose, onRestored }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    setLoading(true);
    return api.get('/sites/recycle-bin')
      .then((r) => setRows(r.data || []))
      .catch((e) => toast.error(apiError(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const restore = async (id) => {
    try {
      await api.post(`/sites/${encodeURIComponent(id)}/restore`);
      toast.success('Restored');
      onRestored();
      reload();
    } catch (e) { toast.error(apiError(e)); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 grid place-items-center p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      data-testid="recycle-bin-modal">
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden max-h-[85vh]">
        <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex items-center gap-3">
          <div className="flex-1">
            <div className="text-[10px] uppercase tracking-wider font-bold text-orange-600">Recycle bin</div>
            <div className="font-bold text-slate-900">Sites awaiting purge (30-day retention)</div>
          </div>
          <button type="button" onClick={onClose}
            className="w-9 h-9 inline-grid place-items-center rounded-lg text-slate-500 hover:bg-slate-200">
            <XIcon size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-6 text-sm text-slate-500"><Loader2 size={14} className="inline animate-spin mr-1" /> Loading…</div>
          ) : rows.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">Recycle bin is empty.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="text-left px-4 py-2.5">Site</th>
                  <th className="text-left px-4 py-2.5">Deleted</th>
                  <th className="text-left px-4 py-2.5">Days left</th>
                  <th className="text-right px-4 py-2.5">Restore</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.simpro_site_id} data-testid={`recycle-row-${r.simpro_site_id}`} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-semibold text-slate-900">{r.name || '(unnamed)'}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{fmtAgo(r.deleted_at)}</td>
                    <td className="px-4 py-3 text-xs text-slate-700">{r.days_left ?? '—'}</td>
                    <td className="px-4 py-3 text-right">
                      <button type="button" onClick={() => restore(r.simpro_site_id)}
                        data-testid={`recycle-restore-${r.simpro_site_id}`}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 text-[11px] font-semibold hover:bg-emerald-100">
                        <RotateCcw size={11} /> Restore
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────── Shared bits ───────────────────

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <div className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1">{label}</div>
      {children}
      {hint && <div className="text-[10px] text-slate-400 mt-1">{hint}</div>}
    </label>
  );
}

function SectionTitle({ children }) {
  return <h3 className="text-[10px] uppercase tracking-wider font-bold text-slate-700">{children}</h3>;
}

// ─────────────────── Print modal (unchanged from v4.2) ───────────────────

function SitePrintModal({ site, onClose }) {
  const [layout, setLayout] = useState('gate_sign');
  const [directUrl, setDirectUrl] = useState(null);
  const [busy, setBusy] = useState(false);

  const generate = useCallback(async (l) => {
    setBusy(true);
    try {
      const r = await api.get(`/sites/${encodeURIComponent(site.simpro_site_id)}/scan-pdf`,
        { params: { layout: l }, responseType: 'blob' });
      const { src } = await stashInlinePdf(r.data, `${site.name || 'site'}-qr.pdf`);
      setDirectUrl(src);
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  }, [site.simpro_site_id, site.name]);

  useEffect(() => { generate(layout); }, [generate, layout]);

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/70 grid place-items-center p-0 md:p-6"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      data-testid="site-print-modal">
      <div className="w-full h-full md:max-w-5xl md:h-[88vh] bg-white md:rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-wider font-bold text-orange-600">Site QR</div>
            <div className="font-display font-bold text-slate-900 truncate">{site.name}</div>
          </div>
          <div className="inline-flex rounded-lg border border-slate-300 overflow-hidden text-xs font-semibold">
            <button onClick={() => setLayout('gate_sign')}
              data-testid="site-print-layout-gate-sign"
              className={`px-3 py-1.5 ${layout === 'gate_sign' ? 'bg-orange-500 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}>
              Gate Sign A4
            </button>
            <button onClick={() => setLayout('avery')}
              data-testid="site-print-layout-avery"
              className={`px-3 py-1.5 border-l border-slate-300 ${layout === 'avery' ? 'bg-orange-500 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}>
              Avery 30-up
            </button>
          </div>
          <button onClick={onClose} data-testid="site-print-close"
            className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-slate-500 hover:bg-slate-200">✕</button>
        </div>
        <div className="flex-1 bg-slate-100 relative">
          {busy ? (
            <div className="absolute inset-0 grid place-items-center">
              <Loader2 size={22} className="animate-spin text-orange-500" />
            </div>
          ) : directUrl ? (
            <iframe data-testid="site-print-iframe" title="Site QR PDF" src={directUrl}
              className="w-full h-full border-0" />
          ) : null}
        </div>
        <div className="px-5 py-2.5 border-t border-slate-200 bg-slate-50 text-[11px] text-slate-500">
          Token: <span className="font-mono">{site.scan_token || 'generated'}</span> · Open in a new tab to print, or download via the browser PDF toolbar.
        </div>
      </div>
    </div>
  );
}

// ─────────────────── Site Detail (existing + Edit hook) ───────────────────

export function SiteDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const user = getUser();
  const canEdit = EDIT_ROLES.has(user?.role);
  const [site, setSite] = useState(null);
  const [siteErr, setSiteErr] = useState(null);
  const [signons, setSignons] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [printOpen, setPrintOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const intervalRef = useRef(null);

  const loadSite = useCallback(() => api.get('/sites')
    .then((r) => {
      const match = (r.data || []).find((s) => String(s.simpro_site_id) === String(id));
      if (match) setSite(match); else setSiteErr('not_found');
    })
    .catch((e) => setSiteErr(apiError(e))), [id]);

  useEffect(() => { loadSite(); }, [loadSite]);

  const loadSignons = useCallback(async () => {
    setRefreshing(true);
    try {
      const r = await api.get(`/sites/${encodeURIComponent(id)}/active-signons`);
      setSignons(r.data?.signons || []);
      setLastRefresh(new Date());
    } catch (e) {
      console.warn('active-signons fetch failed', e);
    } finally { setRefreshing(false); }
  }, [id]);

  useEffect(() => {
    if (!canEdit) return;
    loadSignons();
    intervalRef.current = setInterval(loadSignons, 60_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [canEdit, loadSignons]);

  const signOff = async (signonId) => {
    try {
      await api.delete(`/sites/${encodeURIComponent(id)}/active-signons/${signonId}`);
      toast.success('Worker signed off');
      setSignons((prev) => prev.filter((s) => s.id !== signonId));
    } catch (e) { toast.error(apiError(e)); }
  };

  if (!canEdit) {
    return (
      <div className="p-8">
        <PageHeader crumb="Compliance / Sites" title="Site" />
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">Restricted to Admin / Manager / HSEQ Lead.</div>
      </div>
    );
  }

  if (siteErr === 'not_found') {
    return (
      <div className="p-8">
        <button onClick={() => navigate('/app/sites')}
          className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900 mb-3">
          <ArrowLeft size={12} /> All sites
        </button>
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-sm text-slate-600">Site not found.</div>
      </div>
    );
  }
  if (!site) {
    return <div className="p-8 text-sm text-slate-500"><Loader2 size={14} className="inline animate-spin mr-1" /> Loading…</div>;
  }

  return (
    <div className="p-6 lg:p-8" data-testid="site-detail-page">
      <button onClick={() => navigate('/app/sites')} data-testid="site-detail-back"
        className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900 mb-3">
        <ArrowLeft size={12} /> All sites
      </button>
      <PageHeader
        crumb={`Compliance / Sites / ${site.name || site.simpro_site_id}`}
        title={site.name || `Site ${site.simpro_site_id}`}
        subtitle={site.address_full || site.address || `${site.suburb || ''} ${site.state || ''}`.trim()}
        action={
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setEditOpen(true)}
              data-testid={`site-detail-edit-${site.simpro_site_id}`}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50">
              <Pencil size={13} /> Edit
            </button>
            <button type="button" onClick={() => setPrintOpen(true)}
              data-testid={`site-detail-print-qr-${site.simpro_site_id}`}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-orange-500 text-white text-sm font-bold hover:bg-orange-600">
              <Printer /> Print site QR
            </button>
          </div>
        }
      />

      <section className="rounded-2xl border border-slate-200 bg-white overflow-hidden mt-2" data-testid="site-active-signons">
        <div className="px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center gap-3">
          <Users size={14} className="text-emerald-700" />
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-wider font-bold text-emerald-700">Currently signed on</div>
            <div className="text-sm font-bold text-slate-900">{signons.length} active {signons.length === 1 ? 'worker' : 'workers'} on site (last 24h)</div>
          </div>
          <button onClick={loadSignons} disabled={refreshing}
            data-testid="site-signons-refresh"
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-700 hover:text-slate-900 disabled:opacity-50">
            {refreshing ? <Loader2 size={11} className="animate-spin" /> : <RefreshCcw />}
            Refresh
          </button>
          {lastRefresh && <span className="text-[10px] text-slate-400" data-testid="site-signons-last-refresh">Updated {fmtAgo(lastRefresh.toISOString())}</span>}
        </div>
        {signons.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">Nobody is signed on right now.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-white text-[10px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="text-left px-4 py-2">Worker</th>
                <th className="text-left px-4 py-2">Signed on</th>
                <th className="text-left px-4 py-2">Source</th>
                <th className="text-left px-4 py-2">GPS</th>
                <th className="text-right px-4 py-2">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {signons.map((s) => (
                <tr key={s.id} data-testid={`signon-row-${s.worker_id || s.id}`} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-semibold text-slate-900">
                    {s.worker_name || s.name || s.worker_id || '(visitor)'}
                    {s.company && <span className="ml-1.5 text-[10px] text-slate-500">· {s.company}</span>}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-600">{fmtAgo(s.signed_at)}</td>
                  <td className="px-4 py-2.5 text-[11px] uppercase font-semibold text-slate-500">{s.source || 'qr'}</td>
                  <td className="px-4 py-2.5 text-[11px]">
                    {s.gps_unavailable ? (
                      <span className="text-slate-400">unavailable</span>
                    ) : s.gps_warning ? (
                      <span className="text-amber-700 font-semibold">⚠ {s.gps_distance_m}m away</span>
                    ) : s.gps_distance_m != null ? (
                      <span className="text-emerald-700">{s.gps_distance_m}m</span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button onClick={() => signOff(s.id)}
                      data-testid={`signoff-btn-${s.worker_id || s.id}`}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-rose-200 bg-rose-50 text-rose-700 text-[11px] font-semibold hover:bg-rose-100">
                      <LogOut size={11} /> Sign off
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {printOpen && (
        <SitePrintModal site={site} onClose={() => setPrintOpen(false)} />
      )}
      {editOpen && (
        <EditSiteDrawer site={site} onClose={() => setEditOpen(false)}
          onSaved={() => { setEditOpen(false); loadSite(); }} />
      )}
    </div>
  );
}
