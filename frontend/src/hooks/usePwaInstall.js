// v58.13.112 — PWA install detection + prompt.
//
// Captures the `beforeinstallprompt` event (Chrome / Edge / Android
// Chrome) and exposes it so a UI button can `.prompt()` it on demand.
// Also detects the current install state so the button hides once the
// app is running standalone. iOS Safari fires no such event; we
// detect the platform and let the caller show a manual "Add to Home
// Screen" walk-through instead.
import { useCallback, useEffect, useState } from 'react';

export default function usePwaInstall() {
  const [deferredEvt, setDeferredEvt] = useState(null);
  // v58.13.112 — Resolve standalone / iOS state exactly ONCE per
  // hook lifetime. `display-mode: standalone` matches Chrome, Edge,
  // Android; `navigator.standalone` catches iOS Safari "Add to Home
  // Screen" installs.
  const [isInstalled, setIsInstalled] = useState(() => {
    if (typeof window === 'undefined') return false;
    const dm = window.matchMedia?.('(display-mode: standalone)').matches;
    const ios = window.navigator.standalone === true;
    return !!(dm || ios);
  });
  const [isIOS] = useState(() => {
    if (typeof window === 'undefined') return false;
    const ua = window.navigator.userAgent || '';
    // iPhone / iPad (incl. iPadOS Safari that spoofs Mac UA — check
    // touch capability as the tiebreaker).
    const iOSDevice = /iP(ad|hone|od)/.test(ua);
    const iPadOS = /Macintosh/.test(ua) && 'ontouchend' in document;
    return iOSDevice || iPadOS;
  });

  useEffect(() => {
    const onBeforeInstall = (e) => {
      e.preventDefault();  // stops Chrome's mini-infobar
      setDeferredEvt(e);
    };
    const onAppInstalled = () => {
      setIsInstalled(true);
      setDeferredEvt(null);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onAppInstalled);
    // Also flip `isInstalled` if the display-mode changes mid-session
    // (a rare "the user just accepted the install" transition).
    const mql = window.matchMedia?.('(display-mode: standalone)');
    const onModeChange = (e) => { if (e.matches) setIsInstalled(true); };
    mql?.addEventListener?.('change', onModeChange);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onAppInstalled);
      mql?.removeEventListener?.('change', onModeChange);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferredEvt) return { outcome: 'unavailable' };
    try {
      deferredEvt.prompt();
      const choice = await deferredEvt.userChoice;
      // Whether accepted or dismissed, the browser rejects a re-use
      // of the same event, so drop it.
      setDeferredEvt(null);
      return { outcome: choice?.outcome || 'dismissed' };
    } catch {
      return { outcome: 'error' };
    }
  }, [deferredEvt]);

  return {
    canPrompt: !!deferredEvt && !isInstalled,
    isInstalled,
    isIOS: isIOS && !isInstalled,
    promptInstall,
  };
}
