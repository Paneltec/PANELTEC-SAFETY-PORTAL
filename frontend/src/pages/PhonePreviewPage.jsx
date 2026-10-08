import React, { useEffect } from 'react';
import { useCan } from '@/lib/permissions';

// Keep the existing route and permission key so saved menus and bookmarks work.
export default function PhonePreviewPage() {
  const can = useCan();
  const allowed = can('mobile_preview', 'view');
  const mobileUrl = (process.env.REACT_APP_EXPO_URL || '/m/').trim();
  useEffect(() => {
    if (!allowed) return;
    sessionStorage.removeItem('paneltec_preview_user');
    sessionStorage.removeItem('paneltec_preview_jwt');
    window.location.replace(mobileUrl);
  }, [allowed, mobileUrl]);
  if (!allowed) return <div className="p-8">You do not have access to the phone app from this menu.</div>;
  return <div className="p-8"><h1 className="text-xl font-semibold">Phone app</h1><p>Opening your phone app. Use your own mobile sign-in to record time and submit forms.</p><a href={mobileUrl}>Open phone app</a></div>;
}
