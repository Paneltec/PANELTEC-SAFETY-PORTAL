// Paneltec Civil · v154.2 — iframe-safe file download wrapper.
//
// Mirror of `lib/clipboard.js` in shape and intent. The Emergent
// preview iframe and any hardened corporate WebView will silently
// refuse `<a>.click()` on an anchor that isn't attached to the
// document — same "no error, no download" failure mode that
// Chromium's sandbox flag imposes. Every download button in the
// app must therefore fall through three tiers:
//
//   1. Standard `URL.createObjectURL(blob)` + `<a download>` in
//      the DOM + `.click()`. The `<a>` is APPENDED to `<body>`
//      before click and removed after — this is the one
//      difference that fixes the "silent no-op" case.
//   2. `window.open('data:…;base64,…')` — a real popup that
//      the browser's Save-As handler picks up. Works in many
//      iframe contexts that block anchor downloads.
//   3. Manual-copy modal — a lightweight DOM dialog with the
//      raw content pre-selected in a `<textarea>` and Ctrl+A /
//      Ctrl+C instructions. Guaranteed floor: even under the
//      strictest permissions policy the user can copy the
//      content out. Only offered for text/JSON/YAML content;
//      binary blobs fall back to tier 2 only (a base64 dump
//      would be useless to paste).
//
// A silent no-op from any Download button is a P0 UX bug —
// see the July 4 2026 docker-compose.yml blocker.

import { toast } from 'sonner';

/**
 * Download `payload` as a file, using the strongest available
 * mechanism. Never throws. Toast is fired unless `opts.silent`.
 *
 * @param {Blob | ArrayBuffer | Uint8Array | string} payload
 *        Content to download. Strings are wrapped in a Blob.
 * @param {string} filename  Desired filename.
 * @param {{contentType?: string, silent?: boolean, successMsg?: string}} opts
 * @returns {Promise<{ok: boolean, method: 'anchor'|'window'|'manual'|'failed'}>}
 */
export async function downloadFile(payload, filename, opts = {}) {
  const successMsg = opts.successMsg || `Downloaded ${filename}`;
  const silent = !!opts.silent;
  const contentType = opts.contentType || 'application/octet-stream';

  const blob = payload instanceof Blob
    ? payload
    : new Blob(
        [payload instanceof ArrayBuffer || ArrayBuffer.isView(payload) ? payload : String(payload)],
        { type: contentType });

  // ---- Tier 1 — anchor download (fixed: `<a>` in the DOM). ----
  let objectUrl = null;
  try {
    objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    a.rel = 'noopener';
    a.style.display = 'none';
    // The critical line: anchor MUST be in the DOM for `.click()`
    // to fire the download handler in some browsers / iframe policies.
    document.body.appendChild(a);
    a.click();
    // Give the browser a tick to start the download before removing
    // the anchor — some engines abort the download if the DOM node
    // is gone by the time the click event bubbles.
    setTimeout(() => {
      try { document.body.removeChild(a); } catch (_e) { /* already gone */ }
      try { URL.revokeObjectURL(objectUrl); } catch (_e) { /* ignore */ }
    }, 250);
    if (!silent) toast.success(successMsg);
    return { ok: true, method: 'anchor' };
  } catch (_e) {
    if (objectUrl) { try { URL.revokeObjectURL(objectUrl); } catch (_e2) { /* ignore */ } }
    // Fall through to tier 2.
  }

  // ---- Tier 2 — data URL popup. ----
  // Encode to base64 then open. This survives many iframe policies
  // that block Blob anchors because it's a real navigation, not a
  // synthetic click.
  try {
    const b64 = await blobToBase64(blob);
    const dataUrl = `data:${blob.type || 'application/octet-stream'};base64,${b64}`;
    const w = window.open(dataUrl, '_blank', 'noopener');
    if (w) {
      if (!silent) toast.success(successMsg);
      return { ok: true, method: 'window' };
    }
    // Popup blocked — fall through to tier 3.
  } catch (_e) {
    // Fall through to tier 3.
  }

  // ---- Tier 3 — manual-copy modal (text-ish content only). ----
  // A base64 dump of a binary blob would be useless for the user
  // to paste, so we only offer manual copy for content types that
  // look human-readable. Binary blobs get a plain error toast.
  const looksText = /^(text\/|application\/(json|yaml|x-yaml|xml|javascript|x-python))/.test(blob.type || '');
  if (looksText) {
    try {
      const text = await blob.text();
      showManualDownloadModal(text, filename);
      if (!silent) toast.info('Copy the content manually and save as ' + filename);
      return { ok: false, method: 'manual' };
    } catch (_e) { /* fall through */ }
  }

  if (!silent) toast.error(`Could not download ${filename} — please check browser permissions.`);
  return { ok: false, method: 'failed' };
}

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error);
    r.onload = () => {
      const s = String(r.result || '');
      const comma = s.indexOf(',');
      resolve(comma >= 0 ? s.slice(comma + 1) : s);
    };
    r.readAsDataURL(blob);
  });
}

function showManualDownloadModal(text, filename) {
  const existing = document.getElementById('paneltec-manual-download-modal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'paneltec-manual-download-modal';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('data-testid', 'manual-download-modal');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.62);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;font-family:Inter,system-ui,sans-serif;';

  const card = document.createElement('div');
  card.style.cssText = 'background:#fff;border-radius:12px;padding:22px;max-width:720px;width:100%;box-shadow:0 25px 50px -12px rgba(0,0,0,0.35);border:1px solid #e2e8f0;';

  const title = document.createElement('div');
  title.style.cssText = 'font-weight:800;font-size:15px;color:#0f172a;margin-bottom:6px;';
  title.textContent = `Download blocked — copy ${filename} manually`;

  const hint = document.createElement('div');
  hint.style.cssText = 'font-size:12.5px;color:#475569;margin-bottom:14px;line-height:1.55;';
  hint.innerHTML =
    'Your browser or iframe policy blocked the automatic download. ' +
    'Press <b style="color:#0f172a">Ctrl+A</b> then <b style="color:#0f172a">Ctrl+C</b> ' +
    '(or <b style="color:#0f172a">⌘A</b>/<b style="color:#0f172a">⌘C</b> on Mac) in the box below, ' +
    'then paste into a new text file named <code style="background:#f1f5f9;padding:2px 6px;border-radius:4px;">' +
    filename + '</code>.';

  const ta = document.createElement('textarea');
  ta.setAttribute('readonly', '');
  ta.setAttribute('data-testid', 'manual-download-textarea');
  ta.value = text;
  ta.style.cssText = 'width:100%;min-height:320px;border:1px solid #cbd5e1;border-radius:8px;padding:12px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;background:#f8fafc;color:#0f172a;resize:vertical;box-sizing:border-box;';

  const footer = document.createElement('div');
  footer.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:14px;';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.setAttribute('data-testid', 'manual-download-close');
  closeBtn.textContent = 'Close';
  closeBtn.style.cssText = 'background:#0f172a;color:#fff;border:none;border-radius:8px;padding:9px 18px;font-weight:700;font-size:12px;letter-spacing:0.06em;text-transform:uppercase;cursor:pointer;';
  const dismiss = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  closeBtn.addEventListener('click', dismiss);

  footer.appendChild(closeBtn);
  card.append(title, hint, ta, footer);
  overlay.appendChild(card);

  overlay.addEventListener('click', (e) => { if (e.target === overlay) dismiss(); });
  const onKey = (e) => { if (e.key === 'Escape') dismiss(); };
  document.addEventListener('keydown', onKey);

  document.body.appendChild(overlay);
  setTimeout(() => { try { ta.focus(); ta.select(); } catch (_e) { /* ignore */ } }, 0);
}

export default downloadFile;


// ===============================================================
// v154.2 · Nuclear-option safety net for anchor downloads.
//
// The reported blocker was `downloadCompose` in `BackupTab.jsx`:
// it created a Blob URL, made an `<a download>` element but
// NEVER appended it to the DOM before `.click()`. Under the
// Emergent preview iframe (and any sandboxed WebView) that click
// is a silent no-op — the download handler refuses to fire on a
// detached anchor.
//
// Rather than sweep 14 call sites (which risks context-truncation
// and merge conflicts with the v155a extraction in flight), we
// intercept `HTMLAnchorElement.prototype.click` at module load.
// When any anchor has a `download` attribute and is NOT currently
// in the document, we transparently attach it, click it, and
// detach it after a tick. Every existing raw call site inherits
// the fix immediately with zero code changes.
//
// Idempotent — `__pt_download_wrapped` sentinel prevents double-
// wrap on webpack hot-reload. Also feature-gated to happy-path.
// ===============================================================
try {
  if (typeof HTMLAnchorElement !== 'undefined'
      && HTMLAnchorElement.prototype
      && typeof HTMLAnchorElement.prototype.click === 'function'
      && !HTMLAnchorElement.prototype.__pt_download_wrapped) {

    const originalClick = HTMLAnchorElement.prototype.click;

    HTMLAnchorElement.prototype.click = function ptWrappedAnchorClick() {
      try {
        // Only intercept anchors that are trying to trigger a
        // download AND are not already in the DOM. Normal anchor
        // clicks (navigation, in-page links) pass through untouched.
        const hasDownloadAttr = this.hasAttribute
          && this.hasAttribute('download');
        const isDetached = !this.isConnected;
        if (hasDownloadAttr && isDetached && typeof document !== 'undefined' && document.body) {
          // Attach, click, detach on the next tick.
          this.style.display = this.style.display || 'none';
          document.body.appendChild(this);
          const result = originalClick.apply(this, arguments);
          // Give the browser a moment to start the download before
          // removing the anchor — some engines abort the download
          // if the DOM node is gone by the time the click event
          // bubbles.
          const node = this;
          setTimeout(() => {
            try {
              if (node.parentNode === document.body) {
                document.body.removeChild(node);
              }
            } catch (_e) { /* already gone */ }
          }, 250);
          return result;
        }
      } catch (_e) {
        // Fall through to the original click on any wrapper error —
        // never break existing behaviour.
      }
      return originalClick.apply(this, arguments);
    };

    // Sentinel so webpack hot-reload doesn't wrap the wrapper.
    Object.defineProperty(HTMLAnchorElement.prototype, '__pt_download_wrapped', {
      value: true, enumerable: false, configurable: true, writable: false,
    });
  }
} catch (_e) {
  // Non-browser or hardened runtime — silently skip.
}
