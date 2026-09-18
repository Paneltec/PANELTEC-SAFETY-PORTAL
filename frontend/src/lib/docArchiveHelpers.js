/**
 * v58.13.132if — Archived subfolder shared helpers for document panels.
 *
 * Extends the `.132ie` cert-family archive pattern to:
 *   · HR Documents (Private & Confidential) — `worker_hr_documents`
 *   · Discovered Documents — `worker_unmatched_documents`
 *   · Compliance folders (Doc Library) — `doc_files`
 *
 * The three surfaces share the same UX contract:
 *   · Active docs render in the main list.
 *   · Archived docs render in a collapsible bottom drawer.
 *   · Per-doc Archive / Restore actions on every row.
 *
 * Open state persists per-panel + per-scope in localStorage under
 * `paneltec:archive:open:<panel>:<scopeId>`.
 */
import { useState } from 'react';
import { toast } from 'sonner';
import api, { apiError } from './api';

/**
 * Split rows into { active, archived }. Preserves the parent's sort
 * order within each bucket — callers pre-sort by expiry / uploaded_at.
 */
export function splitDocsByArchived(rows) {
  const active = [];
  const archived = [];
  for (const r of rows || []) {
    if (r && r.archived_at) archived.push(r);
    else active.push(r);
  }
  return { active, archived };
}

/** localStorage-persisted collapse state for the Archived accordion. */
export function useDocArchivedOpen(panel, scopeId) {
  const key = `paneltec:archive:open:${panel}:${scopeId}`;
  const [open, setOpen] = useState(() => {
    try {
      const raw = window.localStorage.getItem(key);
      return raw === '1';   // default CLOSED — archived is a bottom drawer.
    } catch (_) { return false; }
  });
  const toggle = () => {
    setOpen((prev) => {
      const next = !prev;
      try { window.localStorage.setItem(key, next ? '1' : '0'); } catch (_) { /* quota */ }
      return next;
    });
  };
  return [open, toggle];
}

/**
 * Generic archive helper. Fires POST to `archiveUrl`, toasts, refreshes.
 * Wrapping the three surfaces (HR / Unmatched / Doc Library) so all
 * panels share the same error path.
 */
export async function archiveDoc({ archiveUrl, label, onDone }) {
  try {
    await api.post(archiveUrl);
    toast.success(`${label || 'Document'} archived`);
    if (onDone) await onDone();
  } catch (e) { toast.error(apiError(e)); }
}

export async function restoreDoc({ restoreUrl, label, onDone }) {
  try {
    await api.post(restoreUrl);
    toast.success(`${label || 'Document'} restored`);
    if (onDone) await onDone();
  } catch (e) { toast.error(apiError(e)); }
}
