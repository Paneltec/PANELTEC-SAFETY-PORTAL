/**
 * v58.13.132ie — Archived subfolder shared helpers for worker cert-family panels.
 *
 * The three cert-family tabs (Certifications, Licences, Inductions) all
 * split their row list into:
 *   · active   — `archived_at` is null.
 *   · archived — `archived_at` is set (auto by expiry sweep OR manual).
 *
 * The archived section renders as a collapsed accent-coloured card at
 * the bottom of the tab; open state persists per-worker + per-tab via
 * localStorage under `paneltec:archive:open:<panel>:<workerId>`.
 */
import { useState } from 'react';
import { toast } from 'sonner';
import api, { apiError } from './api';

/**
 * Split rows into { active, archived }. Preserves the parent's sort
 * order within each bucket — callers pre-sort by expiry-tone.
 */
export function splitByArchived(rows) {
  const active = [];
  const archived = [];
  for (const r of rows || []) {
    if (r && r.archived_at) archived.push(r);
    else active.push(r);
  }
  return { active, archived };
}

/** localStorage-persisted collapse state for the Archived accordion. */
export function useArchivedOpen(panel, workerId) {
  const key = `paneltec:archive:open:${panel}:${workerId}`;
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
 * Fire the archive-cert POST + refresh callback. Common wrapper so all
 * three panels share the same toast + error path.
 */
export async function archiveCert(cert, onDone) {
  try {
    await api.post(`/workers/certifications/${cert.id}/archive`);
    toast.success(`${cert.name || 'Certification'} archived`);
    if (onDone) await onDone();
  } catch (e) { toast.error(apiError(e)); }
}

export async function restoreCert(cert, onDone) {
  try {
    await api.post(`/workers/certifications/${cert.id}/restore`);
    toast.success(`${cert.name || 'Certification'} restored`);
    if (onDone) await onDone();
  } catch (e) { toast.error(apiError(e)); }
}
