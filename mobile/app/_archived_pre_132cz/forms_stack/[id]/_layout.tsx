/**
 * Form [id] sub-stack layout — v58.13.132j
 * Handles the submitted.tsx child route.
 */
import { Stack } from 'expo-router';

export default function FormIdLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="submitted" />
    </Stack>
  );
}
