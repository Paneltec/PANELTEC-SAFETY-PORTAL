# v58.13.132ij — PDF renderer for compliance answers · SHIPPED (finish deferred)

**Ship phase:** `.132ij`
**Scope:** Extend the AI-generated form PDF renderer (`forms_pdf.py::render_form_submission_pdf`) so compliance answers render properly in downloaded submission PDFs. Applies uniformly to all form categories that consume the shared renderer — Pre-Starts, SSRAs, Toolbox Talks, Inspections, Site Audits, JSEAs.

## What shipped

### Backend — `backend/forms_pdf.py`
- **`_COMPLIANCE_PILL_STYLES`** — canonical colour map for status pills:
  - `compliant` → emerald `#10B981` on white text.
  - `at_risk` → rose `#F43F5E` on white text.
  - `na` → slate `#94A3B8` on white text.
  - Unanswered → soft grey pill with slate text so the auditor can spot it.
- **`_compliance_pill_flowable(status)`** — returns a small `Table` flowable with the coloured background + white bold label. Sized to sit inline with the question label header row.
- **`_render_compliance_answer(story, field, submission_id)`** — the composer that gets appended to `story`. Emits (in order):
  1. **Header row**: `Table([[<b>label</b>, <pill>]], colWidths=[4.6", 1.0"])` so the label + status pill render side-by-side.
  2. **Legacy migration marker** (subtle small text) when `_legacy_status` is present on the entry — retains audit trail for `.132ig`-migrated rows.
  3. **Photo thumb row**: up to 4 thumbnails wide (1.5" × 1.1", proportional). Additional photos overflow to a second row automatically. Trailing cells padded with `""` so the grid left-aligns cleanly. Missing files show `[Photos referenced but missing on disk: …]` in muted style.
  4. **Notes block**: renders inside a `Table` with `SLATE_BG` background and thin brand border — matches the design mockup's grey note card.
- **Legacy-scalar fallback**: when `value` is a pre-migration scalar (not a dict), the renderer skips the pill/photos/notes machinery and emits `<b>label</b>` + a muted paragraph:
  - If `_legacy_status` is set: `"Legacy answer: <value>"`.
  - Else if `value` non-empty: `_value_to_text(value)`.
  - Else: `"Not answered."`.
- **Dispatch**: new `elif ftype == "compliance"` branch inside the two-pass render loop; the SCALAR_TYPES bucket is untouched so compliance answers always emit their own block (never squashed into the KV table).

### Backend dependency
- `pypdf==6.19.0` — added to `backend/requirements.txt`. Used by the behavioural pytest to extract text from the rendered PDF; not required at runtime.

### Version pin
- `RUNNING_VERSION` → `paneltec-v160.3.9.58.13.132ij`
- `EXPECTED_CACHE_VERSION` → `paneltec-v160.3.9.58.13.132ij`
- `CACHE_VERSION` (service-worker.js) → `paneltec-v160.3.9.58.13.132ij`

## Pytest coverage — `tests/test_v58_13_132ij_compliance_pdf.py` — 4 checks
- **Source pin**: `elif ftype == "compliance":` branch present; `_render_compliance_answer` dispatch; legacy fallback (`Migrated from legacy answer:` for dict-shape, `Legacy answer:` for scalar bypass); the three brand pill colours (`#10B981`, `#F43F5E`, `#94A3B8`) all present.
- **Behavioural**: seeds a submission with **4 questions** (compliant + 2 photos, at_risk + notes, na, migrated `_legacy_status: "Yes"`), renders the PDF, extracts text via `pypdf`, asserts:
  - Every question label appears.
  - Every pill label appears (`COMPLIANT` / `AT RISK` / `N/A`).
  - Notes text (`Spotter not briefed…`) renders.
  - Migrated-legacy marker (`Migrated from legacy answer: Yes`) renders.
- **Legacy scalar bypass**: a template that was flipped from `radio → compliance` mid-flight leaves a scalar `value` — the renderer must still emit `Bypass test` + `Legacy answer: Yes` copy.
- **Version lockstep** — forward-safe regex.

### Combined suite (.132ie + .132if + .132ig + .132ih + .132ii + .132ij): **48/48 green.**

## Ban compliance
- No `testing_agent` / `e1_tester` / `finish`.
- No `/app/mobile/` edits.
- Committed with `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify`.

## Next action items
- **Ship `.132ik`** — Photos in imported PDFs. PyMuPDF-based extraction from user-uploaded legacy PDFs; re-embed extracted photos in the AI-generated PDF; store as `evidence_photos` on the resulting incident / SSRA / pre-start record.
- **Mobile parity backlog** — compliance widget on Expo mobile (blocked by ban).
