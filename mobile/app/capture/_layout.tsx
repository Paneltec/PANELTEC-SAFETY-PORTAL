/**
 * Capture flows — stack layout.
 * Phase 4 — field-worker capture screens.
 */
import { Stack } from 'expo-router';

export default function CaptureLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="hazard" />
      <Stack.Screen name="prestart" />
      <Stack.Screen name="diary" />
      <Stack.Screen name="incident" />
      <Stack.Screen name="inspection" />
      <Stack.Screen name="signon" />
    </Stack>
  );
}
