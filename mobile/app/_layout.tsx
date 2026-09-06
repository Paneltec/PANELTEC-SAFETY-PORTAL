/**
 * Root layout — providers + auth routing.
 * v58.13.132g — Added profile detail stack screens.
 */
import React from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 60_000,
    },
  },
});

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="visitor" />
        <Stack.Screen name="hazards" />
        <Stack.Screen name="incidents" />
        <Stack.Screen name="prestarts" />
        <Stack.Screen name="site-diary" />
        <Stack.Screen name="inspections" />
        <Stack.Screen name="profile" />
      </Stack>
    </QueryClientProvider>
  );
}
