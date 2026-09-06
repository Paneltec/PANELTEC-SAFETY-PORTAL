/**
 * StickyBackHeader — reusable sticky back-button strip for screens
 * that live under a stack navigator but currently have no visible
 * back arrow.
 *
 * v160.2.6 — Introduced to sweep-fix a batch of list screens
 * (hazards, incidents, inspections, pre-starts, site-diary,
 * contractors, swms) that were reachable from Settings but stranded
 * the worker with no visible back affordance.
 *
 * Pattern matches v160.0.23's brute-force notch clearance:
 *    headerTopPad = Math.max(insets.top, StatusBar.currentHeight+16, 44)
 *
 * `router.back()` on tap, with `router.replace(fallbackPath)` when
 * the router has no back-stack (i.e. the user opened the screen
 * from a deep link).
 */
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, StatusBar as RNStatusBar, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../lib/colors';

type Props = {
  title?: string;
  fallbackPath?: string;
};

export default function StickyBackHeader({ title, fallbackPath = '/(tabs)/settings' }: Props) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const androidExtra = Platform.OS === 'android' ? (RNStatusBar.currentHeight || 0) + 16 : 24;
  const headerTopPad = Math.max(insets.top, androidExtra, 44);

  const onBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace(fallbackPath as any);
  };

  return (
    <View style={s.wrap}>
      <View style={{ height: headerTopPad, backgroundColor: Colors.imSurface }} />
      <View style={s.row}>
        <TouchableOpacity
          testID="sticky-back-btn"
          style={s.btn}
          onPress={onBack}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="chevron-back" size={20} color={Colors.imBronze} />
          <Text style={s.label}>Back</Text>
        </TouchableOpacity>
        {title ? <Text style={s.title} numberOfLines={1}>{title}</Text> : null}
        <View style={{ width: 56 }} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { backgroundColor: Colors.imSurface, borderBottomWidth: 1, borderBottomColor: Colors.imBorder },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingBottom: 10, minHeight: 36,
  },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 2, minWidth: 56 },
  label: { fontSize: 14, fontWeight: '700', color: Colors.imBronze },
  title: { fontSize: 14, fontWeight: '700', color: Colors.imInk, letterSpacing: 0.2 },
});
