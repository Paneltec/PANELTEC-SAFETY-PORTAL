/**
 * v58.13.132gn — Derive the "business date" for a submission-style record.
 *
 * Pre-Starts, SSRAs, Inspections, Permits and Hazards all originate as
 * mobile form_submissions where the user picks a `type: 'date'` field
 * value that represents the *day the work happened* — not the day the
 * form was uploaded (which is `submitted_at`).
 *
 * The list surfaces have historically rendered `record.date` (auto-
 * mirrored from the submission) OR `record.submitted_at` — both of
 * which equal the SUBMISSION day, not the business day the user
 * actually filled in. For SSRAs in particular this hides evidence:
 * an SSRA submitted 14 Sep 2026 might refer to work done 23 Dec 2024,
 * and Stephen needs to see the 23 Dec date on the list.
 *
 * This helper scans the submission's `fields[]` array for the first
 * `type: 'date'` value and returns it in ISO YYYY-MM-DD form. Falls
 * back to `null` if no date-typed field carries a value — callers
 * are expected to fall back to `record.date || record.submitted_at`.
 *
 * `record.assessment_date` (if the backend one day writes it) wins
 * over the derived value.
 */

/**
 * @param {object} record — a submission-style row with `fields[]`.
 * @returns {string|null} — YYYY-MM-DD or null.
 */
export default function deriveAssessmentDate(record) {
  if (!record) return null;
  if (record.assessment_date) return String(record.assessment_date).slice(0, 10);

  const fields = record.fields;
  if (!Array.isArray(fields) || fields.length === 0) return null;

  for (const f of fields) {
    if (!f || f.type !== 'date') continue;
    const v = f.value;
    if (!v) continue;
    const s = String(v).trim();
    if (!s) continue;
    // Accept full ISO ("2024-12-23T…"), short ISO ("2024-12-23"), or
    // plain "DD/MM/YYYY". Anything else falls through.
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
    if (m) {
      const [, d, mo, y] = m;
      return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
  }
  return null;
}
