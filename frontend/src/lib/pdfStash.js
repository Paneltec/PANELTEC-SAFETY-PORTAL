// Phase 3.13.1 — Inline PDF stash helper.
//
// Some flows (Site QR sheet, Supplier QR sheet, Induction Print) generate a
// PDF on the fly. Historically we wrapped the bytes in `URL.createObjectURL`
// and gave the iframe a `blob:` URL — but ad blockers and privacy extensions
// routinely refuse to load `blob:` URLs (ERR_BLOCKED_BY_CLIENT).
//
// Instead, POST the bytes to `/api/files/inline-pdf` which stashes them
// in-memory and returns a `{stash_id, token}` pair. Combine those into a
// same-origin HTTPS URL the iframe can load like any normal document.
import api, { apiError } from './api';

/**
 * Upload a PDF blob to the inline stash and return a same-origin URL the
 * PdfPreviewModal iframe can render directly.
 *
 * @param {Blob} blob — PDF bytes (axios `responseType: 'blob'` result, or a
 *                       freshly constructed `new Blob([buf], {type:'application/pdf'})`)
 * @param {string} filename — used for Content-Disposition + download button
 * @returns {Promise<{stashId: string, token: string, src: string}>}
 */
export async function stashInlinePdf(blob, filename = 'document.pdf') {
  if (!blob) throw new Error('stashInlinePdf: missing blob');
  try {
    const { data } = await api.post('/files/inline-pdf', blob, {
      headers: {
        'Content-Type': 'application/pdf',
        'X-Filename': filename,
      },
    });
    const src = `${process.env.REACT_APP_BACKEND_URL}/api/files/inline/${data.stash_id}?t=${encodeURIComponent(data.token)}`;
    return { stashId: data.stash_id, token: data.token, src };
  } catch (e) {
    throw new Error(apiError(e) || 'Failed to stash PDF');
  }
}
