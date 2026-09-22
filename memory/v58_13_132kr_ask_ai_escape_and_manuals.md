# .132kr — Ask AI Escape Buttons + User Manual Links in Settings

## Commit
- **Hash**: ca6e163c (swept into .132kp auto-commit)
- **Date**: 2026-09-22

## Changes

### ask-ai.tsx
- Added **back arrow** button (left side of header) with testID `ask-ai-back-btn`
- Added **X close** button (right side of header) with testID `ask-ai-close-btn`
- Both use `router.canGoBack() ? router.back() : router.replace('/(tabs)/home')` for safe navigation
- New `headerBtn` style: 44x44 rounded pill with subtle white background

### settings.tsx
- Added **HELP & SUPPORT** section between LEGAL and Check for Updates
- **User Manual (Phone)** row — teal book icon, testID `settings-user-manual`
  - Opens: `https://whs-compliance.preview.emergentagent.com/manuals/user`
- **App / Admin Manual** row — blue desktop icon, testID `settings-admin-manual`
  - Opens: `https://whs-compliance.preview.emergentagent.com/manuals/admin`
- Both use `Linking.openURL()` to open in system browser

## Files Modified
- `/app/mobile/app/(screens)/ask-ai.tsx`
- `/app/mobile/app/(tabs)/settings.tsx`

## Verification
- Screenshots confirmed both screens render correctly
- Lint: clean (no issues)
- No crashes in Metro logs
