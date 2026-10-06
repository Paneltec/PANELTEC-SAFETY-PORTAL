# Simpro pay runs and phone time entry

Payroll opens on Start a new pay run / history. Choose Monday, review submitted days for each Simpro employee, verify the payroll calculations and save reviewed figures. Lock the run, export the bank file and confirm payment before using Complete pay run and email payslips.

The roster reads current Simpro-linked workers, preserving worker UUIDs and historical runs. Latest Simpro archive status wins. Explicit department, otherwise the existing imported Position field, determines presentation: exact Traffic Control maps to Viatec; everyone else to Paneltec Civil. Logos and legal employer details remain configurable. Duplicate Simpro identities block new work instead of double-paying.

The phone Home screen now has My Time Entries. Workers save start/finish, unpaid break and notes, then submit the saved week. Login-to-worker mapping is organisation-scoped and must be unambiguous. Drafts are not imported. New runs preload submitted hours as estimates requiring officer review. Source fingerprints detect subsequently changed submissions; refreshing is explicit and preserves other adjustments.

Owner-only Settings can enable issuing after payroll validation. Microsoft 365 must be connected and Safe Mode must permit sending. Completion preflights all recipient addresses and freezes the batch. The browser sends one individual private HTML payslip per authenticated request and can resume pending messages. Accepted is provider acceptance, not delivery confirmation. A unique database reservation prevents automatic duplicate sends, including uncertain outcomes. Needs-check / unknown records require manual Sent Items review. Closing the browser pauses remaining sends. No public payslip files or bulk employee recipient lists are created.

No real payroll, payment, super, STP or employee email was sent during validation. STP and super provider integrations remain separate work. Existing statutory review requirements remain. Native phone installations require a new Expo build; the self-hosted phone web viewer is included in the normal server image update.

Validation: 52 isolated API tests and 25 calculation/access tests (+9 subtests); portal production build and Expo web export. Tests include the real phone routes through submission storage and into a pay run, roster eligibility, source changes, cross-organisation access, correction locks, private recipients and retry protection. In-memory DB tests do not replace an operational parallel pay run.
