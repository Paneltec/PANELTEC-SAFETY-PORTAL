import React, { useEffect, useState } from 'react';
import { PaintBrush20Regular, Dismiss16Regular } from '@fluentui/react-icons';

// Phase 4.10.2 (paneltec-v117) — one-time orange-rebrand nudge for users
// who installed the PWA on or before v115. iOS/Android cache home-screen
// icons aggressively and the OS will keep serving the old cobalt tile
// until the user removes + re-adds the app. We can't force-clear OS icon
// caches from a service worker, so surface the instruction in-app the
// first time a standalone session loads after the v117 ship.
//
// Render rules:
//   - Only when running in standalone PWA mode
//     (`window.matchMedia('(display-mode: standalone)').matches`).
//   - Only when localStorage flag `paneltec_seen_v116_rebrand` is unset.
//   - "Got it" sets the flag → banner gone forever on this device.
//   - "Remind me later" closes the banner for this session only
//     (sessionStorage), so it reappears next launch.
const SEEN_KEY = 'paneltec_seen_v116_rebrand';
const SNOOZE_KEY = 'paneltec_v116_rebrand_snoozed';

export default function RebrandNudge() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      const isStandalone = window.matchMedia?.('(display-mode: standalone)')?.matches
        || window.navigator?.standalone === true;
      const seen = localStorage.getItem(SEEN_KEY) === '1';
      const snoozed = sessionStorage.getItem(SNOOZE_KEY) === '1';
      setShow(isStandalone && !seen && !snoozed);
    } catch { /* localStorage / matchMedia missing — silently skip */ }
  }, []);

  if (!show) return null;

  return (
    <div className="px-4 sm:px-6 lg:px-8 pt-3" data-testid="rebrand-nudge">
      <div className="relative bg-orange-50 border-l-4 border-orange-500 rounded-lg shadow-sm p-3.5 sm:p-4 flex items-start gap-3">
        <div className="shrink-0 w-9 h-9 rounded-lg bg-orange-100 flex items-center justify-center">
          <PaintBrush20Regular className="text-orange-600" />
        </div>
        <div className="flex-1 min-w-0 text-sm leading-relaxed text-slate-700">
          <span className="font-semibold text-slate-900">New look.</span>{' '}
          Re-pin Paneltec Civil to your home screen to refresh the app icon.
          <div className="mt-1 text-[12.5px] text-slate-600 italic">
            On iOS: remove the app from your home screen, then re-add via Share → Add to Home Screen.
            On Android: long-press the icon → App info → Uninstall, then re-install from the browser menu.
          </div>
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* ignore */ }
                setShow(false);
              }}
              data-testid="rebrand-nudge-dismiss"
              className="inline-flex items-center px-3 py-1.5 rounded-md bg-orange-500 hover:bg-orange-600 text-white text-[12.5px] font-semibold transition-colors">
              Got it
            </button>
            <button
              type="button"
              onClick={() => {
                try { sessionStorage.setItem(SNOOZE_KEY, '1'); } catch { /* ignore */ }
                setShow(false);
              }}
              data-testid="rebrand-nudge-snooze"
              className="text-[12.5px] font-medium text-slate-600 hover:text-slate-900 hover:underline">
              Remind me later
            </button>
          </div>
        </div>
        <button
          type="button"
          aria-label="Close"
          onClick={() => {
            try { sessionStorage.setItem(SNOOZE_KEY, '1'); } catch { /* ignore */ }
            setShow(false);
          }}
          data-testid="rebrand-nudge-close-x"
          className="shrink-0 -mr-1 -mt-1 p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-orange-100">
          <Dismiss16Regular />
        </button>
      </div>
    </div>
  );
}
