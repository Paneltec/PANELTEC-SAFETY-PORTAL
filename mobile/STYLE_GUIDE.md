# Paneltec Group Field

The look of the Paneltec Group Field phone app: navy screens, off-white bordered cards, orange icons, and green for "go". Anyone building a screen for the app (a developer, Emergent or Claude) should follow this page so every screen looks like it belongs.

The source of truth is the code in the `Paneltec/PANELTEC-SAFETY-PORTAL` repository: `mobile/src/theme/colors.ts` for colours and `mobile/src/components/ui.tsx` for the shared parts. Build new screens from those parts (`Screen`, `PageHeader`, `BackHeader`, `SectionLabel`, `Tile`, `Panel`, `KV`, `Chip`, `FieldLabel`, `Input`, `Empty`, `Hint`) and `PrimaryButton`. Don't restyle them per screen.

## Who uses it

Field crews of about 65 across Paneltec (civil, excavation) and Viatec (traffic management). They use it outdoors, in bright sun, often with gloves on, and some would rather not use their phone for work. Every screen has to be quick to read and hard to mis-tap.

## Colour rules

- **Every screen is navy** (`screen`). There is no light mode and no white screen.
- **Content sits on off-white cards** (`card`) with a 1px `card-border` and `radius-card` corners. Never use pure white. It's harsh outdoors, and Stephen has asked for a soft off-white.
- **Orange (`orange`) is for icons and the brand**: tile icons, overlines, the active footer tab, and orange buttons. On navy, orange only reaches about 3.8:1 contrast, so keep it for icons, bold overlines and large text, never for body text.
- **Green (`green`) means go or done**: Send, Accept Job, Request Leave, Approved, On Site. Text on green buttons uses `on-green`.
- **Grey is secondary**: `on-screen-muted` for labels on navy, `on-card-muted` for descriptions on cards.
- **Status chips**: waiting or needs-info in orange (`orange-soft-on-navy`), approved in green, not approved in red (`red-soft` and `red-chip`), cancelled in grey.
- `viatec` purple appears only on Viatec company chips.

## Type

The phone's own system font (San Francisco on iPhone, Roboto on Android), with no custom fonts.

- Screen titles are 26px and extra-bold, in `on-screen`, under a 10px orange overline (for example "PANELTEC GROUP").
- Section labels are 11px, extra-bold and uppercase with wide letter spacing, in `on-screen-muted`.
- Tile titles are 15px semibold, and descriptions are 12px.
- Buttons use 16px bold uppercase labels, for example "SEND REQUEST".

## Layout

- 16px side gutter on every screen (`space-4`), with the safe area added at the top.
- Lists of tiles have 8px between tiles (`space-2`) and 18px above each section label.
- Nothing tappable is under 44px. Buttons are 54px tall, tiles at least 66px, inputs at least 48px.
- Pushed screens use `BackHeader` (a chevron and a 22px title) and don't show the footer.

## Footer (tab bar)

Five tabs in this order: **Home · Forms · Fleet · My Work · Settings**.

| Tab | Ionicons (selected / not selected) | Route |
| --- | --- | --- |
| Home | `home` / `home-outline` | `(tabs)/home` |
| Forms | `document-text` / `document-text-outline` | `(tabs)/forms` |
| Fleet | `car` / `car-outline` | `(tabs)/fleet` |
| My Work | `briefcase` / `briefcase-outline` | `(tabs)/my-work` |
| Settings | `settings` / `settings-outline` | `(tabs)/profile` (the route keeps its old name) |

- The bar background is `tab-bar` with a 1px `tab-border` top line, 64px tall.
- The selected tab is `tab-active` (orange) and the others are `tab-inactive`.
- Labels are 10px bold uppercase.
- QR Scan and Toolbox are not in the footer. They open from Home tiles and from Settings.

## Icons

Ionicons from `@expo/vector-icons`, at 20px inside a 40px icon box (`radius-field`, `orange-soft-on-navy` on navy or `orange-soft` on cards) and 24px in the footer. Use the filled icon for a selected or active state and the outline icon otherwise. Don't use emoji.

## Words

Write plainly, the way a supervisor would say it: "Request leave", "Waiting for approval", "Can't reach the office server. Check your signal and try again." Buttons say exactly what happens. Never write "Coming soon"; every tile must open a real screen.

## Colour tokens (from src/theme/colors.ts)

| Token | Value | Use |
| --- | --- | --- |
| `screen` | `#1B3D66` | Background of every screen. The app is always navy; there is no light mode. |
| `screen-deep` | `#122E50` | Footer tab bar background and deeper navy panels. |
| `screen-card` | `rgba(255,255,255,0.06)` | Faint panel on navy, e.g. the 'no job yet' note and confirm boxes. |
| `on-screen` | `#F2F5F9` | Headings and main text directly on navy. |
| `on-screen-muted` | `#B4BFCE` | Secondary text, section labels and field labels on navy. |
| `on-screen-subtle` | `#7F8B9C` | Hints and not-yet-done steps on navy. Low contrast (about 3:1): never use it for text a worker must read. |
| `card` | `#F4F6F9` | Off-white tiles, cards and input fields. Never pure white: Stephen finds stark white hard on the eyes. |
| `card-border` | `#B9C6D6` | 1px border on every card, tile and input, and dividers inside cards. |
| `on-card` | `#1A1A1A` | Titles and values on cards. |
| `on-card-muted` | `#4B4B4B` | Descriptions on cards. |
| `on-card-subtle` | `#8A8A8A` | Chevrons, small uppercase keys and placeholders on cards. |
| `orange` | `#F97316` | Brand orange: icons, overlines, the active footer tab and orange buttons. On navy it is about 3.8:1, so use it only for icons, bold overlines and large text. |
| `orange-light` | `#FDBA74` | Light orange accent. |
| `orange-soft` | `#FFF7ED` | Icon box behind an orange icon on a card, and badges. |
| `orange-soft-on-navy` | `rgba(249,115,22,0.16)` | Orange icon box and summary strips on navy; also the 'waiting' chip background. |
| `green` | `#22C55E` | Go actions (Send, Accept, Request leave), approved and on-site states. |
| `green-soft` | `rgba(34,197,94,0.18)` | Green chip and success banner background. |
| `on-green` | `#062B12` | Text on green buttons. |
| `red-chip` | `#F87171` | Text of the red 'Not approved' chip. |
| `red-soft` | `rgba(239,68,68,0.18)` | Red chip background. |
| `tab-bar` | `#122E50` | Footer tab bar background (same as screen-deep). |
| `tab-border` | `#2E5384` | 1px top border of the footer tab bar. |
| `tab-active` | `#F97316` | Icon and label of the selected footer tab. |
| `tab-inactive` | `#D3DCE8` | Icons and labels of the other footer tabs. |
| `error` | `#EF4444` | Sign Out and destructive text. |
| `viatec` | `#6D28D9` | Viatec company accent, for company chips only. |

## Spacing, radius and sizes

| Token | Value | Use |
| --- | --- | --- |
| `space-1` | 4px | Smallest gap, icon to text in chips. |
| `space-2` | 8px | Gap between tiles in a list. |
| `space-3` | 12px | Tile inner padding; gap inside a tile. |
| `space-card` | 14px | Card and panel inner padding. |
| `space-4` | 16px | Screen side gutter. Every screen has 16px left and right. |
| `space-section` | 18px | Space above a section label. |
| `space-6` | 24px | Button side padding; big gaps. |
| `space-8` | 32px | Bottom padding of a scrolling screen. |
| `radius-chip` | 8px | Status chips. |
| `radius-field` | 10px | Inputs, date fields and icon boxes. |
| `radius-card` | 14px | Cards, tiles, panels and buttons. |
| `radius-phone` | 22px | Round avatar (44px circle). |
| `tap-min` | 44px | Smallest tap target anywhere. |
| `button-height` | 54px | Primary button height. |
| `tile-min-height` | 66px | Minimum tile height. |
| `input-height` | 48px | Minimum input height. |
| `icon-box` | 40px | Square icon box on tiles. |
| `tab-bar-height` | 64px | Footer tab bar height (plus the phone's safe area). |

## Text styles

| Style | Size / line | Weight | Notes |
| --- | --- | --- | --- |
| screen-title | 26px / 32px | 800 | letter-spacing 0.5px |
| back-title | 22px / 28px | 800 |  |
| balance-number | 24px / 30px | 800 |  |
| overline | 10px / 14px | 800 | letter-spacing 1.5px, uppercase |
| section-label | 11px / 14px | 800 | letter-spacing 1.4px, uppercase |
| field-label | 11px / 14px | 700 | letter-spacing 1.2px, uppercase |
| tab-label | 10px / 12px | 700 | letter-spacing 0.5px, uppercase |
| chip | 9px / 12px | 800 | letter-spacing 0.6px, uppercase |
| button | 16px / 20px | 700 | letter-spacing 0.5px |
| tile-title | 15px / 20px | 600 |  |
| input | 15px / 20px | 400 |  |
| body | 13px / 19px | 400 |  |
| tile-desc | 12px / 16px | 400 |  |
| hint | 11px / 16px | 400 |  |
