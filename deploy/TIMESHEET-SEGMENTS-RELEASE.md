# Worker client/job time entries

Worker time entries stay inside one canonical Simpro worker/day record. The API validates same-day intervals, positive net time, overlap, client/job ownership, revision conflicts and sent/finalized locks. Daily overtime is estimated once after summing net segment minutes; gaps are excluded. Existing days and saved payroll fingerprints remain compatible.

Phone: week/day selection, recent and searchable cached Simpro clients/open jobs, Yard/Workshop, Travel, Training, Office, unmatched client names, multiple editable entries, 15-minute buttons and one-hour long press, break presets, notes, weekly send/lock.

Office: one row/day with totals and expandable segment details; approve, send back and match unknown clients. Source changes require the officer to refresh and re-review the pay run; payroll adjustments are preserved.

Catalog reads existing organization-scoped Simpro caches. Clients or jobs missing from that cache require the existing integration sync. Older jobs without customer IDs are linked only on unique company/name matches. New job imports retain customer IDs.

Validation uses synthetic in-memory workers and local browser data only. Native binaries still require a public HTTPS backend URL; the portal image includes the updated mobile web preview.

Payroll calendar defaults to Friday–Thursday. New pay-run dates follow the saved Week starts setting, while existing saved runs retain their dates. Finalized runs block overlapping employee periods. The default Thursday payday is the period-ending Thursday for a Friday start; the actual payment date remains editable.
