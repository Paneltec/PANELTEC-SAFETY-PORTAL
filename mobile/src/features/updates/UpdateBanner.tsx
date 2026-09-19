/**
 * UpdateBanner — v58.13.132ja
 *
 * Persistent, dismissible banner shown at the top of the home dashboard
 * when a newer APK is available on the server.
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface Props {
  serverVersion: string;
  onInstall: () => void;
  onDismiss: () => void;
}

export default function UpdateBanner({ serverVersion, onInstall, onDismiss }: Props) {
  return (
    <View testID="update-banner" style={s.container}>
      <TouchableOpacity
        testID="update-banner-install"
        style={s.body}
        onPress={onInstall}
        activeOpacity={0.7}
      >
        <Ionicons name="download-outline" size={18} color="#FFF" />
        <Text style={s.text}>
          Update available: v{serverVersion} · Tap to install
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        testID="update-banner-dismiss"
        style={s.dismissBtn}
        onPress={onDismiss}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Ionicons name="close" size={16} color="rgba(255,255,255,0.7)" />
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2C6BFF',
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginHorizontal: 12,
    marginTop: 8,
    borderRadius: 12,
  },
  body: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  text: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFF',
    flex: 1,
  },
  dismissBtn: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
