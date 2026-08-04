# User Manual — how to add or edit a section (v57.2)

The Paneltec Civil user manual is composed from **one markdown file
per section**, all living in this folder. On every request the
backend reads the folder, sorts by the `order:` frontmatter field,
and concatenates the bodies into the single markdown blob that both
the browser render and the PDF export consume.

## Layout

```
/app/backend/content/manual/
├── 00_index.md                    ← title + preamble
├── 01_platform-overview.md
├── 02_a-day-in-the-life.md
├── 03_getting-started.md
├── ...
├── 21_troubleshooting-faq.md
└── README.md                      ← this file (skipped by composer)
```

Filenames follow `NN_<slug>.md` where `NN` is a zero-padded ordinal
matching the `order:` field. The prefix is cosmetic — `order:` is
authoritative.

## Frontmatter contract

Every section file MUST open with a YAML-lite frontmatter block:

```markdown
---
title: HR Employees Register
slug: hr-employees-register
order: 10
tags: [hr, roster, simpro]
last_updated: 2026-08-04
---

## HR Employees Register

The HR Employees register is the employer-of-record roster …
```

Field notes:
- **title** — display name (`## <title>` in the rendered manual).
- **slug** — search / URL slug; used by the manual page's TOC chips.
- **order** — integer. Composer sorts ascending. Ties → filename order.
- **tags** — optional; free-form list. Not currently surfaced in the
  UI but preserved for future faceted search.
- **last_updated** — free-form date. If omitted, the composer uses
  the file's mtime.

## Adding a new section

1. Pick the next available `order` integer (usually last section + 1).
2. Choose a `slug` — lowercase, hyphen-separated, ≤ 60 chars.
3. Create the file `NN_<slug>.md` with the frontmatter block.
4. Write the body as normal markdown, starting with a `## <title>` H2.
5. Commit. The composer picks it up on the next request — no restart
   needed (mtime-driven cache invalidation).

## Editing an existing section

Edit the file in place. Bump `last_updated`. That's it.

## Renumbering sections

Change the `order:` values in the affected files. Composer re-sorts
automatically. The frontmatter is the source of truth; the filename
prefix is cosmetic and can drift.

## PDF export

`GET /api/help/manual.pdf` uses the same composed markdown. No
per-section flag needed. If a section renders poorly in the PDF,
prefer keeping the markdown simple (bold, italics, bullet lists,
code fences) — ReportLab's mini-HTML parser is picky about nested
inline tags.

## Legacy fallback

If this folder is empty or missing, the composer falls back to the
monolithic `../user_manual.md` file that predated the split. Never
delete that fallback in the same commit as the split — leave it as a
safety net until the folder-based approach has bedded in for a
release cycle.
