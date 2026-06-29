# Iteration 11 — Module Gate (Phase 4.3)

## What was implemented
Per-role mobile module configuration: the admin web panel toggles modules per-role, and the mobile app dynamically shows/hides navigation tabs, capture tools, dashboard metrics, intelligence briefing, and settings links based on the 13-module boolean map returned by `GET /api/me/mobile-modules`.

## Architecture
```
Login → auth.login() → fetchModulesAfterLogin() → cache to AsyncStorage
                                                ↓
AuthContext.refreshModules() ← AppState foreground
                             ← Profile pull-to-refresh
                             ↓
modules state → _layout.tsx (tab gating)
              → dashboard.tsx (metric/capture/briefing gating)
              → capture.tsx (tool gating)
              → settings.tsx (link gating)
```

## Module → Nav mapping
| Module ID | Tab / Screen | How gated |
|---|---|---|
| pre_start | Capture tab + Pre-Starts tool | hasAnyCaptureModule() + individual filter |
| site_diary | Capture tab + Site Diary tool | same |
| hazard | Capture tab + Hazard tool | same |
| incident | Capture tab + Incident tool | same |
| inspection | Capture tab + Inspection tool | same |
| swms | SWMS tool + metric tile | individual filter |
| inductions | Workers settings link | settings link filter |
| plant_vehicles | Vehicles tab | tab href gating |
| service_maintenance | (not shown in current tabs) | deferred |
| certifications | Certifications settings link | settings link filter |
| ask_intel | Ask AI tab + Intelligence Briefing + Ask settings link | tab href + dashboard conditional + settings filter |
| sign_on | QR Sign-On tab | tab href gating |
| profile | Profile tab | always visible |

## Fallback behavior
- API fails + cached map exists → use cached map
- API fails + no cache → SAFE_FALLBACK (sign_on + profile only)
- Yellow "Couldn't load app config" banner shown on dashboard when in SAFE_FALLBACK

## Known limitations
- Worker account is disabled in backend — cannot test worker role toggle live
- service_maintenance module has no dedicated tab yet (out of scope)
- Pull-to-refresh for modules only works on native (web has no pull gesture)

## Files created
- `src/lib/modules.ts`

## Files modified
- `src/lib/AuthContext.tsx`
- `src/lib/auth.ts`
- `app/(tabs)/_layout.tsx`
- `app/(tabs)/dashboard.tsx`
- `app/(tabs)/capture.tsx`
- `app/(tabs)/settings.tsx`
- `app/(auth)/login.tsx`
