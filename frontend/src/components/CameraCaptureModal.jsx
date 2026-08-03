// v160.3.9.34.2 — Reusable camera-capture modal.
//
// Requests `getUserMedia({ video: { facingMode } })`, previews the live
// stream in a 512×512 rounded frame, lets the user Capture / Retake /
// Switch camera / Close. On "Use this photo" it emits a JPEG Blob
// (quality 0.85) wrapped as a `File` via `onCapture(file)`.
//
// HARD RULES (v34.2 spec):
//  * Feature-detect `navigator.mediaDevices?.getUserMedia` — parent must
//    also gate the entry button so this modal never renders on unsupported
//    devices, but we defend here too.
//  * Release the MediaStream on every exit path (unmount, close, capture,
//    switch camera). Zero-leak invariant.
//  * Client-side compress to ≤2MB before emitting — quality 0.85 is
//    typically 100-500KB; we guard by re-encoding at 0.7 if the first
//    encode exceeds 2MB.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, RefreshCw, RotateCcw, X, Check, AlertTriangle } from 'lucide-react';

const MAX_BYTES = 2 * 1024 * 1024; // 2MB client-side guard

export default function CameraCaptureModal({ open, onClose, onCapture }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);

  const [facing, setFacing] = useState('user');
  // perm: 'idle' | 'asking' | 'granted' | 'denied' | 'error'
  const [perm, setPerm] = useState('idle');
  const [errMsg, setErrMsg] = useState('');
  const [snapshot, setSnapshot] = useState(null); // { dataUrl, blob }
  const [busy, setBusy] = useState(false);

  // ─── Stream lifecycle ────────────────────────────────────────────────
  const releaseStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => {
        try { t.stop(); } catch { /* noop */ }
      });
      streamRef.current = null;
    }
    if (videoRef.current) {
      try { videoRef.current.srcObject = null; } catch { /* noop */ }
    }
  }, []);

  const startStream = useCallback(async (mode) => {
    setPerm('asking');
    setErrMsg('');
    releaseStream();
    if (!navigator.mediaDevices?.getUserMedia) {
      setPerm('error');
      setErrMsg('Camera API not available in this browser.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: mode },
          width: { ideal: 1024 },
          height: { ideal: 1024 },
        },
      });
      streamRef.current = stream;
      const v = videoRef.current;
      if (!v) {
        // Component unmounted while awaiting permission — bail cleanly.
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      v.srcObject = stream;
      await v.play().catch(() => { /* autoplay may reject silently */ });
      setPerm('granted');
    } catch (e) {
      const name = e?.name || '';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        setPerm('denied');
        setErrMsg('Camera access denied. You can still upload a photo file.');
      } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        setPerm('error');
        setErrMsg('No camera found on this device.');
      } else {
        setPerm('error');
        setErrMsg(`Camera unavailable: ${e?.message || name || 'unknown error'}`);
      }
    }
  }, [releaseStream]);

  // Open → start stream. Close → release. Facing switch → restart.
  useEffect(() => {
    if (!open) {
      releaseStream();
      setSnapshot(null);
      setPerm('idle');
      setErrMsg('');
      return;
    }
    startStream(facing);
    return () => { releaseStream(); };
  }, [open, facing]);

  // Extra safety: on unmount always release.
  useEffect(() => () => { releaseStream(); }, [releaseStream]);

  // ─── Capture / Retake ────────────────────────────────────────────────
  const doCapture = useCallback(async () => {
    const v = videoRef.current;
    const c = canvasRef.current;
    if (!v || !c || v.readyState < 2) return;
    setBusy(true);
    try {
      // Crop to a centre square so the JPEG matches the preview frame.
      const vw = v.videoWidth || 640;
      const vh = v.videoHeight || 480;
      const side = Math.min(vw, vh);
      const sx = Math.floor((vw - side) / 2);
      const sy = Math.floor((vh - side) / 2);
      // Encode at 1024 for headroom; server resizes to 512 anyway.
      const target = 1024;
      c.width = target; c.height = target;
      const ctx = c.getContext('2d');
      // Mirror the front-camera capture so the frozen preview matches
      // what the user was seeing in the (mirrored) live feed.
      if (facing === 'user') {
        ctx.save();
        ctx.translate(target, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(v, sx, sy, side, side, 0, 0, target, target);
        ctx.restore();
      } else {
        ctx.drawImage(v, sx, sy, side, side, 0, 0, target, target);
      }
      let blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.85));
      if (blob && blob.size > MAX_BYTES) {
        // Guard rail — re-encode tighter if for some reason it went large.
        blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.7));
      }
      if (!blob) {
        setErrMsg('Failed to capture frame. Please try again.');
        return;
      }
      const dataUrl = c.toDataURL('image/jpeg', 0.7);
      setSnapshot({ dataUrl, blob });
      // Release stream while previewing — the user may take a while to
      // decide, no need to keep the camera light on.
      releaseStream();
    } finally { setBusy(false); }
  }, [facing, releaseStream]);

  const doRetake = useCallback(() => {
    setSnapshot(null);
    startStream(facing);
  }, [facing, startStream]);

  const doUseThis = useCallback(() => {
    if (!snapshot?.blob) return;
    const filename = `worker-photo-${Date.now()}.jpg`;
    // Wrap the Blob as a File so downstream FormData → multipart carries
    // a filename (some servers 400 without one).
    const file = new File([snapshot.blob], filename, {
      type: 'image/jpeg',
      lastModified: Date.now(),
    });
    onCapture?.(file);
    // Parent closes us via `open=false`.
  }, [snapshot, onCapture]);

  const doSwitchCamera = useCallback(() => {
    setSnapshot(null);
    setFacing((f) => (f === 'user' ? 'environment' : 'user'));
  }, []);

  const doClose = useCallback(() => {
    releaseStream();
    setSnapshot(null);
    onClose?.();
  }, [onClose, releaseStream]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[90] bg-slate-900/70 grid place-items-center p-4"
      data-testid="camera-capture-modal"
      onClick={(e) => e.target === e.currentTarget && doClose()}
    >
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between bg-[#e6eff9]">
          <div className="flex items-center gap-2 text-[#1e4a8c]">
            <Camera size={16} />
            <h3 className="font-display font-bold text-sm uppercase tracking-wider">
              {snapshot ? 'Confirm photo' : 'Take photo'}
            </h3>
          </div>
          <button
            type="button"
            onClick={doClose}
            data-testid="camera-close-btn"
            className="p-1 rounded-md text-slate-500 hover:text-slate-800 hover:bg-white/60"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5">
          <div
            className="relative mx-auto rounded-2xl overflow-hidden bg-slate-900 aspect-square"
            style={{ maxWidth: 384 }}
            data-testid="camera-frame"
          >
            {/* Live preview */}
            {!snapshot && (
              <video
                ref={videoRef}
                muted
                playsInline
                data-testid="camera-video"
                className={`w-full h-full object-cover ${facing === 'user' ? 'scale-x-[-1]' : ''} ${perm === 'granted' ? '' : 'opacity-30'}`}
              />
            )}
            {/* Frozen preview */}
            {snapshot && (
              <img
                src={snapshot.dataUrl}
                alt="Captured preview"
                data-testid="camera-snapshot-preview"
                className="w-full h-full object-cover"
              />
            )}
            {/* Overlay states */}
            {!snapshot && perm !== 'granted' && (
              <div className="absolute inset-0 grid place-items-center px-4 text-center">
                {perm === 'asking' && (
                  <div className="text-white text-xs uppercase tracking-wider inline-flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Requesting camera…
                  </div>
                )}
                {(perm === 'denied' || perm === 'error') && (
                  <div className="text-white text-xs space-y-2" data-testid="camera-error">
                    <AlertTriangle size={20} className="text-amber-300 mx-auto" />
                    <p className="max-w-[240px] leading-snug">{errMsg}</p>
                  </div>
                )}
              </div>
            )}
            {/* Hidden canvas used for the JPEG encode */}
            <canvas ref={canvasRef} className="hidden" />
          </div>

          {/* Helper copy */}
          <p className="mt-3 text-[11px] text-slate-500 text-center leading-snug">
            {snapshot
              ? 'Preview only — nothing has been uploaded yet.'
              : 'Position the worker inside the frame, then Capture.'}
          </p>
        </div>

        {/* Footer actions */}
        <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-2">
          {/* Left cluster: switch camera (only in live mode) */}
          <div>
            {!snapshot && perm === 'granted' && (
              <button
                type="button"
                onClick={doSwitchCamera}
                data-testid="camera-switch-btn"
                title={facing === 'user' ? 'Switch to back camera' : 'Switch to front camera'}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                <RefreshCw size={13} /> Flip
              </button>
            )}
          </div>
          {/* Right cluster: primary actions */}
          <div className="flex items-center gap-2">
            {snapshot ? (
              <>
                <button
                  type="button"
                  onClick={doRetake}
                  data-testid="camera-retake-btn"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <RotateCcw size={13} /> Retake
                </button>
                <button
                  type="button"
                  onClick={doUseThis}
                  data-testid="camera-use-photo-btn"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#1e4a8c] text-white text-sm font-bold hover:bg-[#143263]"
                >
                  <Check size={13} /> Use this photo
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={doCapture}
                disabled={perm !== 'granted' || busy}
                data-testid="camera-capture-btn"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#1e4a8c] text-white text-sm font-bold hover:bg-[#143263] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Camera size={13} /> Capture
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
