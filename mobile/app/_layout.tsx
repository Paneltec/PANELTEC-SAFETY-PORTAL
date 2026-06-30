import React, { useEffect, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Linking from 'expo-linking';
import { getToken } from '../src/lib/auth';
import { AuthProvider, useAuth } from '../src/lib/AuthContext';
import { isPreviewMode } from '../src/lib/preview';
import ChangePasswordModal from '../src/components/auth/ChangePasswordModal';

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
      <StatusBar style="dark" />
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
    </>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <RootNav />
    </AuthProvider>
  );
}
