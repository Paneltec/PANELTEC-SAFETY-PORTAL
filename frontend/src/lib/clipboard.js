// Paneltec Civil · v154 — iframe-safe clipboard wrapper.
//
// The Emergent preview iframe applies a Permissions-Policy that
// blocks `navigator.clipboard.writeText` with:
//
//   Failed to execute 'writeText' on 'Clipboard':
//   The Clipboard API has been blocked because of a permissions
//   policy applied to the current document.
//
// Same failure mode appears in any hardened corporate iframe host
// (Sharepoint embeds, some MDM-managed WebViews). Every Copy
// button in the app must therefore fall through three tiers:
//
//   1. `navigator.clipboard.writeText` — the modern async API.
//      Fails silently on Permissions-Policy blocks and in non-
//      secure contexts.
//   2. `document.execCommand('copy')` on a hidden textarea. The
//      deprecated legacy path, but usually survives the same
//      Permissions-Policy that blocks the async API because it
//      runs synchronously in the user gesture handler.
//   3. Manual-select modal — a lightweight DOM dialog with the
//      text pre-selected in a <textarea>. Guaranteed escape hatch:
//      even if both write paths are blocked, the user can always
//      hit Ctrl+C / ⌘C on the highlighted text.
//
// Uncaught runtime errors from a Copy click are considered a
// P0 UX bug — see the July 4 2026 agent-token blocker.

import { toast } from 'sonner';

/**
 * Copy `text` to the clipboard using the strongest available
 * mechanism. Never throws. Toast is fired unless `opts.silent`.
 *
 * @param {string} text
 * @param {{successMsg?: string, silent?: boolean}} opts
 * @returns {Promise<{ok: boolean, method: 'async'|'execCommand'|'manual'|'failed'}>}
 */
export async function copyToClipboard(text, opts = {}) {
  const successMsg = opts.successMsg || 'Copied to clipboard';
  const silent = !!opts.silent;
  const value = text == null ? '' : String(text);

  // Tier 1 — modern async Clipboard API. Requires secure context
  // AND the current document to not be blocked by a permissions
  // policy. Both conditions are common failure points in iframes.
  try {
    if (navigator?.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      if (!silent) toast.success(successMsg);
      return { ok: true, method: 'async' };
    }
  } catch (_e) {
    // NotAllowedError / SecurityError / permissions policy —
    // fall through to tier 2.
  }

  // Tier 2 — deprecated but iframe-friendly execCommand path.
  try {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.setAttribute('readonly', '');
    // Off-screen but focusable + selectable.
    ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); }
    catch (_e2) { ok = false; }
    document.body.removeChild(ta);
    if (ok) {
      if (!silent) toast.success(successMsg);
      return { ok: true, method: 'execCommand' };
    }
  } catch (_e) {
    // Fall through to manual modal.
  }

  // Tier 3 — manual-select modal (guaranteed escape hatch).
  try {
    showManualCopyModal(value);
    if (!silent) toast.info('Select and copy manually');
    return { ok: false, method: 'manual' };
  } catch (_e) {
    if (!silent) toast.error('Could not copy — please select the text manually.');
    return { ok: false, method: 'failed' };
  }
}

// ---------------------------------------------------------------
// Manual-select modal — vanilla DOM so any call site can trigger
// it without importing / mounting React. Uses inline styles to
// dodge any missing Tailwind context (e.g. errors during app
// bootstrap). Test IDs so Playwright can drive the flow.
// ---------------------------------------------------------------
function showManualCopyModal(text) {
  // Only one modal at a time.
  const existing = document.getElementById('paneltec-manual-copy-modal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'paneltec-manual-copy-modal';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('data-testid', 'manual-copy-modal');
  overlay.style.cssText = [
    'position:fixed', 'inset:0', 'background:rgba(15,23,42,0.62)',
    'z-index:99999', 'display:flex', 'align-items:center',
    'justify-content:center', 'padding:16px',
    'font-family:Inter,system-ui,sans-serif',
  ].join(';');

  const card = document.createElement('div');
  card.style.cssText = [
    'background:#fff', 'border-radius:12px', 'padding:22px',
    'max-width:560px', 'width:100%',
    'box-shadow:0 25px 50px -12px rgba(0,0,0,0.35)',
    'border:1px solid #e2e8f0',
  ].join(';');

  const title = document.createElement('div');
  title.style.cssText = 'font-weight:800;font-size:15px;color:#0f172a;margin-bottom:6px;';
  title.textContent = 'Copy manually';

  const hint = document.createElement('div');
  hint.style.cssText = 'font-size:12.5px;color:#475569;margin-bottom:14px;line-height:1.55;';
  hint.innerHTML =
    'Your browser blocked automatic copy. Press <b style="color:#0f172a">Ctrl+C</b> ' +
    '(or <b style="color:#0f172a">⌘C</b> on Mac) to copy the highlighted text below, then close.';

  const ta = document.createElement('textarea');
  ta.setAttribute('readonly', '');
  ta.setAttribute('data-testid', 'manual-copy-textarea');
  ta.value = text;
  ta.style.cssText = [
    'width:100%', 'min-height:110px', 'border:1px solid #cbd5e1',
    'border-radius:8px', 'padding:12px',
    'font-family:ui-monospace,SFMono-Regular,Menlo,monospace',
    'font-size:12px', 'background:#f8fafc', 'color:#0f172a',
    'resize:vertical', 'box-sizing:border-box',
  ].join(';');

  const footer = document.createElement('div');
  footer.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:14px;';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.setAttribute('data-testid', 'manual-copy-close');
  closeBtn.textContent = 'Close';
  closeBtn.style.cssText = [
    'background:#0f172a', 'color:#fff', 'border:none',
    'border-radius:8px', 'padding:9px 18px',
    'font-weight:700', 'font-size:12px', 'letter-spacing:0.06em',
    'text-transform:uppercase', 'cursor:pointer',
  ].join(';');
  const dismiss = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  closeBtn.addEventListener('click', dismiss);

  footer.appendChild(closeBtn);
  card.append(title, hint, ta, footer);
  overlay.appendChild(card);

  // Click outside dismisses.
  overlay.addEventListener('click', (e) => { if (e.target === overlay) dismiss(); });

  // Escape dismisses.
  const onKey = (e) => { if (e.key === 'Escape') dismiss(); };
  document.addEventListener('keydown', onKey);

  document.body.appendChild(overlay);

  // Preselect on next tick so the browser has laid out the textarea.
  // Some browsers permit an in-gesture execCommand('copy') at this
  // point; even if not, the text is highlighted and Ctrl+C works.
  setTimeout(() => {
    try { ta.focus(); ta.select(); } catch (_e) { /* ignore */ }
  }, 0);
}

export default copyToClipboard;
