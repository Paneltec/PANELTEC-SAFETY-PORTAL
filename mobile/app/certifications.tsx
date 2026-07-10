import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, ActivityIndicator, Alert, RefreshControl, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import api, { apiError } from '../src/lib/api';
import { getUser } from '../src/lib/auth';
import { Colors } from '../src/lib/colors';
import { previewRole, isPreviewMode } from '../src/lib/preview';

const WRITE_ROLES = new Set(['admin', 'hseq_lead']);
const BACKEND = process.env.EXPO_PUBLIC_BACKEND_URL || '';

const FILTERS = [
  { key: 'all',           label: 'All',           bg: Colors.imConcrete, ink: Colors.imInkMuted },
  { key: 'expired',       label: 'Expired',        bg: Colors.imConcrete, ink: Colors.imError },
  { key: 'expiring_soon', label: 'Expiring Soon',  bg: Colors.imConcrete, ink: Colors.imInk },
  { key: 'missing_file',  label: 'Missing File',   bg: Colors.imConcrete, ink: Colors.imInk },
  { key: 'valid',         label: 'Valid',           bg: Colors.imConcrete, ink: Colors.imSuccess },
  { key: 'no_expiry',     label: 'No Expiry',      bg: Colors.imConcrete, ink: Colors.paneltecBlue },
];

function fmtDate(s: string | null | undefined) { return s ? s.slice(0, 10) : '—'; }

function resolveStatus(c: any): string {
  const hasFile = !!c.file_url || !!c.file_id;
  if (!hasFile && c.status !== 'no_expiry') return 'missing_file';
  return c.status || 'valid';
}

function statusLabel(c: any): { key: string; label: string; bg: string; ink: string; icon?: string } {
  const key = resolveStatus(c);
  switch (key) {
    case 'expired': {
      const d = c.days_since_expiry ?? daysSince(c.expiry_date);
      return { key, label: `EXPIRED${d ? ` ${d}d AGO` : ''}`, bg: Colors.imConcrete, ink: Colors.imError };
    }
    case 'expiring_soon': {
      const d = c.days_until_expiry ?? daysUntil(c.expiry_date);
      return { key, label: `EXPIRES IN ${d ?? '?'}d`, bg: Colors.imConcrete, ink: Colors.imInk };
    }
    case 'missing_file':
      return { key, label: 'MISSING FILE', bg: Colors.imConcrete, ink: Colors.imInk, icon: 'warning' };
    case 'no_expiry':
      return { key, label: 'NO EXPIRY', bg: Colors.imConcrete, ink: Colors.paneltecBlue };
    default:
      return { key: 'valid', label: 'VALID', bg: Colors.imConcrete, ink: Colors.imSuccess };
  }
}

function daysSince(d: string | null) {
  if (!d) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 86400000));
}
function daysUntil(d: string | null) {
  if (!d) return null;
  return Math.max(0, Math.floor((new Date(d).getTime() - Date.now()) / 86400000));
}

const STATUS_PRIORITY: Record<string, number> = {
  expired: 0, expiring_soon: 1, missing_file: 2, valid: 3, no_expiry: 4,
};

function StatusBadge({ cert }: { cert: any }) {
  const s = statusLabel(cert);
  return (
    <View style={[gst.badge, { backgroundColor: s.bg }]}>
      {s.icon && <Ionicons name={s.icon as any} size={10} color={s.ink} />}
      <Text style={[gst.badgeText, { color: s.ink }]}>{s.label}</Text>
    </View>
  );
}

export default function CertificationsScreen() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  const canEdit = WRITE_ROLES.has(user?.role);

  const load = useCallback(async () => {
    try {
      const q = search.trim();
      // v160.0.6 — Preview-mode data-leak fix:
      // The `wantMineOnly` flag drives whether we send `?scope=me`. Before
      // this fix it read `user.role` (the REAL role from the JWT), so an
      // admin using the web preview-as-worker iframe still fetched the
      // full org list. Now we honour the previewed role when the app is
      // running in preview mode. We also pass `as_role=<preview>` so the
      // backend can enforce scoping on its side as defense in depth.
      const effectiveRole = (isPreviewMode && previewRole
        ? previewRole
        : (user?.role || '')
      ).toLowerCase();
      const wantMineOnly = user && !['admin', 'hseq_lead', 'supervisor'].includes(effectiveRole);
      const asRoleParam = isPreviewMode && previewRole
        ? `&as_role=${encodeURIComponent(previewRole)}`
        : '';
      const finalUrl = q
        ? `/workers/certifications/search?q=${encodeURIComponent(q)}${wantMineOnly ? '&scope=me' : ''}${asRoleParam}`
        : `/workers/certifications/all?${wantMineOnly ? 'scope=me' : ''}${asRoleParam.replace(/^&/, '')}`.replace(/\?$/, '');
      const { data } = await api.get(finalUrl);
      setRows(data || []);
    } catch (e: any) { Alert.alert('Error', apiError(e)); }
    finally { setLoading(false); setRefreshing(false); }
  }, [search, user]);

  useEffect(() => { getUser().then(setUser); }, []);
  useEffect(() => { setLoading(true); load(); }, [load]);

  // Counts per filter
  const counts = useMemo(() => {
    const m: Record<string, number> = { all: rows.length };
    rows.forEach((c) => {
      const k = resolveStatus(c);
      m[k] = (m[k] || 0) + 1;
    });
    return m;
  }, [rows]);

  // Filter + sort
  const visible = useMemo(() => {
    let out = rows;
    if (filter !== 'all') {
      out = out.filter((c) => resolveStatus(c) === filter);
    }
    return [...out].sort((a, b) => {
      const pa = STATUS_PRIORITY[resolveStatus(a)] ?? 5;
      const pb = STATUS_PRIORITY[resolveStatus(b)] ?? 5;
      if (pa !== pb) return pa - pb;
      const ea = a.expiry_date || '9999';
      const eb = b.expiry_date || '9999';
      return ea < eb ? -1 : ea > eb ? 1 : 0;
    });
  }, [rows, filter]);

  const sendReminder = async (c: any) => {
    try {
      await api.post(`/workers/certifications/${c.id}/send-reminder`);
      Alert.alert('Sent', `Reminder dispatched for "${c.name}".`);
    } catch (e: any) { Alert.alert('Error', apiError(e)); }
  };

  const exportCsv = async () => {
    const url = `${BACKEND}/api/workers/certifications/all?format=csv`;
    try { await Linking.openURL(url); }
    catch { Alert.alert('Error', 'Could not open export URL.'); }
  };

  return (
    <SafeAreaView style={gst.safe}>
      {/* Butter header banner */}
      <View testID="certs-header" style={gst.headerBanner}>
        <TouchableOpacity onPress={() => router.back()} style={gst.backBtn}>
          <Ionicons name="arrow-back" size={20} color={Colors.ink} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={gst.overline}>SETTINGS</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Ionicons name="ribbon" size={18} color={Colors.orangeLight} />
            <Text style={gst.heading}>Certifications</Text>
          </View>
          <Text style={gst.subtitle}>Compliance attention queue</Text>
        </View>
        <TouchableOpacity testID="certs-export" style={gst.exportBtn} onPress={exportCsv}>
          <Ionicons name="download" size={14} color={Colors.orangeLight} />
          <Text style={gst.exportBtnText}>CSV</Text>
        </TouchableOpacity>
      </View>

      {/* Search */}
      <View style={gst.searchRow}>
        <View style={gst.searchBox}>
          <Ionicons name="search" size={14} color={Colors.textTertiary} />
          <TextInput testID="certs-search" style={gst.searchInput}
            placeholder="Search worker, cert, issuer…"
            placeholderTextColor={Colors.textTertiary}
            value={search} onChangeText={setSearch} autoCapitalize="none" />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')}>
              <Ionicons name="close-circle" size={16} color={Colors.textTertiary} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Filter chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0 }} contentContainerStyle={gst.chipRow}>
        {FILTERS.map((f) => {
          const active = filter === f.key;
          const count = counts[f.key] ?? 0;
          return (
            <TouchableOpacity key={f.key} testID={`filter-${f.key}`}
              style={[gst.chip, active && { backgroundColor: f.bg, borderColor: f.ink + '40' }]}
              onPress={() => setFilter(f.key)}>
              <Text style={[gst.chipText, active && { color: f.ink, fontWeight: '700' }]}>{f.label}</Text>
              <View style={[gst.chipCount, active && { backgroundColor: f.ink + '20' }]}>
                <Text style={[gst.chipCountText, active && { color: f.ink }]}>{count}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* List */}
      {loading ? (
        <View style={gst.loadingWrap}>
          <ActivityIndicator color={Colors.imInk} />
          <Text style={gst.loadingText}>Loading certifications…</Text>
        </View>
      ) : visible.length === 0 ? (
        <View style={gst.loadingWrap}>
          <Ionicons name="ribbon" size={32} color={Colors.textTertiary} />
          <Text style={gst.loadingText}>
            {search ? 'No certifications match your search.' : filter !== 'all' ? 'None in this category.' : 'No certifications found.'}
          </Text>
        </View>
      ) : (
        <ScrollView testID="certs-list" style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={Colors.imInk} />}>
          <Text style={gst.countLabel}>{visible.length} certification{visible.length === 1 ? '' : 's'}</Text>
          {visible.map((c) => (
            <View key={c.id} testID={`gcert-card-${c.id}`} style={gst.card}>
              {/* Top: worker + status */}
              <View style={gst.cardTop}>
                <TouchableOpacity testID={`gcert-worker-${c.id}`} style={{ flex: 1 }}
                  onPress={() => router.push({ pathname: '/workers', params: { openWorkerId: c.worker_id } })}>
                  <Text style={gst.workerName}>{c.worker_name || 'Unknown worker'}</Text>
                </TouchableOpacity>
                <StatusBadge cert={c} />
              </View>
              {/* Middle: cert details */}
              <Text style={gst.certName}>{c.name}</Text>
              <Text style={gst.certMeta}>
                {c.issuer ? `${c.issuer} · ` : ''}Issued {fmtDate(c.issue_date)} · Expires {fmtDate(c.expiry_date)}
              </Text>
              {/* Actions */}
              <View style={gst.cardActions}>
                {canEdit && (
                  <TouchableOpacity testID={`gcert-remind-${c.id}`}
                    style={[gst.actionBtn, { backgroundColor: Colors.imConcrete }]}
                    onPress={() => sendReminder(c)}>
                    <Ionicons name="paper-plane" size={11} color={Colors.paneltecViolet} />
                    <Text style={[gst.actionBtnText, { color: Colors.paneltecViolet }]}>Remind</Text>
                  </TouchableOpacity>
                )}
                {(c.file_url || c.file_id) && (
                  <TouchableOpacity testID={`gcert-file-${c.id}`}
                    style={[gst.actionBtn, { backgroundColor: Colors.imConcrete }]}>
                    <Ionicons name="document" size={11} color={Colors.paneltecBlue} />
                    <Text style={[gst.actionBtnText, { color: Colors.orangeLight }]}>File</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity testID={`gcert-open-${c.id}`}
                  style={[gst.actionBtn, { backgroundColor: Colors.imConcrete }]}
                  onPress={() => router.push({ pathname: '/workers', params: { openWorkerId: c.worker_id } })}>
                  <Ionicons name="open" size={11} color={Colors.imInkMuted} />
                  <Text style={[gst.actionBtnText, { color: Colors.textSecondary }]}>Worker</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const gst = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  // v160.0.6 — dark header. Was cream `#FEF3C7` with `Colors.ink`
  // (near-white) title on top → title invisible in bright sun. Now:
  // slate-900 surface + slate-700 border matches the rest of the shell;
  // orange overline/icon ties the screen to the Certifications module's
  // amber-orange accent without harming legibility.
  headerBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: Colors.surface, paddingHorizontal: 16, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  backBtn: { padding: 4, marginTop: 2 },
  overline: { fontSize: 10, fontWeight: '700', letterSpacing: 1.5, color: Colors.orangeLight },
  heading: { fontSize: 22, fontWeight: '700', color: Colors.ink, letterSpacing: -0.5 },
  subtitle: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  exportBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.orangeSoft, borderWidth: 1, borderColor: Colors.orange,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
  },
  exportBtnText: { fontSize: 11, fontWeight: '600', color: Colors.orangeLight },
  searchRow: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8,
  },
  searchInput: { flex: 1, fontSize: 13, color: Colors.text, padding: 0 },
  chipRow: { paddingHorizontal: 16, paddingBottom: 10, gap: 6 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20,
    borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.white,
  },
  chipText: { fontSize: 11, fontWeight: '500', color: Colors.textSecondary },
  chipCount: { backgroundColor: Colors.imConcrete, borderRadius: 8, paddingHorizontal: 5, paddingVertical: 1 },
  chipCountText: { fontSize: 9, fontWeight: '700', color: Colors.textTertiary },
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8, padding: 32 },
  loadingText: { fontSize: 13, color: Colors.textTertiary, textAlign: 'center' },
  countLabel: {
    fontSize: 11, fontWeight: '600', color: Colors.textTertiary, marginBottom: 8,
    textTransform: 'uppercase', letterSpacing: 0.8,
  },
  card: {
    backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 14, padding: 12, marginBottom: 8,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  workerName: { fontSize: 14, fontWeight: '700', color: Colors.blue },
  certName: { fontSize: 13, fontWeight: '600', color: Colors.ink, marginTop: 4 },
  certMeta: { fontSize: 11, color: Colors.textSecondary, marginTop: 2 },
  cardActions: { flexDirection: 'row', gap: 6, marginTop: 8 },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8,
  },
  actionBtnText: { fontSize: 10, fontWeight: '600' },
  // Badge
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8,
  },
  badgeText: { fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
});
