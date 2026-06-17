import { useEffect, useState } from 'react';

const DISMISS_KEY = 'paneltec_install_dismissed';

// React hook that surfaces the install state of the Paneltec Civil PWA.
// Returns { canInstall, isIOS, isStandalone, dismissed, prompt(), dismiss() }
export function usePwaInstall() {
  const [deferred, setDeferred] = useState(null);
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY) === '1');
  const [isStandalone, setStandalone] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true;
  });

  useEffect(() => {
    const onPrompt = (e) => { e.preventDefault(); setDeferred(e); };
    const onInstalled = () => setStandalone(true);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    const mq = window.matchMedia('(display-mode: standalone)');
    const onChange = (e) => setStandalone(e.matches);
    mq.addEventListener?.('change', onChange);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
      mq.removeEventListener?.('change', onChange);
    };
  }, []);

  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const isIOS = /iPhone|iPad|iPod/.test(ua) && !window.MSStream;

  const prompt = async () => {
    if (!deferred) return { outcome: 'unsupported' };
    deferred.prompt();
    const { outcome } = await deferred.userChoice;
    setDeferred(null);
    return { outcome };
  };

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, '1');
    setDismissed(true);
  };

  const canInstall = !isStandalone && !dismissed && (Boolean(deferred) || isIOS);

  return { canInstall, isIOS, isStandalone, dismissed, prompt, dismiss };
}
