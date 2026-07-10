import React, { useEffect, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Linking from 'expo-linking';
// v160.0.22 — SafeAreaProvider MUST wrap the entire tree so that any
// call to `useSafeAreaInsets()` / `<SafeAreaView edges={...}>` inside
// tab screens returns real Android status-bar inset values. Without
// this provider the hook returns { top: 0, ... } and every sticky
// header we've been trying to pad is quietly getting zero — which is
// why the notch has repeatedly re-swallowed the back buttons after
// each "fix" attempt.
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { getToken } from '../src/lib/auth';
import { AuthProvider, useAuth } from '../src/lib/AuthContext';
import { isPreviewMode } from '../src/lib/preview';
import ChangePasswordModal from '../src/components/auth/ChangePasswordModal';

import ToastHost from '../src/components/ToastHost';

function RootNav() {
  const [isReady, setIsReady] = useState(false);
  const { isAuth, setAuth, mustChangePassword, setMustChangePassword } = useAuth();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    (async () => {
      if (isPreviewMode) {
        setIsReady(true);
        return;
      }
      const token = await getToken();
      setAuth(!!token);
      setIsReady(true);
    })();
  }, []);

  // Deep link: paneltec://reset?token=... → /(auth)/onboard?flavour=reset
  useEffect(() => {
    const handle = (event: { url: string }) => {
      try {
        const parsed = Linking.parse(event.url);
        if (parsed.path === 'reset' && parsed.queryParams?.token) {
          router.replace({ pathname: '/(auth)/onboard', params: { token: parsed.queryParams.token as string, flavour: 'reset' } });
        }
      } catch {}
    };
    Linking.getInitialURL().then(url => { if (url) handle({ url }); });
    const sub = Linking.addEventListener('url', handle);
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!isReady) return;
    const inAuthGroup = segments[0] === '(auth)';
    if (!isAuth && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (isAuth && inAuthGroup) {
      router.replace('/(tabs)/dashboard');
    }
  }, [isReady, isAuth, segments]);

  if (!isReady) return null;

  return (
    <>
      <StatusBar style="light" translucent backgroundColor="transparent" />
      <ChangePasswordModal
        visible={isAuth && mustChangePassword}
        locked={true}
        onClose={() => {}}
        onChanged={() => setMustChangePassword(false)}
      />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="swms" />
        <Stack.Screen name="pre-starts" />
        <Stack.Screen name="site-diary" />
        <Stack.Screen name="hazards" />
        <Stack.Screen name="incidents" />
        <Stack.Screen name="inspections" />
        <Stack.Screen name="contractors" />
        <Stack.Screen name="suppliers" />
        <Stack.Screen name="document-library" />
        <Stack.Screen name="users" />
        <Stack.Screen name="workers" />
        <Stack.Screen name="certifications" />
        <Stack.Screen name="forms" />
      </Stack>
      <ToastHost />
    </>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <RootNav />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
