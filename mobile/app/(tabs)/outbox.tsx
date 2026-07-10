import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, RefreshControl, ActivityIndicator, Alert, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import api, { apiError } from '../../src/lib/api';
import { Colors, StatusColors } from '../../src/lib/colors';

export default function OutboxScreen() {
  const [data, setData] = useState<{ items: any[]; m365_connected: boolean; count: number }>({ items: [], m365_connected: false, count: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statusF, setStatusF] = useState('');
  const [active, setActive] = useState<any>(null);

  const load = useCallback(async () => {
    try {
      const params: any = {}; if (statusF) params.status = statusF;
      const { data: d } = await api.get('/email/outbox', { params }); setData(d);
    } catch (e) { Alert.alert('Error', apiError(e)); }
    finally { setLoading(false); setRefreshing(false); }
  }, [statusF]);

  useEffect(() => { load(); }, [load]);

  const retry = async (id: string) => { try { await api.post(`/email/outbox/${id}/retry`); Alert.alert('Retried'); load(); } catch (e) { Alert.alert('Error', apiError(e)); }};
  const cancel = async (id: string) => { try { await api.post(`/email/outbox/${id}/cancel`); Alert.alert('Cancelled'); load(); } catch (e) { Alert.alert('Error', apiError(e)); }};

  const statuses = ['', 'queued', 'sent', 'failed', 'cancelled'];
  const statusLabels = ['ALL', 'QUEUED', 'SENT', 'FAILED', 'CANCELLED'];

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView testID="outbox-page" style={s.scroll} contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={Colors.orange} />}>
        <Text style={s.overline}>SETTINGS</Text>
        <Text style={s.heading}>EMAIL OUTBOX</Text>
        <Text style={s.sub}>{data.count} messages · Microsoft 365{data.m365_connected ? '' : ' (not connected)'}</Text>

        {!data.m365_connected && (
          <View testID="m365-banner" style={s.warnBanner}>
            <Ionicons name="warning" size={16} color={Colors.amber} />
            <Text style={s.warnText}>Microsoft 365 not connected. Queued emails won't send until M365 is configured in Settings.</Text>
          </View>
        )}

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.filterRow}>
          {statuses.map((st, i) => (
            <TouchableOpacity key={st} testID={`outbox-filter-${st || 'all'}`}
              style={[s.filterChip, statusF === st && s.filterActive]} onPress={() => setStatusF(st)}>
              <Text style={[s.filterText, statusF === st && s.filterActiveText]}>{statusLabels[i]}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {loading ? <ActivityIndicator style={{ marginTop: 40 }} color={Colors.orange} /> :
          data.items.length === 0 ? (
            <View style={s.emptyBox}><Ionicons name="mail-outline" size={32} color={Colors.textTertiary} /><Text style={s.emptyText}>No outbox messages</Text></View>
          ) : data.items.map(m => {
            const sc = StatusColors[m.status] || StatusColors.queued;
            return (
              <TouchableOpacity key={m.id} testID={`outbox-row-${m.id}`} style={s.card} onPress={() => setActive(m)} activeOpacity={0.7}>
                <View style={s.cardTop}>
                  <View style={[s.statusPill, { backgroundColor: sc.bg, borderColor: sc.border }]}>
                    <Text style={[s.statusText, { color: sc.text }]}>{(m.status || '').toUpperCase()}</Text>
                  </View>
                  <Text style={s.cardDate}>{new Date(m.created_at).toLocaleDateString()}</Text>
                </View>
                <Text style={s.cardSubject} numberOfLines={1}>{m.subject}</Text>
                <Text style={s.cardTo} numberOfLines={1}>{(m.to || []).join(', ')}</Text>
                {m.related_record_type && <Text style={s.cardType}>{m.related_record_type.toUpperCase()}</Text>}
                <View style={s.cardActions}>
                  {(m.status === 'queued' || m.status === 'failed') && (
                    <TouchableOpacity testID={`outbox-retry-${m.id}`} style={s.actionBtn} onPress={() => retry(m.id)}>
                      <Ionicons name="refresh" size={13} color={Colors.orange} /><Text style={s.actionBtnText}>RETRY</Text>
                    </TouchableOpacity>
                  )}
                  {m.status === 'queued' && (
                    <TouchableOpacity testID={`outbox-cancel-${m.id}`} style={[s.actionBtn, s.cancelBtn]} onPress={() => cancel(m.id)}>
                      <Ionicons name="close-circle" size={13} color={Colors.red} /><Text style={[s.actionBtnText, { color: Colors.red }]}>CANCEL</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </TouchableOpacity>
            );
          })}
      </ScrollView>

      <Modal visible={!!active} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setActive(null)}>
        <SafeAreaView style={s.drawerSafe}>
          <View testID="outbox-drawer" style={s.drawer}>
            <View style={s.drawerHeader}>
              <Text style={s.drawerTitle}>MESSAGE DETAIL</Text>
              <TouchableOpacity onPress={() => setActive(null)} style={s.closeBtn}><Ionicons name="close" size={22} color={Colors.textTertiary} /></TouchableOpacity>
            </View>
            {active && (
              <ScrollView style={s.drawerBody}>
                {(() => { const sc = StatusColors[active.status] || StatusColors.queued; return (
                  <View style={[s.statusPill, { backgroundColor: sc.bg, borderColor: sc.border, alignSelf: 'flex-start', marginBottom: 12 }]}>
                    <Text style={[s.statusText, { color: sc.text }]}>{(active.status || '').toUpperCase()}</Text>
                  </View>
                );})()}
                <Text style={s.drawerSubject}>{active.subject}</Text>
                <View style={s.drawerField}><Ionicons name="mail" size={12} color={Colors.textTertiary} /><Text style={s.drawerFieldText}>{(active.to || []).join(', ')}</Text></View>
                {active.cc?.length > 0 && <View style={s.drawerField}><Text style={s.drawerFieldLabel}>CC:</Text><Text style={s.drawerFieldText}>{active.cc.join(', ')}</Text></View>}
                {active.related_record_type && <View style={s.drawerField}><Text style={s.drawerFieldLabel}>Related:</Text><Text style={s.drawerFieldText}>{active.related_record_type}</Text></View>}
                <View style={s.drawerField}><Text style={s.drawerFieldLabel}>Created:</Text><Text style={s.drawerFieldText}>{new Date(active.created_at).toLocaleString()}</Text></View>
                {active.error && <View style={s.errorBox}><Text style={s.errorText}>Error: {active.error}</Text></View>}
              </ScrollView>
            )}
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 32 },
  overline: { fontSize: 10, fontWeight: '800', letterSpacing: 1.5, color: Colors.orange },
  heading: { fontSize: 26, fontWeight: '800', color: Colors.ink, marginTop: 4, letterSpacing: 1 },
  sub: { fontSize: 13, color: Colors.textSecondary, marginTop: 4 },
  warnBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 12, padding: 12, borderRadius: 12, backgroundColor: Colors.amberSoft, borderWidth: 1, borderColor: 'rgba(245,158,11,0.3)' },
  warnText: { fontSize: 13, color: Colors.amber, flex: 1, lineHeight: 18 },
  filterRow: { marginTop: 14, marginBottom: 14, flexGrow: 0 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface, marginRight: 8 },
  filterActive: { backgroundColor: Colors.orange, borderColor: Colors.orange },
  filterText: { fontSize: 11, fontWeight: '700', color: Colors.textSecondary, letterSpacing: 0.5 },
  filterActiveText: { color: Colors.imSurface },
  emptyBox: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60 },
  emptyText: { fontSize: 14, color: Colors.textTertiary, marginTop: 8 },
  card: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: 14, padding: 14, marginBottom: 8 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  statusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, borderWidth: 1 },
  statusText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },
  cardDate: { fontSize: 11, color: Colors.textTertiary },
  cardSubject: { fontSize: 15, fontWeight: '600', color: Colors.ink },
  cardTo: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  cardType: { fontSize: 10, fontWeight: '700', color: Colors.textTertiary, letterSpacing: 0.8, marginTop: 4 },
  cardActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surfaceLight },
  actionBtnText: { fontSize: 11, fontWeight: '700', color: Colors.orange, letterSpacing: 0.5 },
  cancelBtn: { borderColor: 'rgba(239,68,68,0.3)' },
  drawerSafe: { flex: 1, backgroundColor: Colors.bg },
  drawer: { flex: 1 },
  drawerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Colors.border, backgroundColor: Colors.surface },
  drawerTitle: { fontSize: 14, fontWeight: '800', color: Colors.ink, letterSpacing: 1 },
  closeBtn: { padding: 4 },
  drawerBody: { flex: 1, padding: 16 },
  drawerSubject: { fontSize: 20, fontWeight: '700', color: Colors.ink, marginBottom: 12 },
  drawerField: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  drawerFieldLabel: { fontSize: 11, fontWeight: '700', color: Colors.textTertiary, letterSpacing: 0.5 },
  drawerFieldText: { fontSize: 13, color: Colors.textSecondary, flex: 1 },
  errorBox: { marginTop: 12, padding: 10, borderRadius: 10, backgroundColor: Colors.redSoft, borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)' },
  errorText: { fontSize: 12, color: Colors.red },
});
