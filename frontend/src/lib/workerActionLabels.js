/**
 * v58.13.132gu Phase 2.5 — Workers "Inactive" → "Archive" wording
 * rename.
 *
 * Frontend-only display translation for `archive_audit` rows tied
 * to the Workers module. The DB `action` codes are deliberately
 * unchanged — historical rows keep `soft_deleted` / `restored` /
 * `deactivated` etc. so grep, exports, and downstream analytics
 * continue to work. When those codes surface in a human-readable
 * audit viewer (e.g. a per-worker history panel in a later ship),
 * the viewer should call `humaniseWorkerAction(row.action)` so the
 * user sees the new "Archived" wording without any schema churn.
 *
 * Keeps the map lightweight (only workers-module codes we
 * actually emit). Unknown codes fall through to a lightly
 * humanised version of the raw code so nothing breaks when new
 * codes are added in the future.
 */

// Map of DB action code → user-visible label. Kept in one place so
// tests can pin it and future audit UIs stay consistent.
export const WORKER_ACTION_LABELS = Object.freeze({
  // Deactivations — all render as "Archived" now.
  soft_deleted: 'Archived worker',
  deleted: 'Archived worker',
  deactivated: 'Archived worker',
  marked_inactive: 'Archived worker',

  // Reactivations — kept as "Restored" per user's Phase 2.5 pick
  // (reads better than "Unarchived" in a table action cluster).
  restored: 'Restored worker',
  reactivated: 'Restored worker',

  // Non-lifecycle codes we still emit for workers.
  created: 'Created worker',
  updated: 'Updated worker',
  imported: 'Imported worker',
  synced: 'Synced worker',
});

/**
 * Convert an `archive_audit.action` string into a user-visible
 * label. Falls back to a lightly-humanised version of the raw
 * code so unmapped codes never render as empty / undefined.
 */
export function humaniseWorkerAction(rawAction) {
  if (!rawAction) return '';
  const key = String(rawAction).toLowerCase();
  if (WORKER_ACTION_LABELS[key]) return WORKER_ACTION_LABELS[key];
  // Convert `foo_bar_baz` → `Foo bar baz`.
  const spaced = key.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
