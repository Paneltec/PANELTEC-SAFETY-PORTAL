# Iteration 5 — Phase A-C Mobile Parity

## What was implemented

### Phase A: Suppliers (replaces Contractors)
- **Suppliers screen** (`/app/mobile/app/suppliers.tsx`) — Live read from `/api/integrations/simpro/suppliers`, merged with local meta overrides via `/api/suppliers/meta`
- **SupplierDrawer** (`/app/mobile/src/components/SupplierDrawer.tsx`) — Modal-based drawer with 4 tabbed panels:
  - **Tasks**: Full CRUD (add/edit/delete), status toggle, priority badges, due dates, overdue detection, status filters (all/open/in_progress/done)
  - **Notes**: Add/edit/delete markdown notes with avatar and timestamps
  - **Folders**: Create folders, nested file views with upload (expo-document-picker) and delete
  - **Members**: Add/edit/delete members with name, role, email, phone, primary contact toggle
- Supplier cards have icon chips (Tasks/Notes/Folders/Members) that open the drawer to the corresponding panel
- Edit modal for meta overrides (tags, state, status, notes)
- Renewal email sending modal
- **Contractors renamed to "(Legacy)"** in Compliance Hub

### Phase B: Document Library
- **Document Library screen** (`/app/mobile/app/document-library.tsx`) — Folder grid from `/api/document-library/folders`
- AI Smart Search via `/api/document-library/search`
- Folder detail view with file list
- Multi-part file upload using `expo-document-picker`
- File download via `Linking.openURL`
- New folder creation

### Phase C: Users & Ask Intelligence
- **Users screen** (`/app/mobile/app/users.tsx`) — User list with role filter chips, force sign-out, disable user, Import from Simpro
- **Ask Intelligence CRUD** (`/app/mobile/app/(tabs)/ask.tsx`) — Suggestions loaded from `/api/ask/suggestions`, editable/deletable chips for admin/hseq_lead
- **Sign in with Simpro** — Button on login.tsx + `loginWithSimpro()` in auth.ts

### Navigation Updates
- Root `_layout.tsx` — Added Stack.Screen entries for suppliers, document-library, users
- Dashboard — Added "MANAGE & COMPLY" section with quick-access tiles
- Compliance Hub — Added Suppliers + Document Library tiles, Contractors renamed to "(Legacy)"

## Web-to-Mobile Mapping

| Web Page | Mobile Screen | Route |
|----------|--------------|-------|
| Suppliers.jsx | suppliers.tsx | /suppliers |
| SupplierDrawer.jsx | SupplierDrawer.tsx | Modal overlay |
| DocumentLibrary.jsx | document-library.tsx | /document-library |
| UsersManagement.jsx | users.tsx | /users |
| Ask.jsx (suggestions CRUD) | ask.tsx | /(tabs)/ask |
| Login.jsx (Simpro button) | login.tsx | /(auth)/login |

## Known Issues
- Simpro integration requires connected Simpro account (demo shows "Simpro isn't connected" — expected)
- CDN/tunnel DNS cache issue persists (known recurring) — screenshots must use localhost:3001
- QR Sign-on flow remains MOCKED (Phase 4 — intentionally deferred)

## Dependencies
- `expo-document-picker` (v56.0.4) — installed in previous iteration

## API Endpoints Used
- `GET /api/integrations/simpro/suppliers`
- `GET /api/suppliers/meta`
- `PATCH /api/suppliers/{id}/meta`
- `POST /api/suppliers/{id}/renewal-email`
- `GET/POST /api/suppliers/{id}/tasks`
- `PATCH/DELETE /api/suppliers/tasks/{id}`
- `GET/POST /api/suppliers/{id}/notes`
- `PATCH/DELETE /api/suppliers/notes/{id}`
- `GET/POST /api/suppliers/{id}/folders`
- `GET/POST /api/suppliers/{id}/members`
- `PATCH/DELETE /api/suppliers/members/{id}`
- `GET /api/document-library/folders`
- `POST /api/document-library/folders`
- `GET /api/document-library/folders/{id}/files`
- `POST /api/document-library/folders/{id}/files`
- `DELETE /api/document-library/files/{id}`
- `GET /api/document-library/search`
- `GET /api/users`
- `POST /api/users/{id}/force-signout`
- `PATCH /api/users/{id}`
- `GET /api/users/import-from-simpro`
- `GET /api/ask/suggestions`
- `POST /api/ask/suggestions`
- `PATCH /api/ask/suggestions/{id}`
- `DELETE /api/ask/suggestions/{id}`
- `POST /api/auth/login-with-simpro`
