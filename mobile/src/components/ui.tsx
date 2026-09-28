/**
 * Shared UI atoms for worker-facing screens (navy bg, off-white bordered
 * cards, orange icons, green "go" actions). .132p3b — cherry-picked from
 * claude/leave-requests branch ui.tsx, adapted for our existing colors.ts.
 */
import React from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView,
  ActivityIndicator, RefreshControl, ViewStyle, TextStyle, TextInputProps,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Colors } from '../theme/colors';

type Icon = keyof typeof Ionicons.glyphMap;

/** Full-height navy screen with safe-area padding and optional pull-to-refresh. */
export function Screen({
  children, scroll = true, refreshing, onRefresh, testID, padded = true, bottomPad = 32,
}: {
  children: React.ReactNode; scroll?: boolean; refreshing?: boolean; onRefresh?: () => void;
  testID?: string; padded?: boolean; bottomPad?: number;
}) {
  const insets = useSafeAreaInsets();
  const pad = { paddingTop: insets.top + 12, paddingHorizontal: padded ? 16 : 0, paddingBottom: bottomPad };
  if (!scroll) return <View testID={testID} style={[s.screen, pad]}>{children}</View>;
  return (
    <ScrollView
      testID={testID}
      style={s.screen}
      contentContainerStyle={pad}
      keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={Colors.orange} /> : undefined}
    >
      {children}
    </ScrollView>
  );
}

/** Back chevron + title row for pushed screens. */
export function BackHeader({ title, right }: { title: string; right?: React.ReactNode }) {
  const router = useRouter();
  return (
    <View style={s.backRow}>
      <TouchableOpacity testID="back-btn" onPress={() => router.back()} style={s.backBtn} hitSlop={8}>
        <Ionicons name="chevron-back" size={26} color={Colors.onScreen} />
      </TouchableOpacity>
      <Text style={s.backTitle} numberOfLines={1}>{title}</Text>
      {right}
    </View>
  );
}

export function SectionLabel({ children, style }: { children: React.ReactNode; style?: TextStyle }) {
  return <Text style={[s.sectionLabel, style]}>{children}</Text>;
}

/** Off-white bordered card. */
export function Panel({ children, style, testID }: { children: React.ReactNode; style?: ViewStyle; testID?: string }) {
  return <View testID={testID} style={[s.panel, style]}>{children}</View>;
}

/** Label above a field, uppercase grey on navy. */
export function FieldLabel({ children }: { children: React.ReactNode }) {
  return <Text style={s.fieldLabel}>{children}</Text>;
}

export function Input(props: TextInputProps & { testID?: string }) {
  return (
    <TextInput
      placeholderTextColor={Colors.onCardSubtle}
      {...props}
      style={[s.input, props.multiline && s.inputMulti, props.style]}
    />
  );
}

/** Key / value row inside a Panel. */
export function KV({ k, v, first }: { k: string; v?: string | null; first?: boolean }) {
  return (
    <View style={[s.kv, !first && s.kvBorder]}>
      <Text style={s.kvKey}>{k}</Text>
      <Text style={s.kvVal}>{v || '—'}</Text>
    </View>
  );
}

/** Small status chip. */
export function Chip({ text, tone = 'orange' }: { text: string; tone?: 'orange' | 'green' | 'grey' | 'red' }) {
  const map = {
    orange: { bg: Colors.orangeSoftOnNavy, fg: Colors.orange },
    green: { bg: Colors.greenSoft, fg: Colors.green },
    grey: { bg: 'rgba(255,255,255,0.10)', fg: Colors.onScreenMuted },
    red: { bg: 'rgba(239,68,68,0.18)', fg: '#F87171' },
  }[tone];
  return (
    <View style={[s.chip, { backgroundColor: map.bg }]}>
      <Text style={[s.chipText, { color: map.fg }]}>{text}</Text>
    </View>
  );
}

export function Loading({ text }: { text?: string }) {
  return (
    <View style={s.loading}>
      <ActivityIndicator color={Colors.orange} />
      {!!text && <Text style={s.loadingText}>{text}</Text>}
    </View>
  );
}

export function Empty({ icon = 'folder-open-outline', title, body }: { icon?: Icon; title: string; body?: string }) {
  return (
    <View style={s.empty}>
      <View style={s.emptyIcon}><Ionicons name={icon} size={26} color={Colors.onCardSubtle} /></View>
      <Text style={s.emptyTitle}>{title}</Text>
      {!!body && <Text style={s.emptyBody}>{body}</Text>}
    </View>
  );
}

export function Hint({ children }: { children: React.ReactNode }) {
  return <Text style={s.hint}>{children}</Text>;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.screen },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 14, minHeight: 44 },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: -12 },
  backTitle: { flex: 1, fontSize: 22, fontWeight: '800', color: Colors.onScreen },
  sectionLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 1.4, color: Colors.onScreenMuted, marginTop: 8, marginBottom: 10 },
  panel: { backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.cardBorder, borderRadius: 14, padding: 14 },
  fieldLabel: { fontSize: 11, fontWeight: '700', color: Colors.onScreenMuted, letterSpacing: 1.2, marginTop: 14, marginBottom: 6 },
  input: {
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.cardBorder, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 13, fontSize: 15, color: Colors.onCard, minHeight: 48,
  },
  inputMulti: { minHeight: 80, textAlignVertical: 'top' },
  kv: { flexDirection: 'row', gap: 10, paddingVertical: 9 },
  kvBorder: { borderTopWidth: 1, borderTopColor: Colors.cardBorder },
  kvKey: { width: 96, fontSize: 10, fontWeight: '800', letterSpacing: 1, color: Colors.onCardSubtle, paddingTop: 2 },
  kvVal: { flex: 1, fontSize: 14, color: Colors.onCard, lineHeight: 19 },
  chip: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8 },
  chipText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.6 },
  loading: { padding: 40, alignItems: 'center', gap: 10 },
  loadingText: { color: Colors.onScreenMuted, fontSize: 13 },
  empty: { alignItems: 'center', paddingVertical: 36, paddingHorizontal: 24, gap: 8 },
  emptyIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.cardBorder, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: Colors.onScreen, marginTop: 6 },
  emptyBody: { fontSize: 13, color: Colors.onScreenMuted, textAlign: 'center', lineHeight: 19 },
  hint: { textAlign: 'center', fontSize: 11, color: Colors.onScreenMuted, marginTop: 10, lineHeight: 16 },
});
