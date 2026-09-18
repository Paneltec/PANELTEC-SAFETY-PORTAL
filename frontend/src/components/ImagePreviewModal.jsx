/**
 * v58.13.132ih — Image preview modal (lightbox).
 *
 * Minimal, keyboard-accessible full-size preview for a single image.
 * Accepts either a `url` (persisted server-side, already reachable
 * via GET) OR a `File` (staged client-side, previewed via a temporary
 * ObjectURL). Callers must not pass both.
 *
 * ESC + backdrop click close. `alt` falls back to "Image preview" so
 * screen readers announce something.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';

export default function ImagePreviewModal({ url, file, alt, onClose }) {
  // Build a stable object URL for staged Files; revoke on unmount.
  const objUrl = useMemo(() => {
    if (!file) return null;
    try { return URL.createObjectURL(file); } catch { return null; }
  }, [file]);
  useEffect(() => () => { if (objUrl) URL.revokeObjectURL(objUrl); }, [objUrl]);

  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const src = url || objUrl || '';

  return (
    <div
      role="dialog"
      aria-modal="true"
      data-testid="image-preview-modal"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div className="relative max-w-5xl max-h-full">
        <button
          type="button"
          onClick={onClose}
          data-testid="image-preview-close"
          aria-label="Close preview"
          className="absolute -top-3 -right-3 w-9 h-9 rounded-full bg-white text-slate-700 shadow-lg hover:bg-slate-100 flex items-center justify-center"
        >
          <X size={16} />
        </button>
        {src ? (
          <img
            src={src}
            alt={alt || 'Image preview'}
            onLoad={() => setLoaded(true)}
            data-testid="image-preview-img"
            className={
              'block max-w-[90vw] max-h-[85vh] rounded-lg shadow-2xl bg-slate-100 ' +
              (loaded ? 'opacity-100' : 'opacity-0 transition-opacity')
            }
          />
        ) : (
          <p className="text-sm text-white">No image to preview.</p>
        )}
      </div>
    </div>
  );
}
