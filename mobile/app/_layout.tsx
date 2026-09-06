/**
 * Root layout — providers + auth routing.
 * v58.13.132h — M6-reset: Forms library + profile detail stacks.
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
        <Stack.Screen name="forms" />
        <Stack.Screen name="profile" />
      </Stack>
    </QueryClientProvider>
  );
}
