import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, ActivityIndicator, Alert, RefreshControl, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import api, { apiError } from '../src/lib/api';
import { getUser } from '../src/lib/auth';
import { Colors } from '../src/lib/colors';
import WorkerEditModal from '../src/components/WorkerEditModal';

const WRITE_ROLES = new Set(['admin', 'hseq_lead']);
const SYNC_OPTIONS = [
  { value: 'paneltec', label: 'Paneltec only' },
  { value: 'viatec',   label: 'Viatec only' },
  { value: 'both',     label: 'Paneltec + Viatec' },
];

function fullName(w: any) {
  return `${w.first_name || ''} ${w.last_name || ''}`.trim() || '(unnamed)';
}
function initials(w: any) {
  const f = (w.first_name || '')[0] || '';
  const l = (w.last_name || '')[0] || '';
  return (f + l).toUpperCase() || '?';
}

function CompanyChip({ label }: { label: string }) {
  const tints: Record<string, { bg: string; text: string }> = {
    Paneltec: { bg: '#e6eff9', text: '#1e4a8c' },
    Viatec:   { bg: '#ece6f4', text: '#4f3a8c' },
    Manual:   { bg: '#F1F5F9', text: '#475569' },
  };
  const c = tints[label] || tints.Manual;
  return (
    <View style={[s.companyChip, { backgroundColor: c.bg }]}>
      <Text style={[s.companyChipText, { color: c.text }]}>{label}</Text>
    </View>
  );
}

export default function WorkersScreen() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<any>(null);
  const [syncOpen, setSyncOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const canEdit = WRITE_ROLES.has(user?.role);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/workers');
      setRows(data || []);
    } catch (e: any) { Alert.alert('Error', apiError(e)); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { getUser().then(setUser); load(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const blob = `${fullName(r)} ${r.email || ''} ${r.phone || ''} ${r.mobile || ''} ${r.suburb || ''} ${r.state || ''}`.toLowerCase();
      return blob.includes(q);
    });
  }, [rows, search]);

  const sync = async (company: string) => {
    setSyncOpen(false);
    setSyncing(true);
    try {
      const { data } = await api.post('/workers/sync-from-simpro', { company });
      Alert.alert('Sync complete', `${data.created ?? 0} new, ${data.updated ?? 0} updated, ${data.skipped ?? 0} skipped`);
      await load();
    } catch (e: any) { Alert.alert('Sync failed', apiError(e)); }
    finally { setSyncing(false); }
  };

  const remove = (w: any) => {
    Alert.alert('Delete worker', `Remove "${fullName(w)}"? This is a soft delete.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try {
          await api.delete(`/workers/${w.id}`);
          Alert.alert('Deleted', `${fullName(w)} removed`);
          await load();
        } catch (e: any) { Alert.alert('Error', apiError(e)); }
      }},
    ]);
  };

  const onRefresh = () => { setRefreshing(true); load(); };

  return (
    <SafeAreaView style={s.safe}>
      {/* Sky pastel header banner */}
      <View testID="workers-header" style={s.headerBanner}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="arrow-back" size={20} color="#1e4a8c" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.overline}>SETTINGS</Text>
          <Text style={s.heading}>Workers</Text>
          <Text style={s.subtitle}>Your field crew — synced from Simpro or added manually.</Text>
        </View>
      </View>

      {/* Toolbar */}
      <View testID="workers-toolbar" style={s.toolbar}>
        <View style={s.searchBox}>
          <Ionicons name="search" size={14} color={Colors.textTertiary} />
          <TextInput
            testID="workers-search"
            style={s.searchInput}
            placeholder="Search name, email, phone…"
            placeholderTextColor={Colors.textTertiary}
            value={search}
            onChangeText={setSearch}
            autoCapitalize="none"
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')}>
              <Ionicons name="close-circle" size={16} color={Colors.textTertiary} />
            </TouchableOpacity>
          )}
        </View>
        <View style={s.toolbarActions}>
          {canEdit && (
            <TouchableOpacity
              testID="sync-dropdown-btn"
              style={s.syncBtn}
              onPress={() => setSyncOpen(true)}
              disabled={syncing}
            >
              {syncing
                ? <ActivityIndicator size="small" color="#1e4a8c" />
                : <Ionicons name="sync" size={14} color="#1e4a8c" />
              }
              <Text style={s.syncBtnText}>Sync</Text>
            </TouchableOpacity>
          )}
          {canEdit && (
            <TouchableOpacity
              testID="add-worker-btn"
              style={s.addBtn}
              onPress={() => setEditing({})}
            >
              <Ionicons name="add" size={14} color="#fff" />
              <Text style={s.addBtnText}>Add</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* List */}
      {loading ? (
        <View style={s.loadingWrap}>
          <ActivityIndicator color="#1e4a8c" />
          <Text style={s.loadingText}>Loading workers…</Text>
        </View>
      ) : filtered.length === 0 ? (
        <View style={s.emptyWrap}>
          <Ionicons name="people" size={36} color={Colors.textTertiary} />
          <Text style={s.emptyTitle}>{search ? 'No workers match' : 'No workers yet'}</Text>
          <Text style={s.emptyBody}>
            {search ? 'Try a different search term.' : 'Sync from Simpro or add a worker manually.'}
          </Text>
          {canEdit && !search && (
            <TouchableOpacity testID="empty-add-worker" style={[s.addBtn, { marginTop: 12 }]} onPress={() => setEditing({})}>
              <Ionicons name="add" size={14} color="#fff" />
              <Text style={s.addBtnText}>Add worker</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        <ScrollView
          testID="workers-list"
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#1e4a8c" />}
        >
          <Text style={s.countLabel}>{filtered.length} worker{filtered.length === 1 ? '' : 's'}</Text>
          {filtered.map((w) => (
            <TouchableOpacity
              key={w.id}
              testID={`worker-row-${w.id}`}
              style={s.workerCard}
              onPress={() => setEditing(w)}
              onLongPress={() => canEdit ? remove(w) : undefined}
              activeOpacity={0.7}
            >
              <View style={[s.avatar, { backgroundColor: w.active ? '#d8ecdd' : '#F1F5F9' }]}>
                <Text style={[s.avatarText, { color: w.active ? '#1f7a3f' : '#475569' }]}>{initials(w)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.workerName}>{fullName(w)}</Text>
                {w.position ? <Text style={s.workerPosition}>{w.position}</Text> : null}
                <View style={s.workerMeta}>
                  {w.email ? (
                    <View style={s.metaRow}>
                      <Ionicons name="mail-outline" size={10} color={Colors.textTertiary} />
                      <Text style={s.metaText} numberOfLines={1}>{w.email}</Text>
                    </View>
                  ) : null}
                  {(w.mobile || w.phone) ? (
                    <View style={s.metaRow}>
                      <Ionicons name="call-outline" size={10} color={Colors.textTertiary} />
                      <Text style={s.metaText}>{w.mobile || w.phone}</Text>
                    </View>
                  ) : null}
                </View>
              </View>
              <View style={s.rightCol}>
                <View style={[s.statusBadge, w.active ? s.activeBadge : s.inactiveBadge]}>
                  <Text style={[s.statusText, { color: w.active ? '#1f7a3f' : '#475569' }]}>
                    {w.active ? 'Active' : 'Inactive'}
                  </Text>
                </View>
                <CompanyChip label={w.company_label || (w.source === 'simpro' ? 'Simpro' : 'Manual')} />
                <Ionicons name="chevron-forward" size={14} color={Colors.textTertiary} />
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Sync Modal */}
      <Modal visible={syncOpen} transparent animationType="fade" onRequestClose={() => setSyncOpen(false)}>
        <TouchableOpacity style={s.syncOverlay} activeOpacity={1} onPress={() => setSyncOpen(false)}>
          <View style={s.syncSheet} testID="sync-modal">
            <Text style={s.syncTitle}>Sync from Simpro</Text>
            <Text style={s.syncDesc}>Import or update workers from your Simpro account.</Text>
            {SYNC_OPTIONS.map((o) => (
              <TouchableOpacity
                key={o.value}
                testID={`sync-${o.value}`}
                style={s.syncOption}
                onPress={() => sync(o.value)}
              >
                <Ionicons name="sync" size={14} color="#1e4a8c" />
                <Text style={s.syncOptionText}>{o.label}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={s.syncCancel} onPress={() => setSyncOpen(false)}>
              <Text style={s.syncCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Edit Modal */}
      {editing !== null && (
        <WorkerEditModal
          worker={editing}
          canEdit={canEdit}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  headerBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: '#e6eff9', paddingHorizontal: 16, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: '#b9d2ec',
  },
  backBtn: { padding: 4, marginTop: 2 },
  overline: { fontSize: 10, fontWeight: '700', letterSpacing: 1.5, color: '#1e4a8c' },
  heading: { fontSize: 24, fontWeight: '700', color: Colors.ink, marginTop: 2, letterSpacing: -0.5 },
  subtitle: { fontSize: 12, color: '#1e4a8c', marginTop: 2, opacity: 0.7 },
  toolbar: { paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8,
  },
  searchInput: { flex: 1, fontSize: 13, color: Colors.text, padding: 0 },
  toolbarActions: { flexDirection: 'row', gap: 8, marginTop: 6 },
  syncBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#e6eff9', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10,
  },
  syncBtnText: { fontSize: 12, fontWeight: '600', color: '#1e4a8c' },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#1e4a8c', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10,
  },
  addBtnText: { fontSize: 12, fontWeight: '600', color: '#fff' },
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8 },
  loadingText: { fontSize: 13, color: Colors.textTertiary },
  emptyWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: Colors.ink },
  emptyBody: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center' },
  countLabel: { fontSize: 11, fontWeight: '600', color: Colors.textTertiary, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.8 },
  workerCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 14, padding: 12, marginBottom: 8,
  },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 13, fontWeight: '700' },
  workerName: { fontSize: 14, fontWeight: '600', color: Colors.ink },
  workerPosition: { fontSize: 11, color: Colors.textSecondary, marginTop: 1 },
  workerMeta: { marginTop: 4, gap: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 11, color: Colors.textTertiary },
  rightCol: { alignItems: 'flex-end', gap: 4 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, borderWidth: 1 },
  activeBadge: { backgroundColor: '#d8ecdd', borderColor: '#b6dcbf' },
  inactiveBadge: { backgroundColor: '#F1F5F9', borderColor: '#E2E8F0' },
  statusText: { fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  companyChip: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  companyChipText: { fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  // Sync modal
  syncOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'flex-end' },
  syncSheet: { backgroundColor: Colors.white, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 40 },
  syncTitle: { fontSize: 17, fontWeight: '700', color: Colors.ink },
  syncDesc: { fontSize: 13, color: Colors.textSecondary, marginTop: 4, marginBottom: 16 },
  syncOption: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Colors.borderLight,
  },
  syncOptionText: { fontSize: 15, color: Colors.text },
  syncCancel: { alignItems: 'center', marginTop: 12, paddingVertical: 10 },
  syncCancelText: { fontSize: 14, fontWeight: '600', color: Colors.textTertiary },
});
