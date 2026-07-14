// v160.3.7p — Central Document Library colour taxonomy.
//
// Previously each surface (DocumentLibrary.jsx, BulkRestrictModal.jsx)
// hand-rolled its own PASTEL_LABEL / COLOR_GROUPS map, and both used
// cosmetic names like "Sky" / "Mint" that gave the admin no idea what
// folders actually lived in each group. This file collapses the taxonomy
// to one export and gives every group a **semantic** name grounded in
// the real folder contents (see /app/memory/PRD.md for the audit).
//
// Cosmetic slugs (`sky`, `blush`, `mint`, …) stay as the DB `color_key`
// so we don't have to migrate any documents; only the UI label changes.

/**
 * Full colour registry.
 * - `slug`        — matches `doc_folders.color_key` in Mongo
 * - `label`       — semantic name shown to WHS admins in every UI surface
 * - `cosmetic`    — pastel colour name (kept for the admin tooltip so the
 *                   swatch↔slug wiring is discoverable)
 * - `bg` / `dot`  — Tailwind arbitrary-value classes for tile tint and
 *                   legend dots. Kept in-file so consumers don't have to
 *                   compose classes themselves.
 * - `hint`        — one-line description of what the group contains,
 *                   surfaced in tooltips and the future admin help card.
 *
 * Add a new colour: append to `FOLDER_COLORS` (order matters for the
 * legend + Restrict-modal swatch row) and the whole app picks it up.
 */
export const FOLDER_COLORS = [
  {
    slug: 'sky',
    label: 'Health & Hazards',
    cosmetic: 'Sky',
    bg: 'bg-[#e0edfa]',
    dot: 'bg-[#a9c4e8]',
    hint: 'SDS, PPE-adjacent hazards, first aid, alcohol/drug, licences.',
  },
  {
    slug: 'blush',
    label: 'Standards & Permits',
    cosmetic: 'Blush',
    bg: 'bg-[#f9dde1]',
    dot: 'bg-[#f2b3bd]',
    hint: 'Australian Standards, permits to work, inductions, subcontractor mgmt.',
  },
  {
    slug: 'mint',
    label: 'Environmental & Risk',
    cosmetic: 'Mint',
    bg: 'bg-[#d4ebd9]',
    dot: 'bg-[#a8dbb5]',
    hint: 'Environmental procedures, JSEA/Risk assessments, reports, checklists.',
  },
  {
    slug: 'butter',
    label: 'Policies & Incidents',
    cosmetic: 'Amber',
    bg: 'bg-[#f5ebc6]',
    dot: 'bg-[#eddc9c]',
    hint: 'IMS index, company policies, BYDA, confined-space, incident reports.',
  },
  {
    slug: 'sage',
    label: 'Quality & Site Ops',
    cosmetic: 'Sage',
    bg: 'bg-[#d6e5d3]',
    dot: 'bg-[#b3ceb0]',
    hint: 'Quality & Mgmt procedures, PPE, inductions, traffic mgmt, calibration.',
  },
  {
    slug: 'lilac',
    label: 'Legal & Procedures',
    cosmetic: 'Lilac',
    bg: 'bg-[#e5d7f4]',
    dot: 'bg-[#c9b0e6]',
    hint: 'WHS Acts & Regs, WHS procedures, ITPs, CCF, emergency mgmt, RTW.',
  },
  {
    slug: 'peach',
    label: 'Audits & Manuals',
    cosmetic: 'Peach',
    bg: 'bg-[#fae3d0]',
    dot: 'bg-[#f4c8a6]',
    hint: 'Audits, SWP, manuals & procedures, forms, CodeSafe, site management.',
  },
  {
    slug: 'coral',
    label: 'Operations & Training',
    cosmetic: 'Coral',
    bg: 'bg-[#f8dccc]',
    dot: 'bg-[#f0b9a3]',
    hint: 'Management policies, training records, procurement, electrical, insurance.',
  },
  {
    slug: 'lavender',
    label: 'SWMS & Competencies',
    cosmetic: 'Lavender',
    bg: 'bg-[#e2d9f2]',
    dot: 'bg-[#c9b8e8]',
    hint: 'SWMS-current, competencies matrices, plant & equipment, hot work, barriers.',
  },
  {
    slug: 'slate',
    label: 'Uncategorised',
    cosmetic: 'Slate',
    bg: 'bg-slate-100',
    dot: 'bg-slate-300',
    hint: 'Not yet assigned to a group — click the swatch to categorise.',
  },
];

/** Fast lookup by slug. Falls back to a Sky-shaped entry if a folder has
 *  a bogus color_key stored (e.g. `null` from very old rows). */
export const FOLDER_COLOR_BY_SLUG = FOLDER_COLORS.reduce((acc, c) => {
  acc[c.slug] = c;
  return acc;
}, {});

export function folderColor(slug) {
  return FOLDER_COLOR_BY_SLUG[slug] || FOLDER_COLOR_BY_SLUG.sky;
}

/** Convenience map: `{ sky: 'Health & Hazards', ... }` for legacy consumers
 *  that just want a slug→label lookup. */
export const FOLDER_COLOR_LABELS = FOLDER_COLORS.reduce((acc, c) => {
  acc[c.slug] = c.label;
  return acc;
}, {});
