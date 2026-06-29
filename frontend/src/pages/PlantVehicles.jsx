// Plant & Vehicles Register — unified live Navixy + manual plant/tool/container assets.
import React, { useEffect, useMemo, useState } from 'react';
import {
  Plus, RefreshCw, Search, MapPin, Truck, Loader2, Printer, Tag,
  Edit3, Archive, QrCode, X, List as ListIcon, Map as MapIcon, Radio,
  ClipboardCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { Link } from 'react-router-dom';
import api, { apiError } from '../lib/api';
import { useCan } from '../lib/permissions';
import { PageHeader } from '../components/capture/Ui';
import VehicleMapModal from '../components/VehicleMapModal';
import AssetDrawer from '../components/AssetDrawer';
import FleetLiveDashboards from '../components/FleetLiveDashboards';

const KIND_CHIPS = [
  { key: 'all', label: 'All' },
  { key: 'vehicle', label: 'Vehicles' },
  { key: 'plant', label: 'Plant' },
  { key: 'tool', label: 'Tools' },
  { key: 'container', label: 'Containers' },
];

const TYPE_LABEL = {
  vacuum_truck: 'Vacuum truck', tipper: 'Tipper', dump_truck: 'Dump truck',
  semi_trailer: 'Semi-trailer', ute: 'Ute', crane_truck: 'Crane truck',
  service_truck: 'Service truck', excavator: 'Excavator', loader: 'Loader',
  bulldozer: 'Bulldozer', grader: 'Grader', compactor: 'Compactor',
  skid_steer: 'Skid steer', backhoe: 'Backhoe', generator: 'Generator',
  pump: 'Pump', compressor: 'Compressor', lighting_tower: 'Lighting tower',
  trailer: 'Trailer', container: 'Container', tool: 'Tool', other: 'Other',
};

function fmtType(t) { return TYPE_LABEL[t] || (t || 'Other').replace(/_/g, ' '); }

function SourceBadge({ asset }) {
  if (asset.navixy_device_id) {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider bg-blue-50 text-blue-700 border border-blue-200" data-testid={`badge-source-${asset.id}`}>
        <Radio size={9} /> Live · Navixy
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider bg-slate-100 text-slate-600 border border-slate-200" data-testid={`badge-source-${asset.id}`}>
      Manual
    </span>
  );
}

function PairingChips({ asset }) {
  return (
    <div className="inline-flex items-center gap-1">
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200" data-testid={`chip-qr-${asset.id}`}>
        QR ✓
      </span>
      {asset.nfc_uid && (
        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider bg-violet-50 text-violet-700 border border-violet-200" data-testid={`chip-nfc-${asset.id}`}>
          NFC ✓
        </span>
      )}
      {asset.uhf_epc && (
        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider bg-amber-50 text-amber-700 border border-amber-200" data-testid={`chip-uhf-${asset.id}`}>
          UHF ✓
        </span>
      )}
    </div>
  );
}

function PrintLabelsModal({ assetIds, onClose }) {
  const [layout, setLayout] = useState('a6');
  const openLabel = () => {
    // Use signed URL via Bearer-style fallback: include header via fetch+blob.
    api.get(`/assets/${assetIds[0]}/label.pdf`, {
      responseType: 'blob',
      params: { layout, ids: layout === 'avery_l7160' ? assetIds.join(',') : undefined },
    }).then((r) => {
      const blobUrl = URL.createObjectURL(r.data);
      window.open(blobUrl, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
    }).catch((e) => toast.error(apiError(e)));
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      data-testid="print-labels-modal">
      <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center gap-3">
          <Printer size={18} className="text-blue-600" />
          <div className="flex-1">
            <h3 className="font-display text-lg font-bold text-slate-900">Print labels</h3>
            <p className="text-xs text-slate-500">{assetIds.length} asset{assetIds.length === 1 ? '' : 's'} selected</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100" data-testid="print-close"><X size={16} /></button>
        </div>
        <div className="px-5 py-4 space-y-2">
          {[
            { v: 'a6', label: 'A6 single label', sub: 'Full-page label with QR + name + rego' },
            { v: 'on_metal', label: 'On-metal label', sub: 'Big QR + big rego, no NFC zone' },
            { v: 'combo', label: 'QR + NFC pairing label', sub: 'QR with dotted NFC tag outline' },
            { v: 'avery_l7160', label: 'Avery L7160 sheet', sub: 'A4 with 21 mini labels (3×7)' },
          ].map((opt) => (
            <label key={opt.v}
              className={`flex gap-3 px-3 py-2.5 rounded-xl border-2 cursor-pointer transition ${layout === opt.v ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:bg-slate-50'}`}
              data-testid={`print-layout-${opt.v}`}>
              <input type="radio" name="layout" checked={layout === opt.v} onChange={() => setLayout(opt.v)}
                className="mt-1 accent-blue-600" />
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm text-slate-900">{opt.label}</div>
                <div className="text-[11px] text-slate-500">{opt.sub}</div>
              </div>
            </label>
          ))}
        </div>
        <div className="px-5 py-4 border-t border-slate-200 flex items-center justify-end gap-2 bg-slate-50">
          <button onClick={onClose} className="px-3 py-2 rounded-xl border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-white" data-testid="print-cancel">Cancel</button>
          <button onClick={openLabel} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700" data-testid="print-generate">
            <Printer size={14} /> Generate PDF
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PlantVehicles() {
  const can = useCan();
  const canEdit = can('assets', 'edit');
  const [data, setData] = useState({ assets: [], total: 0, live: 0, manual: 0 });
  const [busy, setBusy] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [kind, setKind] = useState('all');
  const [assetType, setAssetType] = useState('all');
  const [q, setQ] = useState('');
  const [view, setView] = useState('list');
  const [activeMapAsset, setActiveMapAsset] = useState(null);
  const [drawerAsset, setDrawerAsset] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [printIds, setPrintIds] = useState(null);

  const load = async () => {
    setRefreshing(true); setError('');
    try {
      const { data: d } = await api.get('/assets', { params: { kind, asset_type: assetType, q: q || undefined } });
      setData(d);
    } catch (e) { setError(apiError(e)); }
    finally { setBusy(false); setRefreshing(false); }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [kind, assetType]);
  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const typeCounts = useMemo(() => {
    const m = {};
    for (const a of data.assets) m[a.asset_type] = (m[a.asset_type] || 0) + 1;
    return m;
  }, [data.assets]);

  // Phase 3.9b — load form-assignment counts per asset_type so each row can
  // show "N forms". Only admin/manager/hseq_lead can read the matrix; for
  // workers we just leave the chip hidden.
  const [formCountsByType, setFormCountsByType] = useState({});
  const [formNamesByType, setFormNamesByType] = useState({});
  useEffect(() => {
    let alive = true;
    api.get('/form-templates/assignments').then((r) => {
      if (!alive) return;
      const counts = {};
      const names = {};
      (r.data?.templates || []).forEach((t) => {
        const a = t.applies_to || {};
        const isAny = (a.kinds || []).includes('any');
        const types = a.asset_types || [];
        const kinds = a.kinds || [];
        // Track per-type (explicit) and a sentinel for "any kind".
        const targets = new Set(types);
        // Also: any kind-level match → applies to every asset_type of that kind.
        // We can't compute that without a full kind→types index, so we just
        // include this template against every asset_type the page knows
        // about. data.assets already gives us that mapping cheaply.
        if (isAny || kinds.length) {
          (data.assets || []).forEach((asset) => {
            if (isAny || (asset.kind && kinds.includes(asset.kind))) {
              if (asset.asset_type) targets.add(asset.asset_type);
            }
          });
        }
        targets.forEach((at) => {
          counts[at] = (counts[at] || 0) + 1;
          (names[at] = names[at] || []).push(t.name);
        });
      });
      setFormCountsByType(counts);
      setFormNamesByType(names);
    }).catch(() => { /* worker or other 403 — chip stays hidden */ });
    return () => { alive = false; };
  }, [data.assets]);

  const archive = async (a) => {
    if (!window.confirm(`Archive asset "${a.name}"?`)) return;
    try {
      await api.delete(`/assets/${a.id}`);
      toast.success(`Archived ${a.name}`);
      load();
    } catch (e) { toast.error(apiError(e)); }
  };

  const downloadQr = (a) => {
    api.get(`/assets/${a.id}/qr.png`, { responseType: 'blob' })
      .then((r) => {
        const url = URL.createObjectURL(r.data);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `qr-${a.rego_serial || a.scan_token}.png`;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      })
      .catch((e) => toast.error(apiError(e)));
  };

  const openCreate = () => { setDrawerAsset(null); setDrawerOpen(true); };
  const openEdit = (a) => { setDrawerAsset(a); setDrawerOpen(true); };

  if (busy && !data.assets.length && !error) {
    return <div className="text-sm text-slate-500" data-testid="assets-loading">Loading register…</div>;
  }

  const assets = data.assets || [];
  const filteredCount = assets.length;
  const totalSummary = `${filteredCount} of ${data.total} assets · ${data.live} live · ${data.manual} manual`;

  return (
    <div className="max-w-6xl mx-auto" data-testid="plant-vehicles-page">
      <PageHeader
        crumb="Compliance / Plant & Vehicles"
        title="Plant & Vehicles"
        subtitle={<>Unified asset register — live Navixy fleet + manually-added plant, tools and containers. <Link to="/app/settings/integrations" className="text-brand-blue hover:underline ml-1">Manage Navixy</Link></>}
        action={
          <div className="flex items-center gap-2">
            <button onClick={load} disabled={refreshing} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 text-sm hover:bg-slate-50 disabled:opacity-50" data-testid="assets-refresh">
              {refreshing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Refresh
            </button>
            {canEdit && (
              <>
                <button onClick={() => setPrintIds(assets.map((a) => a.id))} disabled={!assets.length}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 text-sm hover:bg-slate-50 disabled:opacity-50"
                  data-testid="assets-print-labels">
                  <Printer size={14} /> Print Labels
                </button>
                <button onClick={openCreate}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700"
                  data-testid="assets-add">
                  <Plus size={14} /> Add Asset
                </button>
              </>
            )}
          </div>
        }
      />

      {error && (
        <div className="mb-4 px-3 py-2 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-700" data-testid="assets-error">{error}</div>
      )}

      {/* Phase 3.6 — native Navixy dashboards (Fleet Live / Trips / Technical) */}
      <FleetLiveDashboards />

      {/* Filters */}
      <div className="rounded-2xl border border-slate-200 bg-white p-3 mb-4 space-y-2.5">
        <div className="flex items-center gap-2 flex-wrap">
          {KIND_CHIPS.map((c) => (
            <button key={c.key} onClick={() => setKind(c.key)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${kind === c.key ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}
              data-testid={`assets-kind-${c.key}`}>{c.label}</button>
          ))}
          <div className="ml-auto flex items-center gap-2">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-2.5 text-slate-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)}
                placeholder="Search name, rego, make…"
                className="pl-7 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg w-56"
                data-testid="assets-search" />
            </div>
            <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden text-xs">
              <button onClick={() => setView('list')} data-testid="assets-view-list"
                className={`inline-flex items-center gap-1 px-2.5 py-1.5 ${view === 'list' ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                <ListIcon size={12} /> List
              </button>
              <button onClick={() => setView('map')} data-testid="assets-view-map"
                className={`inline-flex items-center gap-1 px-2.5 py-1.5 ${view === 'map' ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                <MapIcon size={12} /> Map
              </button>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap text-xs">
          <span className="text-slate-500 mr-1">Type:</span>
          <button onClick={() => setAssetType('all')}
            className={`px-2 py-0.5 rounded-full font-semibold border ${assetType === 'all' ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
            data-testid="assets-type-all">All ({data.total})</button>
          {Object.entries(typeCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([t, n]) => (
            <button key={t} onClick={() => setAssetType(t)}
              className={`px-2 py-0.5 rounded-full font-semibold border ${assetType === t ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
              data-testid={`assets-type-${t}`}>
              {fmtType(t)} ({n})
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <div className="text-xs text-slate-500" data-testid="assets-count">{totalSummary}</div>
        </div>

        {!assets.length ? (
          <div className="p-10 text-center" data-testid="assets-empty">
            <div className="inline-flex w-14 h-14 rounded-2xl bg-blue-50 items-center justify-center mb-3"><Truck size={22} className="text-blue-700" /></div>
            <h4 className="font-display text-lg font-semibold">No assets match these filters</h4>
            <p className="mt-1 text-sm text-slate-600">Try clearing filters, or add a manual asset.</p>
          </div>
        ) : view === 'map' ? (
          <FleetMap assets={assets} onPick={setActiveMapAsset} />
        ) : (
          <ul className="divide-y divide-slate-100" data-testid="assets-list">
            {assets.map((a) => (
              <li key={a.id} className="px-4 py-3 flex items-center gap-3 hover:bg-slate-50" data-testid={`asset-${a.id}`}>
                <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                  {a.kind === 'vehicle' ? <Truck size={18} className="text-blue-700" /> : <Tag size={18} className="text-slate-500" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-slate-900 truncate" data-testid={`asset-name-${a.id}`}>{a.name}</span>
                    <span className="text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600" data-testid={`asset-type-${a.id}`}>{fmtType(a.asset_type)}</span>
                    {formCountsByType[a.asset_type] > 0 && (
                      <Link to={`/app/settings/form-assignments?asset_type=${encodeURIComponent(a.asset_type)}`}
                        title={(formNamesByType[a.asset_type] || []).join(' · ')}
                        data-testid={`asset-forms-chip-${a.id}`}
                        className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 hover:bg-slate-200">
                        <ClipboardCheck size={10} /> {formCountsByType[a.asset_type]} forms
                      </Link>
                    )}
                    <SourceBadge asset={a} />
                    <PairingChips asset={a} />
                    {a.status === 'retired' && <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200">Retired</span>}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5 truncate">
                    {a.rego_serial && <span className="font-mono font-semibold text-slate-700 mr-2">{a.rego_serial}</span>}
                    {a.make && `${a.make}${a.model ? ' · ' + a.model : ''}`}
                    {a.year && <span className="ml-1.5">· {a.year}</span>}
                    <span className="ml-2 font-mono text-slate-400">{a.scan_token}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {a.navixy_device_id && (() => {
                    // Phase 3.15 — show the pin whenever an asset is linked to
                    // Navixy. If we don't have a fix yet the button is disabled
                    // but the health dot still tells the operator the device
                    // hasn't reported. Tooltip carries the relative time.
                    const hasPos = a.last_known_lat != null;
                    const health = a.navixy_health;  // 'green' | 'red' | null
                    const seen = a.navixy_last_seen_at
                      ? formatDistanceToNow(parseISO(a.navixy_last_seen_at), { addSuffix: true })
                      : 'never reported';
                    const dotCls = health === 'green' ? 'bg-emerald-500' : 'bg-rose-500';
                    const label = health === 'green'
                      ? `Navixy live · last seen ${seen}`
                      : `Navixy offline · ${a.navixy_last_seen_at ? `last seen ${seen}` : 'never reported'}`;
                    return (
                      <button onClick={() => hasPos && setActiveMapAsset({ ...a, lat: a.last_known_lat, lng: a.last_known_lng, label: a.name, plate: a.rego_serial })}
                        disabled={!hasPos}
                        title={label}
                        className={`relative p-2 rounded-lg ${hasPos ? 'hover:bg-slate-100 text-slate-600' : 'text-slate-400 cursor-default'}`}
                        data-testid={`asset-locate-${a.id}`}>
                        <MapPin size={15} />
                        {health && (
                          <span
                            data-testid={`asset-navixy-health-${a.id}`}
                            data-health={health}
                            className={`absolute bottom-1 right-1 w-2 h-2 rounded-full ring-2 ring-white ${dotCls}`} />
                        )}
                      </button>
                    );
                  })()}
                  <button onClick={() => downloadQr(a)} title="Download QR" className="p-2 rounded-lg hover:bg-slate-100 text-slate-600" data-testid={`asset-qr-${a.id}`}>
                    <QrCode size={15} />
                  </button>
                  {canEdit && (
                    <button onClick={() => setPrintIds([a.id])} title="Print label" className="p-2 rounded-lg hover:bg-slate-100 text-slate-600" data-testid={`asset-label-${a.id}`}>
                      <Printer size={15} />
                    </button>
                  )}
                  {canEdit && (
                    <button onClick={() => openEdit(a)} title="Edit" className="p-2 rounded-lg hover:bg-slate-100 text-slate-600" data-testid={`asset-edit-${a.id}`}>
                      <Edit3 size={15} />
                    </button>
                  )}
                  {canEdit && a.status !== 'retired' && (
                    <button onClick={() => archive(a)} title="Archive" className="p-2 rounded-lg hover:bg-slate-100 text-rose-600" data-testid={`asset-archive-${a.id}`}>
                      <Archive size={15} />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <VehicleMapModal vehicle={activeMapAsset} open={!!activeMapAsset} onClose={() => setActiveMapAsset(null)} />
      {drawerOpen && (
        <AssetDrawer asset={drawerAsset} onClose={() => setDrawerOpen(false)} onSaved={() => { setDrawerOpen(false); load(); }} />
      )}
      {printIds && <PrintLabelsModal assetIds={printIds} onClose={() => setPrintIds(null)} />}
    </div>
  );
}

function FleetMap({ assets, onPick }) {
  const positioned = assets.filter((a) => typeof a.last_known_lat === 'number' && typeof a.last_known_lng === 'number');
  // Phase 3.15 — same green/red treatment as the list-row dots. The Google
  // Maps embed is single-iframe so we can't recolour per-marker; instead we
  // surface a counter strip so operators see the same signal in either view.
  const green = positioned.filter((a) => a.navixy_health === 'green').length;
  const red   = positioned.filter((a) => a.navixy_health === 'red').length;
  if (!positioned.length) {
    return <div className="h-[60vh] flex items-center justify-center text-sm text-slate-500" data-testid="assets-map-empty">No tracked assets have a current GPS position.</div>;
  }
  const avgLat = positioned.reduce((s, a) => s + a.last_known_lat, 0) / positioned.length;
  const avgLng = positioned.reduce((s, a) => s + a.last_known_lng, 0) / positioned.length;
  const src = `https://maps.google.com/maps?q=${avgLat},${avgLng}&z=10&output=embed`;
  return (
    <div data-testid="assets-map">
      <div className="px-4 py-2 text-[11px] text-slate-500 bg-slate-50 border-b border-slate-100 flex items-center gap-3">
        <span>
          Showing area of <strong className="text-slate-700">{positioned.length}</strong> tracked vehicle{positioned.length === 1 ? '' : 's'}.
          Click an asset&apos;s pin icon in List view for the focused view.
        </span>
        <span className="ml-auto inline-flex items-center gap-2">
          <span className="inline-flex items-center gap-1" data-testid="fleet-map-health-green">
            <span className="w-2 h-2 rounded-full bg-emerald-500 ring-2 ring-white" /> {green} live
          </span>
          <span className="inline-flex items-center gap-1" data-testid="fleet-map-health-red">
            <span className="w-2 h-2 rounded-full bg-rose-500 ring-2 ring-white" /> {red} offline
          </span>
        </span>
      </div>
      <div className="h-[60vh]">
        <iframe title="Fleet area" src={src} width="100%" height="100%" style={{ border: 0 }} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
      </div>
    </div>
  );
}
