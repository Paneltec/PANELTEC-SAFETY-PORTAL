// AssetScanField — Phase 2 of the Plant & Vehicles backbone.
// Three input modes (segmented control):
//   • QR Camera  (uses BarcodeDetector or jsqr fallback on a hidden <video>)
//   • NFC Tap    (Android Chrome only — NDEFReader.scan())
//   • Manual Pick (debounced search hitting /api/forms/assets/picker)
// On resolve, we call /api/forms/assets/lookup and surface a confirmation card
// before committing back to the FieldRunner. Autofill of dependent fields is
// done by the FieldRunner wrapper (not here) so the engine stays declarative.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera, ScanLine, Smartphone, Search, Loader2, AlertTriangle, Check, X,
  RefreshCw, Truck, Wrench,
} from 'lucide-react';
import { toast } from 'sonner';
import jsQR from 'jsqr';
import api, { apiError } from '../../lib/api';

const PUBLIC_PATH_RE = /\/scan\/([A-Za-z0-9_-]{6,32})$/;

function parseScanToken(payload) {
  if (!payload) return null;
  const trimmed = String(payload).trim();
  // Accept a raw token or a full /scan/{token} URL.
  if (/^[A-Za-z0-9_-]{6,32}$/.test(trimmed)) return trimmed;
  try {
    const u = new URL(trimmed);
    const m = u.pathname.match(PUBLIC_PATH_RE);
    if (m) return m[1];
  } catch { /* not a URL */ }
  const m = trimmed.match(PUBLIC_PATH_RE);
  return m ? m[1] : null;
}

export default function AssetScanField({ field, value, onChange, readOnly }) {
  const cfg = field?.config || {};
  const requireScan = !!cfg.requireScan;
  const kindFilter = cfg.kindFilter || 'any';
  // Capability detection.
  const hasNfc = typeof window !== 'undefined' && 'NDEFReader' in window;
  const hasCamera = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  const hasBarcode = typeof window !== 'undefined' && 'BarcodeDetector' in window;

  // Default to camera if available, else manual.
  const defaultMode = hasCamera ? 'qr' : (hasNfc ? 'nfc' : 'manual');
  const [mode, setMode] = useState(defaultMode);
  const [pending, setPending] = useState(null);     // payload before confirm
  const [resolved, setResolved] = useState(null);   // looked-up asset
  const [resolving, setResolving] = useState(false);
  const [err, setErr] = useState('');

  // ── Persist resolved value when committed ──
  const commit = useCallback((asset, resolved_via) => {
    onChange({
      asset_id: asset.id,
      scan_token: asset.scan_token,
      name: asset.name,
      rego_serial: asset.rego_serial,
      asset_type: asset.asset_type,
      vehicle_type_slug: asset.vehicle_type_slug,
      kind: asset.kind,
      last_known_lat: asset.last_known_lat,
      last_known_lng: asset.last_known_lng,
      resolved_via,
      resolved_at: new Date().toISOString(),
    });
    setResolved(null); setPending(null); setErr('');
  }, [onChange]);

  const lookup = useCallback(async (token, resolved_via) => {
    if (!token) return;
    setResolving(true); setErr('');
    try {
      const { data } = await api.get('/forms/assets/lookup', { params: { token } });
      // We're about to surface a confirmation card. Keep `resolved_via` in
      // local state so the Use button knows it.
      setResolved({ ...data, _resolved_via: resolved_via });
    } catch (e) {
      const code = e?.response?.status;
      setErr(code === 410 ? 'That asset has been retired.' : code === 404 ? 'Unknown scan code. Try again or pick manually.' : apiError(e));
    } finally { setResolving(false); }
  }, []);

  // ── Read-only / already-filled view ──
  if (value?.asset_id && !pending && !resolving) {
    return <ResolvedCard field={field} value={value} readOnly={readOnly} onClear={() => onChange(null)} />;
  }

  return (
    <div className="space-y-2.5" data-testid={`field-${field.id}`}>
      {/* segmented control */}
      <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-0.5 text-xs">
        {hasCamera && (
          <button type="button" onClick={() => setMode('qr')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold ${mode === 'qr' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
            data-testid={`scan-mode-qr-${field.id}`}>
            <ScanLine size={12} /> QR Camera
          </button>
        )}
        {hasNfc && (
          <button type="button" onClick={() => setMode('nfc')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold ${mode === 'nfc' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
            data-testid={`scan-mode-nfc-${field.id}`}>
            <Smartphone size={12} /> NFC Tap
          </button>
        )}
        {!requireScan && (
          <button type="button" onClick={() => setMode('manual')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold ${mode === 'manual' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
            data-testid={`scan-mode-manual-${field.id}`}>
            <Search size={12} /> Manual pick
          </button>
        )}
      </div>
      {!hasNfc && !requireScan && (
        <div className="text-[10px] text-slate-400">NFC tap is unavailable in this browser/device — use the QR camera or manual picker instead.</div>
      )}

      {mode === 'qr' && hasCamera && (
        <QrCameraScanner fieldId={field.id} hasBarcode={hasBarcode}
          onPayload={(p) => { setPending(p); const tok = parseScanToken(p); if (tok) lookup(tok, 'qr'); }} />
      )}
      {mode === 'nfc' && hasNfc && (
        <NfcTapScanner fieldId={field.id}
          onPayload={(p) => { setPending(p); const tok = parseScanToken(p); if (tok) lookup(tok, 'nfc'); }} />
      )}
      {mode === 'manual' && !requireScan && (
        <ManualPicker fieldId={field.id} kindFilter={kindFilter}
          onPicked={(asset) => lookup(asset.scan_token, 'manual')} />
      )}

      {resolving && (
        <div className="text-xs text-slate-500 inline-flex items-center gap-1" data-testid={`scan-resolving-${field.id}`}>
          <Loader2 size={12} className="animate-spin" /> Resolving asset…
        </div>
      )}
      {err && (
        <div className="px-3 py-2 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700 inline-flex items-center gap-1.5" data-testid={`scan-error-${field.id}`}>
          <AlertTriangle size={12} /> {err}
        </div>
      )}
      {resolved && (
        <ConfirmCard fieldId={field.id} asset={resolved}
          onUse={() => commit(resolved, resolved._resolved_via)}
          onAgain={() => { setResolved(null); setPending(null); setErr(''); }} />
      )}
    </div>
  );
}

// ─────────────── confirmation card ───────────────

function ConfirmCard({ fieldId, asset, onUse, onAgain }) {
  return (
    <div className="px-3 py-3 rounded-2xl bg-emerald-50 border-2 border-emerald-300" data-testid={`scan-confirm-${fieldId}`}>
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center shrink-0">
          {asset.kind === 'vehicle' ? <Truck size={18} className="text-emerald-700" /> : <Wrench size={18} className="text-emerald-700" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-wider font-semibold text-emerald-700">
            Resolved · {(asset.kind || '').toUpperCase()} · {(asset.asset_type || '').replace(/_/g, ' ').toUpperCase()}
          </div>
          <div className="font-semibold text-slate-900 truncate">{asset.name}</div>
          {asset.rego_serial && <div className="mt-0.5 inline-block px-2 py-0.5 rounded-md bg-white text-sm font-mono font-bold text-slate-900">{asset.rego_serial}</div>}
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={onUse}
          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700"
          data-testid={`scan-use-${fieldId}`}>
          <Check size={14} /> Use this
        </button>
        <button type="button" onClick={onAgain}
          className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50"
          data-testid={`scan-again-${fieldId}`}>
          <RefreshCw size={14} /> Scan again
        </button>
      </div>
    </div>
  );
}

// ─────────────── locked / resolved view ───────────────

function ResolvedCard({ field, value, onClear, readOnly }) {
  return (
    <div className="px-3 py-2.5 rounded-xl bg-blue-50 border-2 border-blue-200 inline-flex items-center gap-2.5 max-w-full" data-testid={`field-${field.id}`}>
      {value.kind === 'vehicle' ? <Truck size={16} className="text-blue-700 shrink-0" /> : <Wrench size={16} className="text-blue-700 shrink-0" />}
      <div className="min-w-0">
        <div className="font-semibold text-slate-900 truncate">{value.name}</div>
        <div className="text-[11px] text-slate-500">
          <span className="font-mono font-semibold text-slate-800">{value.rego_serial || '—'}</span>
          <span className="ml-2 uppercase tracking-wider">{(value.asset_type || '').replace(/_/g, ' ')}</span>
          {value.resolved_via && <span className="ml-2 text-slate-400">via {value.resolved_via}</span>}
        </div>
      </div>
      {!readOnly && (
        <button type="button" onClick={onClear}
          className="ml-2 p-1.5 rounded-lg hover:bg-blue-100 text-slate-600"
          data-testid={`scan-clear-${field.id}`} title="Clear / scan again">
          <X size={14} />
        </button>
      )}
    </div>
  );
}

// ─────────────── QR camera scanner ───────────────

function QrCameraScanner({ fieldId, hasBarcode, onPayload }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const rafRef = useRef(0);
  const streamRef = useRef(null);
  const detectorRef = useRef(null);
  const [running, setRunning] = useState(false);
  const [perm, setPerm] = useState('idle');

  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setRunning(false);
  }, []);

  const start = useCallback(async () => {
    setPerm('asking');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
      });
      streamRef.current = stream;
      const v = videoRef.current;
      if (!v) return;
      v.srcObject = stream;
      await v.play();
      setRunning(true); setPerm('granted');
      if (hasBarcode && !detectorRef.current) {
        // eslint-disable-next-line no-undef
        detectorRef.current = new BarcodeDetector({ formats: ['qr_code'] });
      }
      const tick = async () => {
        if (!streamRef.current) return;
        if (v.readyState >= 2) {
          let payload = null;
          try {
            if (detectorRef.current) {
              const r = await detectorRef.current.detect(v);
              if (r && r[0]?.rawValue) payload = r[0].rawValue;
            } else {
              // jsqr fallback
              const canvas = canvasRef.current;
              const w = v.videoWidth, h = v.videoHeight;
              if (canvas && w && h) {
                canvas.width = w; canvas.height = h;
                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                ctx.drawImage(v, 0, 0, w, h);
                const data = ctx.getImageData(0, 0, w, h);
                const r = jsQR(data.data, w, h, { inversionAttempts: 'attemptBoth' });
                if (r?.data) payload = r.data;
              }
            }
          } catch { /* keep scanning */ }
          if (payload) {
            stop();
            onPayload(payload);
            return;
          }
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (e) {
      setPerm('denied');
      toast.error(`Camera unavailable: ${e?.message || e}`);
    }
  }, [hasBarcode, onPayload, stop]);

  useEffect(() => () => stop(), [stop]);

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3" data-testid={`scan-qr-${fieldId}`}>
      <div className="relative aspect-video rounded-xl overflow-hidden bg-slate-900 flex items-center justify-center">
        <video ref={videoRef} muted playsInline className={`w-full h-full object-cover ${running ? '' : 'opacity-40'}`} />
        <canvas ref={canvasRef} className="hidden" />
        {!running && (
          <button type="button" onClick={start}
            className="absolute inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/95 text-slate-900 text-sm font-bold shadow-lg"
            data-testid={`scan-start-${fieldId}`}>
            <Camera size={14} /> Start camera
          </button>
        )}
        {running && (
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            <div className="w-48 h-48 border-2 border-emerald-300 rounded-2xl shadow-[0_0_0_9999px_rgba(15,23,42,0.45)]" />
          </div>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-slate-500">
        <span>{running ? 'Point at the QR label on the asset' : perm === 'denied' ? 'Camera permission was denied.' : 'Click Start camera to begin scanning'}</span>
        {running && (
          <button type="button" onClick={stop}
            className="px-2 py-1 rounded-md border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50"
            data-testid={`scan-stop-${fieldId}`}>Stop</button>
        )}
      </div>
    </div>
  );
}

// ─────────────── NFC tap scanner ───────────────

function NfcTapScanner({ fieldId, onPayload }) {
  const [scanning, setScanning] = useState(false);
  const ctrlRef = useRef(null);
  const stop = useCallback(() => {
    try { ctrlRef.current?.abort(); } catch { /* ignore */ }
    ctrlRef.current = null;
    setScanning(false);
  }, []);
  const start = useCallback(async () => {
    setScanning(true);
    try {
      // eslint-disable-next-line no-undef
      const reader = new NDEFReader();
      const ctrl = new AbortController();
      ctrlRef.current = ctrl;
      await reader.scan({ signal: ctrl.signal });
      reader.onreading = (event) => {
        for (const rec of event.message.records || []) {
          if (rec.recordType === 'url') {
            const dec = new TextDecoder();
            const text = dec.decode(rec.data);
            stop();
            onPayload(text);
            return;
          }
        }
      };
    } catch (e) {
      toast.error(`NFC error: ${e?.message || e}`);
      stop();
    }
  }, [onPayload, stop]);

  useEffect(() => () => stop(), [stop]);

  return (
    <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4 text-center" data-testid={`scan-nfc-${fieldId}`}>
      <div className={`mx-auto w-14 h-14 rounded-full bg-white flex items-center justify-center ${scanning ? 'animate-pulse' : ''}`}>
        <Smartphone size={22} className="text-violet-700" />
      </div>
      <div className="mt-2 text-sm font-semibold text-violet-900">{scanning ? 'Tap the NFC tag against your phone…' : 'Press start, then tap the tag'}</div>
      <div className="mt-2 flex justify-center gap-2">
        {!scanning ? (
          <button type="button" onClick={start}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-violet-600 text-white text-sm font-semibold"
            data-testid={`scan-nfc-start-${fieldId}`}>
            <Smartphone size={14} /> Start NFC
          </button>
        ) : (
          <button type="button" onClick={stop}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-700"
            data-testid={`scan-nfc-stop-${fieldId}`}>Stop</button>
        )}
      </div>
    </div>
  );
}

// ─────────────── manual picker ───────────────

function ManualPicker({ fieldId, kindFilter, onPicked }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const { data } = await api.get('/forms/assets/picker', {
          params: { q: q || undefined, kind: kindFilter === 'any' ? undefined : kindFilter, limit: 50 },
        });
        if (alive) setRows(data.assets || []);
      } catch (e) {
        if (alive) toast.error(apiError(e));
      } finally { if (alive) setBusy(false); }
    }, q ? 250 : 0);
    return () => { alive = false; clearTimeout(t); };
  }, [q, kindFilter]);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white" data-testid={`scan-manual-${fieldId}`}>
      <div className="px-3 py-2 border-b border-slate-100 flex items-center gap-2">
        <Search size={13} className="text-slate-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name, rego, serial…"
          className="flex-1 text-sm bg-transparent outline-none"
          data-testid={`scan-manual-search-${fieldId}`} />
        {busy && <Loader2 size={12} className="animate-spin text-slate-400" />}
      </div>
      <div className="max-h-60 overflow-y-auto divide-y divide-slate-100">
        {rows.length === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-slate-500 italic">{busy ? 'Searching…' : 'No assets match.'}</div>
        ) : rows.map((a) => (
          <button key={a.id} type="button"
            onClick={() => onPicked(a)}
            data-testid={`scan-manual-opt-${a.id}`}
            className="w-full px-3 py-2.5 text-left hover:bg-blue-50 flex items-center gap-2">
            {a.kind === 'vehicle' ? <Truck size={13} className="text-slate-400" /> : <Wrench size={13} className="text-slate-400" />}
            <span className="font-semibold text-sm text-slate-900 truncate">{a.name}</span>
            {a.rego_serial && <span className="ml-auto text-xs font-mono font-semibold text-slate-700">{a.rego_serial}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─────────────── helper for dependent autofill ───────────────

/**
 * Given a template's field list and the asset payload returned by the
 * lookup endpoint, return a values map (keyed by field.id) of dependent
 * fields that should be auto-filled. The FieldRunner wrapper applies
 * this on top of the current values map.
 */
export function buildAutofillFromAsset(allFields, asset, options = {}) {
  if (!asset || !Array.isArray(allFields)) return {};
  const targets = options.autofillTargets;
  const wants = (label, types = []) => {
    const target = allFields.find((f) => {
      const lbl = (f.label || '').toLowerCase();
      const lblHits = label.some((kw) => lbl.includes(kw));
      const typeHits = types.length === 0 || types.includes(f.type);
      const targetSelected = !targets || targets.length === 0 || targets.includes(f.id);
      return lblHits && typeHits && targetSelected;
    });
    return target || null;
  };
  const out = {};
  // vehicle_type select
  const vt = wants(['vehicle type', 'plant type', 'equipment type'], ['select']);
  if (vt && asset.vehicle_type_slug) {
    const v = asset.vehicle_type_slug;
    // Try to find a matching option case-insensitively.
    const opts = (vt.options || []).map((o) => o);
    const found = opts.find((o) => o && o.toLowerCase().replace(/[\s_-]+/g, '') === v.replace(/[_]/g, ''));
    if (found) out[vt.id] = found;
  }
  // rego / vehicle rego text field
  const rego = wants(['vehicle rego', 'rego', 'serial'], ['text', 'vehicle_navixy']);
  if (rego && asset.rego_serial) {
    if (rego.type === 'vehicle_navixy') {
      out[rego.id] = {
        navixy_id: asset.navixy_device_id || null,
        label: asset.name, registration: asset.rego_serial,
      };
    } else {
      out[rego.id] = asset.rego_serial;
    }
  }
  // GPS
  const gps = allFields.find((f) => f.type === 'gps');
  if (gps && asset.last_known_lat != null && asset.last_known_lng != null) {
    out[gps.id] = { lat: asset.last_known_lat, lng: asset.last_known_lng, at: new Date().toISOString() };
  }
  // Odometer / hours
  const odo = wants(['odometer', 'odo', 'kilometres'], ['number']);
  if (odo && asset.odo_km != null) out[odo.id] = String(asset.odo_km);
  const hrs = wants(['hours', 'hour meter'], ['number']);
  if (hrs && asset.hours_meter != null) out[hrs.id] = String(asset.hours_meter);
  return out;
}
