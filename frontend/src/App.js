import React from 'react';
import '@/App.css';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'sonner';

import Cover from '@/pages/Cover';
import Login from '@/pages/Login';
import Signup from '@/pages/Signup';
import Dashboard from '@/pages/Dashboard';
import Integrations from '@/pages/Integrations';
import Stub from '@/pages/Stub';
import AppShell from '@/components/layout/AppShell';
import { WorkspaceProvider } from '@/lib/workspace';

import SwmsList, { SwmsNew, SwmsDetail } from '@/pages/Swms';
import PreStartsList, { PreStartNew } from '@/pages/PreStarts';
import SiteDiaryList, { SiteDiaryNew } from '@/pages/SiteDiary';
import HazardsList, { HazardNew } from '@/pages/Hazards';
import IncidentsList, { IncidentNew } from '@/pages/Incidents';
import InspectionsList, { InspectionNew } from '@/pages/Inspections';
import ContractorsList, { ContractorNew, ContractorDetail } from '@/pages/Contractors';
import Renewals from '@/pages/Renewals';
import AuditExports from '@/pages/AuditExports';
import Ask from '@/pages/Ask';
import PublicRenewal from '@/pages/PublicRenewal';
import NavixyAdmin from '@/pages/NavixyAdmin';
import SimproAdmin from '@/pages/SimproAdmin';
import Microsoft365Admin from '@/pages/Microsoft365Admin';
import TextMagicAdmin from '@/pages/TextMagicAdmin';
import Vehicles from '@/pages/Vehicles';
import PlantVehicles from '@/pages/PlantVehicles';
import ScanResolver from '@/pages/ScanResolver';
import WorkerScanResolver from '@/pages/WorkerScanResolver';
import UsersManagement from '@/pages/UsersManagement';
import Outbox from '@/pages/Outbox';
import MyProfile from '@/pages/MyProfile';
import OrgSettings from '@/pages/OrgSettings';
import Workspaces from '@/pages/Workspaces';
import DocumentLibrary, { DocumentLibraryFolder } from '@/pages/DocumentLibrary';
import Suppliers from '@/pages/Suppliers';
import Workers from '@/pages/Workers';
import FormAssignmentsAdmin from '@/pages/FormAssignmentsAdmin';
import Certifications from '@/pages/Certifications';
import Forms, { SubmissionViewModal } from '@/pages/Forms'; // eslint-disable-line no-unused-vars
import FormSubmissions from '@/pages/FormSubmissions';

function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <WorkspaceProvider>
          <Routes>
            <Route path="/" element={<Cover />} />
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/renew/:token" element={<PublicRenewal />} />
            <Route path="/scan/worker/:token" element={<WorkerScanResolver />} />
          <Route path="/scan/:token" element={<ScanResolver />} />

            <Route path="/app" element={<AppShell />}>
              <Route index element={<Navigate to="/app/dashboard" replace />} />
              <Route path="dashboard" element={<Dashboard />} />
              <Route path="ask" element={<Ask />} />

              <Route path="swms" element={<SwmsList />} />
              <Route path="swms/new" element={<SwmsNew />} />
              <Route path="swms/:id" element={<SwmsDetail />} />

              <Route path="pre-starts" element={<PreStartsList />} />
              <Route path="pre-starts/new" element={<PreStartNew />} />

              <Route path="site-diary" element={<SiteDiaryList />} />
              <Route path="site-diary/new" element={<SiteDiaryNew />} />

              <Route path="hazards" element={<HazardsList />} />
              <Route path="hazards/new" element={<HazardNew />} />

              <Route path="incidents" element={<IncidentsList />} />
              <Route path="incidents/new" element={<IncidentNew />} />

              <Route path="inspections" element={<InspectionsList />} />
              <Route path="inspections/new" element={<InspectionNew />} />

              <Route path="contractors" element={<ContractorsList />} />
              <Route path="contractors/new" element={<ContractorNew />} />
              <Route path="contractors/:id" element={<ContractorDetail />} />
              <Route path="contractors-legacy" element={<ContractorsList />} />
              <Route path="suppliers" element={<Suppliers />} />

              <Route path="renewals" element={<Renewals />} />
              <Route path="audit-exports" element={<AuditExports />} />
              <Route path="vehicles" element={<PlantVehicles />} />
              <Route path="vehicles-legacy" element={<Vehicles />} />

              <Route path="document-library" element={<DocumentLibrary />} />
              <Route path="document-library/:folderId" element={<DocumentLibraryFolder />} />

              <Route path="settings/org" element={<OrgSettings />} />
              <Route path="settings/workspaces" element={<Workspaces />} />
              <Route path="settings/integrations" element={<Integrations />} />
              <Route path="settings/integrations/navixy" element={<NavixyAdmin />} />
              <Route path="settings/integrations/simpro" element={<SimproAdmin />} />
              <Route path="settings/integrations/microsoft365" element={<Microsoft365Admin />} />
              <Route path="settings/integrations/textmagic" element={<TextMagicAdmin />} />
              <Route path="settings/users" element={<UsersManagement />} />
              <Route path="settings/workers" element={<Workers />} />
              <Route path="settings/form-assignments" element={<FormAssignmentsAdmin />} />
              <Route path="settings/certifications" element={<Certifications />} />
              <Route path="forms" element={<Forms />} />
              <Route path="forms/templates/:templateId/submissions" element={<FormSubmissions />} />
              <Route path="outbox" element={<Outbox />} />
              <Route path="profile" element={<MyProfile />} />
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
