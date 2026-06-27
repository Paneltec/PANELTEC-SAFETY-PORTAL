## Iteration 5 — Phase A-C Mobile Parity

### What was implemented

**Phase A: Suppliers**
- Wired `/suppliers` route in root `_layout.tsx`
- Connected `SupplierDrawer` modal component (`/src/components/SupplierDrawer.tsx`) with 4 tabbed panels:
  - **Tasks**: CRUD with status filters, priority badges, due dates, toggle done
  - **Notes**: Add/edit/delete markdown notes with author attribution
  - **Folders**: Create folders + nested file view with upload (`expo-document-picker`)
  - **Members**: CRUD with primary contact flag, role, email, phone
- Updated supplier cards: icon chips (Tasks, Notes, Folders, Members) now open the drawer on the corresponding panel

**Phase B: Document Library**
- Wired `/document-library` route in root `_layout.tsx`
- Pre-existing `document-library.tsx` already had full implementation (folder grid, file list, multi-part upload, AI Smart Search)
- Now reachable from Compliance Hub

**Phase C: Users & Ask Intelligence**
- Wired `/users` route in root `_layout.tsx`
- Pre-existing `users.tsx` already had full implementation (force sign-out, disable, import from Simpro)
- **Ask Intelligence CRUD**: Rewrote `(tabs)/ask.tsx` to:
  - Load suggestions from `/api/ask/suggestions` instead of hardcoded array
  - Admin/HSEQ Lead can add, edit, delete suggestions inline
  - Category picker modal for suggestions
  - "+ Add question" dashed chip appears for authorized roles
- **Simpro Login**: Added "Sign in with Simpro" button + `loginWithSimpro()` function to `auth.ts`
  - OR divider between password and Simpro login
  - Hint text explaining the flow

**Navigation Updates**
- Updated Compliance Hub to show: Suppliers, Document Library, Contractors (Legacy), Renewal Links, Audit Exports
- Each item has distinct pastel background icon tints

### Web-to-Mobile Mapping
| Web File | Mobile File | Mapping |
|----------|-------------|---------|
| `pages/Suppliers.jsx` | `app/suppliers.tsx` | Full screen with Simpro API fetch + edit modal |
| `components/suppliers/SupplierDrawer.jsx` | `src/components/SupplierDrawer.tsx` | Modal with 4 tabbed panels |
| `pages/DocumentLibrary.jsx` | `app/document-library.tsx` | Folder grid + file list + upload |
| `pages/UsersManagement.jsx` | `app/users.tsx` | User list + filters + import/disable/force-signout |
| `pages/Ask.jsx` (suggestions section) | `(tabs)/ask.tsx` | API-loaded suggestions with CRUD |
| `pages/Login.jsx` (Simpro button) | `(auth)/login.tsx` | "Sign in with Simpro" button |

### Dependencies
- No new dependencies added (expo-document-picker was already installed)

### Known Issues
- CDN/tunnel DNS cache prevents external screenshot tool from resolving — localhost:3001 works fine
- QR Sign-on remains MOCKED (pre-existing, intentionally deferred)
