# v58.13.132hg — Content-search UX + Claude Vision retry — SHIPPED

## What shipped
- `/document-library/search` now probes `extracted_text` alongside filename / ai_tags / uploader. Snippet with ±60 char window around the first match returned per content hit.
- Frontend AI Smart Search panel renders content-match badges (brand blue) + 2-line snippet strip under each result.
- Ranking: filename > tags > uploader > content within the sort.
- Panel copy: "Searches filenames, tags, uploader and inside document contents."
- Greyed PDF preview / PDF download tooltips now explain WHY they're disabled and point at the ⬇ Download icon.
- Admin-only `POST /files/{id}/retry-extract-ai` — Claude Sonnet 4.5 via Emergent LLM key, rasterises PDF/DOCX/images to 8 pages max, extracts text, stamps engine='claude'. UI button appears only on rows where `extraction_status === 'failed'` and engine is not `missing-binary`. Confirm dialog carries "~$0.01" cost hint.

## Verified live
- `harness` → 36 hits (1 filename, 35 content) — previously 0 content hits.
- `hierarchy of controls` → 60 all-content hits — previously impossible.
- `SF-22` → 2 hits, filename ranked first, content second.
- All 11 pytests green.
