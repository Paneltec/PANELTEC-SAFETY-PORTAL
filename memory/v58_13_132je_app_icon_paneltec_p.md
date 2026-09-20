# Ship Memo — v58.13.132je: Replace App Icon with Paneltec Group P Logo

## Date: 2026-09-20
## Version: 1.0.22 / versionCode 144
## Bundle: paneltec-v160.3.9.58.13.132je

## Source Asset Investigation

### Brand colors extracted from `/app/frontend/public/brand/icon-512.png`:
- **Paneltec Orange**: `#F57E25` (dominant, 4705 pixels in source)
- **Paneltec Grey**: `#5C5D60` (secondary)

### Source assets found:
| File | Size | Description |
|---|---|---|
| `frontend/public/brand/icon-512.png` | 512x512 RGBA | Full "THE PANELTEC GROUP" logo with stylized P + text on white |
| `frontend/public/brand/icon-maskable-512.png` | 512x512 RGBA | Orange chevron on navy — old "orange arrow" icon |
| `frontend/public/brand/logo-512.png` | 512x512 RGBA | Same as icon-512.png |
| `frontend/public/brand/mark.png` | 48x48 RGBA | Tiny full logo (unusable at this size) |

### Previous app icon (replaced):
- `mobile/assets/icons/icon.png` — 1024x1024 orange chevron on navy blue (the "orange arrow" user didn't want)
- `mobile/assets/icons/adaptive-icon.png` — same chevron

### Decision:
The existing P mark in the source logo was only 98px wide within the 512px canvas — too small to crop and upscale. The mobile Wordmark component renders the brand mark as a **white chevron on orange square** (this is what the user sees on the cover screen and calls "the P"). Generated a clean, high-resolution 1024x1024 icon using image generation with the exact brand orange (#F57E25) — bold white P mark centered on solid orange background.

## Icon Files Created/Replaced

| File | Size | Description |
|---|---|---|
| `mobile/assets/icons/icon.png` | 1024x1024 RGB | White P on #F57E25 orange — iOS app icon |
| `mobile/assets/icons/adaptive-icon.png` | 1024x1024 RGB | Same — Android adaptive icon foreground |
| `mobile/assets/icons/splash-icon.png` | 512x512 RGB | Same P mark — splash screen |
| `mobile/assets/images/favicon.png` | 196x196 RGB | Same — web favicon |

## app.json Changes

```json
"icon": "./assets/icons/icon.png",
"splash": {
  "image": "./assets/icons/splash-icon.png",
  "resizeMode": "contain",
  "backgroundColor": "#F57E25"
},
"android": {
  "adaptiveIcon": {
    "foregroundImage": "./assets/icons/adaptive-icon.png",
    "backgroundColor": "#F57E25"
  }
},
"web": {
  "favicon": "./assets/images/favicon.png"
}
```

## Brand Orange
`#F57E25` — extracted from the existing web frontend brand asset at `frontend/public/brand/icon-512.png` using PIL pixel analysis.

## EAS Build
- Build ID: `7ed27984-569d-4044-96ac-fe04d33172d9`
- Profile: preview-apk
- Version: 1.0.22 / versionCode 144
