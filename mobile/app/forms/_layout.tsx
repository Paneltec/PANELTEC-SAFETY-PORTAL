/**
 * Forms stack layout — v58.13.132h M6-reset
 */
import { Stack } from 'expo-router';

export default function FormsLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="[id]" />
    </Stack>
  );
}
