# Payroll flow and payslip theme — 132p47

Applies the supplied Paneltec pay-run and payslip designs to the existing application. Seven steps: Start, Inputs, Calculate, Review, Approve, Pay & report, Close. Calendar follows the configured Friday–Thursday week; payday remains editable. Existing Simpro roster, department branding and payroll permissions remain authoritative.

Employee changes use a side drawer with a saved reason. Review shows real gross/PAYG/super/net totals. Completion stores revision-scoped, immutable references to externally verified bank, STP, super and leave results. It never sends money or creates an ATO/fund receipt. Close is blocked until the run is locked, payment and required evidence recorded, and private payslip emails accepted by the email service.

Issued payslips now have indigo/gold PDF attachments and masked account/member particulars captured at issue. My Payslips on the phone exposes only the authenticated current Simpro employee's issued snapshots and PDF downloads. Cached native share files are removed after sharing. YTD is explicitly not loaded and leave remains projected, not posted.

Validation: 72 isolated API tests; 26 calculation/access/ABA tests and 9 subtests; production frontend build; web/iOS/Android JavaScript exports; synthetic browser correction/edit/save/calculate/review flow; visually inspected generated A4 PDF and phone payslip. No live payroll, bank transfer, email, STP or super submission was made during testing.

Known limits: external STP/SuperStream setup, statutory reporting mappings/YTD, automatic posted leave and accounting journals, independent second approver and prior-week variance checks remain outstanding. Native binaries need a confirmed public HTTPS backend before release. This change is not a complete replacement for validated statutory payroll services.

Release through GitHub and the existing in-app System updater only. Preserve issuing/sending safeguards and existing employee data. Set week start to Friday in payroll settings if the existing installation still has Monday.
