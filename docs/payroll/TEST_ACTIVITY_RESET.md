# Test activity reset

Adds a Reset test activity disclosure to Payroll > Manage access. Does not run a reset on deployment. Existing administrator role and PIN are enforced on the server, with the shared PIN lockout. A fresh preview, typed confirmation and paused-entry acknowledgement are required.

Only the 17 named organisation-scoped activity collections in admin_test_activity_reset.TARGETS are cleared. Both divisions are included. Names containing "test" are not used to classify data. The UI shows counts before execution. New records outside the preview manifest survive. Every removed record is first retained in test_reset_archive; whole-document Mongo equality prevents deleting a concurrently changed record. An audit event and operation status are retained.

Users, workers, employee configuration, rates, bank details, integrations, master assets/sites, templates, SWMS, schedules, stored files, backups, audit history remain. Saved pay-run archives are included with Stephen's explicit approval on 13 October 2026. This does not provide an absolutely empty database: integrations may reimport activity. No external service is reset. Collections without org_id are never targeted. Additional modules require explicit mapping and review; there is no dynamic delete-all.

A successful new full snapshot is required before removal. If snapshots are disabled, busy, deduplicated or fail, reset stops. The reset snapshot skips existing-backup pruning. Ordinary backup scheduling and retention continue normally. The reset copy should be delivered to the configured destination; this operation verifies snapshot success, not a restore drill or NAS receipt. Full-backup recovery uses existing Backup & Restore and affects the whole deployment. The per-record archive is a secondary recovery aid, not a user-facing undo feature.

Run with other users and imports paused. A crash may leave a partial reset or stuck in-progress job; do not automatically retry/force-unlock it. Inspect counts, backup and archive before recovery. No records, PINs or record-containing exception messages are returned in status. Archive storage and disk space must be considered before large resets.

Validation: 10 synthetic in-memory tests passed; frontend lint passed. Separate disposable CI Mongo tests exercise actual whole-document equality and tenant isolation. No reset was executed against Umbrel, and no production database contents were inspected.
