import React from 'react';
import '@/App.css';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'sonner';

import Landing from '@/pages/Landing';
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
import Vehicles from '@/pages/Vehicles';
import UsersManagement from '@/pages/UsersManagement';
import Outbox from '@/pages/Outbox';

function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <WorkspaceProvider>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/renew/:token" element={<PublicRenewal />} />

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

              <Route path="renewals" element={<Renewals />} />
              <Route path="audit-exports" element={<AuditExports />} />
              <Route path="vehicles" element={<Vehicles />} />

              <Route path="settings/org" element={<Stub />} />
              <Route path="settings/workspaces" element={<Stub />} />
              <Route path="settings/integrations" element={<Integrations />} />
              <Route path="settings/integrations/navixy" element={<NavixyAdmin />} />
              <Route path="settings/users" element={<UsersManagement />} />
              <Route path="outbox" element={<Outbox />} />
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
