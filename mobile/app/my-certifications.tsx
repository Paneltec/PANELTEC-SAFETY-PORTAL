/**
 * v160.2.6-cont — My Certifications
 *
 * Read-only card list of the caller's certifications. Data comes from
 * `GET /api/me/worker-profile` (shipped in v160.2.2). Status pills
 * mirror the WorkerViewModal palette:
 *   Valid       → olive success
 *   Expiring soon (<30d) → amber warning
 *   Expired     → brick red
 *   No expiry   → paneltec blue
 *   Missing file → concrete + warning icon
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, TextInput, RefreshControl, Linking, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import api, { apiError } from '../src/lib/api';
import { Colors } from '../src/lib/colors';
import StickyBackHeader from '../src/components/StickyBackHeader';

function shortDate(iso?: string | null) {
  if (!iso || iso.length < 10) return '—';
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}`;
}

function statusStyle(key?: string) {
  switch (key) {
    case 'expired':
      return { bg: 'rgba(139,58,58,0.12)', ink: Colors.imError, border: Colors.imError, label: 'EXPIRED' };
    case 'expiring_soon':
      return { bg: 'rgba(192,128,64,0.15)', ink: Colors.imWarning, border: Colors.imWarning, label: 'EXPIRING SOON' };
    case 'valid':
      return { bg: 'rgba(107,127,92,0.15)', ink: Colors.imSuccess, border: Colors.imSuccess, label: 'VALID' };
    case 'missing_file':
      return { bg: Colors.imConcrete, ink: Colors.imWarning, border: Colors.imWarning, label: 'MISSING FILE' };
    default:
      return { bg: Colors.imConcrete, ink: Colors.imInkMuted, border: Colors.imBorder, label: 'NO EXPIRY' };
  }
}

export default function MyCertificationsScreen() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [certs, setCerts] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const BACKEND = process.env.EXPO_PUBLIC_BACKEND_URL || '';

  const load = useCallback(async () => {
    setErr(null);
    try {
      const { data } = await api.get('/me/worker-profile');
      setCerts(data?.certifications || []);
    } catch (e: any) {
      setErr(apiError(e));
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return certs;
    return certs.filter((c: any) =>
      (c.name || '').toLowerCase().includes(needle) ||
      (c.issuer || '').toLowerCase().includes(needle)
    );
  }, [q, certs]);

  const openFile = (c: any) => {
    // v160.2.2 workers.py returns cert doc_file_id — the mobile PDF
    // viewer route accepts a file_id via query. Fallback opens the
    // backend's raw file endpoint in the system browser.
    if (!c.doc_file_id) return;
    const url = `${BACKEND}/api/files/${c.doc_file_id}`;
    Linking.openURL(url);
  };

  return (
    <SafeAreaView style={s.safe} edges={['left', 'right']}>
      <StickyBackHeader title="My Certifications" fallbackPath="/(tabs)/settings" />
      <ScrollView
        testID="my-certifications-page"
        contentContainerStyle={s.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={Colors.imBronze}
          />
        }
      >
        <Text style={s.overline}>MY CERTIFICATIONS · READ ONLY</Text>
        <Text style={s.heading}>{certs.length} on file</Text>
        <Text style={s.sub}>Amber = expiring soon. Red = expired. Ask your admin if any detail is wrong.</Text>

        {/* Search */}
        <View style={s.searchRow}>
          <Ionicons name="search" size={16} color={Colors.textTertiary} />
          <TextInput
            testID="my-cert-search"
            style={s.searchInput}
            value={q}
            onChangeText={setQ}
            placeholder="Search certifications…"
            placeholderTextColor={Colors.placeholder}
            underlineColorAndroid="transparent"
            selectionColor={Colors.imBronze}
          />
          {q.length > 0 && (
            <TouchableOpacity onPress={() => setQ('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close-circle" size={16} color={Colors.textTertiary} />
            </TouchableOpacity>
          )}
        </View>

        {loading && (
          <ActivityIndicator style={{ marginTop: 24 }} color={Colors.imBronze} />
        )}
        {err && (
          <View style={s.errCard}>
            <Ionicons name="alert-circle" size={16} color={Colors.imError} />
            <Text style={s.errText}>{err}</Text>
          </View>
        )}
        {!loading && !err && certs.length === 0 && (
          <View style={s.emptyCard}>
            <Ionicons name="ribbon-outline" size={32} color={Colors.textTertiary} />
            <Text style={s.emptyTitle}>No certifications on file yet</Text>
            <Text style={s.emptyBody}>
              Your admin hasn&apos;t uploaded any certificates for you.
              Ask them to add them from the Workers screen.
            </Text>
          </View>
        )}
        {!loading && !err && certs.length > 0 && filtered.length === 0 && (
          <View style={s.emptyCard}>
            <Text style={s.emptyBody}>No certifications match &ldquo;{q.trim()}&rdquo;.</Text>
          </View>
        )}
        {!loading && filtered.map((c: any) => {
          const sty = statusStyle(c.status?.key);
          const label = c.status?.label ? c.status.label.toUpperCase() : sty.label;
          return (
            <View key={c.id} testID={`my-cert-${c.id}`} style={s.card}>
              <View style={s.cardIcon}>
                <Ionicons name="ribbon" size={18} color={Colors.imSurface} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.cardName} numberOfLines={1}>{c.name}</Text>
                {c.issuer ? <Text style={s.cardIssuer} numberOfLines={1}>{c.issuer}</Text> : null}
                <View style={s.metaRow}>
                  <Text style={s.metaText}>Issued {shortDate(c.issue_date)}</Text>
                  <Text style={s.metaSep}>·</Text>
                  <Text style={s.metaText}>Expires {shortDate(c.expiry_date)}</Text>
                </View>
                <View style={s.footRow}>
                  <View style={[s.statusPill, { backgroundColor: sty.bg, borderColor: sty.border }]}>
                    <Text style={[s.statusText, { color: sty.ink }]}>{label}</Text>
                  </View>
                  {c.doc_file_id && (
                    <TouchableOpacity
                      testID={`my-cert-view-${c.id}`}
                      style={s.viewBtn}
                      onPress={() => openFile(c)}
                      activeOpacity={0.75}
                    >
                      <Ionicons name="eye" size={13} color={Colors.imBronze} />
                      <Text style={s.viewBtnText}>View</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: Colors.bg },
  content:   { padding: 16, paddingBottom: 40 },
  overline:  { fontSize: 10, fontWeight: '800', letterSpacing: 1.5, color: Colors.imBronze, marginTop: 8 },
  heading:   { fontSize: 22, fontWeight: '800', color: Colors.ink, marginTop: 4, letterSpacing: -0.3 },
  sub:       { fontSize: 12, color: Colors.textSecondary, marginTop: 4, marginBottom: 14, lineHeight: 17 },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: Colors.imBorder, borderRadius: 10,
    backgroundColor: Colors.imSurface, paddingHorizontal: 12, marginBottom: 12,
  },
  searchInput: {
    flex: 1, paddingVertical: 10, fontSize: 14, color: Colors.imInk,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none', outlineWidth: 0 } as any : {}),
  },
  errCard:  {
    flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12,
    borderWidth: 1, borderColor: Colors.imError, borderRadius: 10,
    backgroundColor: 'rgba(139,58,58,0.08)', marginBottom: 12,
  },
  errText:  { flex: 1, color: Colors.imError, fontSize: 13, fontWeight: '600' },
  emptyCard: {
    marginTop: 24, padding: 20, borderWidth: 1, borderColor: Colors.imBorder,
    borderRadius: 12, backgroundColor: Colors.imSurface, alignItems: 'center', gap: 8,
  },
  emptyTitle: { fontSize: 14, fontWeight: '800', color: Colors.imInk, marginTop: 4 },
  emptyBody:  { fontSize: 12, color: Colors.textSecondary, textAlign: 'center', lineHeight: 17 },
  card: {
    flexDirection: 'row', gap: 12, padding: 12,
    backgroundColor: Colors.imSurface, borderWidth: 1, borderColor: Colors.imBorder,
    borderRadius: 12, marginBottom: 10,
  },
  cardIcon: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: Colors.imBronze, alignItems: 'center', justifyContent: 'center',
  },
  cardName: { fontSize: 14, fontWeight: '800', color: Colors.imInk },
  cardIssuer: { fontSize: 11, color: Colors.textSecondary, marginTop: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  metaText: { fontSize: 11, fontWeight: '600', color: Colors.textTertiary },
  metaSep: { fontSize: 11, color: Colors.textTertiary },
  footRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  statusPill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  statusText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.6 },
  viewBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: 1, borderColor: Colors.imBronze, borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 4,
  },
  viewBtnText: { fontSize: 11, fontWeight: '800', color: Colors.imBronze },
});
