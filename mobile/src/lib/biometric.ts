// Phase 4.7 — biometric helpers for Face ID / Touch ID / Android biometric
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const BIO_TOKEN_KEY = 'paneltec_bio_token';
const BIO_ENABLED_KEY = 'paneltec_bio_enabled';

export async function isBiometricAvailable(): Promise<boolean> {
  try {
    const compatible = await LocalAuthentication.hasHardwareAsync();
    if (!compatible) return false;
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    return enrolled;
  } catch {
    return false;
  }
}

export async function getBiometricType(): Promise<string> {
  try {
    const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
    if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) return 'Face ID';
    if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) return 'Touch ID';
    if (types.includes(LocalAuthentication.AuthenticationType.IRIS)) return 'Iris';
    return 'Biometric';
  } catch {
    return 'Biometric';
  }
}

export async function storeBiometricToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(BIO_TOKEN_KEY, token);
  await SecureStore.setItemAsync(BIO_ENABLED_KEY, 'true');
}

export async function getBiometricToken(): Promise<string | null> {
  try {
    const enabled = await SecureStore.getItemAsync(BIO_ENABLED_KEY);
    if (enabled !== 'true') return null;
    return await SecureStore.getItemAsync(BIO_TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function isBiometricEnabled(): Promise<boolean> {
  try {
    const v = await SecureStore.getItemAsync(BIO_ENABLED_KEY);
    return v === 'true';
  } catch {
    return false;
  }
}

export async function clearBiometric(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(BIO_TOKEN_KEY);
    await SecureStore.deleteItemAsync(BIO_ENABLED_KEY);
  } catch {}
}

export async function authenticateWithBiometric(): Promise<{ success: boolean; token?: string }> {
  const token = await getBiometricToken();
  if (!token) return { success: false };
  const bioType = await getBiometricType();
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: `Sign in with ${bioType}`,
    cancelLabel: 'Use password',
    disableDeviceFallback: true,
  });
  if (result.success) return { success: true, token };
  return { success: false };
}
