// v58.13.132jk — Per-field visual customization popover.
//
// Rendered inside `TemplateBuilder.jsx::FieldEditor` when the admin
// clicks the paint-brush icon. Uses zero third-party colour-picker
// deps — plain HTML `<input type="color">` + hex text sync.
// Popover positions itself relative to the trigger via a fixed
// overlay + right-anchored panel.
//
// Every property is optional; a Reset button wipes the whole object.
// Live-preview at the top mirrors the exact styleWrap logic the
// filler uses so admins see the effect before saving.
import React, { useState, useEffect, useMemo } from 'react';
import { X, RotateCcw, Info } from 'lucide-react';

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

// v58.13.132jk — helpers shared with the filler's inline styleWrap
// logic. Keep in sync with `Forms.jsx` (search "styleWrap" over there).
export function styleToWrapCss(fs = {}) {
  const out = {};
  if (fs.backgroundColor) out.backgroundColor = fs.backgroundColor;
  if (fs.borderColor) out.borderColor = fs.borderColor;
  if (fs.borderWidth !== undefined) {
    out.borderWidth = `${fs.borderWidth}px`;
    out.borderStyle = fs.borderStyle || 'solid';
  } else if (fs.borderStyle) {
    out.borderStyle = fs.borderStyle;
  }
  if (fs.borderRadius !== undefined) out.borderRadius = `${fs.borderRadius}px`;
  if (fs.paddingX !== undefined) {
    out.paddingLeft = `${fs.paddingX}px`;
    out.paddingRight = `${fs.paddingX}px`;
  }
  if (fs.paddingY !== undefined) {
    out.paddingTop = `${fs.paddingY}px`;
    out.paddingBottom = `${fs.paddingY}px`;
  }
  return out;
}

export function styleToLabelCss(fs = {}) {
  const out = {};
  if (fs.labelColor) out.color = fs.labelColor;
  if (fs.labelBold) out.fontWeight = 700;
  if (fs.labelSize === 'sm') out.fontSize = '0.75rem';
  if (fs.labelSize === 'lg') out.fontSize = '1rem';
  return out;
}

function ColorInput({ label, value, onChange, hint, testid }) {
  const [text, setText] = useState(value || '');
  useEffect(() => { setText(value || ''); }, [value]);
  const bad = text && !HEX_RE.test(text);
  return (
    <label className="block text-xs font-medium text-slate-700 space-y-1">
      <span className="flex items-center gap-1">
        {label}
        {hint && <span className="text-[10px] text-slate-400 font-normal">({hint})</span>}
      </span>
      <div className="flex items-stretch gap-1.5">
        <input type="color"
          value={value || '#ffffff'}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="w-8 h-8 rounded-lg border border-slate-300 cursor-pointer"
          data-testid={testid ? `${testid}-picker` : undefined} />
        <input type="text"
          value={text}
          onChange={(e) => {
            const raw = e.target.value.trim();
            setText(raw);
            if (!raw) { onChange(null); return; }
            if (HEX_RE.test(raw)) onChange(raw.toUpperCase());
          }}
          placeholder="#RRGGBB"
          className={`flex-1 min-w-0 px-2 py-1 text-xs font-mono border rounded-lg ${bad ? 'border-rose-500 bg-rose-50' : 'border-slate-300 bg-white'}`}
          data-testid={testid ? `${testid}-hex` : undefined} />
        {value && (
          <button type="button"
            onClick={() => { setText(''); onChange(null); }}
            className="text-[10px] text-slate-500 hover:text-slate-700 underline"
            title="Clear"
            data-testid={testid ? `${testid}-clear` : undefined}>
            clear
          </button>
        )}
      </div>
    </label>
  );
}

function NumInput({ label, value, onChange, min = 0, max = 32, testid, suffix = 'px' }) {
  return (
    <label className="block text-xs font-medium text-slate-700 space-y-1">
      <span>{label}</span>
      <div className="flex items-center gap-1.5">
        <input type="number"
          value={value ?? ''}
          min={min} max={max}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === '') { onChange(undefined); return; }
            const n = parseInt(raw, 10);
            if (Number.isFinite(n)) onChange(Math.max(min, Math.min(max, n)));
          }}
          className="w-16 px-2 py-1 text-xs border border-slate-300 rounded-lg bg-white"
          data-testid={testid} />
        <span className="text-[10px] text-slate-400">{suffix}</span>
        {value !== undefined && value !== null && (
          <button type="button"
            onClick={() => onChange(undefined)}
            className="text-[10px] text-slate-500 hover:text-slate-700 underline">
            clear
          </button>
        )}
      </div>
    </label>
  );
}

export default function FieldStylePopover({ style, onChange, onClose, fieldLabel }) {
  const s = style || {};
  const set = (k, v) => {
    const next = { ...s };
    if (v === undefined || v === null || v === '') {
      delete next[k];
    } else {
      next[k] = v;
    }
    onChange(next);
  };
  const reset = () => onChange({});

  const wrapCss = useMemo(() => styleToWrapCss(s), [s]);
  const labelCss = useMemo(() => styleToLabelCss(s), [s]);
  const iconGlyph = useMemo(() => {
    if (!s.icon) return null;
    if (s.icon.startsWith('emoji:')) return s.icon.slice('emoji:'.length);
    return s.icon;
  }, [s.icon]);

  // Close on Escape.
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[70] bg-slate-900/30 backdrop-blur-[1px] flex items-center justify-center p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      data-testid="field-style-popover">
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-[0.16em] font-semibold text-slate-500">
              Field style
            </div>
            <div className="text-sm font-semibold text-slate-800 truncate">
              {fieldLabel || 'Untitled field'}
            </div>
          </div>
          <button type="button" onClick={reset}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-200"
            data-testid="field-style-reset">
            <RotateCcw size={12} /> Reset
          </button>
          <button type="button" onClick={onClose}
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-200"
            data-testid="field-style-close" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4 overflow-y-auto">
          {/* Live preview */}
          <div className="rounded-xl border border-dashed border-slate-300 p-3 bg-slate-50/60">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">Preview</div>
            <div style={{ borderStyle: 'solid', borderWidth: 1, borderColor: '#e5e7eb', ...wrapCss }}
                 className="rounded-xl p-3 bg-white">
              <div className="flex items-center gap-1.5 mb-1.5" style={labelCss}>
                {iconGlyph && <span aria-hidden>{iconGlyph}</span>}
                <span className="text-sm font-semibold">
                  {fieldLabel || 'Sample field label'}
                </span>
              </div>
              <div className="text-xs" style={s.helpTextColor ? { color: s.helpTextColor } : { color: '#6B7280' }}>
                Preview help text renders here.
              </div>
              <div className="mt-2 h-7 w-full rounded-lg border border-slate-300 bg-white" />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-2">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Colours</div>
              <ColorInput label="Background" testid="fs-bg"
                value={s.backgroundColor}
                onChange={(v) => set('backgroundColor', v)} />
              <ColorInput label="Border" testid="fs-border"
                value={s.borderColor}
                onChange={(v) => set('borderColor', v)} />
              <ColorInput label="Label" testid="fs-label"
                value={s.labelColor}
                onChange={(v) => set('labelColor', v)} />
              <ColorInput label="Help text" testid="fs-help"
                value={s.helpTextColor}
                onChange={(v) => set('helpTextColor', v)} />
              <ColorInput label="Hover background" testid="fs-hover" hint="web only"
                value={s.hoverBackgroundColor}
                onChange={(v) => set('hoverBackgroundColor', v)} />
            </div>

            <div className="space-y-2">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Border &amp; layout</div>
              <NumInput label="Border width" testid="fs-bw"
                value={s.borderWidth} min={0} max={8}
                onChange={(v) => set('borderWidth', v)} />
              <label className="block text-xs font-medium text-slate-700 space-y-1">
                <span>Border style</span>
                <select value={s.borderStyle || ''}
                  onChange={(e) => set('borderStyle', e.target.value || undefined)}
                  className="w-full px-2 py-1 text-xs border border-slate-300 rounded-lg bg-white"
                  data-testid="fs-border-style">
                  <option value="">Default</option>
                  <option value="solid">Solid</option>
                  <option value="dashed">Dashed</option>
                  <option value="dotted">Dotted</option>
                  <option value="none">None</option>
                </select>
              </label>
              <NumInput label="Border radius" testid="fs-br"
                value={s.borderRadius} min={0} max={32}
                onChange={(v) => set('borderRadius', v)} />
              <NumInput label="Padding X" testid="fs-px"
                value={s.paddingX} min={0} max={48}
                onChange={(v) => set('paddingX', v)} />
              <NumInput label="Padding Y" testid="fs-py"
                value={s.paddingY} min={0} max={48}
                onChange={(v) => set('paddingY', v)} />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-2">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Label</div>
              <label className="inline-flex items-center justify-between px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white cursor-pointer w-full">
                <span className="text-slate-700">Bold</span>
                <input type="checkbox" checked={!!s.labelBold}
                  onChange={(e) => set('labelBold', e.target.checked || undefined)}
                  className="w-4 h-4 text-blue-600" data-testid="fs-label-bold" />
              </label>
              <label className="block text-xs font-medium text-slate-700 space-y-1">
                <span>Size</span>
                <select value={s.labelSize || ''}
                  onChange={(e) => set('labelSize', e.target.value || undefined)}
                  className="w-full px-2 py-1 text-xs border border-slate-300 rounded-lg bg-white"
                  data-testid="fs-label-size">
                  <option value="">Default</option>
                  <option value="sm">Small</option>
                  <option value="md">Medium</option>
                  <option value="lg">Large</option>
                </select>
              </label>
            </div>

            <div className="space-y-2">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Icon</div>
              <label className="block text-xs font-medium text-slate-700 space-y-1">
                <span className="flex items-center gap-1">
                  Prefix or emoji
                  <span className="text-[10px] text-slate-400 font-normal">
                    e.g. <code>emoji:⚠️</code> or <code>ion:warning</code>
                  </span>
                </span>
                <div className="flex items-center gap-2">
                  <input type="text" value={s.icon || ''}
                    onChange={(e) => set('icon', e.target.value || undefined)}
                    placeholder="emoji:⚠️"
                    className="flex-1 px-2 py-1 text-xs border border-slate-300 rounded-lg bg-white font-mono"
                    data-testid="fs-icon-input" />
                  <div className="min-w-8 h-8 flex items-center justify-center rounded-lg bg-slate-100 text-lg"
                       data-testid="fs-icon-preview">
                    {iconGlyph || <span className="text-[10px] text-slate-400">—</span>}
                  </div>
                </div>
              </label>
              <div className="text-[10px] text-slate-500 flex items-start gap-1">
                <Info size={11} className="mt-0.5 shrink-0" />
                <span>
                  PDF export renders <code>emoji:</code> icons literally.
                  Non-emoji prefixes render as text (icon libraries only
                  resolve in web + mobile).
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex justify-end">
          <button type="button" onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-slate-900 text-white hover:bg-slate-800"
            data-testid="field-style-done">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
