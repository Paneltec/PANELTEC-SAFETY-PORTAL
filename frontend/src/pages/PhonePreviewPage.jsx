import React from 'react';
import { Link } from 'react-router-dom';
import { useCan } from '@/lib/permissions';

// Retain the saved menu route; this is the real mobile app, not impersonation.
export default function PhonePreviewPage() {
  const can = useCan();
  const allowed = can('mobile_preview', 'view');
  const mobileUrl = (process.env.REACT_APP_EXPO_URL || '/m/').trim();
  if (!allowed) return <div className="p-8">You do not have access to the phone app from this menu.</div>;
  return (
    <section className="mx-auto max-w-5xl" data-testid="phone-app-page">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Phone App</h1>
          <p className="mt-1 text-sm text-slate-600">Your live phone app. Saved entries go to your real account.</p>
        </div>
        <Link to="/app/dashboard" className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Back to office</Link>
      </div>
      <div className="flex justify-center">
        <div className="w-full max-w-[390px] overflow-hidden rounded-[38px] border-[8px] border-slate-900 bg-slate-900 shadow-xl" data-testid="live-phone-frame">
          <div className="flex h-5 items-center justify-center gap-2" aria-hidden="true"><span className="h-1 w-12 rounded-full bg-slate-600" /><span className="h-1.5 w-1.5 rounded-full bg-slate-600" /></div>
          <iframe src={mobileUrl} title="Live Phone App" className="block w-full border-0 bg-[#1d3e63]" style={{height:'clamp(520px, calc(100dvh - 230px), 740px)'}} allow="camera; geolocation" />
          <div className="flex h-5 items-center justify-center" aria-hidden="true"><span className="h-1 w-24 rounded-full bg-slate-500" /></div>
        </div>
      </div>
    </section>
  );
}
