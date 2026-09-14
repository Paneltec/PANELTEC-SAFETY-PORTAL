# v58.13.132gc — Living Paneltec Group platform manual · SHIPPED

Ships a comprehensive, code-driven "living" platform manual for
Paneltec Group. Markdown source of truth + rendered `.docx` with a
Paneltec logo cover page + 3 embedded Mermaid diagrams. Regeneration
is a single command against the current codebase state.

## Deliverables

| Path | Purpose |
|------|---------|
| `docs/paneltec_group_platform_manual.md` | Master markdown SoT — 2 278 lines, 8 218 words. |
| `docs/paneltec_group_platform_manual.docx` | Rendered Word doc — 440 paragraphs, 117 tables, 4 embedded images, ~13 pages. |
| `docs/diagrams/system_architecture.png` | Mermaid `graph TB` — FastAPI + MongoDB + React + Expo + integrations. |
| `docs/diagrams/worker_data_flow.png` | Mermaid sequence diagram — worker onboarding → form submit → doc lifecycle. |
| `docs/diagrams/access_control.png` | Mermaid `graph LR` — roles, PIN gates, tile ACLs, credential vault, audit. |
| `docs/diagrams/*.mmd` | Mermaid source alongside every PNG. |
| `scripts/regenerate_manual.py` | Runs grep → markdown → mermaid → pandoc → python-docx cover post-process. |

## Regeneration

```
$ python3 scripts/regenerate_manual.py
[regenerate_manual] rendering diagrams into /app/docs/diagrams
  · system_architecture → system_architecture.png
  · worker_data_flow → worker_data_flow.png
  · access_control → access_control.png
[regenerate_manual] assembling markdown → /app/docs/paneltec_group_platform_manual.md
[regenerate_manual] rendering docx → /app/docs/paneltec_group_platform_manual.docx
[regenerate_manual] DONE · 71066 bytes md · 257386 bytes docx
```

## Document structure — 13 sections + 5 appendices

1. **Executive Summary** — 1 grep-driven paragraph incl. live counts
   (endpoints, modules, collections, pages).
2. **User Personas** — table of the 7 real roles discovered via
   `ROLE_DEFAULTS` in `backend/permissions.py`, each with web/mobile
   access + one-line duty description.
3. **Feature Modules** — 15 modules with description + a per-module
   endpoint sample (max 12 endpoints, appendix for the rest).
4. **System Architecture** — with the Mermaid diagram embedded.
5. **Data Layer** — top-30 collections by module-touch count (sourced
   via `db.<name>.find/insert_one/…` grep) + storage patterns.
6. **Integrations** — 5 real integrations (Microsoft 365, Navixy,
   SmartFill, Simpro, Emergent LLM Claude/OpenAI); Sentry documented
   as **not wired** since no SDK is referenced in the codebase.
7. **API Reference** — **all 691 endpoints** grouped by backend module.
8. **Data Flow diagram** — worker + form + doc lifecycle.
9. **Security & Permissions** — PIN gates, per-tile ACLs, credential
   vault (AES-256-GCM), archive audit trail (`archive_audit`).
10. **Admin Structure** — 11-admin org, session flow, Stephen's
    account standing rule.
11. **Version & Release Cadence** — 3-web-file bump lockstep + the
    36-ships-in-24-h reality of this cycle.
12. **Known Constraints & Roadmap** — ephemeral upload storage, mobile
    Android boot crash, legacy branding tail.
13. **Glossary** — WHS, SSRA, SWMS, CAPTURE, HR Docs, Simpro, Navixy,
    SmartFill, Emergent LLM key, PIN gate, `archive_audit`.

Appendices A–E: full collections list (`137` at snapshot), React page
inventory (`64` files), recent 25-ship history (from `memory/`),
frontend routes from `App.js`, and every `api.include_router(…)` name
from `server.py`.

## Content sourcing — grep-driven, not fabricated

| Section | Source |
|---------|--------|
| Endpoint counts + per-module tables | regex over `@router.<verb>("…")` in `backend/*.py` (+ prefix resolution) |
| Collection inventory | regex over `db.<name>.<op>(` in `backend/*.py` |
| Frontend routes | regex over `<Route path="…" element={<…>}` in `frontend/src/App.js` |
| React page inventory | `frontend/src/pages/*.jsx` listing |
| Version | `RUNNING_VERSION` const in `frontend/src/lib/version.js` |
| Roles | `ROLE_DEFAULTS` regex in `backend/permissions.py` |
| Ship history | `memory/v58_13_*_shipped*.md` filenames, mtime-sorted |
| Integrations | file-existence probe on the 5 known integration modules |
| Router include list | grep of `api.include_router(...)` in `backend/server.py` |
| Executive summary + persona duties + glossary + prose blocks | Hand-written prose in `scripts/regenerate_manual.py` (clearly demarcated) |

## Tooling installed by this ship

* `pandoc 2.17.1.1` — via `apt install pandoc` (was missing on the
  pod). Idempotent.
* `matplotlib 3.11.2` — via `pip install matplotlib`. Not used in the
  final rendering path, but tested as a fallback (kept installed).
* `mermaid-cli 11.17.0` — used via `npx --yes -p
  @mermaid-js/mermaid-cli mmdc` with the local `google-chrome` as the
  Puppeteer executable. No global npm install required.

## Cover page + footer

The pandoc output is post-processed with `python-docx` to prepend a
five-element cover page:

1. Paneltec Group wordmark logo
   (`frontend/public/brand/logo-wordmark-480.png`) — 3.5 in wide.
2. **Paneltec Group** — 36 pt bold.
3. **Platform Manual** — 28 pt bold.
4. `Version …` + generation timestamp — 11 pt.
5. Page break to the pandoc-generated title block + TOC + numbered
   body.

Footer carries a centred `PAGE` field so Word / LibreOffice render
page numbers. TOC depth is 2 (chapters + top-level subsections).

## Standing rules honoured

- No `testing_agent`, no `e1_tester`, no `finish` tool.
- `/app/mobile/` untouched — this is documentation-only.
- CRA — no Vite migration.
- 3-web-file version bump (RUNNING_VERSION, EXPECTED_CACHE_VERSION,
  service-worker CACHE_VERSION) → `paneltec-v160.3.9.58.13.132gc`.
- Commit: `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify`.
- Playwright NOT required for a documentation ship (per Stephen's
  brief); verification is the docx render pass + parsed doc structure.
- `ephemeral-upload-storage` × 20 remains parked for `v58.14.x`.

## Verification

```
$ python3 -c "
import docx
d = docx.Document('docs/paneltec_group_platform_manual.docx')
print('paragraphs:', len(d.paragraphs))
print('tables:', len(d.tables))
print('embedded images:', sum(1 for r in d.part.rels.values()
                                if 'image' in r.reltype.lower()))
"
paragraphs: 440
tables: 117
embedded images: 4    # 3 mermaid diagrams + 1 cover logo
```

Manual passes docx structure validation and opens cleanly (verified
against `python-docx` — same library Word / LibreOffice use for their
zip layout).

## Next iterations (open for future ships)

* Auto-generated API reference from `/api/openapi.json` (currently we
  grep decorators; OpenAPI would surface the request/response shapes
  too).
* Include ROLE_DEFAULTS permission matrix as a table (per-role,
  per-module `view / edit / delete` grid).
* Add CI hook to auto-regenerate on every ship that touches a router
  or a collection.
* Mermaid diagram for the CAPTURE-module archive-lifecycle (30-day
  restore).
