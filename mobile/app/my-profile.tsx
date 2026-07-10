// v160.2.2 — Read-only "My Profile" screen for the mobile app.
// Reads GET /api/me/worker-profile and shows the caller's identity,
// contact, personal, availability, clients and certifications with
// expiring / expired highlights. Strictly read-only — workers don't
// get edit rights over their own compliance profile.
import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  RefreshControl, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import api, { apiError } from '../src/lib/api';
import { Colors } from '../src/lib/colors';

const DAYS: { key: string; label: string }[] = [
  { key: 'mon', label: 'MON' }, { key: 'tue', label: 'TUE' },
  { key: 'wed', label: 'WED' }, { key: 'thu', label: 'THU' },
  { key: 'fri', label: 'FRI' }, { key: 'sat', label: 'SAT' },
  { key: 'sun', label: 'SUN' },
];

function shortDate(iso?: string | null) {
  if (!iso || iso.length < 10) return '—';
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}`;
}

function certStatusStyle(key?: string) {
  // Amber for expiring_soon (<30d), red for expired, olive for valid,
  // grey neutral otherwise. Uses Colors.im* tokens per the theming rule.
  switch (key) {
    case 'expired':
      return { bg: 'rgba(139,58,58,0.12)', border: Colors.imError, ink: Colors.imError };
    case 'expiring_soon':
      return { bg: 'rgba(192,128,64,0.15)', border: Colors.imWarning, ink: Colors.imWarning };
    case 'valid':
      return { bg: 'rgba(107,127,92,0.15)', border: Colors.imSuccess, ink: Colors.imSuccess };
    default:
      return { bg: Colors.imConcrete, border: Colors.imBorder, ink: Colors.imInkMuted };
  }
}

export default function MyProfileScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<any>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { data } = await api.get('/me/worker-profile');
      setProfile(data);
    } catch (e: any) {
      setError(apiError(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const w = profile?.worker || null;
  const certs = profile?.certifications || [];
  const clients = profile?.clients || [];
  const enabledDays = w?.availability
    ? DAYS.filter((d) => w.availability?.[d.key]?.enabled)
    : [];

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/settings');
  };

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView
        testID="my-profile-page"
        style={s.scroll}
        contentContainerStyle={s.content}
        refreshControl={
          <RefreshControl
            testID="my-profile-refresh"
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={Colors.imBronze}
          />
        }
      >
        <TouchableOpacity testID="my-profile-back-btn" onPress={goBack} style={s.navBack}>
          <Ionicons name="arrow-back" size={20} color={Colors.imBronze} />
          <Text style={s.navBackText}>Back</Text>
        </TouchableOpacity>

        <Text style={s.overline}>MY PROFILE · READ ONLY</Text>
        <Text style={s.heading}>{w ? `${w.first_name || ''} ${w.last_name || ''}`.trim() || 'Profile' : 'Loading…'}</Text>
        {w?.position ? <Text style={s.sub}>{w.position}</Text> : null}

        {loading && (
          <ActivityIndicator style={{ marginTop: 24 }} color={Colors.imBronze} />
        )}

        {!loading && error && (
          <View testID="my-profile-error" style={s.errorCard}>
            <Ionicons name="alert-circle" size={16} color={Colors.imError} />
            <Text style={s.errorText}>{error}</Text>
          </View>
        )}

        {!loading && !error && !w && (
          <View style={s.emptyCard}>
            <Text style={s.emptyText}>
              No worker profile is linked to your account. Ask your HSEQ lead
              to create your worker record so your compliance details show up here.
            </Text>
          </View>
        )}

        {!loading && !error && w && (
          <>
            {/* Identity & contact */}
            <Text style={s.sectionLabel}>IDENTITY &amp; CONTACT</Text>
            <View testID="section-identity" style={s.section}>
              <Row label="EMAIL" value={w.email || '—'} testID="row-email" />
              <Row label="PHONE" value={w.phone || '—'} testID="row-phone" />
              <Row label="MOBILE" value={w.mobile || '—'} testID="row-mobile" />
              <Row label="COMPANY" value={w.company_label || '—'} testID="row-company" last />
            </View>

            {/* Personal */}
            <Text style={s.sectionLabel}>PERSONAL</Text>
            <View testID="section-personal" style={s.section}>
              <Row label="BIRTH DATE" value={shortDate(w.birth_date)} testID="row-birth-date" />
              <Row label="COUNTRY" value={w.country || '—'} testID="row-country" />
              <Row label="STATE" value={w.state || '—'} testID="row-state" />
              <Row label="POSTAL" value={w.postal_code || '—'} testID="row-postal" />
              <Row label="ADDRESS"
                value={[w.street_address, w.suburb].filter(Boolean).join(', ') || '—'}
                testID="row-street" last />
            </View>

            {/* Availability */}
            <Text style={s.sectionLabel}>AVAILABILITY</Text>
            <View testID="section-availability" style={s.section}>
              {enabledDays.length === 0 ? (
                <Text style={s.emptyRow}>No days configured</Text>
              ) : (
                <View style={s.chipRow}>
                  {enabledDays.map((d) => {
                    const row = w.availability[d.key];
                    return (
                      <View key={d.key} testID={`avail-${d.key}`} style={s.availChip}>
                        <Text style={s.availDay}>{d.label}</Text>
                        <Text style={s.availTime}>{row.start}–{row.end}</Text>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>

            {/* Clients */}
            <Text style={s.sectionLabel}>CLIENTS · {clients.length || 0}</Text>
            <View testID="section-clients" style={s.section}>
              {clients.length === 0 ? (
                <Text style={s.emptyRow}>No clients assigned</Text>
              ) : (
                <View style={s.chipRow}>
                  {clients.map((c: any) => (
                    <View key={c.id} testID={`client-${c.id}`} style={s.clientChip}>
                      <Text style={s.clientName}>{c.name || `#${c.id}`}</Text>
                      {c.company_label ? <Text style={s.clientCompany}>{c.company_label}</Text> : null}
                    </View>
                  ))}
                </View>
              )}
            </View>

            {/* Certifications */}
            <Text style={s.sectionLabel}>CERTIFICATIONS · {certs.length || 0}</Text>
            <View testID="section-certifications" style={s.section}>
              {certs.length === 0 ? (
                <Text style={s.emptyRow}>No certifications recorded</Text>
              ) : (
                certs.map((c: any) => {
                  const sty = certStatusStyle(c.status?.key);
                  return (
                    <View key={c.id} testID={`cert-${c.id}`} style={s.certRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={s.certName}>{c.name}</Text>
                        {c.issuer ? <Text style={s.certIssuer}>{c.issuer}</Text> : null}
                        <Text style={s.certExpiry}>EXPIRES · {shortDate(c.expiry_date)}</Text>
                      </View>
                      <View
                        testID={`cert-status-${c.id}`}
                        style={[s.certStatus, { backgroundColor: sty.bg, borderColor: sty.border }]}
                      >
                        <Text style={[s.certStatusText, { color: sty.ink }]}>
                          {(c.status?.label || '—').toUpperCase()}
                        </Text>
                      </View>
                    </View>
                  );
                })
              )}
            </View>

            <View style={s.footerHint}>
              <Ionicons name="lock-closed" size={12} color={Colors.imInkSubtle} />
              <Text style={s.footerHintText}>
                Read-only. Ask your HSEQ lead if any detail needs correcting.
              </Text>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value, testID, last }: { label: string; value: string; testID?: string; last?: boolean }) {
  return (
    <View testID={testID} style={[s.row, last && s.rowLast]}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={s.rowValue} numberOfLines={2}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: Colors.bg },
  scroll:    { flex: 1 },
  content:   { padding: 16, paddingBottom: 40 },
  navBack:   { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6, paddingVertical: 4 },
  navBackText: { fontSize: 13, fontWeight: '700', color: Colors.imBronze, letterSpacing: 0.4 },
  overline:  { fontSize: 10, fontWeight: '800', letterSpacing: 1.5, color: Colors.imBronze },
  heading:   { fontSize: 24, fontWeight: '800', color: Colors.ink, marginTop: 4, letterSpacing: -0.5 },
  sub:       { fontSize: 13, color: Colors.textSecondary, marginTop: 3 },
  errorCard: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 18, padding: 12, backgroundColor: 'rgba(139,58,58,0.08)', borderWidth: 1, borderColor: Colors.imError, borderRadius: 10 },
  errorText: { flex: 1, color: Colors.imError, fontSize: 13, fontWeight: '600' },
  emptyCard: { marginTop: 18, padding: 14, borderWidth: 1, borderColor: Colors.imBorder, borderRadius: 12, backgroundColor: Colors.imSurface },
  emptyText: { fontSize: 13, color: Colors.textSecondary, lineHeight: 18 },
  sectionLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.5, color: Colors.textTertiary, marginTop: 18, marginBottom: 8 },
  section:   { backgroundColor: Colors.imSurface, borderWidth: 1, borderColor: Colors.imBorder, borderRadius: 12, overflow: 'hidden' },
  row:       { paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.borderLight, flexDirection: 'row', alignItems: 'center' },
  rowLast:   { borderBottomWidth: 0 },
  rowLabel:  { width: 90, fontSize: 10, fontWeight: '800', letterSpacing: 0.8, color: Colors.textTertiary },
  rowValue:  { flex: 1, fontSize: 13, fontWeight: '600', color: Colors.ink },
  emptyRow:  { padding: 14, fontSize: 12, fontStyle: 'italic', color: Colors.textTertiary },
  chipRow:   { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 12 },
  availChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.imConcrete, borderWidth: 1, borderColor: Colors.imBorder, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  availDay:  { fontSize: 11, fontWeight: '800', color: Colors.ink, letterSpacing: 0.5 },
  availTime: { fontSize: 11, fontWeight: '600', color: Colors.textSecondary, fontVariant: ['tabular-nums'] },
  clientChip:{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.imConcrete, borderWidth: 1, borderColor: Colors.imBorder, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  clientName:{ fontSize: 12, fontWeight: '600', color: Colors.ink },
  clientCompany: { fontSize: 10, fontWeight: '800', letterSpacing: 0.8, color: Colors.imBronze, textTransform: 'uppercase' },
  certRow:   { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  certName:  { fontSize: 13, fontWeight: '700', color: Colors.ink },
  certIssuer:{ fontSize: 11, color: Colors.textSecondary, marginTop: 1 },
  certExpiry:{ fontSize: 10, fontWeight: '800', color: Colors.textTertiary, letterSpacing: 0.8, marginTop: 4 },
  certStatus:{ borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  certStatusText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.6 },
  footerHint:{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 18, paddingHorizontal: 4 },
  footerHintText: { fontSize: 11, color: Colors.imInkSubtle, fontStyle: 'italic' },
});
