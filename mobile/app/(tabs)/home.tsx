/**
 * Phase 4 — Home / Dashboard tab.
 * Compliance score ring + metric chips + AI briefing card.
 */
import React, { useCallback, useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, RefreshControl,
  ActivityIndicator, TouchableOpacity,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { civilGet, getStoredCivilUser } from '../../src/services/civilApi';

const BLUE = '#2C6BFF';
const GREEN = '#10B981';
const VIOLET = '#7C3AED';
const AMBER = '#F59E0B';
const RED = '#EF4444';
const BG = '#F8FAFC';
const INK = '#0F172A';
const MUTED = '#64748B';

interface Metrics {
  swms_count: number;
  prestarts_count: number;
  diary_count: number;
  hazards_count: number;
  incidents_count: number;
  inspections_count: number;
  attention_score: number;
  attention_band: string;
  records_needing_attention: number;
}

interface Briefing {
  title: string;
  body: string;
  confidence: string;
  fallback?: boolean;
}

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [user, setUser] = useState<any>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    const [u, mRes, bRes] = await Promise.all([
      getStoredCivilUser(),
      civilGet<Metrics>('/dashboard/metrics'),
      civilGet<Briefing>('/ask/briefing'),
    ]);
    setUser(u);
    if (mRes.ok && mRes.data) setMetrics(mRes.data);
    if (bRes.ok && bRes.data) setBriefing(bRes.data);
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  const greeting = user?.name ? `Hi, ${user.name.split(' ')[0]}` : 'Welcome';

  const metricChips = metrics ? [
    { label: 'SWMS', count: metrics.swms_count, icon: 'document-text-outline' as const, color: BLUE },
    { label: 'Pre-Starts', count: metrics.prestarts_count, icon: 'checkbox-outline' as const, color: GREEN },
    { label: 'Diary', count: metrics.diary_count, icon: 'book-outline' as const, color: VIOLET },
    { label: 'Hazards', count: metrics.hazards_count, icon: 'warning-outline' as const, color: AMBER },
    { label: 'Incidents', count: metrics.incidents_count, icon: 'flash-outline' as const, color: RED },
    { label: 'Inspections', count: metrics.inspections_count, icon: 'clipboard-outline' as const, color: BLUE },
  ] : [];

  return (
    <View testID="home-screen" style={[s.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={s.header}>
        <View style={s.headerTop}>
          <View style={{ flex: 1 }}>
            <Text testID="home-greeting" style={s.greeting}>{greeting}</Text>
            <Text style={s.roleLabel}>{user?.role || 'Field Worker'}</Text>
          </View>
          <TouchableOpacity
            testID="home-avatar-btn"
            style={s.avatarBtn}
            onPress={() => router.push('/(tabs)/profile')}
          >
            <Text style={s.avatarText}>
              {user?.name ? user.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase() : '?'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        testID="home-scroll"
        contentContainerStyle={s.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={BLUE} colors={[BLUE]} />}
      >
        {loading ? (
          <ActivityIndicator testID="home-loading" color={BLUE} size="large" style={{ marginTop: 60 }} />
        ) : (
          <>
            {/* Compliance Score Ring */}
            {metrics && (
              <View testID="home-score-card" style={s.scoreCard}>
                <View style={s.scoreRing}>
                  <Text style={s.scoreNumber}>{metrics.attention_score}</Text>
                  <Text style={s.scoreLabel}>Compliance</Text>
                </View>
                <View style={s.scoreRight}>
                  <Text style={s.scoreBand}>{metrics.attention_band}</Text>
                  <Text style={s.scoreAttention}>
                    {metrics.records_needing_attention} records need attention
                  </Text>
                </View>
              </View>
            )}

            {/* Metric Chips */}
            {metricChips.length > 0 && (
              <View testID="home-metric-chips" style={s.chipsWrap}>
                {metricChips.map((chip) => (
                  <View key={chip.label} style={s.chip}>
                    <Ionicons name={chip.icon} size={18} color={chip.color} />
                    <Text style={s.chipCount}>{chip.count}</Text>
                    <Text style={s.chipLabel}>{chip.label}</Text>
                  </View>
                ))}
              </View>
            )}

            {/* AI Briefing — "What needs my attention" */}
            <View testID="home-briefing-card" style={s.briefingCard}>
              <View style={s.briefingHeader}>
                <Ionicons name="sparkles" size={20} color={VIOLET} />
                <Text style={s.briefingTitle}>What needs my attention</Text>
                {briefing?.confidence && (
                  <View style={[s.confPill, {
                    backgroundColor: briefing.confidence === 'high' ? '#D1FAE5' : briefing.confidence === 'medium' ? '#FEF3C7' : '#F3E8FF',
                  }]}>
                    <Text style={[s.confText, {
                      color: briefing.confidence === 'high' ? GREEN : briefing.confidence === 'medium' ? AMBER : VIOLET,
                    }]}>{briefing.confidence}</Text>
                  </View>
                )}
              </View>
              {briefing ? (
                <>
                  <Text style={s.briefingBodyTitle}>{briefing.title}</Text>
                  <Text style={s.briefingBody}>{briefing.body}</Text>
                </>
              ) : (
                <Text style={s.briefingBody}>No briefing available. Pull to refresh.</Text>
              )}
            </View>

            {/* Quick access */}
            <Text style={s.sectionTitle}>Quick Actions</Text>
            <View style={s.quickGrid}>
              <TouchableOpacity testID="home-quick-capture" style={s.quickTile} onPress={() => router.push('/(tabs)/capture')}>
                <Ionicons name="camera-outline" size={24} color={BLUE} />
                <Text style={s.quickLabel}>Capture</Text>
              </TouchableOpacity>
              <TouchableOpacity testID="home-quick-qr" style={s.quickTile} onPress={() => router.push('/(tabs)/qr-scan')}>
                <Ionicons name="qr-code-outline" size={24} color={GREEN} />
                <Text style={s.quickLabel}>QR Sign-On</Text>
              </TouchableOpacity>
              <TouchableOpacity testID="home-quick-mywork" style={s.quickTile} onPress={() => router.push('/(tabs)/my-work')}>
                <Ionicons name="briefcase-outline" size={24} color={VIOLET} />
                <Text style={s.quickLabel}>My Work</Text>
              </TouchableOpacity>
            </View>

            <View style={{ height: 40 }} />
          </>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  headerTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  greeting: { fontSize: 24, fontWeight: '800', color: INK, letterSpacing: -0.5 },
  roleLabel: { fontSize: 13, color: MUTED, fontWeight: '500', marginTop: 2, textTransform: 'capitalize' },
  avatarBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: BLUE, alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: '#FFF', fontSize: 14, fontWeight: '800' },
  scrollContent: { padding: 16, paddingBottom: 32 },

  // Score card
  scoreCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#FFFFFF', borderRadius: 16, padding: 20,
    marginBottom: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  scoreRing: {
    width: 80, height: 80, borderRadius: 40,
    borderWidth: 6, borderColor: BLUE,
    alignItems: 'center', justifyContent: 'center', marginRight: 20,
  },
  scoreNumber: { fontSize: 24, fontWeight: '800', color: BLUE },
  scoreLabel: { fontSize: 9, fontWeight: '600', color: MUTED, marginTop: -2 },
  scoreRight: { flex: 1 },
  scoreBand: { fontSize: 16, fontWeight: '700', color: INK },
  scoreAttention: { fontSize: 13, color: MUTED, marginTop: 4 },

  // Chips
  chipsWrap: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20,
  },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#FFFFFF', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
    borderWidth: 1, borderColor: '#E5E7EB',
    minWidth: '30%',
  },
  chipCount: { fontSize: 16, fontWeight: '800', color: INK },
  chipLabel: { fontSize: 11, fontWeight: '600', color: MUTED },

  // Briefing
  briefingCard: {
    backgroundColor: '#F5F3FF', borderRadius: 16, padding: 20, marginBottom: 24,
    borderWidth: 1, borderColor: '#E9E5FF',
  },
  briefingHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  briefingTitle: { fontSize: 16, fontWeight: '700', color: VIOLET, flex: 1 },
  confPill: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  confText: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  briefingBodyTitle: { fontSize: 15, fontWeight: '700', color: INK, marginBottom: 6 },
  briefingBody: { fontSize: 14, color: '#4B5563', lineHeight: 22 },

  // Quick actions
  sectionTitle: { fontSize: 18, fontWeight: '800', color: INK, marginBottom: 12 },
  quickGrid: { flexDirection: 'row', gap: 12 },
  quickTile: {
    flex: 1, backgroundColor: '#FFFFFF', borderRadius: 14, padding: 16,
    alignItems: 'center', gap: 8, minHeight: 80,
    borderWidth: 1, borderColor: '#E5E7EB',
  },
  quickLabel: { fontSize: 12, fontWeight: '600', color: INK },
});
