/**
 * Haptic feedback helpers — v58.13.132jb
 * Light: tab switch. Medium: form submit success. Warning: submit failure.
 */
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

const isNative = Platform.OS !== 'web';

export function lightHaptic() {
  if (isNative) {
    try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {}
  }
}

export function mediumHaptic() {
  if (isNative) {
    try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); } catch {}
  }
}

export function successHaptic() {
  if (isNative) {
    try { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); } catch {}
  }
}

export function warningHaptic() {
  if (isNative) {
    try { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); } catch {}
  }
}

export function errorHaptic() {
  if (isNative) {
    try { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error); } catch {}
  }
}
