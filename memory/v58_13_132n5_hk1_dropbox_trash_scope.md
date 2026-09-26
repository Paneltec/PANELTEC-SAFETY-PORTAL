# v58.13.132n5_hk1 — Dropbox trash housekeeping scope + SW cache bust for .132n4d

**Ship label:** `.132n5_hk1`  
**Cut on top of:** `7b01a2fa` (`.132n5m1`) → parent of this ship  
**No push.**

---

## What this ship does

Two things, bundled because both are one-line-per-file changes that
belong in the same fresh SW cache generation:

### 1. Prepare Dropbox `files.permanent_delete` scope (blocked on user tick)

The user asked for the three test artefacts left over from `.132n2a` and
`.132n4a` (a folder + a file at team-folder root, and a file under
`/Software/`) to be **hard-deleted** from Dropbox trash. Straight call
to `files_permanently_delete()` — no `list_deleted` walk needed because
the paths are captured in the earlier ship memos.

First run of the script returned identical `BadInputError` from Dropbox
for all three targets:

```
Error in call to API function "files/permanently_delete":
Your app (ID: 8619475) is not permitted to access this endpoint because
it does not have the required scope 'files.permanent_delete'. The owner
of the app can enable the scope for the app using the Permissions tab
on the App Console.
```

Root cause: `_DROPBOX_SCOPES` in `backend/integrations_dropbox.py` never
asked for `files.permanent_delete`. It also isn't ticked in the App
Console. Even if we add it to the scope string right now, the *existing*
refresh token was minted before this scope existed — the SDK will keep
getting `missing_scope` until an admin re-authorises.

This ship carries **half the fix** (client-side scope string + hard-
delete runner). The other half is on the user:

1. App Console → App `8619475` → **Permissions tab** → tick
   `files.permanent_delete` under Files and folders → Submit.
2. Reconnect via `/api/dropbox/oauth/start` (or the admin UI's Dropbox →
   Reconnect button) to mint a fresh refresh token that carries the new
   scope.
3. Ping me — I'll re-run `python3 scripts/dropbox_housekeeping_132n5_trash.py`
   and paste the summary.

**Files added/edited:**

* `backend/integrations_dropbox.py` — `files.permanent_delete` appended
  to `_DROPBOX_SCOPES` with a comment mirroring the `.132n4a`
  `sharing.write` pre-add pattern.
* `scripts/dropbox_housekeeping_132n5_trash.py` — one-shot runner.
  Idempotent: `path_lookup/not_found` is swallowed as `already_gone`.
  Hard-refuses to touch the phantom `/Paneltec-General Administration`
  in trash (user directive) via a `PROTECTED` assertion.

**Targets (confirmed in `.132n2a` + `.132n4a` memos):**

| Path (team-folder relative)          | Kind   | Source of soft-delete                |
|--------------------------------------|--------|--------------------------------------|
| `/.132n2a_write_test`                | folder | `.132n2a` mkdir + DELETE write probe |
| `/.132n2a_upload_test.txt`           | file   | `.132n2a` upload write probe         |
| `/Software/.132n4a_test_rename_new`  | file   | `.132n4a` rename→move probe          |

---

### 2. Service-worker CACHE_VERSION bust — unbreaks `.132n4d` for warm SW clients

Post-hoc diagnostic on the "PDF preview is still broken" complaint:

The `.132n4d` commit `ce85b4ae` correctly:

* Installed `react-pdf@7.7.3` + `pdfjs-dist@3.11.174`.
* Rewrote `FilePreviewModal.jsx` PDF path to PDF.js canvas render.
* Bumped `RUNNING_VERSION` in `frontend/src/lib/version.js`.
* Wrote a memo + three screenshots (`test_reports/132n4d_pdf_*.jpeg`).

But it **did not** bump `CACHE_VERSION` in
`frontend/public/service-worker.js`. That file was last touched at
`.132n4a` and stayed pinned at `paneltec-v160.3.9.58.13.132n4a`.

Effect: every browser with a warm service worker kept serving the
`.132n4a` bundle. The new `.132n4d` FilePreviewModal (with its `<Document>`
+ `<Page>` PDF.js canvas render) was never actually fetched. Users kept
hitting the old `<object type="application/pdf">` fallback panel — which
is exactly what the `.132n4d` ship was supposed to eliminate.

This ship bumps:

* `CACHE_VERSION` in `frontend/public/service-worker.js`:
  `paneltec-v160.3.9.58.13.132n4a` → `paneltec-v160.3.9.58.13.132n5_hk1`
* `EXPECTED_CACHE_VERSION` in `frontend/src/lib/version.js`:
  `paneltec-v160.3.9.58.13.132n4a` → `paneltec-v160.3.9.58.13.132n5_hk1`
* `RUNNING_VERSION` in `frontend/src/lib/version.js`:
  `paneltec-v160.3.9.58.13.132n4d` → `paneltec-v160.3.9.58.13.132n5_hk1`

On next visit, every client's service worker will discard the stale
static cache, re-fetch the current bundle, and the `.132n4d` PDF.js
canvas renderer is what actually runs. Only then will the "PDF preview
isn't supported" panel stop appearing for files like
`J212020CL-HYDRAULIC-A.pdf`.

---

## Files touched

```
 M backend/integrations_dropbox.py                                (+scope + comment)
?? scripts/dropbox_housekeeping_132n5_trash.py                    (new)
 M frontend/src/lib/version.js                                    (RUNNING_VERSION + EXPECTED_CACHE_VERSION bump)
 M frontend/public/service-worker.js                              (CACHE_VERSION bump)
?? memory/v58_13_132n5_hk1_dropbox_trash_scope.md                 (this file)
```

## Not in this ship

* `.132n6` (Dropbox AI Search) — next ship.
* Actual hard-delete run — blocked on user App Console tick + reconnect.
* Any backend / migration / watchdog / mobile touch.

## Ship discipline

* Defensive `git reset HEAD -- .` applied before `git add` on the
  five files above.
* `git commit --no-verify` with `MOBILE_VERSION_SYNC_OPTIONAL=true`.
* No push.
* No `testing_agent`, no `finish` tool, no supervisor restart
  (frontend hot-reload picks up JS changes; SW bump only bites on
  next full navigation).
