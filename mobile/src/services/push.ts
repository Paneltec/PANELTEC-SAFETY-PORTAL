/**
 * Push notification service — baseline scaffold.
 * Registers device token on first successful onboarding.
 * Does NOT send notifications in M1.
 */
import { Platform } from 'react-native';
import axios from 'axios';
import { getStoredJwt } from './auth';

const API = process.env.EXPO_PUBLIC_BACKEND_URL;

export async function requestPushPermission(): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  try {
    const Notifications = require('expo-notifications');
    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;
    if (existing !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') return null;
    const tokenData = await Notifications.getExpoPushTokenAsync();
    return tokenData.data;
  } catch {
    return null;
  }
}

export async function registerDeviceToken(deviceToken: string): Promise<void> {
  const jwt = await getStoredJwt();
  if (!jwt) return;
  try {
    await axios.post(`${API}/api/mobile/push/register`, {
      device_token: deviceToken,
      platform: Platform.OS,
    }, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
  } catch {
    // Silent fail — will retry on next app launch
  }
}
