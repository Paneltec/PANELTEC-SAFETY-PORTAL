# Screenshot Instructions — Google Play Store

## Requirements
- **Phone**: min 2, max 8 screenshots
- **Aspect ratio**: 16:9 (landscape) or 9:16 (portrait) — portrait recommended for phone app
- **Dimensions**: 1080×1920 px (standard phone portrait) works perfectly
- **Format**: PNG or JPEG, max 8 MB each
- **7-inch tablet** and **10-inch tablet**: optional but improves ranking

## Recommended 6 Screenshots

### 1. Home Screen
- **Route**: `/` (Home tab after PIN login)
- **Must show**: Green "You have a new job" tile, Quick Actions grid (Forms, Fleet, GPS Check-In, Sign On, My Leave), compliance score ring
- **Why**: First screenshot = first impression — shows the app is a field dashboard, not a generic form filler
- **Device frame**: Pixel 8 or Samsung Galaxy S24

### 2. Job Detail
- **Route**: Tap the green "You have a new job" tile on Home
- **Must show**: Job address, scope of work, site details, SWMS link, crew info
- **Why**: Shows SMS job dispatch in action — the core daily workflow
- **Device frame**: Same as #1

### 3. Forms Library
- **Route**: Forms tab (bottom nav)
- **Must show**: Colour-coded category tiles (General = blue, Vehicle = orange, Electrical = yellow, etc.), form count badges
- **Why**: Demonstrates breadth of WHS forms available
- **Device frame**: Same as #1

### 4. Form Fill — Response Buttons
- **Route**: Forms tab → General → Hot Work Permit (or any form with Yes/No/N/A fields)
- **Must show**: White background form with green (OK), orange (Not OK), grey (N/A) tri-state buttons, field labels, progress bar
- **Why**: Shows the actual field-worker experience — big buttons, clear colours, easy to use with gloves
- **Device frame**: Same as #1

### 5. My Leave
- **Route**: Home → "My Leave" tile → (if leave exists) list view, or tap "REQUEST LEAVE" to show the form
- **Must show**: Balance cards (Annual / Sick), green "REQUEST LEAVE" button, leave type picker
- **Why**: Shows the app goes beyond safety forms — handles admin tasks too
- **Device frame**: Same as #1

### 6. Asset Detail
- **Route**: Fleet tab → tap any vehicle
- **Must show**: Vehicle image, rego, category badge, assigned forms with category filter dropdown
- **Why**: Shows asset management capability — differentiator from generic form apps
- **Device frame**: Same as #1

## How to Capture
**Option A — Physical device**: Install the APK, navigate to each screen, take native screenshots (Power + Volume Down on Android)

**Option B — Expo preview**: Use the browser preview at `https://whs-compliance.expo.preview.emergentagent.com/`, resize browser to 360×800, take screenshots with browser dev tools (Ctrl+Shift+M for device mode in Chrome)

**Option C — EAS screenshot service**: Not available for this project type

## Tips
- Use real data (demo account PIN 3310), not empty states
- Ensure at least one form has been partially filled for screenshot #4
- For My Leave, submit a test leave request first so the list isn't empty
- Play Console has a built-in device frame generator — upload raw screenshots and it adds bezels
