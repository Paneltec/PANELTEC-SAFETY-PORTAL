# Ship Memo — v58.13.132jd: Fix Dead Operator Signature Pad on Native

## Date: 2026-09-20
## Version: 1.0.21 / versionCode 143
## Bundle: paneltec-v160.3.9.58.13.132jd

## Root Cause

The signature field in the Form Runner was a **static placeholder** — a `<View>` with an icon and "Tap to sign" text but **NO actual drawing canvas** and **NO onPress handler**. The library `react-native-signature-canvas` v5.0.2 was installed in `package.json` but never imported or used anywhere in the codebase. The signature field was literally dead on both web and native.

## Fix

Created `/app/mobile/src/components/SignatureField.tsx` — a reusable signature component that:

1. **Placeholder state**: Orange dashed border, "Tap to sign" text, tappable
2. **On tap**: Opens a full-screen `Modal` with `react-native-signature-canvas`
3. **Drawing modal**: 
   - Header: Cancel / label / Done button (disabled until first stroke)
   - Canvas: white background, black pen, baseline guide at 25% from bottom
   - Footer: Clear button
   - Saves as base64 data URL on "Done" tap
4. **Signed state**: Shows signature preview image, "Re-sign" and "Clear" buttons
5. **Haptic feedback**: Light on stroke end (confirms touch), Medium on save

### Why full-screen modal?
The Form Runner uses a `ScrollView`. Embedding a signature canvas inline would cause gesture conflicts (scroll vs draw). The modal approach:
- Completely avoids gesture conflict
- Gives full screen real estate for drawing
- Works reliably on both Android and iOS native
- Clear UX: open → draw → done

### Review mode
Updated the signature field review summary:
- `"Signed ✓"` when signature data URL is present
- `"Not signed"` when null/empty

## Files Touched

### New
- `mobile/src/components/SignatureField.tsx` — Reusable signature field component

### Modified
- `mobile/app/forms/[id]/index.tsx` — Imported SignatureField, replaced static placeholder with real component, updated review summary, removed unused placeholder styles

### Bumped
- `mobile/app.json` — version 1.0.21, versionCode 143
- `mobile/src/lib/version.ts` — 132jd

## Screens Using Signature

The signature field is ONLY referenced in the generic Form Runner at `/forms/[id]/index.tsx`. This is the single entry point for ALL form types:
- Pre-Start (15 templates including "Excavator Pre-start")
- SWMS (2)
- Inspection (4)
- Incident (3)
- Hazard, Risk Assessment, Site Diary, Toolbox, General, Admin

**Fixing it in the Form Runner fixes ALL forms with signature fields in one shot.**

## Library

`react-native-signature-canvas` v5.0.2 (already installed, now used):
- WebView-based (uses `signature_pad` JS library internally)
- Handles touch routing correctly in the WebView
- `onOK(base64)` callback for saving
- `onEnd()` callback for stroke completion
- Ref API: `clearSignature()`, `readSignature()`

## EAS Build
- Build ID: `7056098d-32d6-4503-b8c8-df25d1eec613`
- Profile: preview-apk
- Version: 1.0.21 / versionCode 143
