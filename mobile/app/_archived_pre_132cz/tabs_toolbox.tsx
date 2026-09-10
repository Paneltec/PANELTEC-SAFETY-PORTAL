/**
 * Toolbox meetings — v58.13.132ab.
 *
 * Scaffolding-only screen. Fills in once Plaud hardware arrives.
 * Route: hidden tab (accessed via home-tile only, `href: null` in
 * `(tabs)/_layout.tsx`).
 */
import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../src/theme/colors';

export default function ToolboxScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View testID="toolbox-screen" style={[s.container, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <TouchableOpacity
          testID="toolbox-back-btn"
          style={s.backBtn}
          onPress={() => router.back()}
        >
          <Ionicons name="chevron-back" size={24} color={Colors.white} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Toolbox Meetings</Text>
      </View>

      <ScrollView contentContainerStyle={s.scroll}>
        {/* Empty state */}
        <View style={s.emptyCard} testID="toolbox-empty-card">
          <View style={s.emptyIconWrap}>
            <Ionicons name="mic-outline" size={36} color={Colors.orange} />
          </View>
          <Text style={s.emptyTitle}>No meetings recorded yet</Text>
          <Text style={s.emptyBody}>
            Toolbox transcripts will appear here once your Plaud recorder is
            connected and pushed the first meeting to Paneltec Civil.
          </Text>
        </View>

        {/* Recent meetings — placeholder */}
        <View style={s.section}>
          <View style={s.sectionHeader}>
            <Text style={s.sectionTitle}>RECENT MEETINGS</Text>
            <View style={s.chip}>
              <Text style={s.chipText}>coming soon</Text>
            </View>
          </View>
          <View style={s.placeholderCard} testID="toolbox-recent-placeholder">
            <Ionicons name="list-outline" size={20} color={Colors.textTertiary} />
            <Text style={s.placeholderText}>
              Once meetings sync, they'll appear here newest first.
            </Text>
          </View>
        </View>

        {/* Upload audio manually — disabled */}
        <View style={s.section}>
          <View style={s.sectionHeader}>
            <Text style={s.sectionTitle}>UPLOAD MANUALLY</Text>
          </View>
          <TouchableOpacity
            testID="toolbox-upload-btn"
            style={s.disabledBtn}
            disabled={true}
            activeOpacity={1}
          >
            <Ionicons name="cloud-upload-outline" size={20} color={Colors.textTertiary} />
            <Text style={s.disabledBtnText}>Upload audio</Text>
          </TouchableOpacity>
          <Text style={s.disabledHint}>
            Awaiting Plaud device setup. Manual upload will be enabled once the
            transcription pipeline is provisioned.
          </Text>
        </View>

        {/* Meeting templates */}
        <View style={s.section}>
          <View style={s.sectionHeader}>
            <Text style={s.sectionTitle}>MEETING TEMPLATES</Text>
          </View>
          <TouchableOpacity
            testID="toolbox-templates-btn"
            style={s.linkCard}
            onPress={() => router.push('/(tabs)/forms' as never)}
            activeOpacity={0.75}
          >
            <View style={s.linkIcon}>
              <Ionicons name="document-text" size={20} color={Colors.white} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.linkTitle}>Open Forms tab</Text>
              <Text style={s.linkSub}>
                Toolbox templates will surface as a Forms category (pending template pack).
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={Colors.textTertiary} />
          </TouchableOpacity>
        </View>

        <View style={{ height: 32 }} />
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.navy },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 10,
  },
  backBtn: { padding: 6 },
  headerTitle: { color: Colors.white, fontSize: 18, fontWeight: '700', marginLeft: 4 },
  scroll: { paddingHorizontal: 16, paddingBottom: 24 },

  emptyCard: {
    backgroundColor: Colors.surface,
    borderRadius: 18, padding: 22,
    alignItems: 'center', marginTop: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 6, elevation: 2,
  },
  emptyIconWrap: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: Colors.orangeSoft,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 10,
  },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: Colors.textPrimary, marginBottom: 6 },
  emptyBody: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center', lineHeight: 18 },

  section: { marginTop: 20 },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 8,
  },
  sectionTitle: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 11, fontWeight: '700', letterSpacing: 0.8,
  },
  chip: {
    backgroundColor: 'rgba(249,115,22,0.15)',
    borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2,
    borderWidth: 1, borderColor: 'rgba(249,115,22,0.35)',
  },
  chipText: { color: Colors.orangeLight, fontSize: 10, fontWeight: '700', letterSpacing: 0.6 },

  placeholderCard: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 14, padding: 14,
    flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  placeholderText: { color: 'rgba(255,255,255,0.6)', fontSize: 13, flex: 1 },

  disabledBtn: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14,
    flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  disabledBtnText: { color: Colors.textTertiary, fontSize: 14, fontWeight: '600' },
  disabledHint: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 11, marginTop: 6, lineHeight: 15,
  },

  linkCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.surface, borderRadius: 14,
    padding: 12, gap: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 4, elevation: 1,
  },
  linkIcon: {
    width: 42, height: 42, borderRadius: 12,
    backgroundColor: Colors.navy,
    alignItems: 'center', justifyContent: 'center',
  },
  linkTitle: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary },
  linkSub: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
});
