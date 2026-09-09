# Version bump policy (v58.13.132p and forward)

Every ship bumps exactly TWO files:

- `frontend/src/lib/version.js#RUNNING_VERSION` → shown in the footer, per-ship traceability.
- `mobile/src/lib/version.ts#MOBILE_BUNDLE_VERSION` → mobile bundle audit trail.

Do **NOT** bump `frontend/public/service-worker.js#CACHE_VERSION` on a
per-ship cadence. That constant only bumps when the SW's cache strategy
itself changes (rare). Bumping it per-ship triggered the rapid-reload
"blink" bug diagnosed in `v58_13_132p_blink_diagnosis.md`.

Effective from `.132p` on.
