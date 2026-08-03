// v160.3.9.34.2 — Reusable image lightbox.
//
// Renders an image at max 90vw × 90vh with `object-fit: contain`.
// Exits on X button, ESC key, or click on the backdrop.
//
// Usage:
//   <ImageLightbox
//     open={open}
//     src={url}
//     alt="Worker photo"
//     title="Aaron Foster · ID card photo"
//     onClose={() => setOpen(false)}
//   />
import React, { useEffect } from 'react';
import { X, ZoomIn } from 'lucide-react';

export default function ImageLightbox({ open, src, alt, title, onClose }) {
  // ESC to close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !src) return null;

  return (
    <div
      className="fixed inset-0 z-[95] bg-black/80 backdrop-blur-sm grid place-items-center p-4"
      data-testid="image-lightbox"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      {/* Top-right close button */}
      <button
        type="button"
        onClick={onClose}
        data-testid="image-lightbox-close"
        aria-label="Close preview"
        className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white grid place-items-center backdrop-blur border border-white/20"
      >
        <X size={18} />
      </button>
      {/* Optional caption in top-left */}
      {title && (
        <div className="absolute top-4 left-4 text-white text-xs uppercase tracking-wider bg-white/10 backdrop-blur border border-white/20 rounded-full px-3 py-1.5 inline-flex items-center gap-1.5">
          <ZoomIn size={12} /> {title}
        </div>
      )}
      {/* The image itself */}
      <img
        src={src}
        alt={alt || ''}
        data-testid="image-lightbox-img"
        className="max-w-[90vw] max-h-[90vh] object-contain rounded-xl shadow-2xl bg-white"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}
