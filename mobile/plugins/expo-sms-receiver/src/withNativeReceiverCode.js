/**
 * withNativeReceiverCode.js — Expo config plugin modifier (dangerous mod)
 * Copies SmsReceiver.kt into android/app/src/main/java/<package>/
 */
const { withDangerousMod } = require('expo/config-plugins');
const { mkdirSync, copyFileSync, existsSync, readFileSync, writeFileSync } = require('fs');
const { join } = require('path');

function withNativeReceiverCode(config, { senderFilter }) {
  return withDangerousMod(config, [
    'android',
    (modConfig) => {
      const projectRoot = modConfig.modRequest.projectRoot;

      // Resolve Android package path from app.json android.package
      const androidPackage =
        modConfig.android?.package || 'com.paneltec.mobile';
      const packagePath = androidPackage.replace(/\./g, '/');

      const destDir = join(
        projectRoot,
        'android',
        'app',
        'src',
        'main',
        'java',
        packagePath
      );
      if (!existsSync(destDir)) {
        mkdirSync(destDir, { recursive: true });
      }

      // Read the template Kotlin file
      const ktSource = join(
        __dirname,
        '..',
        'android',
        'SmsReceiver.kt'
      );
      let ktContent = readFileSync(ktSource, 'utf-8');

      // Replace package declaration to match actual app package
      ktContent = ktContent.replace(
        /^package .*$/m,
        `package ${androidPackage}`
      );

      // Bake in the sender filter
      if (senderFilter) {
        ktContent = ktContent.replace(
          /private const val SENDER_FILTER = ".*"/,
          `private const val SENDER_FILTER = "${senderFilter}"`
        );
      }

      writeFileSync(join(destDir, 'SmsReceiver.kt'), ktContent);
      console.log(
        `[expo-sms-receiver] Copied SmsReceiver.kt → ${destDir}`
      );

      return modConfig;
    },
  ]);
}

module.exports = withNativeReceiverCode;
