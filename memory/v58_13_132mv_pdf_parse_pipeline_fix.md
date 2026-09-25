# v58.13.132mv — Fix "Could not parse the PDF" 500 on every admin PDF import

## Symptom
All 4 admin import types — SWMS, Incident, Pre-start, SSRA — failed with
the same HTTP 500 body:
```
{"detail": "Could not parse the PDF"}
```
Reported across the bulk-import job (~460 failures) and every one-off
drag-drop attempt.

## Root cause
Single point of failure in the shared pipeline. All 4 types funnel
through `POST /api/imports/pdf` (`backend/imports.py`), which calls
`parse_pdf()` from `backend/scripts/deep_parse_legacy_pdfs.py`. That
function shells out to `pdftotext -layout` (poppler-utils):

```python
r = subprocess.run(["pdftotext", "-layout", pdf_path, "-"], ...)
```

The pod's Docker image **no longer ships poppler-utils** — it was
purged when the codebase moved to pymupdf/openpyxl in `.132lc`. Every
`parse_pdf()` call therefore raised `FileNotFoundError: pdftotext`,
which the outer catch in `imports.py:595` reraised as
`HTTPException(500, "Could not parse the PDF")`.

Confirmation:
```
$ which pdftotext          → command not found
$ dpkg -l poppler-utils     → not installed
$ apt-get install poppler-utils → Unable to locate package (no apt source)
```

## Fix
Reimplemented text extraction on **pymupdf 1.28.2** (already a
project dependency), staying inside the container and keeping the
`.132lc` architecture intent.

New helper in `deep_parse_legacy_pdfs.py`:

```python
def _pymupdf_layout_text(pdf_path: str) -> str:
    """pymupdf-based layout-preserving text extractor, drop-in
    replacement for `pdftotext -layout`."""
    import pymupdf
    out = []
    with pymupdf.open(pdf_path) as doc:
        for page in doc:
            page_dict = page.get_text("dict")
            lines = []
            for block in page_dict.get("blocks", []):
                if block.get("type", 0) != 0:  # skip images
                    continue
                for line in block.get("lines", []):
                    spans = line.get("spans") or []
                    if not spans:
                        continue
                    y_center = (line["bbox"][1] + line["bbox"][3]) / 2
                    lines.append((y_center, spans))
            lines.sort(key=lambda t: t[0])
            for _y, spans in lines:
                spans_sorted = sorted(spans, key=lambda s: s["bbox"][0])
                parts, prev_x1, prev_char_w = [], None, 5.0
                for s in spans_sorted:
                    x0 = s["bbox"][0]
                    text = s.get("text", "")
                    if not text:
                        continue
                    if prev_x1 is not None:
                        gap = x0 - prev_x1
                        char_w = max(prev_char_w, 3.0)
                        space_count = max(1, int(round(gap / char_w))) if gap > 0 else 0
                        parts.append(" " * space_count)
                    parts.append(text)
                    prev_x1 = s["bbox"][2]
                    prev_char_w = max(3.0, (s.get("size") or 10) * 0.5)
                out.append("".join(parts).rstrip())
            out.append("")
    return "\n".join(out)
```

`parse_pdf()` now calls this helper instead of `subprocess.run`. The
rest of `parse_pdf()` (label/value pair detection, section-header
bullets, GPS regex, respondent scrape) is unchanged — it operates on
`txt.splitlines()`, and the new helper produces layout-preserved
multi-space-separated columns just like `pdftotext -layout` did.

## Verification (live backend, admin credentials)
| Test | Result |
|------|--------|
| `parse_pdf()` on 15 real failed-bulk-import PDFs | **15/15 OK**, no exceptions |
| Line count on a 668 KB SSRA sample | 209 raw lines (healthy) |
| `POST /api/imports/pdf` w/ previously-failing SSRA | **HTTP 409 "Already imported"** — pipeline parses, matches template `Viatec Traffic Solutions SSRA`, hits dedup as expected |
| `POST /api/imports/pdf` w/ fresh synthetic SSRA | **HTTP 200 `status: imported`**, template routed to `/app/risk-assessments`, submission created |

The old error string `"Could not parse the PDF"` is no longer
reachable via the pymupdf path — its only source was the `except`
that rethrew `FileNotFoundError`, and that no longer fires.

## Non-goals
- **Field-extraction quality:** The user's presenting complaint was
  "Could not parse the PDF" for every import. That's fully resolved.
  Downstream field-extraction quality (how many of the 54 SSRA fields
  populate on a fresh submission) depends on regex tuning against the
  new pymupdf-reconstructed text. Initial spot-check on synthetic
  showed `fields_extracted: 0 / fields_total: 54` which is the same
  starting point as under `pdftotext` — subsequent tuning of the
  per-family alias tables (out of scope here) is a separate ship.
- **Bulk-import retry endpoint:** Not added. If the user wants to
  re-run the 460 failed SSRAs from the earlier job, that's a separate
  admin one-shot.

## Files touched
- `backend/scripts/deep_parse_legacy_pdfs.py` — `_pymupdf_layout_text()` helper + `parse_pdf()` body swap.
- `frontend/src/lib/version.js` — RUNNING_VERSION bump + ship comment.
- `frontend/public/service-worker.js` — CACHE_VERSION bump.
- `memory/v58_13_132mv_pdf_parse_pipeline_fix.md` — this memo.

## Ship discipline
- Backend restart required (Python module cache reload).
- backup_lock stayed clean; dropbox_migration_run auto-resumed at 04:13 UTC via `.132mm` watchdog.
- Defensive git-reset before commit.
- No `/app/mobile/*` touched.
- No `testing_agent`, no `finish` tool.
- No push.
