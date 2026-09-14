# v58.13.132gd — Platform manual follow-ups · SHIPPED

Fills the follow-up backlog left open by `.132gc`: the API section is
now sourced from `/api/openapi.json`, a full permission matrix appendix
is rendered, an archive-lifecycle diagram is embedded, and a PIN-gated
`GET /api/docs/manual.docx` endpoint plus a "Download manual" UI card
let admins pull the current Word doc without SSHing into the pod. A
drift-check script guards the manual against silent staleness.

## Deliverables

| # | Deliverable | Path |
|---|-------------|------|
| 1 | API section sourced from openapi.json (auth + WAF UA) | `scripts/regenerate_manual.py::collect_openapi()` |
| 2 | Permission matrix appendix (subprocess import of `permissions.py`) | `scripts/regenerate_manual.py::collect_permission_matrix()` + Appendix F |
| 3 | Archive-lifecycle Mermaid diagram | `docs/diagrams/archive_lifecycle.{png,mmd}` |
| 4 | Admin-only, PIN-gated download endpoint | `backend/docs_manual.py` → `GET /api/docs/manual.docx` |
| 5 | "Download manual" UI card + PIN modal | `frontend/src/pages/MyProfile.jsx::ManualDownloadCard` |
| 6 | Drift-check script | `scripts/check_manual_drift.py` |

## Endpoint counts — openapi vs decorator-grep

| Source | Count |
|--------|-------|
| `/api/openapi.json` (live pod) | **768** endpoints across **117** tags |
| Decorator-grep (`@router.<verb>(…)` regex) | **692** endpoints across **99** modules |

They differ because:

* **openapi picks up FastAPI-scoped routes without a decorator prefix
  match** — e.g. `/api/`, `/api/health`, `/api/whoami`, `/api/gps-map`
  are declared directly on `api` in `server.py`, not via
  `@<module>_router`.
* **openapi lists a few 405-only stubs** the grep pass ignores.

Neither is wrong. The openapi section is now the primary reference in
the manual; grep totals feed the executive-summary snapshot line +
the drift-check anchor.

## Permission matrix screenshot

Appendix F is a full **PERMISSIONS_SCHEMA × ROLE_DEFAULTS** grid,
rendered as a pipe-table markdown and picked up as a native Word table
by pandoc. 7 roles × ~50 resources. Each cell = comma-joined granted
verbs (`view, edit, delete, email, team_view, use, approve`).

Sample row from the rendered docx:

```
Resource        · admin       · hseq_lead        · contractor_rep · supervisor · worker · auditor · contractor_rep_submit_only
`workers`       · view, edit  · view, edit, team_view · —          · view       · —      · view    · —
`incidents`     · view, edit, · view, edit, delete   · view, edit  · view, edit · view   · view    · view, edit
                  delete
```

Preview screenshot (Playwright captured after the download completes):
`memory/v58_13_132gd_02_after_download.png`.

## Archive lifecycle diagram

`docs/diagrams/archive_lifecycle.png` renders the four-stage lifecycle
(soft-delete → `archive_audit` write → 30-day restore window → optional
restore OR expire → hard-delete cron sweep) for the 7 CAPTURE modules
that use it (Incidents, Pre-Starts, SSRAs, Risk Assessments, Forms,
Workers/HR Docs, Document Library).

## Download endpoint — curl smoke

```
$ TOKEN=$(curl -sH 'User-Agent: Mozilla/5.0' -X POST "$BASE/api/auth/login" \
    -H 'Content-Type: application/json' \
    -d '{"email":"stephen@paneltec.com.au","password":"…"}' \
    | jq -r .access_token)

# No PIN header → 401
$ curl -sw '\nHTTP %{http_code}\n' -H "Authorization: Bearer $TOKEN" \
    "$BASE/api/docs/manual.docx"
{"detail":"Admin console PIN required in X-Admin-Console-Pin header."}
HTTP 401

# Valid PIN → 200 with the docx bytes + correct headers
$ curl -sw '\nHTTP %{http_code} · %{content_type} · %{size_download}\n' \
    -o /tmp/manual.docx -D /tmp/hdrs.txt \
    -H "Authorization: Bearer $TOKEN" \
    -H "X-Admin-Console-Pin: 3310" \
    "$BASE/api/docs/manual.docx"
HTTP 200 · application/vnd.openxmlformats-officedocument.wordprocessingml.document · 329093

$ grep -iE '^content-(disposition|type|length):' /tmp/hdrs.txt
content-type: application/vnd.openxmlformats-officedocument.wordprocessingml.document
content-length: 329093
content-disposition: attachment; filename="paneltec_group_platform_manual.docx"
```

## Drift-check sample output

```
$ python3 scripts/check_manual_drift.py
[drift] manual anchor: endpoints=692 · collections=131 · pages=64
[drift] codebase now : endpoints=692 · collections=131 · pages=64
  ✓ endpoints_grep   drift   0.0 %
  ✓ collections      drift   0.0 %
  ✓ pages            drift   0.0 %
[drift] manual is within tolerance — no regeneration needed.
```

Exit code 0 when within 5 % tolerance on all three axes; 2 when any
axis drifts. Suitable for a pre-commit hook or CI smoke.

## Tests

* **Pytest** — `backend/tests/test_v58_13_132gd_manual_followups.py`
  (12 tests):
    * Source pins: docs endpoint registered in `server.py`; module
      wires the shared `_check_lockout` / `_record_failure` /
      `_reset_attempts` PIN-lockout helpers + `FileResponse` streaming;
      `regenerate_manual.py` carries the openapi collector +
      permission-matrix subprocess + archive_lifecycle diagram spec;
      MyProfile FE has the ManualDownloadCard with all six required
      test-ids; drift-check script has the tolerance + parser + fail
      branch.
    * Behavioural: 401 without PIN header; 200 + docx bytes + correct
      headers with valid PIN; 403 for worker role (skipped if fixture
      unavailable); drift-check exits clean after regeneration.
    * Wrong-PIN negative — deliberately **skipped** per Stephen's
      standing rule; covered by source pins.

* **Playwright** — `scripts/verify_132gd.py`:
    * Login as Stephen → `/app/profile` → "Download manual" card
      visible → open PIN modal → type valid PIN → submit → assert
      `page.expect_download()` fires with the right filename → save
      + validate docx (`PK` magic + ≥100 KB).

## Standing rules honoured

* No `testing_agent`, no `e1_tester`, no `finish`.
* `/app/mobile/` untouched.
* CRA — no Vite migration.
* 3-web-file version bump → `paneltec-v160.3.9.58.13.132gd`.
* Commit: `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify`.
* Playwright wrong-PIN branches skipped for Stephen; source pins cover
  the negative paths.
* 20 `ephemeral-upload-storage` warnings still parked for `v58.14.x`.
* Manual regenerated at ship close so the new endpoint + version land
  in the `.docx` shipped with this commit.

## How to regenerate

```
python3 scripts/regenerate_manual.py
python3 scripts/check_manual_drift.py   # sanity: exit 0
```

## Open follow-ups (deferred)

* CI hook (git pre-commit or CI job) — `scripts/check_manual_drift.py`
  is written but not yet wired into `.git/hooks/pre-commit`; the docs
  team can copy the one-liner from this memo into their own hook
  config.
* Auto-regen when router/collection count drifts — currently the
  drift-checker only *warns*; auto-regen would be a follow-up.
