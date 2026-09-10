/**
 * Forms stack layout — v58.13.132j
 */
import { Stack } from 'expo-router';

export default function FormsLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="[id]" />
      <Stack.Screen name="category" />
    </Stack>
  );
}
