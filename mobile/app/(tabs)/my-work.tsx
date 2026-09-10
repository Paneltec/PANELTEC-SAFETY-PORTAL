/**
 * My Work — the worker's own records grouped by type. Every group is always
 * shown with a "+ New" button, even when empty, so there is never a dead end.
 */
import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../src/theme/colors';
import { Screen, PageHeader, Chip, Hint } from '../../src/components/ui';
import { MODULE_CONFIG, listItems, type CaptureModuleKey, type CaptureItem } from '../../src/services/capture';
import { TITLES } from '../capture/[module]/index';

const GROUPS: { key: CaptureModuleKey; icon: any }[] = [
  { key: 'pre-starts', icon: 'clipboard' }, { key: 'hazards', icon: 'warning' }, { key: 'incidents', icon: 'alert-circle' },
  { key: 'site-diary', icon: 'book' }, { key: 'inspections', icon: 'checkmark-circle' },
];

export default function MyWorkScreen() {
  const router = useRouter();
  const [data, setData] = useState<Partial<Record<CaptureModuleKey, CaptureItem[]>>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [offline, setOffline] = useState(false);

  const load = useCallback(async () => {
    const out: Partial<Record<CaptureModuleKey, CaptureItem[]>> = {};
    let failed = false;
    await Promise.all(GROUPS.map(async g => {
      try { out[g.key] = await listItems(g.key, { scope: 'me', limit: 20 }); } catch { failed = true; }
    }));
    setData(prev => ({ ...prev, ...out })); setOffline(failed);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const open = (k: CaptureModuleKey) => router.push({ pathname: '/capture/[module]', params: { module: k } } as never);
  const add = (k: CaptureModuleKey) => router.push({ pathname: '/capture/[module]/new', params: { module: k } } as never);

  return (
    <Screen testID="my-work-screen" refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}>
      <PageHeader overline="MY WORK" title="MY RECORDS" sub="Everything you've captured, grouped by type." />
      {offline && <Hint>Some groups couldn't load — pull down to retry.</Hint>}
      <View style={{ gap: 12 }}>
        {GROUPS.map(g => {
          const cfg = MODULE_CONFIG[g.key];
          const items = data[g.key] || [];
          return (
            <View key={g.key} testID={`group-${g.key}`} style={s.group}>
              <TouchableOpacity style={s.groupHead} activeOpacity={0.8} onPress={() => open(g.key)}>
                <View style={s.groupIcon}><Ionicons name={g.icon} size={16} color={Colors.orange} /></View>
                <Text style={s.groupLabel}>{TITLES[g.key].toUpperCase()}</Text>
                <Text style={s.count}>{items.length}</Text>
                <TouchableOpacity testID={`new-${g.key}`} style={s.newBtn} onPress={() => add(g.key)} hitSlop={6}>
                  <Ionicons name="add" size={16} color={Colors.onGreen} />
                  <Text style={s.newText}>New</Text>
                </TouchableOpacity>
              </TouchableOpacity>
              {items.length === 0 ? (
                <Text style={s.emptyRow}>Nothing yet — tap New to capture your first {cfg.label.toLowerCase()}.</Text>
              ) : items.slice(0, 3).map((it, i) => {
                const title = String(it[cfg.titleField] || cfg.label);
                const date = String(it[cfg.dateField] || it.created_at || '').slice(0, 10);
                const status = it[cfg.statusField] ? String(it[cfg.statusField]) : '';
                return (
                  <TouchableOpacity key={it.id || i} style={[s.row, i > 0 && s.rowBorder]} activeOpacity={0.8}
                    onPress={() => router.push({ pathname: '/capture/[module]/[id]', params: { module: g.key, id: it.id } } as never)}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={s.rowTitle} numberOfLines={1}>{title}</Text>
                      <Text style={s.rowDate}>{date}</Text>
                    </View>
                    {!!status && <Chip text={status.replace(/_/g, ' ').toUpperCase()} tone={/closed|signed|complete/i.test(status) ? 'green' : 'orange'} />}
                  </TouchableOpacity>
                );
              })}
              {items.length > 3 && (
                <TouchableOpacity style={s.viewAll} onPress={() => open(g.key)}>
                  <Text style={s.viewAllText}>VIEW ALL {items.length}</Text>
                  <Ionicons name="arrow-forward" size={14} color={Colors.orange} />
                </TouchableOpacity>
              )}
            </View>
          );
        })}
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  group: { backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.cardBorder, borderRadius: 14, overflow: 'hidden' },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderBottomWidth: 1, borderBottomColor: Colors.cardBorder, minHeight: 56 },
  groupIcon: { width: 30, height: 30, borderRadius: 8, backgroundColor: Colors.orangeSoft, alignItems: 'center', justifyContent: 'center' },
  groupLabel: { flex: 1, fontSize: 12, fontWeight: '800', letterSpacing: 1, color: Colors.onCard },
  count: { fontSize: 11, fontWeight: '800', color: Colors.orange, backgroundColor: Colors.orangeSoft, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, overflow: 'hidden' },
  newBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: Colors.green, borderRadius: 8, paddingHorizontal: 10, minHeight: 32, justifyContent: 'center' },
  newText: { color: Colors.onGreen, fontSize: 12, fontWeight: '800' },
  emptyRow: { fontSize: 12, color: Colors.onCardMuted, padding: 12, lineHeight: 17 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10, minHeight: 52 },
  rowBorder: { borderTopWidth: 1, borderTopColor: Colors.cardBorder },
  rowTitle: { fontSize: 14, fontWeight: '600', color: Colors.onCard },
  rowDate: { fontSize: 11, color: Colors.onCardSubtle, marginTop: 2 },
  viewAll: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 10, borderTopWidth: 1, borderTopColor: Colors.cardBorder },
  viewAllText: { fontSize: 11, fontWeight: '800', color: Colors.orange, letterSpacing: 0.5 },
});
