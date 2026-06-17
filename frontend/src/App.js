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

function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />

          <Route path="/app" element={<AppShell />}>
            <Route index element={<Navigate to="/app/dashboard" replace />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="ask" element={<Stub />} />
            <Route path="swms" element={<Stub />} />
            <Route path="pre-starts" element={<Stub />} />
            <Route path="site-diary" element={<Stub />} />
            <Route path="hazards" element={<Stub />} />
            <Route path="incidents" element={<Stub />} />
            <Route path="inspections" element={<Stub />} />
            <Route path="contractors" element={<Stub />} />
            <Route path="renewals" element={<Stub />} />
            <Route path="audit-exports" element={<Stub />} />
            <Route path="settings/org" element={<Stub />} />
            <Route path="settings/workspaces" element={<Stub />} />
            <Route path="settings/integrations" element={<Integrations />} />
            <Route path="settings/users" element={<Stub />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster position="top-right" richColors closeButton />
    </div>
  );
}

export default App;
