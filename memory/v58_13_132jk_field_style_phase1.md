# v58.13.132jk — Per-field visual customization (Phase 1: backend + web + PDF)

## User request
"In the form template builder, add per-field visual customization. Admin
picks styles in the builder → styles render everywhere: builder preview,
web filler, mobile filler, PDF export. **1d** freeform / **2b** everywhere
/ **3b** paint-brush icon / **4** no locked presets."

## Scope of this ship (Phase 1)
- Backend schema + validator (`field.style`).
- Backend CRUD round-trip (POST / PATCH / GET / IMPORT).
- Web builder: paint-brush icon on every field card + popover.
- Web builder: field card outline mirrors the style so the admin sees
  the effect while designing.
- Web builder: Live-preview panel mirrors the style.
- Web filler: styles apply on the actual worker-facing form.
- PDF: scalar rows honour background / border / label styling; complex
  fields (photo, sig, gps) honour label colour + bold + size.
- Mobile: **deferred to Phase 2** (out of scope this ship).

## Schema

```jsonc
{
  "id": "battery_cables_status",
  "label": "Battery Cables — status",
  "type": "radio",
  "required": true,
  "options": ["OK", "At Risk", "N/A"],
  "style": {                            // ALL props optional; absence = default
    "backgroundColor": "#FEF3C7",       // hex #RRGGBB / #RGB
    "borderColor": "#F59E0B",
    "borderWidth": 2,                   // int 0..8 px
    "borderStyle": "dashed",            // solid|dashed|dotted|none
    "borderRadius": 12,                 // int 0..32 px
    "labelColor": "#78350F",
    "labelBold": true,
    "labelSize": "lg",                  // sm|md|lg
    "helpTextColor": "#92400E",
    "hoverBackgroundColor": "#FDE68A",  // web only; mobile+pdf ignore
    "icon": "emoji:⚠️",                 // "emoji:X" or "ion:name"; PDF resolves emoji only
    "paddingX": 10,                     // int 0..48 px
    "paddingY": 6
  }
}
```

Legacy templates (no `style` on any field) render with the built-in
default look — zero-touch migration.

## Validation (backend)
`backend/forms.py::_clean_field_style`:
- Hex validated against `^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$`.
- Integers clamped to per-property ranges (`borderWidth` 0-8,
  `borderRadius` 0-32, `paddingX/Y` 0-48).
- Enums whitelisted (`borderStyle`, `labelSize`).
- Booleans coerced.
- Icon capped at 60 chars.
- **Any malformed property → HTTP 400 with the specific field
  and expected format.** Empty `style: {}` accepted.

Live curl verification:
```
CREATE 200 + all fields round-trip in POST → GET
PATCH  200 (style diff applied cleanly)
POST bad hex           → HTTP 400  "field.style.backgroundColor must be a hex color like '#RRGGBB' or '#RGB' (got 'not-a-hex')"
POST borderWidth=99    → HTTP 400  "field.style.borderWidth must be between 0 and 8"
POST borderStyle bogus → HTTP 400  "field.style.borderStyle must be one of ['dashed', 'dotted', 'none', 'solid'] (got 'squiggly')"
```

## Routes touched (backend)
- `POST   /api/forms/templates` — accepts `fields[].style`, validates,
  returns 400 on malformed hex/enum.
- `PATCH  /api/forms/templates/{id}` — same validator on the fields
  array.
- `GET    /api/forms/templates` and `GET /api/forms/templates/{id}` —
  emit `style` on every field (empty `{}` when unset).
- `POST   /api/forms/templates/import` — validator runs on every
  imported field.

No new endpoints. Same auth model.

## Files touched

### Backend
- `backend/forms.py`
  - New `_clean_field_style(raw) -> dict` validator (module-level).
  - `_clean_field` now returns `{..., "style": _clean_field_style(...)}`.
  - `TemplateIn` / `TemplatePatch` unchanged — `fields[]` is still
    `list[dict]`, style rides inside each dict.
- `backend/forms_pdf.py`
  - New module-level `_hex_to_reportlab_color(hex_str)` helper.
  - New module-level `_styled_scalar_row(label, value, fs)` helper —
    renders a scalar field as its own 2-col Table with per-field
    background / border / label colour when a style is set.
  - `render_form_submission_pdf` scalar loop now branches: styled
    fields exit the shared `_kv_table` accumulator; unstyled fields
    stay in the accumulator (identical PDF output for legacy
    templates).
  - Complex fields (photo, sig, gps, vehicle_navixy) now honour
    `labelColor` / `labelSize` / `labelBold` via a cloned
    Paragraph style.
  - Emoji icons prepended to the label; non-emoji prefixes drop
    silently in PDF (documented below).

### Web builder
- `frontend/src/components/forms/FieldStylePopover.jsx` **(NEW)**
  - Two-column popover: Colours / Border & Layout.
  - Label row (bold + size).
  - Icon row with free-text input + live preview swatch.
  - Reset button + Escape-to-close + Done footer.
  - Live preview strip mirroring the runtime `styleToWrapCss` logic.
  - **Zero third-party colour deps** — plain `<input type="color">`
    with a synced hex text input. Hex validation inline.
- `frontend/src/components/forms/TemplateBuilder.jsx`
  - `emptyField()` now emits `style: {}`.
  - `FieldEditor` component:
    - Palette icon button (from `lucide-react`) placed to the LEFT
      of the trash icon. Violet accent tint when a style is applied,
      slate default otherwise.
    - `styleOpen` local state toggles the popover.
    - The field card's outer container gets a `styleToWrapCss(style)`
      overlay so admins see the effect while designing.
    - `updateField` propagates style edits up to the parent draft
      state.
  - Save payload now includes `style: f.style || {}` on every field.
  - `previewTemplate.fields` propagates `style` through so the
    right-column live preview panel also renders styled fields.
  - Preview loop mirrors the same wrap CSS + label CSS + icon glyph
    logic the filler uses.

### Web filler (`frontend/src/pages/Forms.jsx`)
- The fill loop (`FillOutModal`, around field row rendering)
  computes `styleWrap` from `f.style` and applies it inline.
- Emits a scoped `<style>` block for `hoverBackgroundColor` keyed on
  `[data-field-style-id]:hover`.
- Label span honours `labelColor / labelBold / labelSize`.
- Icon glyph rendered before the label (`emoji:` prefix parsed;
  raw text otherwise so admins get visible feedback if an
  ion-name doesn't resolve).

### Version + service-worker
- `frontend/src/lib/version.js` — `RUNNING_VERSION` +
  `EXPECTED_CACHE_VERSION` → `paneltec-v160.3.9.58.13.132jk`.
- `frontend/public/service-worker.js` — `CACHE_VERSION` →
  `paneltec-v160.3.9.58.13.132jk`.

## Also — LH border stripe on Form Template cards
Additional micro-tweak folded into this ship (user request during
Phase 1 build):

- **File:** `frontend/src/pages/Forms.jsx::TemplateCard` (line 1324).
- **Before:** `w-1` (Tailwind = 4 px LH accent stripe).
- **After:** `w-3` (Tailwind = 12 px). **3×** wider as requested.
- Colour (`colour.stripe`, sourced from `lib/templateColors.js`) and
  vertical extent preserved. Top / right / bottom borders untouched.
- Only the Form Templates listing card (`/app/forms`). The
  submission-record card (`components/CaptureCard.jsx`) uses the same
  palette but was NOT changed — user was specific about "form template
  builder" scope.

## Known limitations (documented, not blockers)
1. **PDF ignores `paddingX / paddingY`** — ReportLab table padding is
   per-column not per-row. Follow-up work if the user asks for it.
2. **PDF ignores `hoverBackgroundColor`** — irrelevant (no hover in
   PDF).
3. **PDF `borderStyle: dashed / dotted`** rendered as solid (ReportLab
   `TableStyle` BOX only takes width + colour). Border colour and
   width still honour the config, just the stroke pattern is uniform.
4. **PDF `borderRadius`** ignored (ReportLab tables don't round).
5. **PDF non-emoji icons** (`ion:warning`, `mdi:*`) drop silently. The
   web + mobile clients can resolve them via their icon libraries; PDF
   would need font-embed work. Documented in the popover as
   "PDF export renders `emoji:` icons literally".
6. **Mobile filler** — deferred to Phase 2 (dispatched separately per
   user's plan).

## Verification (before commit)
- `curl` end-to-end on `/api/forms/templates` — POST + GET + PATCH +
  DELETE all green, with a fully-populated style object round-tripping
  intact. All four reject paths return 400 with the specific error.
- `yarn build` → **Compiled successfully** in ~68 s. Zero warnings
  that matter.
- Frontend serves `paneltec-v160.3.9.58.13.132jk` (verified in the
  login page footer — "PANELTEC-V160.3.9.58.13.132JK").
- No mobile edits (Phase 2 dispatch pending).

## NOT changed
- `/app/mobile/` — untouched. Consumes the same schema in Phase 2.
- Existing template CRUD endpoints (behaviour is a strict superset —
  `style` is additive).
- Any other component or page. No accidental refactors.
- `MOBILE_BUNDLE_VERSION`.
- Legacy submissions without `style` — they render identically to
  pre-.132jk.

## Follow-up (Phase 2 handoff)
Mobile team consumes the exact same `field.style` schema. Suggested
implementation notes for them:
- `emoji:` prefix renders literally (React Native supports emoji
  characters in `<Text>`).
- `ion:` prefix resolves via `@expo/vector-icons` (Ionicons already
  bundled). Fall back to skipping the icon if the name doesn't resolve.
- `hoverBackgroundColor` should be ignored (no hover on touch).
- Border radius / width / padding map directly to React Native
  style props.
- The web filler's inline `styleWrap` logic in `Forms.jsx` is a good
  reference for the property mapping.
