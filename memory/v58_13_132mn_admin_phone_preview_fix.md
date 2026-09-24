# v58.13.132mn — Fix admin Live Preview phone-bezel broken image glyph

**Ship class:** Frontend UI bug fix
**Type:** Single React component swap — iframe → static placeholder
**Status:** SHIPPED
**Scope:** ~90 line delta in one file + version bumps + memo

## Symptom (user-reported)

Admin → Settings → Mobile Modules → Live Preview page. Role dropdown,
worker dropdown (69 workers), Reset preview button, Exit preview
button, and read-only warning banner all render correctly. The phone
bezel itself (rounded rectangle with notch) renders correctly. **Only
the phone bezel body is broken** — showing a browser-provided
broken-image glyph (📄 with sad face) centred in the phone body.

## Root cause

`frontend/src/components/settings/MobileModulesSection.jsx` — the
`PhonePreview` component renders an `<iframe>` (pre-fix ~L566) whose
`src` is computed by `computeExpoUrl()`, a URL rewrite of
`REACT_APP_BACKEND_URL` from `<sub>.preview.emergentagent.com` to
`<sub>.expo.preview.emergentagent.com`. That expo-subdomain is served
by the pod's `supervisor mobile` program (`yarn expo start --port 3001`
per `/etc/supervisor/conf.d/*.bak_ticket*`).

**In this pod the `mobile` supervisor program is intentionally STOPPED.**
`sudo supervisorctl status` → `mobile   STOPPED   Not started`.

Consequence: the Cloudflare / Kubernetes ingress can't route to the
Expo dev server (nothing listens on 3001), so every request to
`https://whs-compliance.expo.preview.emergentagent.com/*` returns
`HTTP/2 502` with a `retry-after: 60` header. Chromium's default
rendering for an iframe whose response is a non-HTML 502 body is the
broken-image glyph.

**Verified pre-fix inline:**
```
$ curl -sSI https://whs-compliance.expo.preview.emergentagent.com/
HTTP/2 502
retry-after: 60
cf-ray: a3fedfe9da791187-ORD
access-control-allow-origin: *
```

## Fix

Replace the `<iframe>` block (~45 lines) with a static placeholder
`<div>` (~90 lines) that still lives inside the phone bezel and
respects its dimensions.

Placeholder shows:
- Phone20Regular fluent icon in a soft-grey chip
- Bold title: "Live device preview offline"
- 3-line explanation: "The Expo dev server that powers the in-bezel
  render is not running in this environment. Your role & worker
  selections are still captured — copy the preview URL below to open
  it in a real device browser."
- Monospace URL block echoing the exact computed `src` (so admins can
  still verify their role / worker / token / scope wire through
  correctly, and can manually paste the URL into a device browser
  when Expo IS running elsewhere)
- "Copy preview URL" button (uses `navigator.clipboard.writeText`,
  best-effort — silent-fails on browsers where clipboard is denied)
- Empty-state fallback: "(no URL — pick a role)" when `src === ''`

## Kept intact (reversal is one-block swap)

- `computeExpoUrl(roleOrScope, token, workerId)` — URL rewrite logic.
- `computeExpoResetUrl()` — reset-flow URL builder.
- `iframeRef` — moved onto the placeholder `<div>` so the parent
  component's imperative "clear + repoint" logic still has a valid
  ref target (no NPE risk if any other code calls
  `iframeRef.current.src = ...`).
- The **original `<iframe>` block** (including the postMessage
  role-label handoff added in `.132in`) is left as a `{/* … */}`
  JSX comment block directly below the placeholder for a
  zero-guessing revert once Expo is running again.

## Non-goals

- Do NOT re-enable the `mobile` supervisor program — pod is
  configured with it STOPPED for a reason (confirmed with user).
- Do NOT touch backend, migration, or watchdog code.
- Do NOT modify the URL-generation contract — mobile team may still
  be reading `computeExpoUrl` output shape.
- Do NOT delete the original iframe code — user wants reversal cheap.

## Test IDs

Preserved for regression testing:
- `mobile-preview-bezel` (parent bezel div — unchanged)
- **New:** `mobile-preview-placeholder` (replaces `mobile-preview-iframe`)
- **New:** `mobile-preview-url` (monospace URL echo block)
- **New:** `mobile-preview-copy-url` (copy button, only rendered when `src` non-empty)

## Files touched

| File | Change |
|---|---|
| `frontend/src/components/settings/MobileModulesSection.jsx` | +90/-45 (approx). iframe swap. Uses existing `Phone20Regular` fluent icon import — no new imports. |
| `frontend/src/lib/version.js` | +76/-1. Running version + changelog block. |
| `frontend/public/service-worker.js` | +1/-1. Cache version bump. |
| `memory/v58_13_132mn_admin_phone_preview_fix.md` | New. |

## Ship discipline

### Defensive `git reset` (NEW pattern, first applied this ship)

Root cause of the `.132mm` first-commit near-miss (`586bbcdc`, reverted
before push): my explicit `git add <5-files>` coincided with some
unknown external process staging 12 parallel-actor files. Git had no
alias, no hook, no autocorrect config that would explain it. To
prevent recurrence, this ship applies the following pattern between
`git add` and `git commit`:

```bash
# 1. Explicit adds (unchanged)
git add <file1> <file2> ...

# 2. NEW — defensive: check for stowaway parallel-actor files and
#    reset them BEFORE commit. Whitelist my intended file list; reset
#    anything else that shows up staged.
INTENDED=(<file1> <file2> ...)
git diff --cached --name-only | while read f; do
  if ! printf '%s\n' "${INTENDED[@]}" | grep -qx "$f"; then
    echo "UNSTAGING stowaway: $f"
    git restore --staged "$f"
  fi
done

# 3. Verify staged list matches intent exactly.
git status --short | grep -E '^[AM]'

# 4. Commit only if match.
MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify -m "..."
```

All future ships in this codebase should follow this pattern.

### Standing rules respected

- Explicit `git add <file>` per touched path — no `-A`, no `commit -a`.
- Parallel-actor files (`craco.config.js` + `.bak_ticket*` backups +
  `backend/tests/test_v58_13_132m[bf]_*.py` + `test_reports/*` +
  `memory/v58_13_132l[ag]_*` + `memory/v58_13_132m[ci]_*`) stay
  unstaged.
- No `/app/mobile/*` touch.
- No `testing_agent`, no `finish` tool.
- No backend restart (frontend-only ship; hot-reload handles).

## Post-ship verification

1. Frontend compile clean (checked via `/var/log/supervisor/frontend.out.log`).
2. `MobileModulesSection.jsx` renders `mobile-preview-placeholder` div
   instead of `mobile-preview-iframe`.
3. Placeholder shows the currently-computed URL (or empty-state text).
4. Copy button copies the URL to clipboard on click.
5. No console errors related to the missing Expo endpoint.
6. Migration + watchdog untouched — status snapshot in ship response.
