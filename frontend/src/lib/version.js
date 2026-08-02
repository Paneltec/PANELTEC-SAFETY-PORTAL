// Paneltec Civil · v159 — single-source-of-truth version constant
// for the currently running JS bundle.

// v160.3.9.32-4b — Phase 4b: Simpro-first user provisioning.
//                  Removed admin-invite flow (POST /users + POST /users/{id}/invite → 410).
//                  New endpoints: /admin/simpro/employees/available,
//                  /admin/simpro/import-employees/selective, /admin/simpro/sync-linked,
//                  /admin/users/{id}/set-password. Selective import lands users
//                  active (not pending). Frontend Users page: invite modals stripped,
//                  Import from Simpro + Sync from Simpro buttons added, direct
//                  Reset-Password dialog on the drawer.
export const RUNNING_VERSION = 'paneltec-v160.3.9.32-4b';
