/**
 * Capture list — one screen for pre-starts, hazards, incidents, site diary
 * and inspections. "+ New" is always there, even with no records.
 */
import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../../src/theme/colors';
import { Screen, BackHeader, Empty, Loading, Chip } from '../../../src/components/ui';
import { MODULE_CONFIG, listItems, type CaptureModuleKey, type CaptureItem } from '../../../src/services/capture';

export const TITLES: Record<CaptureModuleKey, string> = {
  'pre-starts': 'Daily Pre-Starts',
  'hazards': 'Hazard Reports',
  'incidents': 'Incident Reports',
  'site-diary': 'Site Diary',
  'inspections': 'Inspections',
};

function summarise(module: CaptureModuleKey, it: CaptureItem): { title: string; sub: string; date: string; status?: string } {
  const c = MODULE_CONFIG[module];
  const date = String(it[c.dateField] || it.created_at || '').slice(0, 10);
  const title = String(it[c.titleField] || '').trim() || c.label;
  const sub = String(it[c.subtitleField] || '').trim();
  const status = it[c.statusField] ? String(it[c.statusField]) : undefined;
  return { title, sub, date, status };
}

export default function CaptureListScreen() {
  const router = useRouter();
  const { module } = useLocalSearchParams<{ module: CaptureModuleKey }>();
  const key = (module || 'pre-starts') as CaptureModuleKey;
  const cfg = MODULE_CONFIG[key];
  const [items, setItems] = useState<CaptureItem[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try { setItems(await listItems(key, { scope: 'me', limit: 50 })); setError(''); }
    catch { setItems(items ?? []); setError("Couldn't load from the office server. Pull down to retry."); }
  }, [key]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!cfg) return <Screen><BackHeader title="Not found" /></Screen>;

  return (
    <Screen testID={`capture-list-${key}`} refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}>
      <BackHeader
        title={TITLES[key]}
        right={
          <TouchableOpacity
            testID="capture-new-btn"
            style={s.newBtn}
            onPress={() => router.push({ pathname: '/capture/[module]/new', params: { module: key } } as never)}
          >
            <Ionicons name="add" size={18} color={Colors.onGreen} />
            <Text style={s.newText}>New</Text>
          </TouchableOpacity>
        }
      />
      {!!error && <Text style={s.error}>{error}</Text>}
      {items === null ? <Loading text="Loading…" /> : items.length === 0 ? (
        <Empty icon={cfg.icon as any} title={`No ${TITLES[key].toLowerCase()} yet`} body={`Tap New to capture your first ${cfg.label.toLowerCase()}.`} />
      ) : (
        <View style={s.list}>
          {items.map(it => {
            const v = summarise(key, it);
            return (
              <TouchableOpacity
                key={it.id}
                testID={`capture-row-${it.id}`}
                style={s.card}
                activeOpacity={0.8}
                onPress={() => router.push({ pathname: '/capture/[module]/[id]', params: { module: key, id: it.id } } as never)}
              >
                <View style={s.cardTop}>
                  <Text style={s.date}>{v.date || '—'}</Text>
                  {!!v.status && <Chip text={v.status.replace(/_/g, ' ').toUpperCase()} tone={/closed|signed|complete|resolved/i.test(v.status) ? 'green' : /high|critical|open/i.test(v.status) ? 'orange' : 'grey'} />}
                  {it._offline && <Chip text="WAITING TO SEND" tone="grey" />}
                </View>
                <Text style={s.title} numberOfLines={1}>{v.title}</Text>
                {!!v.sub && <Text style={s.sub} numberOfLines={2}>{v.sub}</Text>}
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  newBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.green, borderRadius: 10, paddingHorizontal: 12, minHeight: 40, justifyContent: 'center' },
  newText: { color: Colors.onGreen, fontSize: 13, fontWeight: '800' },
  error: { color: Colors.onScreenMuted, fontSize: 12, marginBottom: 10 },
  list: { gap: 10 },
  card: { backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.cardBorder, borderRadius: 14, padding: 14 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  date: { flex: 1, fontSize: 12, fontWeight: '700', color: Colors.orange, letterSpacing: 0.5 },
  title: { fontSize: 15, fontWeight: '700', color: Colors.onCard },
  sub: { fontSize: 13, color: Colors.onCardMuted, marginTop: 4, lineHeight: 18 },
});
