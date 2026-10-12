# Checklist additions

- Retain encrypted before-values for all successful payroll profile/bank revisions, not only opening-balance edits. Ensure stale writes add no audit event and public responses never expose encrypted history.
- Check test harness connections before collection. Never use live database fixtures for audit tests.
- Check phone payroll history access for inactive/former employees separately from current worker time entry.
- Review source checklist dates/terminology against current ATO materials: QE versus OTE must be accountant-approved.
- Verify legal employer mapping uses confirmed business identity, not job-title heuristics.
