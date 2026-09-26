/**
 * smsPermissions.ts — v58.13.132p1b
 *
 * Android SMS permission request with explanation dialog.
 * iOS: no-op (uses paste flow instead).
 */
import { Platform, PermissionsAndroid, Alert, Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const PERM_KEY = 'paneltec_sms_perm_requested';

export type SmsPermResult = 'granted' | 'denied' | 'never_ask_again' | 'ios_skip';

/** Has the permission already been requested this install? */
export async function hasRequestedSmsPermission(): Promise<boolean> {
  const val = await AsyncStorage.getItem(PERM_KEY);
  return val === 'true';
}

/**
 * Request RECEIVE_SMS + READ_SMS on Android with a user-facing explanation first.
 * Returns the result status. Stores flag to avoid re-prompting in same session.
 */
export async function requestSmsPermission(): Promise<SmsPermResult> {
  if (Platform.OS !== 'android') return 'ios_skip';

  // Check if already granted
  const already = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECEIVE_SMS);
  if (already) return 'granted';

  // Show explanation dialog first
  return new Promise((resolve) => {
    Alert.alert(
      'Auto-receive job SMS',
      'Paneltec needs to read incoming SMS from Paneltec01 so your daily job allocations appear in the app automatically.\n\nIt never reads any other messages.',
      [
        {
          text: 'Not now',
          style: 'cancel',
          onPress: async () => {
            await AsyncStorage.setItem(PERM_KEY, 'true');
            resolve('denied');
          },
        },
        {
          text: 'Allow',
          onPress: async () => {
            await AsyncStorage.setItem(PERM_KEY, 'true');
            try {
              const results = await PermissionsAndroid.requestMultiple([
                PermissionsAndroid.PERMISSIONS.RECEIVE_SMS,
                PermissionsAndroid.PERMISSIONS.READ_SMS,
              ]);
              const receiveSms = results[PermissionsAndroid.PERMISSIONS.RECEIVE_SMS];
              if (receiveSms === PermissionsAndroid.RESULTS.GRANTED) {
                resolve('granted');
              } else if (receiveSms === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
                resolve('never_ask_again');
              } else {
                resolve('denied');
              }
            } catch {
              resolve('denied');
            }
          },
        },
      ]
    );
  });
}

/** Open the app's system settings page (for when permission was permanently denied). */
export function openAppSettings() {
  Linking.openSettings();
}
