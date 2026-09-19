/**
 * Screens group layout — v58.13.132jb
 * Non-tab screens (QR scan, my-work, ask-ai, outbox).
 * Uses a simple stack with no header (each screen manages its own).
 */
import { Stack } from 'expo-router';

export default function ScreensLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }} />
  );
}
