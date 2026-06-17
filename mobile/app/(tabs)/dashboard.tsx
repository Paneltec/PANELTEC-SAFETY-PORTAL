import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import api from '../../src/lib/api';
import { getUser, initials } from '../../src/lib/auth';
import { Colors } from '../../src/lib/colors';

const METRIC_ROWS = [
  { key: 'swms', label: 'AI SWMS', field: 'swms_count', icon: 'document-text' as const },
  { key: 'pre-starts', label: 'Pre-starts', field: 'prestarts_count', icon: 'clipboard' as const },
  { key: 'site-diary', label: 'Site diary', field: 'today' as const, icon: 'book' as const },
  { key: 'hazards', label: 'Hazards', field: 'hazards_count', icon: 'warning' as const },
  { key: 'incidents', label: 'Incidents', field: 'incidents_count', icon: 'alert-circle' as const },
  { key: 'inspections', label: 'Inspections', field: 'inspections_count', icon: 'checkmark-circle' as const },
];

const CAPTURE_TOOLS = [
  { key: 'swms', title: 'AI SWMS', desc: 'Draft Safe Work Method Statements', icon: 'document-text' as const, route: '/swms' },
  { key: 'pre-starts', title: 'Daily Pre-Starts', desc: 'Crew pre-start checks and sign-ons', icon: 'clipboard' as const, route: '/pre-starts' },
  { key: 'site-diary', title: 'Site Diary AI', desc: 'Auto-summarise notes into daily diary', icon: 'book' as const, route: '/site-diary' },
  { key: 'hazards', title: 'Hazard Reports', desc: 'Snap a hazard — AI classifies risk', icon: 'warning' as const, route: '/hazards' },
  { key: 'incidents', title: 'Incident Reports', desc: 'Structured incident capture', icon: 'alert-circle' as const, route: '/incidents' },
  { key: 'inspections', title: 'Inspections', desc: 'Site walk, plant, height inspections', icon: 'checkmark-circle' as const, route: '/inspections' },
];

export default function DashboardScreen() {
  const router = useRouter();
  const [metrics, setMetrics] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = async () => {
    try {
      const [u, m] = await Promise.all([
        getUser(),
        api.get('/dashboard/metrics').then(r => r.data).catch(() => null),
      ]);
      setUser(u);
      setMetrics(m);
    } catch {} finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const onRefresh = () => { setRefreshing(true); loadData(); };

  const score = metrics?.attention_score ?? 0;
  const band = metrics?.attention_band ?? 'Strong';
  const bandColor = band === 'Strong' ? Colors.emerald : band === 'Watch' ? Colors.amber : Colors.red;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        testID="dashboard-page"
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.blue} />}
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.overline}>PANELTEC CIVIL</Text>
            <Text style={styles.heading}>Compliance Dashboard</Text>
          </View>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials(user)}</Text>
          </View>
        </View>

        {/* Attention score card */}
        <View testID="attention-score-card" style={[styles.scoreCard, { borderColor: bandColor }]}>
          <View style={styles.scoreRow}>
            <View style={[styles.scoreCircle, { borderColor: bandColor }]}>
              <Text style={[styles.scoreNum, { color: bandColor }]}>{score}</Text>
              <Text style={[styles.scoreLbl, { color: bandColor }]}>{band}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.scoreTitle}>{band} · {score}/100</Text>
              <Text style={styles.scoreDesc}>
                {band === 'Strong' ? 'Compliance signal strong across all workspaces.' :
                 band === 'Watch' ? 'A few items need attention.' :
                 'Multiple items need immediate review.'}
              </Text>
              <Text style={styles.scoreExtra}>{metrics?.records_needing_attention ?? 0} records pending</Text>
            </View>
          </View>
        </View>

        {/* Metrics grid */}
        <Text style={styles.sectionLabel}>COMPLIANCE SNAPSHOT</Text>
        <View style={styles.metricsGrid}>
          {METRIC_ROWS.map((row) => (
            <View key={row.key} testID={`metric-${row.key}`} style={styles.metricCard}>
              <View style={styles.metricIcon}>
                <Ionicons name={row.icon} size={16} color={Colors.textSecondary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.metricLabel}>{row.label}</Text>
                <Text style={styles.metricSub}>this quarter</Text>
              </View>
              <Text style={styles.metricValue}>
                {loading ? '…' : (metrics?.[row.field] ?? 0)}
              </Text>
            </View>
          ))}
        </View>

        {/* Quick capture */}
        <Text style={styles.sectionLabel}>CREATE & CAPTURE</Text>
        {CAPTURE_TOOLS.map((t) => (
          <TouchableOpacity
            key={t.key}
            testID={`capture-card-${t.key}`}
            style={styles.captureCard}
            onPress={() => router.push(t.route as any)}
            activeOpacity={0.7}
          >
            <View style={styles.captureIcon}>
              <Ionicons name={t.icon} size={18} color={Colors.blue} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.captureTitle}>{t.title}</Text>
              <Text style={styles.captureDesc}>{t.desc}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />
          </TouchableOpacity>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 32 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  overline: { fontSize: 10, fontWeight: '700', letterSpacing: 1.5, color: Colors.blue },
  heading: { fontSize: 26, fontWeight: '700', color: Colors.ink, marginTop: 4, letterSpacing: -0.5 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.blue, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  scoreCard: {
    borderWidth: 2, borderRadius: 16, padding: 16, marginBottom: 20,
    backgroundColor: '#F0FDF4',
  },
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  scoreCircle: {
    width: 72, height: 72, borderRadius: 36, borderWidth: 4,
    alignItems: 'center', justifyContent: 'center',
  },
  scoreNum: { fontSize: 18, fontWeight: '800' },
  scoreLbl: { fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  scoreTitle: { fontSize: 18, fontWeight: '700', color: Colors.ink },
  scoreDesc: { fontSize: 13, color: Colors.textSecondary, marginTop: 4, lineHeight: 18 },
  scoreExtra: { fontSize: 12, color: Colors.textSecondary, marginTop: 4 },
  sectionLabel: {
    fontSize: 10, fontWeight: '700', letterSpacing: 1.2, color: Colors.textTertiary,
    marginBottom: 10, marginTop: 8,
  },
  metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 },
  metricCard: {
    width: '48%', flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 12, padding: 12,
  },
  metricIcon: {
    width: 32, height: 32, borderRadius: 8, backgroundColor: Colors.bg,
    alignItems: 'center', justifyContent: 'center',
  },
  metricLabel: { fontSize: 13, fontWeight: '500', color: Colors.text },
  metricSub: { fontSize: 9, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5 },
  metricValue: { fontSize: 20, fontWeight: '700', color: Colors.ink },
  captureCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Colors.white,
    borderWidth: 1, borderColor: Colors.border, borderRadius: 14, padding: 14, marginBottom: 8,
  },
  captureIcon: {
    width: 40, height: 40, borderRadius: 10, backgroundColor: Colors.blueSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  captureTitle: { fontSize: 15, fontWeight: '600', color: Colors.ink },
  captureDesc: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
});
