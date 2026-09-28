/**
 * Phase 4 — Root layout.
 * Simplified for civil WHS app.
 * QueryClient + ErrorBoundary + StatusBar.
 */
import React, { useEffect } from 'react';
import { AppState, Platform, View, Text, StyleSheet } from 'react-native';
import type { AppStateStatus } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import * as SplashScreen from 'expo-splash-screen';

function onAppStateChange(status: AppStateStatus) {
  if (Platform.OS !== 'web') {
    focusManager.setFocused(status === 'active');
  }
}

try { SplashScreen.preventAutoHideAsync().catch(() => {}); } catch {}

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 2, staleTime: 60_000 } },
});

// Simple error boundary
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; error?: Error }> {
  state = { hasError: false, error: undefined as Error | undefined };
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <View style={eb.container}>
          <Text style={eb.title}>Something went wrong</Text>
          <Text style={eb.msg}>{this.state.error?.message || 'Unknown error'}</Text>
        </View>
      );
    }
    return this.props.children;
  }
}

const eb = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F8FAFC', padding: 32 },
  title: { fontSize: 20, fontWeight: '700', color: '#0F172A', marginBottom: 8 },
  msg: { fontSize: 14, color: '#64748B', textAlign: 'center' },
});

export default function RootLayout() {
  useEffect(() => {
    const sub = AppState.addEventListener('change', onAppStateChange);
    return () => sub.remove();
  }, []);

  useEffect(() => {
    (async () => {
      try { await SplashScreen.hideAsync(); } catch {}
    })();
  }, []);

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="(screens)" />
        </Stack>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
