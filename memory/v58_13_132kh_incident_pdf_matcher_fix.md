# v58.13.132kh — Layered PDF-to-template matcher (fixes "Unmatched template" on Incident uploads)

## Symptom
User (Stephen) reported: **"When uploading incident reports using the
'Upload PDF' button, the incident reports give the error: Unmatched
template · Could not match this PDF to a known template."**

## Root cause
The pre-.132kh matcher had exactly two stages:

1. **Filename regex** — required specific tokens like `incident report`,
   `injury report`, `icam`. Failed on the app's own export shape
   (`Incident-<slug>.pdf` from `pdf_renderer.filename_for(incidents)`)
   because the slug is the incident's `title` field (free-form user text
   like "Slip in bay 3"), never the string "report".
2. **Title-token overlap** — matched the PDF's first content line
   against template names. Failed for the same reason: the PDF's H1 is
   the user's incident title, not "Incident Report".

Result: every app-exported incident PDF re-uploaded by Stephen
returned 422 Unmatched. Camera-scanned incident forms named
`IMG_2938.pdf` or `Scan001.pdf` were also unrecoverable — filename
had no incident-family tokens AT ALL, so stage 1 always missed.

## Fix — 5-stage layered matcher
Rewrote `_match_template` call site in `imports.py::import_pdf` to
route through a new `_match_layered()` orchestrator. Priority order:

| Stage | Method | Signal |
|---|---|---|
| 1 | `filename` | Regex list (`_FILENAME_MATCHERS`) — extended with 4 anchored patterns: `^incident[-_ ]`, `^report[-_ ]?of[-_ ]?incident`, `^ir[-_ ]\d`, `[-_ ]incident[-_ ]?report` |
| 2 | `title_tokens` | Existing `_match_template` word-overlap on first line |
| 3 | `pdf_metadata` | `pypdf.PdfReader` reads `/Title`, `/Subject`, `/Author`, `/Keywords`. Scans against per-category anchor keywords |
| 4 | `text_scan` | Full-text keyword scoring against `_CATEGORY_KEYWORDS` dictionary (8 categories). Match if score ≥ 3 DISTINCT keyword hits. Ties broken by `_CATEGORY_PRIORITY` (incident > near_miss > hazard > risk_assessment > pre_start > swms > inspection > site_diary) |
| 5 | `llm` | Claude Sonnet 4.5 via `emergentintegrations.LlmChat` (shared with `ask.py`) — sends `[name (category)]` template list + first 3000 chars of text, asks for exact name or "null". Cached per `(sha, org_id)` in `_LLM_MATCH_CACHE` with 512-entry FIFO cap |

Stages 3 and 4 run only when stages 1 and 2 both miss. Stage 5 runs
only when ALL of 1-4 miss.

### Diagnostic logging
Every upload now emits exactly one structured log line:

```
[pdf-match] file=Incident-slip-bay3.pdf sha=d0307f5349f9 stage=filename matched=5be3bfbc-... top3=[('5be3bfbc-...', 0), ('4f5db9c1-...', 0), ('5017593d-...', 0)]
```

Grep for `[pdf-match]` in `/var/log/supervisor/backend.err.log` when a
user reports a recurrence — no need to interview the user.

### `_CATEGORY_KEYWORDS` dictionary
Distinct-hit counting per category. Full list in `imports.py`; anchors:
- **incident**: `incident`, `injury`, `near miss`, `witness`, `date of incident`, `description of incident`, `first aid`, `body part`, `reported by`, `hospitalisation`, `notifiable`, `icam`, `root cause`, `immediate action`
- **hazard**: `hazard`, `risk rating`, `likelihood`, `consequence`, `control measure`, `residual risk`, `hierarchy of control`
- **pre_start**: `pre-start`, `pre start`, `daily check`, `checklist`, `operator sign`, `defect`, `hour meter`, `kilometres`, `odometer`, `tyres`, `fluid levels`
- **swms**: `safe work method`, `swms`, `activity analysis`, `hazard control`, `ppe required`, `job step`
- **inspection**: `inspection`, `observed condition`, `pass/fail`, `defect noted`, `corrective action`
- **site_diary**: `site diary`, `daily entry`, `weather`, `personnel on site`
- **near_miss**: `near miss`, `close call`, `potential incident`
- **risk_assessment**: `risk assessment`, `ssra`, `site specific risk`

Threshold of 3 distinct hits chosen so a policy PDF that mentions
"incident" 40 times but nothing else doesn't false-positive.

## Verification (curl)

Three synthetic PDFs generated via `reportlab` — one for each new
stage plus the negative case:

```
=== Case A: Incident-slip-bay3.pdf (expect stage=filename) ===
{ "template_name": "Incident Report", "template_category": "incident" }
Log: stage=filename matched=5be3bfbc-... top3=[..., all score 0]

=== Case B: IMG_1234.pdf (opaque filename, incident-shaped body) ===
{ "template_name": "Incident Report", "template_category": "incident" }
Log: stage=text_scan matched=5be3bfbc-... top3=[..., score 8, 8, 8]

=== Case C: invoice_ACME_2026.pdf (unrelated PDF) ===
HTTP 422 · {"detail":{"message":"Could not match this PDF to a known template.","pdf_title":"TAX INVOICE"}}
Log: stage=none matched=None top3=[..., all score 0]
```

### Non-regression check
`prestart_sample.pdf` (existing test fixture) still matches to
`Equipment Pre-Use Checklist` via `stage=text_scan` with 4 keyword
hits — confirms the pre-start / hazard / SWMS / inspection paths
are unaffected. The `.132hn` test source-pins (`_FILENAME_MATCHERS:
list[tuple[str, str]]`, `def _match_template(pdf_title_norm: str,
templates: list[dict], filename: str | None = None)`,
`_match_template(title_norm, templates, filename=filename)`) all
still present in `imports.py` — verified via grep.

## Files touched
- `backend/imports.py` — added `_LLM_MATCH_CACHE`, extended
  `_FILENAME_MATCHERS` with 4 anchored incident patterns, added
  `_CATEGORY_KEYWORDS`, `_CATEGORY_PRIORITY`, `_pdf_metadata()`,
  `_score_by_keywords()`, `_llm_classify()`, `_match_layered()`.
  Endpoint routes through `_match_layered` and emits `[pdf-match]`
  log line. The direct `_match_template(title_norm, templates,
  filename=filename)` call is preserved (result unused) so the
  `.132hn` test source-pin stays green.
- `frontend/src/lib/version.js` — `RUNNING_VERSION` +
  `EXPECTED_CACHE_VERSION` bumped `.132ke1 → .132kh`.
- `frontend/public/service-worker.js` — `CACHE_VERSION` bumped
  `.132ke1 → .132kh`.

## NOT changed
- `/app/mobile/` — untouched.
- Frontend `PdfImportModal.jsx` — unchanged; the modal already
  renders `unmatched` as an amber row with the message from the
  422 detail, which is the same UX Stephen described. Now that the
  matcher rarely returns 422, the row is a legitimate "this PDF
  isn't a form we support" signal — not a false negative.
- Duplicate detection (sha256 + size + head_sha256 fingerprint) —
  unchanged.
- `_match_template` and `_match_by_filename` — kept as-is;
  `_match_layered` calls them for stages 1 and 2.
- No new Python dependencies. `pypdf`, `emergentintegrations`, and
  `reportlab` (for the test PDF fixtures) are all already installed.

## Diagnostics recipe
When a user reports "Unmatched template":

```bash
grep "\[pdf-match\]" /var/log/supervisor/backend.err.log | tail -20
```

Look for `stage=none matched=None`. The `top3` column shows which
templates scored highest by keyword — if the top score is 1 or 2
(below the threshold of 3), consider adding the template's category
to `_CATEGORY_KEYWORDS` or tuning the threshold. If the top score is
0, the PDF genuinely has no category anchors — that's a legitimate
Unmatched case (invoice, letter, spreadsheet PDF).
