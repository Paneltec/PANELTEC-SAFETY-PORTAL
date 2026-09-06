// v160.0.8.1 — HTML5 canvas signature pad for Expo Web.
// react-native-signature-canvas relies on react-native-webview, which
// does NOT support the web target (renders a red "React Native WebView
// does not support this platform" message). This component provides a
// pointer-driven canvas fallback that returns a base64 PNG data URL via
// `onSave`, matching the interface of SignatureScreen so the calling
// screen doesn't need to know which platform it's on.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Colors } from '../lib/colors';

type Props = {
  onSave: (dataUrl: string) => void;
  onClose: () => void;
};

export default function SignaturePadWeb({ onSave, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const hasStrokeRef = useRef(false);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Retina-safe sizing.
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = Colors.imConcrete;
    // Prime an off-white bg so the PNG has proper background.
    ctx.fillStyle = Colors.imSurface;
    ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.strokeStyle = Colors.imInk;
  }, []);

  const pointerFrom = (e: any) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const clientX = e.clientX ?? (e.touches && e.touches[0]?.clientX) ?? 0;
    const clientY = e.clientY ?? (e.touches && e.touches[0]?.clientY) ?? 0;
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const start = (e: any) => {
    e.preventDefault?.();
    drawingRef.current = true;
    lastPointRef.current = pointerFrom(e);
  };
  const move = (e: any) => {
    if (!drawingRef.current) return;
    e.preventDefault?.();
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const last = lastPointRef.current;
    const next = pointerFrom(e);
    if (last) {
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(next.x, next.y);
      ctx.stroke();
      hasStrokeRef.current = true;
      if (empty) setEmpty(false);
    }
    lastPointRef.current = next;
  };
  const end = (e: any) => {
    e?.preventDefault?.();
    drawingRef.current = false;
    lastPointRef.current = null;
  };

  const clear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    ctx.fillStyle = Colors.imSurface;
    ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.strokeStyle = Colors.imInk;
    hasStrokeRef.current = false;
    setEmpty(true);
  };
  const save = () => {
    if (!hasStrokeRef.current) return;
    const dataUrl = canvasRef.current?.toDataURL('image/png');
    if (dataUrl) onSave(dataUrl);
  };

  // On web, `View` compiles to a `<div>`, so we can safely nest a raw
  // `<canvas>` via React.createElement.
  const canvasEl = React.createElement('canvas', {
    ref: canvasRef,
    style: {
      width: '100%',
      height: '100%',
      display: 'block',
      backgroundColor: Colors.imSurface,
      borderRadius: 12,
      touchAction: 'none',
      cursor: 'crosshair',
    },
    onMouseDown: start,
    onMouseMove: move,
    onMouseUp: end,
    onMouseLeave: end,
    onTouchStart: start,
    onTouchMove: move,
    onTouchEnd: end,
    'data-testid': 'sig-canvas-web',
  });

  return (
    <View style={sp.wrap}>
      <View style={sp.canvasBox}>{canvasEl as any}</View>
      <View style={sp.actions}>
        <TouchableOpacity
          testID="sig-clear-web"
          style={[sp.btn, sp.btnGhost]}
          onPress={clear}
        >
          <Text style={sp.btnGhostText}>Clear</Text>
        </TouchableOpacity>
        <TouchableOpacity
          testID="sig-save-web"
          style={[sp.btn, sp.btnPrimary, empty && sp.btnDisabled]}
          onPress={save}
          disabled={empty}
        >
          <Text style={sp.btnPrimaryText}>Save signature</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const sp = StyleSheet.create({
  wrap: { flex: 1, padding: 16, gap: 12, backgroundColor: Colors.surface },
  canvasBox: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.imSurface,
    overflow: 'hidden',
  },
  actions: { flexDirection: 'row', gap: 10 },
  btn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnGhost: {
    backgroundColor: Colors.surfaceLight,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  btnGhostText: { color: Colors.textSecondary, fontWeight: '600', fontSize: 14 },
  btnPrimary: { backgroundColor: Colors.orange },
  btnPrimaryText: { color: Colors.imSurface, fontWeight: '700', fontSize: 14 },
  btnDisabled: { opacity: 0.4 },
});
