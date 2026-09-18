import React, { useEffect } from 'react';
import '@/App.css';
import '@/lib/clipboard';   // v154.1 — arms the navigator.clipboard.writeText safety-net at app boot
import '@/lib/download';    // v154.2 — arms the HTMLAnchorElement.click safety-net at app boot
import { hydratePalette } from '@/lib/civilPalette';   // v58.13.67-palette-switcher
import { BrowserRouter, Routes, Route, Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { Toaster, toast } from 'sonner';

// v58.13.120d/e — Fleet & Service Register grace/toast expiries.
// LegacyVehiclesRedirect is retained INDEFINITELY (user policy call —
// external bookmarks / old browser tabs / hard-coded links in
// emails should keep resolving). The "This page has moved" toast is
// only useful for the first month or so, so we self-clean it on
// TOAST_EXPIRES_AT — 30 days from the .120e ship. After that date
// the redirect still fires silently.
export const TOAST_EXPIRES_AT = '2026-10-04T00:00:00Z';
// LegacyVehiclesRedirect retained indefinitely for old bookmarks.

import Cover from '@/pages/Cover';
// v58.13.132z — removed `import Signup from '@/pages/Signup';`
// (dead route; backend `POST /users` returns 410).
// v58.13.132cb — `import Workspaces from '@/pages/Workspaces';` removed;
// Phase A of Workspaces/Sites merge. `/app/settings/workspaces` now
// redirects to `/app/settings/sites`.
import Dashboard from '@/pages/Dashboard';
import Integrations from '@/pages/Integrations';
import Stub from '@/pages/Stub';
import AppShell from '@/components/layout/AppShell';
import VersionBadge from '@/components/VersionBadge';
import { WorkspaceProvider } from '@/lib/workspace';

import SwmsList, { SwmsNew, SwmsDetail } from '@/pages/Swms';
import PreStartsList, { PreStartNew } from '@/pages/PreStarts';
// v160.3.9.58.1 — Bulk-import Pre-Starts wizard (4-step, URL-driven).
import BulkImportWizard from '@/pages/prestarts/BulkImport/BulkImportWizard';
import SiteDiaryList, { SiteDiaryNew } from '@/pages/SiteDiary';
import HazardsList, { HazardNew } from '@/pages/Hazards';
import IncidentsList, { IncidentNew } from '@/pages/Incidents';
import InspectionsList, { InspectionNew } from '@/pages/Inspections';
// v58.13.6 — Site Sign-In / Visitor Register capture page.
// v58.13.109b — retired; component + route deleted. Import kept as a
// comment so `git log -S` can find the removal context. See
// backend/scripts/migrate_legacy_signins_v58_13_109b.py for the data
// migration.
// import SiteSigninList from '@/pages/SiteSigninList';
import RiskAssessments from '@/pages/RiskAssessments';
// v58.13.132hz — Dedicated SSRA capture page.
import SsraCapture from '@/pages/capture/SsraCapture';
// v58.13.132dz — `CsIncidentsList` import retired. The `/app/submissions/*`
// routes now redirect to `/app/incidents` (data merged into Incident
// Reports in v58.13.132dz; see the ship memo).
// import CsIncidentsList from '@/pages/CsIncidentsList';
import ContractorsList, { ContractorNew, ContractorDetail } from '@/pages/Contractors';
import Renewals from '@/pages/Renewals';
import AuditExports from '@/pages/AuditExports';
import BackupTab from '@/pages/settings/BackupTab';
import Ask from '@/pages/Ask';
import PublicRenewal from '@/pages/PublicRenewal';
import NavixyAdmin from '@/pages/NavixyAdmin';
import SimproAdmin from '@/pages/SimproAdmin';
import Microsoft365Admin from '@/pages/Microsoft365Admin';
import TextMagicAdmin from '@/pages/TextMagicAdmin';
import Vehicles from '@/pages/Vehicles';
// v58.13.120e — `PlantVehicles.jsx` retired and file deleted this
// ship. The `/app/vehicles` route now resolves to
// `LegacyVehiclesRedirect` (see this file), which navigates to
// `/app/fleet` and fires the once-per-session moved-toast.
import FleetRegister from '@/pages/FleetRegister';
// v58.13.132x — Fuel card attribution admin.
import FuelCardsAdmin from '@/pages/FuelCardsAdmin';
// v58.13.132ab — admin daily-job assignment for mobile home screen.
import AdminAssignDailyJobs from '@/pages/AdminAssignDailyJobs';
// v58.13.132gh — Post-incident admin surface for byte-less file
// records. Landing page + dashboard banner both link here.
import AdminMissingFiles from '@/pages/AdminMissingFiles';
// v58.13.132gl-b — Equipment Register page.
import EquipmentRegister from '@/pages/EquipmentRegister';
// v58.13.131c — SmartFill fuel-anomaly inbox route.
import FuelAnomalyInbox from '@/pages/FuelAnomalyInbox';
// v58.13.131d — SmartFill fuel reporting page.
import FuelReporting from '@/pages/FuelReporting';
import AdminImports from '@/pages/settings/AdminImports';
import ScanResolver from '@/pages/ScanResolver';
import WorkerIdCardPrint from '@/pages/print/WorkerIdCardPrint';
import WorkerScanResolver from '@/pages/WorkerScanResolver';
import UsersManagement from '@/pages/UsersManagement';
import MyApps from '@/pages/MyApps';
import PermissionPresetsAdmin from '@/pages/PermissionPresetsAdmin';
// v160.3.9.31-4a — Phase 4a: Roles Admin (system-role viewer + custom-role editor).
import RolesAdmin from '@/pages/RolesAdmin';
// v58.13.61 — Users + Roles merged into a single tabbed shell.
// The old `/app/settings/roles-admin` URL redirects to
// `/app/settings/users?tab=roles` for a 90-day grace window.
// REMOVE AFTER 2026-11-27 and flip to 410.
function UsersAndRolesShell() {
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') === 'roles' ? 'roles' : 'users';
  return (
    <div data-testid="users-and-roles-shell">
      <div className="flex gap-2 border-b border-slate-200 mb-4 px-6 pt-4">
        <button
          data-testid="users-and-roles-tab-users"
          onClick={() => { const n = new URLSearchParams(sp); n.delete('tab'); setSp(n); }}
          className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
            tab === 'users'
              ? 'border-brand-blue text-slate-900'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Users
        </button>
        <button
          data-testid="users-and-roles-tab-roles"
          onClick={() => { const n = new URLSearchParams(sp); n.set('tab', 'roles'); setSp(n); }}
          className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
            tab === 'roles'
              ? 'border-brand-blue text-slate-900'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Roles
        </button>
      </div>
      {tab === 'roles' ? <RolesAdmin /> : <UsersManagement />}
    </div>
  );
}


// v58.13.120d — Legacy /app/vehicles(...) → /app/fleet redirect.
// Preserves `?open=<id>` so bookmarked drawer links keep working.
// Fires a once-per-session Sonner toast so operators know their
// bookmark landed on the new surface. Phase 5 (`FLEET_GRACE_ENDS_AT`)
// removes this shim entirely.
// v58.13.132z — `LegacyVehiclesRedirect` deleted. Prior policy note
// "retained INDEFINITELY (old bookmarks)" superseded by user directive
// on 2026-09-07. Old `/app/vehicles/*` bookmarks now 404; users will
// discover the new `/app/fleet` route via nav.
// (component + routes removed below)

import Outbox from '@/pages/Outbox';
import MyProfile from '@/pages/MyProfile';
import OrgSettings from '@/pages/OrgSettings';
// v58.13.132eq — Read-only Quick Links page (sidebar entry, admin-manages
// via Org Settings).
import QuickLinks from '@/pages/QuickLinks';
// v58.13.132es — Standalone Apps Directory hub (opens in new window).
import AppsDirectory from '@/pages/AppsDirectory';
// v58.13.132cb — `Workspaces` page retired (Phase A of workspaces/sites
// merge). Route redirects to `/app/settings/sites`. The `.jsx` file has
// been deleted; import removed to prevent a build-time resolve error.
import DocumentLibrary, { DocumentLibraryFolder } from '@/pages/DocumentLibrary';
import Suppliers from '@/pages/Suppliers';
import Workers from '@/pages/Workers';
import FormAssignmentsAdmin from '@/pages/FormAssignmentsAdmin';
import SwmsAssignmentsAdmin from '@/pages/SwmsAssignmentsAdmin';
import SiteScanResolver from '@/pages/SiteScanResolver';
import VisitorSignIn from '@/pages/VisitorSignIn';
import AdminVisitors from '@/pages/AdminVisitors';
import SupplierScanResolver from '@/pages/SupplierScanResolver';
import SitesAdmin, { SiteDetail } from '@/pages/SitesAdmin';
import SystemSettings from '@/pages/SystemSettings';
import Certifications from '@/pages/Certifications';
import UserManual from '@/pages/UserManual';
import Forms, { SubmissionViewModal } from '@/pages/Forms'; // eslint-disable-line no-unused-vars
import FormSubmissions from '@/pages/FormSubmissions';
// Phase 4.7 — public token-driven password flows + must-change guard.
import Onboard, { ResetPasswordPage } from '@/pages/Onboard';
// v58.13.132ae — Public QR-landing page for onboarding cards.
import OnboardMobileLanding from '@/pages/OnboardMobileLanding';
import { MustChangePasswordGuard } from '@/components/auth/AuthBundle';
// Phase 4.7.3 — Comms Safe Mode admin page.
import CommsSafeMode from '@/pages/CommsSafeMode';
import CacheBusterBanner from '@/components/CacheBusterBanner';
// v160.3.7i — Simpro import walkthrough rehomed to its own page so it
// stops breaking the Users & Permissions layout.
import SimproImportGuidePage from '@/pages/help/SimproImportGuidePage';
// v160.3.7q — Program-wide visual schematic
import ProgramSchematicPage from '@/pages/settings/ProgramSchematicPage';
// v160.3.9.48 — HR Employees register.
// v58.13.57 — `HrEmployeesPage` import retired. Route below redirects
// `/app/settings/hr-employees` → `/app` for a 90-day grace window.
// REMOVE AFTER 2026-11-25.

// Phase 4.13 (paneltec-v129) — `/login` is deprecated. Cover.jsx (mounted
// at `/`) is the single sign-in surface. `<LoginRedirect />` forwards any
// remaining `/login?next=…` traffic to `/?next=…` so deep-links keep
// working, preserving the query string.
function LoginRedirect() {
  const { search } = useLocation();
  return <Navigate to={{ pathname: '/', search }} replace />;
}

function App() {
  // v58.13.67-palette-switcher — hydrate the persisted CIVIL palette onto
  // <html data-palette="…"> before any page renders, so first paint is
  // already in the palette the user picked last time.
  useEffect(() => { hydratePalette(); }, []);
  return (
    <div className="App">
      <BrowserRouter>
        <WorkspaceProvider>
          {/* v154.3 — Cache-buster banner sits at the very top of every
              route so a stale-bundle user can one-click hard-reload
              regardless of which page they landed on. Renders above
              the SilentAgentAlert (which lives inside BackupTab) by
              virtue of being outside <Routes>. */}
          <CacheBusterBanner/>
          {/* v58.13.132e_web_hotfix — Persistent version pill on every
              route (landing, login, PWA reset, print, scan, etc.). The
              sidebar's `app-version-footer` only renders on authed
              `/app/*` routes, so anonymous / public flows previously
              had no version indicator. */}
          <VersionBadge />
          <Routes>
            <Route path="/" element={<Cover />} />
            <Route path="/login" element={<LoginRedirect />} />
            {/* v58.13.132z — `/signup` route removed. Backend
                `POST /users` returns 410; onboarding via admin-invite
                or Simpro sync + QR. */}
            {/* Phase 4.7 — public token-driven password flows */}
            <Route path="/onboard" element={<Onboard />} />
            {/* v58.13.132ae — Public onboarding-card QR landing page.
                DIFFERENT flow from /onboard (which is the web invite
                password-set). This one is for MOBILE onboarding cards
                and drives users into the App Store / Play Store, then
                deep-links into the installed app. */}
            <Route path="/m/onboard/:token" element={<OnboardMobileLanding />} />
            <Route path="/reset" element={<ResetPasswordPage />} />
            <Route path="/renew/:token" element={<PublicRenewal />} />
            <Route path="/scan/worker/:token" element={<WorkerScanResolver />} />
            {/* v58.13.106a — public visitor sign-in matched BEFORE the bare
                site scan resolver so React Router's ranking can never
                collapse the 4-segment /visitor path onto the 3-segment
                worker/kiosk resolver. Both routes are outside the /app
                auth-gated tree. */}
            <Route path="/scan/site/:token/visitor" element={<VisitorSignIn />} />
            <Route path="/scan/site/:token" element={<SiteScanResolver />} />
            <Route path="/scan/supplier/:token" element={<SupplierScanResolver />} />
          <Route path="/scan/:token" element={<ScanResolver />} />
            {/* v160.3.9.7 — Standalone popup for Worker ID card print preview.
                Rendered OUTSIDE AppShell so no sidebar/top-nav bleeds into
                the popup window that Workers.jsx opens via window.open(). */}
            <Route path="/print/worker-id-card/:workerId" element={<WorkerIdCardPrint />} />

            {/* v58.13.132es — Standalone Apps Directory hub route,
                intended to be popped in a fresh browser window by
                the sidebar entry via `window.open`. Rendered OUTSIDE
                AppShell so the popup carries no sidebar / top-nav
                chrome. Still hits `GET /org/url-tiles` through the
                authenticated axios instance (localStorage token from
                the main window is available on the same origin). */}
            <Route path="/apps-directory" element={<AppsDirectory />} />

            <Route path="/app" element={<MustChangePasswordGuard><AppShell /></MustChangePasswordGuard>}>
              <Route index element={<Navigate to="/app/dashboard" replace />} />
              <Route path="dashboard" element={<Dashboard />} />
              <Route path="ask" element={<Ask />} />
              {/* v58.13.132eq — Read-only shared bookmark tiles.
                  v58.13.132et — Sidebar Quick Links entry removed;
                  this legacy route now 302-redirects to the dashboard
                  with `?open=apps-directory` so old bookmarks
                  auto-open the modal on landing. */}
              <Route path="quick-links" element={<Navigate to="/app/dashboard?open=apps-directory" replace />} />

              <Route path="swms" element={<SwmsList />} />
              <Route path="swms/new" element={<SwmsNew />} />
              <Route path="swms/:id" element={<SwmsDetail />} />

              <Route path="pre-starts" element={<PreStartsList />} />
              <Route path="pre-starts/new" element={<PreStartNew />} />
              {/* v160.3.9.58.1 — bulk-import wizard route. Gated by
                  `pre_starts.edit` (matches backend `_WRITE_ROLES`). */}
              <Route path="pre-starts/bulk-import" element={<BulkImportWizard />} />

              <Route path="site-diary" element={<SiteDiaryList />} />
              <Route path="site-diary/new" element={<SiteDiaryNew />} />

              <Route path="hazards" element={<HazardsList />} />
              <Route path="hazards/new" element={<HazardNew />} />

              <Route path="incidents" element={<IncidentsList />} />
              <Route path="incidents/new" element={<IncidentNew />} />

              <Route path="inspections" element={<InspectionsList />} />
              {/* v58.13.109b — legacy site-signin route retired. Any
                  bookmark / deep-link now redirects to the newer
                  public-visitor register at /app/admin/visitors. The
                  underlying data (form_submissions, template_id
                  e8873f7e-…) is migrated to site_visitors via
                  `backend/scripts/migrate_legacy_signins_v58_13_109b.py`
                  (1 record on preview at ship day). */}
              <Route path="site-signin" element={<Navigate to="/app/admin/visitors" replace />} />
              <Route path="site-signin/*" element={<Navigate to="/app/admin/visitors" replace />} />
              {/* v58.13.106 — Admin visitor register (public sign-ins from QR). */}
              <Route path="admin/visitors" element={<AdminVisitors />} />
              {/* v160.3.0-adjust-13 — new Capture bucket. */}
              <Route path="risk-assessments" element={<RiskAssessments />} />
              {/* v58.13.132hz — Dedicated SSRA capture route. Filters
                  risk-assessments to SSRA-family templates + hosts
                  the Upload PDF affordance. */}
              <Route path="capture/ssra" element={<SsraCapture />} />
              {/* v58.13.12 — Submissions bucket. */}
              {/* v58.13.132dz — CS Incidents merged into Incident
                  Reports. Both `submissions` and
                  `submissions/cs-incidents` now redirect to
                  `/app/incidents` for one release cycle so old
                  bookmarks / stale tabs land somewhere sane. */}
              <Route path="submissions" element={<Navigate to="/app/incidents" replace />} />
              <Route path="submissions/cs-incidents" element={<Navigate to="/app/incidents" replace />} />
              <Route path="inspections/new" element={<InspectionNew />} />

              <Route path="contractors" element={<ContractorsList />} />
              <Route path="contractors/new" element={<ContractorNew />} />
              <Route path="contractors/:id" element={<ContractorDetail />} />
              {/* v58.13.132z — `contractors-legacy` alias route removed. */}
              <Route path="suppliers" element={<Suppliers />} />

              <Route path="renewals" element={<Renewals />} />
              <Route path="audit-exports" element={<AuditExports />} />
              {/* v58.13.120d — legacy `vehicles` route retired.
                  See LegacyVehiclesRedirect + Route definitions
                  below. */}
              <Route path="vehicles-legacy" element={<Vehicles />} />
              {/* v58.13.120c — Fleet & Service Register (Phase 3). */}
              <Route path="fleet" element={<FleetRegister />} />
              {/* v58.13.131c — SmartFill CSV Fuel Anomaly Inbox. */}
              <Route path="fleet/fuel/anomalies" element={<FuelAnomalyInbox />} />
              {/* v58.13.132x — Fuel card attribution admin */}
              <Route path="fleet/fuel/cards" element={<FuelCardsAdmin />} />
              {/* v58.13.132ab — Admin: assign daily jobs to mobile workers. */}
              <Route path="mobile/assign-daily-jobs" element={<AdminAssignDailyJobs />} />
              {/* v58.13.131d — SmartFill Fuel Reporting page. */}
              <Route path="fleet/fuel" element={<FuelReporting />} />
              {/* v58.13.120e — Bulk XLSX importer moved from the
                  retired Plant & Vehicles surface to Settings.
                  The `POST /api/plant-maintenance/reimport` endpoint
                  is unchanged. */}
              <Route path="settings/imports" element={<AdminImports />} />
              {/* v58.13.120d — Legacy Plant & Vehicles surface is
                  retired. Every `/app/vehicles`(...) URL redirects
                  to `/app/fleet`, preserving `?open=<id>` so
                  bookmarked deep-links keep working. The
                  `LegacyVehiclesRedirect` component fires a
                  once-per-session Sonner toast on arrival so
                  operators know their bookmark landed somewhere
                  new. See `FLEET_GRACE_ENDS_AT` at the top of this
                  file — Phase 5 removes the redirects on that
                  date. */}
              {/* v58.13.132z — `/app/vehicles` + `/app/vehicles/*`
                  redirects removed. Old bookmarks now 404. */}
              <Route path="sites" element={<SitesAdmin />} />
              <Route path="sites/:id" element={<SiteDetail />} />

              <Route path="document-library" element={<DocumentLibrary />} />
              <Route path="document-library/:folderId" element={<DocumentLibraryFolder />} />

              <Route path="settings/org" element={<OrgSettings />} />
              {/* v58.13.132cb — Workspaces surface retired (Phase A of
                  workspaces/sites merge). `/app/settings/workspaces`
                  redirects to the canonical Sites admin. Old bookmarks
                  keep landing on the right page. */}
              <Route path="settings/workspaces" element={<Navigate to="/app/settings/sites" replace />} />
              <Route path="settings/integrations" element={<Integrations />} />
              <Route path="settings/comms-safe-mode" element={<CommsSafeMode />} />
              <Route path="settings/integrations/navixy" element={<NavixyAdmin />} />
              <Route path="settings/integrations/simpro" element={<SimproAdmin />} />
              <Route path="settings/integrations/microsoft365" element={<Microsoft365Admin />} />
              <Route path="settings/integrations/textmagic" element={<TextMagicAdmin />} />
              <Route path="settings/users" element={<UsersAndRolesShell />} />
              {/* v160.3.7i — dedicated help page for the Simpro ZIP import walkthrough. */}
              <Route path="settings/help/simpro-import" element={<SimproImportGuidePage />} />
              {/* v160.3.7q — Program-wide visual schematic diagram. */}
              <Route path="settings/schematic" element={<ProgramSchematicPage />} />
              {/* v160.3.9.47 — Legacy redirect for the pre-rewrite URL. */}
              <Route path="settings/program-schematic" element={<Navigate to="/app/settings/schematic" replace />} />
              <Route path="settings/my-apps" element={<MyApps />} />
              <Route path="settings/permission-presets" element={<PermissionPresetsAdmin />} />
              {/* v160.3.9.31-4a — Phase 4a: Roles Admin page. */}
              {/* v58.13.61 — Roles Admin merged as a tab under
                  Users & Permissions. Old URL redirects for a
                  90-day grace window. REMOVE AFTER 2026-11-27. */}
              <Route path="settings/roles-admin" element={<Navigate to="/app/settings/users?tab=roles" replace />} />
              <Route path="settings/workers" element={<Workers />} />
              {/* v160.3.9.48 — HR Employees register. Gated by `hr_employees.view`. */}
              {/* v58.13.57 — HR Employees page retired. The 4 HR
                  flags now live on the Worker record (merged in
                  v58.13.56). Backend `/api/hr/employees` list+get
                  stays live in read-only shape for a 90-day grace
                  window. REMOVE AFTER 2026-11-25 and flip to 410. */}
              <Route path="settings/hr-employees" element={<Navigate to="/app" replace />} />
              <Route path="settings/form-assignments" element={<FormAssignmentsAdmin />} />
              <Route path="settings/swms-assignments" element={<SwmsAssignmentsAdmin />} />
              <Route path="settings/system" element={<SystemSettings />} />
              <Route path="settings/certifications" element={<Certifications />} />
              <Route path="settings/backup" element={<BackupTab />} />
              {/* v58.13.132gh — Files needing reupload (post-incident admin surface). */}
              <Route path="settings/missing-files" element={<AdminMissingFiles />} />
              {/* v58.13.132gl-b — Equipment Register. */}
              <Route path="equipment" element={<EquipmentRegister />} />
              <Route path="forms" element={<Forms />} />
              <Route path="forms/templates/:templateId/submissions" element={<FormSubmissions />} />
              <Route path="outbox" element={<Outbox />} />
              <Route path="profile" element={<MyProfile />} />
              <Route path="help" element={<UserManual />} />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </WorkspaceProvider>
      </BrowserRouter>
      <Toaster position="top-right" richColors closeButton />
    </div>
  );
}

export default App;
