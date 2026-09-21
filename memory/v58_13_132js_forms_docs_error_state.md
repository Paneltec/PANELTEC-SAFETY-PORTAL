# .132js — Error-State UI + Focus Refetch for Forms & Docs Tabs

## Problem
Forms and Docs tabs silently showed empty state when JWT expired (401). React-query swallowed errors; no error UI was rendered; stale data persisted because tabs don't unmount.

## Root Causes
1. `forms.ts` used raw axios — 401 threw AxiosError, react-query retried & failed silently
2. `forms.tsx` never checked `isError`/`error` from useQuery — showed empty list
3. `docs.tsx` only checked `rootError` for SESSION_EXPIRED, not subfolder/file errors
4. No `useFocusEffect` — tabs don't unmount, stale data persisted on re-focus
5. No `focusManager` wired — react-query didn't refetch on app foreground

## Fix (4 files)
1. **`forms.ts`** — Added `SessionExpiredError` class; all axios calls now detect 401 and throw it; `authHeaders()` throws if no JWT stored
2. **`forms.tsx`** — Added `isError`/`error` from useQuery; error banner UI (cloud-offline icon + retry button); session expiry redirect; `useFocusEffect` refetch; skip retry on SessionExpiredError
3. **`docs.tsx`** — Added `isError`/`error` to all 3 queries (root, sub, files); unified session expiry detection across all queries; error banner with retry; `useFocusEffect` refetch
4. **`_layout.tsx`** — Wired react-query `focusManager` to `AppState` (foreground → refetch stale queries)

## Commit
`516fd7e0` — 2026-09-21
