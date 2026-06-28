// Right-side drawer for create/edit asset + pairing (QR/NFC/UHF) management.
import React, { useEffect, useMemo, useState } from 'react';
import {
  X, Loader2, QrCode, Smartphone, Tag, Wrench, Truck, Container,
  Printer, AlertTriangle, Check, CheckCircle2,
} from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../lib/api';
import { ServiceSchedulesTab, ServiceLogTab } from './AssetServiceTabs';
import LiveCountersPanel from './LiveCountersPanel';

const KIND_OPTIONS = [
  { v: 'vehicle', label: 'Vehicle', icon: Truck },
  { v: 'plant', label: 'Plant', icon: Wrench },
  { v: 'tool', label: 'Tool', icon: Tag },
  { v: 'container', label: 'Container', icon: Container },
];

const TYPE_OPTIONS = [
  'vacuum_truck', 'tipper', 'dump_truck', 'semi_trailer', 'ute',
  'crane_truck', 'service_truck', 'excavator', 'loader', 'bulldozer',
  'grader', 'compactor', 'skid_steer', 'backhoe', 'generator',
  'pump', 'compressor', 'lighting_tower', 'trailer', 'container',
  'tool', 'other',
];

const TABS = [
  { key: 'details', label: 'Details' },
  { key: 'pairing', label: 'Pairing' },
  { key: 'schedules', label: 'Schedules' },
  { key: 'service_log', label: 'Service log' },
  { key: 'photo', label: 'Photo' },
  { key: 'notes', label: 'Notes' },
];

const emptyForm = {
  kind: 'plant', name: '', asset_type: 'excavator', rego_serial: '',
  make: '', model: '', year: '', owner: '', notes: '', status: 'active',
};

export default function AssetDrawer({ asset, onClose, onSaved }) {
  const isEdit = !!asset?.id;
  const isNavixy = !!asset?.navixy_device_id;
  const [tab, setTab] = useState('details');
  const [form, setForm] = useState(() => asset ? { ...emptyForm, ...asset, year: asset.year || '' } : { ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [nfcSaving, setNfcSaving] = useState(false);
  const [uhfSaving, setUhfSaving] = useState(false);
  const [manualNfc, setManualNfc] = useState(asset?.nfc_uid || '');
  const [manualUhf, setManualUhf] = useState(asset?.uhf_epc || '');
  const [current, setCurrent] = useState(asset);

  useEffect(() => { setCurrent(asset); setForm(asset ? { ...emptyForm, ...asset, year: asset.year || '' } : { ...emptyForm }); }, [asset]);

  const change = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const submit = async () => {
    if (!form.name.trim()) { toast.error('Name is required'); return; }
    if (!form.asset_type) { toast.error('Type is required'); return; }
    setSaving(true);
    try {
      const payload = {
        kind: form.kind, name: form.name.trim(), asset_type: form.asset_type,
        rego_serial: form.rego_serial || null, make: form.make || null,
        model: form.model || null, year: form.year ? Number(form.year) : null,
        owner: form.owner || null, notes: form.notes || null,
        status: form.status || 'active',
      };
      const r = isEdit
        ? await api.put(`/assets/${asset.id}`, payload)
        : await api.post('/assets', payload);
      toast.success(isEdit ? 'Asset updated' : 'Asset created');
      setCurrent(r.data);
      onSaved?.(r.data);
    } catch (e) { toast.error(apiError(e)); }
    finally { setSaving(false); }
  };

  // ── NFC: try Web NFC API on Android Chrome, fallback to manual UID. ──
  const nfcSupported = typeof window !== 'undefined' && 'NDEFReader' in window;

  const writeNfcTag = async () => {
    if (!current?.id || !current?.scan_token) {
      toast.error('Save the asset first, then write the NFC tag');
      return;
    }
    setNfcSaving(true);
    try {
      // eslint-disable-next-line no-undef
      const reader = new NDEFReader();
      const url = `${window.location.origin}/scan/${current.scan_token}`;
      await reader.write({ records: [{ recordType: 'url', data: url }] });
      // After write, prompt user to also pair UID (next scan).
      toast.success('NFC tag written. Now tap the tag once to register its UID.');
      const ctrl = new AbortController();
      await reader.scan({ signal: ctrl.signal });
      reader.onreading = async (event) => {
        ctrl.abort();
        await pairNfc(event.serialNumber);
      };
    } catch (e) {
      toast.error(`NFC error: ${e?.message || e}`);
    } finally { setNfcSaving(false); }
  };

  const pairNfc = async (uid) => {
    if (!uid) return;
    try {
      const r = await api.post(`/assets/${current.id}/nfc-pair`, { nfc_uid: uid });
      toast.success('NFC tag paired');
      setCurrent(r.data); setManualNfc(r.data.nfc_uid || '');
      onSaved?.(r.data);
    } catch (e) { toast.error(apiError(e)); }
  };

  const unpairNfc = async () => {
    try {
      const r = await api.delete(`/assets/${current.id}/nfc-pair`);
      toast.success('NFC unpaired');
      setCurrent(r.data); setManualNfc('');
      onSaved?.(r.data);
    } catch (e) { toast.error(apiError(e)); }
  };

  const submitManualNfc = async () => {
    if (!manualNfc.trim()) return;
    await pairNfc(manualNfc.trim().toUpperCase());
  };

  const submitUhf = async () => {
    if (!manualUhf.trim()) return;
    setUhfSaving(true);
    try {
      const r = await api.post(`/assets/${current.id}/uhf-pair`, { uhf_epc: manualUhf.trim().toUpperCase() });
      toast.success('UHF EPC stored');
      setCurrent(r.data); onSaved?.(r.data);
    } catch (e) { toast.error(apiError(e)); }
    finally { setUhfSaving(false); }
  };

  const downloadLabel = (layout) => {
    api.get(`/assets/${current.id}/label.pdf`, { params: { layout }, responseType: 'blob' })
      .then((r) => {
        const url = URL.createObjectURL(r.data);
        window.open(url, '_blank', 'noopener');
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      })
      .catch((e) => toast.error(apiError(e)));
  };

  const qrSrc = useMemo(() => {
    if (!current?.id) return null;
    // We can't include Bearer in <img src>, so fetch as blob.
    return current.id;
  }, [current]);
  const [qrUrl, setQrUrl] = useState(null);
  useEffect(() => {
    if (!qrSrc) { setQrUrl(null); return; }
    let alive = true; let urlToRevoke = null;
    api.get(`/assets/${qrSrc}/qr.png`, { responseType: 'blob' })
      .then((r) => { if (alive) { urlToRevoke = URL.createObjectURL(r.data); setQrUrl(urlToRevoke); } })
      .catch(() => { if (alive) setQrUrl(null); });
    return () => { alive = false; if (urlToRevoke) URL.revokeObjectURL(urlToRevoke); };
  }, [qrSrc]);

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-slate-900/40 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      data-testid="asset-drawer">
      <aside className="w-full sm:max-w-xl h-full bg-white shadow-2xl border-l border-slate-200 overflow-hidden flex flex-col">
        <div className="px-5 py-4 border-b border-slate-200 flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-[0.16em] font-semibold text-slate-500">{isEdit ? 'Edit asset' : 'New asset'}</div>
            <h2 className="font-display text-xl font-bold text-slate-900 truncate">{current?.name || 'New asset'}</h2>
            {isNavixy && (
              <div className="mt-1 inline-flex items-center gap-1 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                Synced from Navixy · core fields locked
              </div>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100" data-testid="asset-drawer-close"><X size={18} /></button>
        </div>

        <div className="px-5 pt-3 border-b border-slate-200 flex gap-1 text-sm">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-3 py-2 -mb-px border-b-2 font-semibold ${tab === t.key ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
              data-testid={`asset-tab-${t.key}`}>{t.label}</button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {tab === 'details' && (
            <div className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Kind</label>
                <div className="flex gap-1.5 flex-wrap">
                  {KIND_OPTIONS.map((k) => (
                    <button key={k.v} type="button" disabled={isNavixy}
                      onClick={() => change('kind', k.v)}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border ${form.kind === k.v ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-700 border-slate-200'} ${isNavixy ? 'opacity-50 cursor-not-allowed' : 'hover:bg-slate-50'}`}
                      data-testid={`asset-kind-${k.v}`}>
                      <k.icon size={12} /> {k.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Name *</label>
                <input value={form.name} onChange={(e) => change('name', e.target.value)} disabled={isNavixy}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm disabled:bg-slate-50"
                  data-testid="asset-name" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">Type *</label>
                  <select value={form.asset_type} onChange={(e) => change('asset_type', e.target.value)} disabled={isNavixy}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm disabled:bg-slate-50" data-testid="asset-type">
                    {TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">Rego / Serial</label>
                  <input value={form.rego_serial || ''} onChange={(e) => change('rego_serial', e.target.value)} disabled={isNavixy}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono uppercase disabled:bg-slate-50"
                    data-testid="asset-rego" />
                </div>
              </div>
              {current && <LiveCountersPanel asset={current} onAssetUpdated={(a) => { setCurrent(a); }} />}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">Make</label>
                  <input value={form.make || ''} onChange={(e) => change('make', e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" data-testid="asset-make" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">Model</label>
                  <input value={form.model || ''} onChange={(e) => change('model', e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" data-testid="asset-model" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">Year</label>
                  <input type="number" value={form.year || ''} onChange={(e) => change('year', e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" data-testid="asset-year" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">Owner</label>
                  <input value={form.owner || ''} onChange={(e) => change('owner', e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" data-testid="asset-owner" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Status</label>
                <div className="flex gap-2">
                  {['active', 'retired'].map((s) => (
                    <button key={s} type="button" onClick={() => change('status', s)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${form.status === s ? (s === 'retired' ? 'bg-rose-600 text-white border-rose-600' : 'bg-emerald-600 text-white border-emerald-600') : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}
                      data-testid={`asset-status-${s}`}>{s}</button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {tab === 'pairing' && (
            <div className="space-y-5">
              {!current?.id && (
                <div className="px-3 py-2.5 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800">
                  <AlertTriangle size={14} className="inline mr-1" />
                  Save the asset first to enable QR / NFC / UHF pairing.
                </div>
              )}
              {current?.id && (
                <>
                  {/* QR */}
                  <section className="space-y-2">
                    <h4 className="font-display text-sm font-semibold text-slate-800 flex items-center gap-1.5">
                      <QrCode size={14} /> QR code
                    </h4>
                    <div className="flex items-start gap-3">
                      {qrUrl ? (
                        <img alt="QR" src={qrUrl} className="w-32 h-32 rounded-lg border border-slate-200 bg-white p-1" data-testid="asset-qr-preview" />
                      ) : (
                        <div className="w-32 h-32 flex items-center justify-center rounded-lg border border-slate-200 bg-slate-50"><Loader2 size={18} className="animate-spin text-slate-400" /></div>
                      )}
                      <div className="text-xs text-slate-600 space-y-2 flex-1">
                        <div>Scan token: <span className="font-mono font-bold text-slate-900">{current.scan_token}</span></div>
                        <div className="text-slate-500">Encodes: <span className="break-all font-mono">{`${window.location.origin}/scan/${current.scan_token}`}</span></div>
                        <div className="flex gap-1.5 flex-wrap pt-1">
                          {['a6', 'on_metal', 'combo', 'avery_l7160'].map((l) => (
                            <button key={l} onClick={() => downloadLabel(l)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-300 text-[11px] font-semibold hover:bg-slate-50"
                              data-testid={`asset-label-${l}`}>
                              <Printer size={11} /> {l.replace(/_/g, ' ')}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </section>

                  {/* NFC */}
                  <section className="space-y-2 pt-1 border-t border-slate-100">
                    <h4 className="font-display text-sm font-semibold text-slate-800 flex items-center gap-1.5 pt-3">
                      <Smartphone size={14} className="text-violet-600" /> NFC tag pairing
                      {current.nfc_uid && <span className="ml-1 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200"><Check size={9} /> Paired</span>}
                    </h4>
                    {current.nfc_uid ? (
                      <div className="px-3 py-2.5 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center gap-2 text-sm">
                        <CheckCircle2 size={14} className="text-emerald-700" />
                        <span>UID <span className="font-mono font-bold text-emerald-900">{current.nfc_uid}</span></span>
                        <button onClick={unpairNfc} className="ml-auto text-xs text-rose-600 font-semibold hover:underline" data-testid="asset-nfc-unpair">Unpair</button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {nfcSupported ? (
                          <button onClick={writeNfcTag} disabled={nfcSaving}
                            className="w-full inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border-2 border-dashed border-violet-300 bg-violet-50 text-violet-700 text-sm font-semibold hover:bg-violet-100 disabled:opacity-50"
                            data-testid="asset-nfc-write">
                            {nfcSaving ? <Loader2 size={14} className="animate-spin" /> : <Smartphone size={14} />}
                            Tap to write tag & pair
                          </button>
                        ) : (
                          <div className="text-[11px] text-slate-500">
                            Web NFC not supported on this device. Use a separate NFC writer app, then enter the tag UID below.
                          </div>
                        )}
                        <div className="flex gap-2">
                          <input value={manualNfc} onChange={(e) => setManualNfc(e.target.value.toUpperCase())}
                            placeholder="Manual UID (hex)" className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono uppercase"
                            data-testid="asset-nfc-manual" />
                          <button onClick={submitManualNfc} disabled={!manualNfc.trim()}
                            className="px-3 py-2 rounded-lg bg-violet-600 text-white text-sm font-semibold disabled:opacity-50" data-testid="asset-nfc-save">Pair</button>
                        </div>
                      </div>
                    )}
                  </section>

                  {/* UHF EPC */}
                  <section className="space-y-2 pt-1 border-t border-slate-100">
                    <h4 className="font-display text-sm font-semibold text-slate-800 flex items-center gap-1.5 pt-3">
                      <Tag size={14} className="text-amber-600" /> UHF EPC <span className="text-[10px] font-semibold uppercase text-slate-400">(Phase 5)</span>
                    </h4>
                    <div className="flex gap-2">
                      <input value={manualUhf} onChange={(e) => setManualUhf(e.target.value.toUpperCase())}
                        placeholder="EPC hex (e.g. E280689400005002…)"
                        className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono uppercase"
                        data-testid="asset-uhf-manual" />
                      <button onClick={submitUhf} disabled={!manualUhf.trim() || uhfSaving}
                        className="px-3 py-2 rounded-lg bg-amber-600 text-white text-sm font-semibold disabled:opacity-50" data-testid="asset-uhf-save">
                        {uhfSaving ? <Loader2 size={14} className="animate-spin" /> : 'Store'}
                      </button>
                    </div>
                    {current.uhf_epc && <div className="text-xs text-slate-600">Stored EPC: <span className="font-mono">{current.uhf_epc}</span></div>}
                  </section>
                </>
              )}
            </div>
          )}

          {tab === 'schedules' && (
            current?.id
              ? <ServiceSchedulesTab asset={current} canEdit />
              : <div className="text-sm text-slate-500">Save the asset first to add service schedules.</div>
          )}
          {tab === 'service_log' && (
            current?.id
              ? <ServiceLogTab asset={current} canEdit />
              : <div className="text-sm text-slate-500">Save the asset first to log service or defects.</div>
          )}

          {tab === 'photo' && (
            <div className="space-y-3">
              <h4 className="font-display text-sm font-semibold text-slate-800">Photo</h4>
              <div className="text-sm text-slate-500">
                Photo uploads will be wired in Phase 2 alongside the asset_scan form field.
                For now you can drop a file path/id into the field below.
              </div>
              <input value={form.photo_file_id || ''} onChange={(e) => change('photo_file_id', e.target.value)}
                placeholder="photo_file_id" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono"
                data-testid="asset-photo-id" />
            </div>
          )}

          {tab === 'notes' && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">Notes</label>
              <textarea rows={8} value={form.notes || ''} onChange={(e) => change('notes', e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                data-testid="asset-notes" />
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 rounded-xl border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-white" data-testid="asset-cancel">Cancel</button>
          <button onClick={submit} disabled={saving}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 disabled:opacity-50"
            data-testid="asset-save">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {isEdit ? 'Save changes' : 'Create asset'}
          </button>
        </div>
      </aside>
    </div>
  );
}
