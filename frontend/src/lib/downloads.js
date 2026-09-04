// v58.13.105 — Shared bearer-authed file opener.
//
// Extracted from AuditExports.jsx (.103) so every download surface can
// call the same helper. Root cause the helper exists at all:
// bearer-gated file endpoints served through `/api/files/…` return 401
// when opened via a plain `<a href={BACKEND + file_url} target="_blank">`
// because the browser strips the Authorization header on plain
// navigations. Solution: pull the file through axios (bearer auto-
// attached) as a Blob, hand the browser a `URL.createObjectURL()`, open
// that in a new tab, revoke after 60s.
//
// Popup-blocked fallback: synthetic `<a download>` click. Object URL
// is always revoked after 60s so long-running sessions don't leak blobs.
import api, { apiError } from './api';
import { toast } from 'sonner';

/**
 * @param {string} fileUrl     Absolute or /api-prefixed path. The
 *                             leading `/api` is stripped before handing
 *                             to axios (which re-adds it via baseURL).
 * @param {string} [filename]  Suggested download name; also drives the
 *                             MIME fallback for PDFs.
 * @param {object} [opts]
 * @param {'blob'|'download'} [opts.mode='blob']  'blob' opens in a new tab
 *                             (default — the .103 behaviour). 'download'
 *                             forces a save-as via a synthetic <a download>.
 */
export async function openAuthedFile(fileUrl, filename, opts = {}) {
  const mode = opts.mode || 'blob';
  try {
    const path = String(fileUrl || '').replace(/^\/api/, '');
    const r = await api.get(path, { responseType: 'blob' });
    const nameLower = (filename || '').toLowerCase();
    const mime = nameLower.endsWith('.pdf')
      ? 'application/pdf'
      : (r.headers?.['content-type'] || 'application/octet-stream');
    const blob = new Blob([r.data], { type: mime });
    const url = URL.createObjectURL(blob);
    if (mode === 'download') {
      const a = document.createElement('a');
      a.href = url; a.download = filename || 'download';
      document.body.appendChild(a); a.click(); a.remove();
    } else {
      const win = window.open(url, '_blank', 'noopener,noreferrer');
      if (!win) {
        // Popup blocked — degrade gracefully to a forced download.
        const a = document.createElement('a');
        a.href = url; a.download = filename || 'download';
        document.body.appendChild(a); a.click(); a.remove();
      }
    }
    setTimeout(() => { try { URL.revokeObjectURL(url); } catch { /* ignore */ } }, 60_000);
  } catch (e) {
    toast.error(apiError(e) || 'Could not open file');
  }
}
