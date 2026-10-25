import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { useCameraPermissions } from 'expo-camera';

// Permission requests must only follow a deliberate tap. In particular, a denied
// result must never trigger another request through an effect dependency.
export function browserCameraProblem(): string {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return '';
  if (!window.isSecureContext) {
    return 'Camera scanning needs a secure HTTPS connection. This local preview cannot use the camera. Enter the code manually, or use the phone app with camera access.';
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return 'This browser does not support camera scanning. Enter the code manually or use the phone app.';
  }
  const page = document as Document & {
    permissionsPolicy?: { allowsFeature: (name: string) => boolean };
    featurePolicy?: { allowsFeature: (name: string) => boolean };
  };
  const policy = page.permissionsPolicy || page.featurePolicy;
  if (policy && !policy.allowsFeature('camera')) {
    return 'Camera access is blocked in this preview. Enter the code manually, or open the phone app directly using HTTPS.';
  }
  return '';
}

export function useScannerCamera() {
  // Expo's automatic permission read may itself request browser camera access.
  // Defer both reading and requesting until the user presses Enable camera.
  const [permission, requestPermission] = useCameraPermissions({ get: false });
  const [status, setStatus] = useState<'idle' | 'requesting' | 'ready' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const unavailable = browserCameraProblem();
  const needsSettings = Platform.OS !== 'web' && permission?.canAskAgain === false && !permission.granted;

  const enableCamera = useCallback(async () => {
    if (inFlight.current || browserCameraProblem()) return;
    inFlight.current = true;
    setStatus('requesting');
    setMessage('');
    try {
      const result = await requestPermission();
      if (!mounted.current) return;
      if (result.granted) {
        setStatus('ready');
      } else {
        setStatus('error');
        setMessage(Platform.OS === 'web'
          ? 'Camera access was not allowed. You can allow it in your browser site settings and try again, or enter the code manually.'
          : 'Camera access was not allowed. Allow Camera for Paneltec in your phone settings, or enter the code manually.');
      }
    } catch {
      if (!mounted.current) return;
      setStatus('error');
      setMessage('The camera could not open. Check camera access and close other apps using it, then try again or enter the code manually.');
    } finally {
      inFlight.current = false;
    }
  }, [requestPermission]);

  const cameraFailed = useCallback(() => {
    if (!mounted.current) return;
    setStatus('error');
    setMessage('The camera could not start. Check camera access and close other apps using it, then try again or enter the code manually.');
  }, []);

  return {
    cameraReady: status === 'ready' && !unavailable,
    requesting: status === 'requesting',
    canRequest: !unavailable && !needsSettings,
    needsSettings,
    message: unavailable || message || (status === 'requesting'
      ? 'Waiting for camera permission. You can go back or use manual entry at any time.'
      : 'Enable the camera to scan a code, or enter it manually.'),
    requestLabel: status === 'error' ? 'Try camera again' : 'Enable camera',
    enableCamera,
    cameraFailed,
  };
}
