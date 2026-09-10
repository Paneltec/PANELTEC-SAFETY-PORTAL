/**
 * Category stack layout — v58.13.132j
 */
import { Stack } from 'expo-router';

export default function CategoryLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="[key]" />
    </Stack>
  );
}
