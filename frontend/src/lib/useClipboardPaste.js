/**
 * v58.13.132gm — Shared `paste`-to-upload hook.
 *
 * Attaches a `paste` listener to `window` and calls `onFiles(File[])`
 * with any clipboard items where `kind === "file"`. Screenshots pasted
 * from the OS clipboard arrive as `image.png` (or `image.<ext>`) with
 * no meaningful filename; we auto-rename those to
 * `Pasted-image-YYYY-MM-DDTHH-MM-SS.<ext>` so they don't collide.
 *
 * The hook only fires when `enabled` is truthy so callers can gate on
 * permission checks, modal-open state, etc. `deps` extend the effect's
 * dep list so the hook re-attaches when the caller's identity for the
 * `onFiles` closure changes (e.g. after a modal target flips).
 *
 * Usage:
 *   useClipboardPaste((files) => uploader(files), enabled, [targetId]);
 *
 * DocumentLibrary.jsx used to inline this same code — extracted here so
 * the Equipment Register modal and Worker "Private & Confidential"
 * panel can share the exact same UX without divergence.
 */
import { useEffect } from 'react';

export default function useClipboardPaste(onFiles, enabled = true, deps = []) {
  useEffect(() => {
    if (!enabled) return undefined;
    const onPaste = (e) => {
      const items = Array.from(e.clipboardData?.items || []);
      const pasted = [];
      for (const it of items) {
        if (it.kind !== 'file') continue;
        const file = it.getAsFile();
        if (!file) continue;
        // Screenshot / anonymous-blob rename.
        if (!file.name
            || file.name === 'image.png'
            || /^image\.\w+$/i.test(file.name)) {
          const ext = (file.type || 'image/png').split('/')[1] || 'png';
          const stamp = new Date().toISOString()
            .replace(/[:.]/g, '-')
            .slice(0, 19);
          pasted.push(new File(
            [file],
            `Pasted-image-${stamp}.${ext}`,
            { type: file.type },
          ));
        } else {
          pasted.push(file);
        }
      }
      if (pasted.length) {
        e.preventDefault();
        onFiles(pasted);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);
}
