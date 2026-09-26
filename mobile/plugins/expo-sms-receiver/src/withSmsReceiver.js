/**
 * withSmsReceiver.js — Expo config plugin modifier
 * Registers the <receiver> for SMS_RECEIVED in AndroidManifest.xml
 */
const { withAndroidManifest } = require('expo/config-plugins');

const RECEIVER_CLASS = '.SmsReceiver';

function withSmsReceiver(config) {
  return withAndroidManifest(config, (modConfig) => {
    const manifest = modConfig.modResults.manifest;
    const app = manifest.application?.[0];
    if (!app) return modConfig;

    if (!app.receiver) app.receiver = [];

    // Avoid duplicate
    const exists = app.receiver.find(
      (r) => r.$?.['android:name'] === RECEIVER_CLASS
    );
    if (!exists) {
      app.receiver.push({
        $: {
          'android:name': RECEIVER_CLASS,
          'android:permission': 'android.permission.BROADCAST_SMS',
          'android:exported': 'true',
        },
        'intent-filter': [
          {
            action: [
              {
                $: {
                  'android:name':
                    'android.provider.Telephony.SMS_RECEIVED',
                },
              },
            ],
          },
        ],
      });
    }

    return modConfig;
  });
}

module.exports = withSmsReceiver;
