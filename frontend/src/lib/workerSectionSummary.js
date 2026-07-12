// v160.3.5 — Shared worker-section-summary aggregator.
//
// Both the VIEW modal (`WorkerViewModal.jsx`) and the EDIT modal
// (`Workers.jsx → EditModal + CertificationsPanel`) MUST render identical
// counts for the same worker. Previously each computed its own aggregate
// inline, which drifted (Daniel Butler showed `Inductions · 37` in EDIT
// vs `Inductions · 27` in VIEW). Importing a single helper eliminates
// that whole class of regression.
//
// All aggregators assume `worker_certifications` / `worker_hr_documents`
// / `worker_unmatched_documents` shapes already filtered to
// `deleted_at: null` on the server side.

const SIMPRO_SOURCES = new Set([
  'simpro', 'simpro_zip', 'simpro_zip_reclassified',
]);

const INDUCTION_TOKEN = 'induction';

const SOON_MS = 30 * 86400_000; // 30 days

/**
 * Aggregate certifications into the pill set consumed by both modals.
 * Returns:
 *   {
 *     total, simpro, manual, pending, missing, expired, expiringSoon,
 *     inductions,
 *     inductionsByFolder: { [folder]: count }
 *   }
 * `inductions` = certs whose `cert_kind_slug` OR `name` contains
 * "induction" (case-insensitive). Same heuristic as the previous inline
 * counters — this helper is the ONLY place that formula lives.
 */
export function summariseCertifications(rows) {
  const now = new Date();
  const soon = new Date(now.getTime() + SOON_MS);
  const out = {
    total: 0, simpro: 0, manual: 0, pending: 0, missing: 0,
    expired: 0, expiringSoon: 0, inductions: 0,
    inductionsByFolder: {},
  };
  if (!Array.isArray(rows)) return out;
  out.total = rows.length;
  for (const c of rows) {
    if (SIMPRO_SOURCES.has(c.source)) out.simpro += 1;
    else out.manual += 1;
    if (c.pending_review) out.pending += 1;
    if (!c.doc_file_id) out.missing += 1;
    const exp = c.expiry_date ? new Date(c.expiry_date) : null;
    if (exp && !isNaN(exp)) {
      if (exp < now) out.expired += 1;
      else if (exp <= soon) out.expiringSoon += 1;
    }
    const slug = (c.cert_kind_slug || '').toLowerCase();
    const nm = (c.name || '').toLowerCase();
    if (slug.includes(INDUCTION_TOKEN) || nm.includes(INDUCTION_TOKEN)) {
      out.inductions += 1;
      // Group by seed_folder (Simpro ZIP paths like "Inductions/EPA").
      // Fall back to "Uncategorised" so every counted row lands in a bucket.
      const folder = (c.doc_seed_folder || '').split('/').pop()
                       || (c.issuer || '').trim()
                       || 'Uncategorised';
      out.inductionsByFolder[folder] = (out.inductionsByFolder[folder] || 0) + 1;
    }
  }
  return out;
}

/** How many of the 5 Personal-tab fields have been filled in. */
export function personalFilledCount(worker) {
  if (!worker) return 0;
  return [
    worker.birth_date, worker.country, worker.state,
    worker.postal_code, worker.street_address,
  ].filter(Boolean).length;
}
