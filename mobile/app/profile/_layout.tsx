/**
 * Profile stack layout — v58.13.132g M6
 */
import { Stack } from 'expo-router';

export default function ProfileLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="certifications/[id]" />
      <Stack.Screen name="swms/[id]" />
      <Stack.Screen name="fleet/[id]" />
    </Stack>
  );
}
