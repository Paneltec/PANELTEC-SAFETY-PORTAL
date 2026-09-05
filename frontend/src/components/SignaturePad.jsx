// v58.13.121 — Shared signature pad extracted from Forms.jsx's inline
// SignatureField. Same pen colour, same responsive sizing pattern.
// Adds an aria-label prop so accessibility tools announce the pad's
// purpose. Consumers pass `value` (data URL) + `onChange(dataUrlOrNull)`.
import React, { useEffect, useRef, useState } from 'react';
import { Eraser } from 'lucide-react';
import SignatureCanvas from 'react-signature-canvas';

export default function SignaturePad({
  value,
  onChange,
  ariaLabel = 'Signature capture area',
  testId,
  disabled = false,
}) {
  const padRef = useRef(null);
  const wrapRef = useRef(null);
  const [size, setSize] = useState({ w: 400, h: 150 });

  useEffect(() => {
    const update = () => {
      if (!wrapRef.current) return;
      const w = Math.min(wrapRef.current.clientWidth, 600);
      setSize({ w, h: Math.max(140, Math.min(180, Math.round(w * 0.4))) });
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  useEffect(() => {
    if (value && padRef.current && padRef.current.isEmpty()) {
      try { padRef.current.fromDataURL(value); } catch { /* ignore */ }
    }
  }, [value]);

  const clear = () => { padRef.current?.clear(); onChange(null); };
  const onEnd = () => {
    if (padRef.current && !padRef.current.isEmpty()) {
      onChange(padRef.current.toDataURL('image/png'));
    }
  };

  if (disabled) {
    return value
      ? <img src={value} alt={ariaLabel}
             className="border border-slate-200 rounded-lg max-h-32 bg-white" />
      : <div className="text-xs text-slate-400 italic">{ariaLabel} (read-only)</div>;
  }

  return (
    <div className="space-y-2" ref={wrapRef} data-testid={testId}>
      <div className="rounded-xl border border-slate-300 bg-white overflow-hidden"
           role="img" aria-label={ariaLabel}>
        <SignatureCanvas
          ref={padRef}
          penColor="#0f172a"
          canvasProps={{
            width: size.w,
            height: size.h,
            className: 'block w-full touch-none',
            'aria-label': ariaLabel,
            'data-testid': testId ? `${testId}-canvas` : undefined,
          }}
          onEnd={onEnd}
        />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-slate-500">
          Sign with your finger or mouse.
        </span>
        <button type="button" onClick={clear}
          data-testid={testId ? `${testId}-clear` : undefined}
          className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-rose-700 px-2 py-1">
          <Eraser size={12} /> Clear
        </button>
      </div>
    </div>
  );
}
