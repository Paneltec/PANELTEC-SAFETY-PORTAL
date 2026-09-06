# Styling Audit Ship Memo — v58.13.132f

## Summary
Visual alignment pass across all M5 screens to match the 11 approved mockups. Consolidated theme tokens, fixed visual drift, standardised all headers/cards/buttons/toggles.

## Per-Screen Delta List (Before → After)

### Home (mockup #10)
| Before | After |
|--------|-------|
| Flat 19-tile grid, no hierarchy | **6 primary tiles** in 3×2 grid (Sites, Report Hazard, Pre-Start, Site Diary, Inspections, Profile) |
| All 19 tiles equal visual weight | **"More modules"** collapsible section for remaining 13, with count badge |
| Company pill in separate row below header | Company pill **inside navy header** |
| Basic card styling | White surface cards with **iOS 17 soft shadow** (0.06 opacity, 8px radius) |
| Tile icons in generic circles | **Navy filled circles (52×52)** with white icons (matches mockup exactly) |

### Hazards New (mockup #3)
| Before | After |
|--------|-------|
| Flat severity-only form, no category step | **6 category tiles** with colour-coded left borders (Yellow=Slip, Orange=Vehicle, Green=Environmental, Red=Electrical, Blue=Manual Handling, Grey=Other) |
| Grey header | **Navy `#0F172A` header** with white text |
| Basic white field backgrounds | **White card containers** (`borderRadius: 16`) with soft shadow per field group |
| Small submit button at bottom | **Sticky orange footer** with shield icon, always visible |
| AI chips inline | AI analysis in **dedicated amber card** with tap-to-add control chips |

### Pre-Start New (mockup #4)
| Before | After |
|--------|-------|
| Text-only checklist with cycle-through toggle | **Tri-state toggles** (green ✓ / red ✕ / grey N/A) each 40×40 |
| No progress indicator | **Orange progress bar** at top showing completion % |
| Grey header | **Navy header** |
| Basic field layout | **White card containers** with shadow, Date + Crew Lead side-by-side |
| Inline submit button | **Sticky footer** (Save Draft + Submit Pre-Start) |

### Inspections New (matches Pre-Start style)
| Before | After |
|--------|-------|
| Old PASS/FAIL/NA text toggle | Same **tri-state toggle** pattern as Pre-Start |
| No score summary | **Score bar** below header ("8 pass", "0 fail") |
| Basic layout | **Navy header**, white cards, sticky footer |

### Site Diary
| Before | After |
|--------|-------|
| No change needed — already white card style, minimal chrome | Unchanged — matches mockup naturally |

### Tab Bar
| Before | After |
|--------|-------|
| Generic active/inactive colors | **Safety-orange `#F97316`** active tint, **slate-400 `#94A3B8`** inactive |

### Splash (mockup #1)
| Before | After |
|--------|-------|
| Already correct | Verified — navy gradient bg, bold white PANELTEC CIVIL, orange chevron accent |

## Theme Token Consolidation
Added to `src/theme/colors.ts`:
- `slate400: '#94A3B8'` (inactive tint)
- `muted: '#64748B'`

All existing tokens verified:
- `navy = '#0F172A'` ✅
- `orange = '#F97316'` ✅
- `surface = '#FFFFFF'` ✅

No drifting hex codes found in the codebase — all screens use `Colors.xxx` references.

## Test Results
- **13/13 passed** (5 M4 reconciliation + 8 M5 capture) — zero regressions

## Screenshots
1. ✅ Home: 6 primary tiles + collapsed "More modules (13)"
2. ✅ Hazards New: 6 category tiles with colour-coded left borders + AI zone
3. ✅ Pre-Start New: Tri-state toggles + progress bar
4. ✅ Inspections New: Tri-state toggles + score bar
5. ✅ Splash: Navy bg + PANELTEC CIVIL wordmark + orange chevron
6. N/A — before/after collage (deltas documented in table above)
