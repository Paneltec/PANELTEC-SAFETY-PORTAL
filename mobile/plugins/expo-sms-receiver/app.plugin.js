/**
 * expo-sms-receiver — Expo Config Plugin v58.13.132p1b
 *
 * Composes three Android mods:
 *   1. withSmsPermissions   — RECEIVE_SMS + READ_SMS in Manifest
 *   2. withSmsReceiver      — <receiver> declaration in Manifest
 *   3. withNativeReceiverCode — copies SmsReceiver.kt into android/app/src/
 *
 * Usage in app.json:
 *   "plugins": [["./plugins/expo-sms-receiver", { "senderFilter": "Paneltec01" }]]
 */
const withSmsPermissions = require('./src/withSmsPermissions');
const withSmsReceiver = require('./src/withSmsReceiver');
const withNativeReceiverCode = require('./src/withNativeReceiverCode');

function withExpoSmsReceiver(config, props = {}) {
  const senderFilter = props.senderFilter || 'Paneltec01';

  config = withSmsPermissions(config);
  config = withSmsReceiver(config);
  config = withNativeReceiverCode(config, { senderFilter });

  return config;
}

module.exports = withExpoSmsReceiver;
