# v58.13.132cw — APK cleanup + gitignore + history rewrite — **INCIDENT REPORT** (finish deferred)

## TL;DR

**Ship succeeded for its stated purpose** (APKs purged from git history, `.gitignore` primed, endpoint patches verified), **but caused a catastrophic side-effect**: `git filter-repo --force` performed a `git reset --hard` + working-tree clean, obliterating **9 ships worth of uncommitted work** (`.132cm` through `.132cu`) from the working tree. Only Emergent checkpoint rollback can recover those changes.

**Stephen — recommendation: rollback the container to the Emergent checkpoint immediately before this ship (`.132cu` finish), then re-run just the APK-cleanup portion of `.132cw` with `git stash` protection.** Do NOT push the current state to GitHub — the current HEAD is at `.132cl` (rewritten) and is missing all subsequent work.

---

## What worked (the APK-cleanup goal)

1. **APK inventory** (pre-delete):
   - `paneltec-field-app-v58.13.132ag.apk` — 115 MB
   - `paneltec-field-app-v58.13.132ai.apk` — 111 MB
   - `paneltec-field-app-v58.13.132al.apk` — 111 MB
   - `paneltec-field-app-v58.13.132at.apk` — 117 MB
   - **Total:** 452 MB across 4 files.
   - `android_manifest.json` (690 B) also removed for consistency (endpoint was returning `available:true` while file was gone).
2. **Working-tree deletion** — successful (`rm -v`).
3. **`.gitkeep` placeholder** created at `backend/static/downloads/.gitkeep`.
4. **`.gitignore` entry** appended:
   ```
   # =====================================================================
   # v58.13.132cw — Mobile APK artefacts. Not source; produced by EAS Build.
   # Delivered to phones via /api/mobile/downloads/android/latest.apk from
   # `backend/static/downloads/`. The directory itself is preserved via a
   # .gitkeep placeholder so the endpoint's file-lookup path exists on a
   # fresh clone; the actual .apk binaries stay out of git.
   # =====================================================================
   backend/static/downloads/*.apk
   ```
5. **`git filter-repo`** installed (`pip install git-filter-repo` → 2.47.0) and executed:
   ```
   git filter-repo --path-glob 'backend/static/downloads/*.apk' --invert-paths --force
   ```
   Output: `Parsed 728 commits · New history written in 5.15 seconds · HEAD is now at c2f5960 v58.13.132cl`.
6. **History verification** — clean:
   ```
   $ git log --all --full-history --oneline -- 'backend/static/downloads/*.apk'
   (empty — no matches)
   ```
7. **Object stats** — mixed:
   - Before: `size-pack: 132.15 MiB · loose: 388.81 MiB · packs: 1`
   - After:  `size-pack: 150.05 MiB · loose: 0 B · packs: 1`
   - Interpretation: the pack grew slightly (rewritten commits added new objects) but the ~390 MB of loose objects was fully repacked/purged. **Net .git footprint reduction ≈ 370 MB.**
8. **Endpoint verification** (post-cleanup):
   - `GET /api/mobile/downloads/android/version` → `HTTP 503 {"available": false, "reason": "no APK published yet", "message": "Contact your admin — Android APK build pending."}`
   - `GET /api/mobile/downloads/android/latest.apk` → `HTTP 503 {"detail":"No APK published yet — contact your admin."}`
   - Both endpoints degrade gracefully; no 500s. The existing `mobile_downloads.py` (`.132ah`) already handles the missing-file case correctly.
9. **Remote status** — `git filter-repo` intentionally strips the `origin` remote so a naïve `git push` cannot silently overwrite the upstream. Stephen must re-add:
   ```
   git remote add origin git@github.com:<paneltec>/<repo>.git
   git push --force-with-lease origin main
   ```

## What broke (the incident)

**Root cause:** `git filter-repo` with the `--force` flag on a dirty working tree performs a **`git reset --hard` + `git clean -fdx` at the end** (per the filter-repo docs — "does not preserve uncommitted or untracked changes"). The pre-flight `git status` showed **21 uncommitted changes**:

- **Modified (11):** `.emergent/emergent.yml`, `backend/auth_mobile_pin.py`, `backend/mobile_onboarding_cards.py`, `backend/permission_presets.py`, `backend/server.py`, `frontend/public/service-worker.js`, `frontend/src/lib/programSchematic.js`, `frontend/src/lib/version.js` — all reset to their `.132cl` HEAD state.
- **Added / staged (10):** `backend/program_schematic_overlays.py`, `backend/scripts/backfill_asset_division_v58_13_132cn.py`, `backend/scripts/reset_permission_presets_v58_13_132co.py`, `backend/scripts/seed_stephen_guy_mobile_pin_v58_13_132cq.py`, `backend/tests/test_v58_13_132cm/cn/co/cp/cq/cr/cs/ct/cu_*.py` — **9 test files** — all deleted from the working tree.
- **Untracked (memos):** `memory/v58_13_132cm/cn/co/cp/cq/cr/cs/ct/cu_*_shipped_finish_deferred.md` — **9 memos** — all deleted.
- **Untracked (this-ship deletion):** `backend/static/downloads/*.apk` staged for deletion — those APKs were also removed from the rewritten history (so `--force` was actually harmless for the APK deletion path itself).

**Also gone:** `frontend/src/pages/settings/ProgramSchematicPage.jsx` was modified in the `.132cr/cs/ct/cu` chain; those modifications are reverted to `.132cl` HEAD state.

**Not affected:**
- All commits through `.132cl` (rewritten to remove APKs but otherwise intact).
- Untracked memos from `.132c` through `.132cl` (older than the wipe window — apparently git-clean scoped to newer files or filter-repo's clean was partial).
- `backend/static/downloads/.gitkeep` (untracked, created after filter-repo).
- `.git/filter-repo/` metadata (commit-map, ref-map, changed-refs) — could be forensic if needed.

**Reflog and dangling objects:** Empty. `git fsck --dangling` returned nothing. No recovery possible from within git.

## Full list of ships obliterated (per pre-flight `git status`)

| Ship | Touched (per session log) | Status |
|---|---|---|
| `.132cm` | Expo web preview CORS fix + version bump | **LOST** |
| `.132cn` | Fleet Ranger + VTS division backfill; User drawer QR shortcut | **LOST** |
| `.132co` | Permission presets clean slate (4 core roles) | **LOST** |
| `.132cp` | CORS wildcard + mobile PIN field logic fix | **LOST** |
| `.132cq` | Stephen Guy PIN seed (`3310`) + debug breadcrumb removal | **LOST** |
| `.132cr` | Program Schematic Mobile cluster + editable overlay | **LOST** |
| `.132cs` | Program Schematic Mobile real contents (26 nodes) | **LOST** |
| `.132ct` | Program Schematic Mobile tab-based sub-clusters | **LOST** |
| `.132cu` | Program Schematic Mobile real-runtime contents + parent-path labels (81 nodes / 20 sub-clusters / 41 form templates) | **LOST** |

**Also lost:** the `.132cw` memo I was about to write for this ship itself (this file is a rewrite from memory).

**Interestingly preserved:** `db.program_schematic_overlays` in Mongo — 47 documents Stephen created via the `.132cr` UI editor. Since Mongo is external to git, the overlays are intact. So the *user data* from those ships is fine; only the *code* is gone.

## Recovery paths

### Option A (Recommended) — Emergent checkpoint rollback

Rollback the container to the checkpoint immediately before the `.132cw` ship started. That state had all 21 uncommitted files present. Then:

1. **First,** `git stash push -u -m "132cm-cu WIP"` to stash the uncommitted work (including untracked files with `-u`).
2. Re-run only the APK-cleanup portion:
   ```
   rm backend/static/downloads/*.apk
   rm backend/static/downloads/android_manifest.json   # optional
   touch backend/static/downloads/.gitkeep
   # append `.gitignore` block for `backend/static/downloads/*.apk`
   git filter-repo --path-glob 'backend/static/downloads/*.apk' --invert-paths --force
   ```
3. `git stash pop` to restore all `.132cm-cu` uncommitted work.
4. Bump `version.js` (RUNNING, EXPECTED_CACHE) + `service-worker.js` (CACHE_VERSION) to `.132cw` in lockstep.
5. Re-run pytest gate.

### Option B — Rebuild `.132cm-cu` from prior memos + Mongo state

Every ship has a `_shipped_finish_deferred.md` memo that documents the exact diff. Those memos were deleted in the wipe, but earlier session transcripts / analysis blocks may still have them in a fork history. Stephen would need to reconstruct 9 ships from memory + memos + Mongo state.

**Risk:** high — 9 ships with subtle diffs is a lot of surface area to re-derive.

### Option C — Accept the loss, roll forward from `.132cl`

If the rewritten `.132cl` history is acceptable (APK-free), Stephen could push this state to GitHub and re-do `.132cm-cu` as fresh commits on top. This is faster than Option B but means the git history line skips `.132cm-cu`, which will confuse future audits.

## Ship-rule violations

- **Version bump did not land.** `frontend/src/lib/version.js`, `frontend/public/service-worker.js` are back to `.132cl`. The `.132cw` bump lasted ~30 seconds in the working tree before filter-repo reverted it. **Three-way version sync is NOT at `.132cw`.**
- **No pytest gate for `.132cw`** (there was no code test to run — `.132cw` is repo-hygiene, not runtime — but the *previous* ships' tests are now missing so no regression sweep is possible).
- **Filter-repo did not preserve WIP.** Should have `git stash push -u` first. My mistake.

## Preventive playbook for future filter-repo runs

Enshrine this in the ship playbook and any `.132c*` filter-repo doc:

1. `git stash push --include-untracked --message "pre-filter-repo WIP"` **before** any filter-repo invocation.
2. Or: `git commit -am 'wip: pre-filter-repo snapshot'` on a throwaway branch.
3. Only then run `git filter-repo` — WITHOUT `--force` (which requires a clean tree, forcing you to stash first anyway).
4. `git stash pop` **after** filter-repo completes to restore WIP.
5. Fresh `git reflog` after the pop and verify no data loss.

## Stephen — what I need from you

- **Confirm rollback path (A / B / C).** My strong recommendation: **A**.
- Do **NOT** `git push` in the current state — HEAD is a rewritten `.132cl` and missing 9 ships.
- If you rollback: I'll re-execute `.132cw` correctly (stash-first) + re-produce this memo.
- If you don't rollback: I can start reconstructing `.132cm-cu` from memory + Mongo state, but strongly prefer the rollback.

## Ship rules honoured (partial)

- No `finish` tool used.
- No `testing_agent` / `e1_tester`.
- No writes to `/app/mobile/`.
- APK purge from history: **complete**.
- Endpoint verified graceful: **complete**.
- Working tree preservation: **FAILED**.
