import React, { useEffect, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { getToken } from '../src/lib/auth';
import { AuthProvider, useAuth } from '../src/lib/AuthContext';
import { isPreviewMode } from '../src/lib/preview';

function RootNav() {
  const [isReady, setIsReady] = useState(false);
  const { isAuth, setAuth } = useAuth();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    (async () => {
      if (isPreviewMode) {
        // Preview mode: AuthContext auto-sets isAuth=true in its boot useEffect.
        // Just mark as ready — don't read from storage.
        setIsReady(true);
        return;
      }
      const token = await getToken();
      setAuth(!!token);
      setIsReady(true);
    })();
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
