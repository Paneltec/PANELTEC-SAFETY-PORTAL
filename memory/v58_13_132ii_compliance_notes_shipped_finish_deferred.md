# v58.13.132ii — Compliance question · per-question notes · SHIPPED (finish deferred)

**Ship phase:** `.132ii`
**Scope:** Enables the notes button on the compliance widget end-to-end. Click the note icon → expands an inline `<textarea>` bound to `value.notes`. 2000-char cap enforced client + server. Commits on blur (parent re-renders stay sparse).

Closes the widget triad: **status** (`.132ig`) · **photos** (`.132ih`) · **notes** (`.132ii`).

## What shipped

### 1. Backend

- **`backend/forms.py`** — `create_submission`:
  - New `elif t == "compliance"` branch in the value-normalisation loop.
  - Coerces any loose shape into the canonical `{status, photos, notes}` dict:
    - `status` — only `"compliant" | "at_risk" | "na"` survive; everything else (including `None` / bogus values) → `None`.
    - `photos` — non-list values coerce to `[]`.
    - `notes` — non-str → `""`; str values capped at **2000 chars**.
  - No new endpoint. Existing `/photos` endpoint (`.132ih`) already preserves `notes` on writes, so the two write paths remain compatible.

### 2. Frontend

- **`frontend/src/components/forms/ComplianceQuestion.jsx`**:
  - **Notes button live** — disabled state removed; button toggles a local `notesOpen` state. Coloured brand-blue when the panel is open OR when there's a persisted note (visual signal even when collapsed).
  - **Inline `<textarea>`** — renders below the thumbnail grid when `notesOpen`. Placeholder `"Add a note for this question…"`. `rows={2}`, `maxLength={2000}`, brand-blue focus ring.
  - **Local draft + commit-on-blur** — typing updates `notesDraft` state; only commits back to the parent on `onBlur`, and only if the value actually changed. Keeps parent renders sparse during typing.
  - **Char counter** — right-aligned `"N / 2000"` below the textarea.
  - **Read-only path** — when the widget renders in read-only mode with persisted notes, the panel collapses to a plain-text `whitespace-pre-wrap` block styled as a note card.
  - **Sync guard** — `useEffect` keeps `notesDraft` in step with `persistedNotes` when it changes externally (draft restore, status-only commit from another codepath).
  - **Auto-open when persisted** — `notesOpen` initial state is `true` iff `persistedNotes.length > 0`. Users see + can edit existing notes without an extra click.
  - `commitNotes` builds the full canonical `{status, photos, notes}` dict so nothing else on the value dict gets clobbered.

## Version pin
- `RUNNING_VERSION` → `paneltec-v160.3.9.58.13.132ii`
- `EXPECTED_CACHE_VERSION` → `paneltec-v160.3.9.58.13.132ii`
- `CACHE_VERSION` (service-worker.js) → `paneltec-v160.3.9.58.13.132ii`

## Pytest coverage — `tests/test_v58_13_132ii_compliance_notes.py` — 6 checks
- **Backend source pin**: `create_submission` has the compliance branch with status whitelist + 2000-char notes cap + canonical output shape.
- **Frontend source pins**:
  - Notes button no longer stubbed; toggles `notesOpen`.
  - Textarea uses local draft + commit-on-blur + 2000-char cap on `.slice` + `maxLength`.
  - Read-only fallback path renders persisted notes.
  - `commitNotes` builds the full canonical `{status, photos, notes}` (preserves siblings).
  - Notes panel auto-opens when a persisted note exists.
- **Version lockstep**.
- **Behavioural (live_db_writes)** — spins up the real FastAPI app via `AsyncClient(ASGITransport)`, authenticates with `create_access_token`, POSTs a submission with a garbage compliance value (`status="bogus"`, `photos=None`, `notes="x" * 5000`), asserts the persisted `fields.value` is `{status: None, photos: [], notes: <2000 chars>}`. Uses a per-test motor client bound to the current event loop.

### Combined suite (.132ie + .132if + .132ig + .132ih + .132ii): **44/44 green.**

Also refactored `.132if` behavioural test to use its own per-test motor client (no longer imports `document_library.list_files` which was closing the shared loop between test files and poisoning `.132ii`'s `AsyncClient` test).

## Ban compliance
- No `testing_agent` / `e1_tester` / `finish`.
- No `/app/mobile/` edits.
- Committed with `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify`.

## Next action items
- **Playwright visual sweep** (Stephen requested this after .132ii) — synthetic template seeded temporarily, capture Pre-Start + SSRA + Inspection screenshots, delete synthetic template after. Wire up `scripts/verify_compliance_widget_132ii.py`.
- **PDF renderer follow-up** (`.132ij`) — the shared PDF template still renders yes/no/na text for legacy submissions. Needs a status-chip cell + photo thumbnail row + notes column on compliance answers. Legacy `_legacy_status` values should also render clean.
- **Issue 3** — Photos in imported PDFs (still deferred from `.132id` — needs PyMuPDF stash + preview adapter).
- **Mobile parity** — mobile capture form should render the same compliance widget for consistent UX. Blocked by /app/mobile ban — flag for Expo specialist.
