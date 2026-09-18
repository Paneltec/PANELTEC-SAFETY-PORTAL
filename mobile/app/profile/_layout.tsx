/**
 * Profile stack layout — v58.13.132dc
 */
import { Stack } from 'expo-router';

export default function ProfileLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="personal" />
      <Stack.Screen name="certifications" />
      <Stack.Screen name="inductions" />
      <Stack.Screen name="id-card" />
      <Stack.Screen name="certifications/[id]" />
    </Stack>
  );
}
