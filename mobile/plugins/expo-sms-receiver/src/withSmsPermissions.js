/**
 * withSmsPermissions.js — Expo config plugin modifier
 * Adds RECEIVE_SMS + READ_SMS permissions to AndroidManifest.xml
 */
const { withAndroidManifest } = require('expo/config-plugins');

function withSmsPermissions(config) {
  return withAndroidManifest(config, (modConfig) => {
    const manifest = modConfig.modResults.manifest;
    const perms = manifest['uses-permission'] || [];

    const addPerm = (name) => {
      if (!perms.find((p) => p.$?.['android:name'] === name)) {
        perms.push({ $: { 'android:name': name } });
      }
    };

    addPerm('android.permission.RECEIVE_SMS');
    addPerm('android.permission.READ_SMS');

    manifest['uses-permission'] = perms;
    return modConfig;
  });
}

module.exports = withSmsPermissions;
