/**
 * Home tab — Dashboard with greeting, weather, site status, module tiles.
 * v58.13.132b — M2 implementation (Mockup 10).
 */
import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  RefreshControl, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Colors } from '../../src/theme/colors';
import CompanyPill from '../../src/components/CompanyPill';
import {
  fetchHome,
  setActiveCompany,
  fetchNotificationCount,
  type HomeData,
  type HomeModule,
} from '../../src/services/home';

// ── Icon mapper ──
function moduleIcon(icon: string, focused: boolean): keyof typeof Ionicons.glyphMap {
  const map: Record<string, [string, string]> = {
    location:  ['location', 'location-outline'],
    warning:   ['warning', 'warning-outline'],
    clipboard: ['clipboard', 'clipboard-outline'],
    megaphone: ['megaphone', 'megaphone-outline'],
    car:       ['car', 'car-outline'],
    truck:     ['car', 'car-outline'],
    person:    ['person', 'person-outline'],
    checklist: ['clipboard', 'clipboard-outline'],
  };
  const pair = map[icon] || ['grid', 'grid-outline'];
  return (focused ? pair[0] : pair[1]) as keyof typeof Ionicons.glyphMap;
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data, isLoading, isError, refetch } = useQuery<HomeData>({
    queryKey: ['mobile-home'],
    queryFn: fetchHome,
    staleTime: 60_000,
    retry: 2,
  });

  const { data: notifCount } = useQuery({
    queryKey: ['mobile-notif-count'],
    queryFn: fetchNotificationCount,
    staleTime: 120_000,
  });

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const handleCompanySwitch = useCallback(async (companyId: string) => {
    try {
      await setActiveCompany(companyId);
      queryClient.invalidateQueries({ queryKey: ['mobile-home'] });
    } catch {
      // silent — toast later
    }
  }, [queryClient]);

  // ── Loading state ──
  if (isLoading && !data) {
    return (
      <View testID="home-loading" style={[s.container, { paddingTop: insets.top }]}>
        <View style={s.loadingCenter}>
          <ActivityIndicator size="large" color={Colors.orange} />
          <Text style={s.loadingText}>Loading dashboard…</Text>
        </View>
      </View>
    );
  }

  // ── Error fallback ──
  if (isError && !data) {
    return (
      <View testID="home-error" style={[s.container, { paddingTop: insets.top }]}>
        <View style={s.loadingCenter}>
          <Ionicons name="cloud-offline-outline" size={48} color={Colors.textTertiary} />
          <Text style={s.errorTitle}>Could not load dashboard</Text>
          <TouchableOpacity testID="home-retry-btn" style={s.retryBtn} onPress={() => refetch()}>
            <Text style={s.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const d = data!;
  const firstName = (d.user.name || '').split(' ')[0] || 'there';
  const badgeCount = notifCount || 0;

  return (
    <View testID="home-screen" style={[s.container, { paddingTop: insets.top }]}>
      <ScrollView
        contentContainerStyle={s.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.orange} />
        }
      >
        {/* ── 1. Greeting header (dark navy) ── */}
        <View style={s.greetingHeader}>
          <View style={s.greetingRow}>
            <View style={s.avatar}>
              <Text style={s.avatarText}>{d.user.avatar_initials}</Text>
            </View>
            <View style={s.greetingTextWrap}>
              <Text testID="home-greeting" style={s.greetingText}>
                {d.today.greeting}, {firstName}
              </Text>
              {d.user.employee_number && (
                <Text style={s.employeeNum}>#{d.user.employee_number}</Text>
              )}
            </View>
            <TouchableOpacity
              testID="home-notification-bell"
              style={s.bellBtn}
              onPress={() => {/* M3+ notifications screen */}}
            >
              <Ionicons name="notifications-outline" size={22} color={Colors.white} />
              {badgeCount > 0 && (
                <View style={s.bellBadge}>
                  <Text style={s.bellBadgeText}>{badgeCount}</Text>
                </View>
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* ── 2. Company toggle pill ── */}
        <View style={s.companyRow}>
          <CompanyPill
            companies={d.companies}
            activeId={d.active_company_id}
            canSwitch={d.can_switch_company}
            onSwitch={handleCompanySwitch}
          />
        </View>

        {/* ── 3. Today hero card ── */}
        <View style={s.heroCard}>
          <View style={s.heroLeft}>
            <Text testID="home-today-label" style={s.heroDateLabel}>
              Today · {d.today.day_name}
            </Text>
            <Text style={s.heroDate}>{d.today.date_iso}</Text>
            {d.weather.temperature_c != null && (
              <View style={s.weatherRow}>
                <Ionicons name="partly-sunny" size={16} color={Colors.warning} />
                <Text style={s.weatherText}>
                  {d.weather.temperature_c}°C · {d.weather.condition}
                </Text>
              </View>
            )}
            {d.weather.wind_kmh != null && (
              <View style={s.weatherRow}>
                <Ionicons name="flag" size={14} color={Colors.textTertiary} />
                <Text style={s.windText}>
                  {d.weather.wind_kmh} km/h {d.weather.wind_dir}
                </Text>
              </View>
            )}
          </View>
          <View style={s.heroRight}>
            {d.site.signed_in ? (
              <View style={s.signedInChip}>
                <Ionicons name="checkmark-circle" size={16} color={Colors.success} />
                <Text style={s.signedInText} numberOfLines={2}>
                  Signed in · {d.site.site_name}
                </Text>
              </View>
            ) : d.site.nearest ? (
              <View style={s.nearestWrap}>
                <Text style={s.nearestLabel}>📍 {d.site.nearest.name}</Text>
                {d.site.nearest.distance_km != null && (
                  <Text style={s.nearestDist}>
                    {d.site.nearest.distance_km} km away
                  </Text>
                )}
                <TouchableOpacity
                  testID="home-sign-in-site-btn"
                  style={s.signInBtn}
                  onPress={() => router.push('/(tabs)/sites')}
                >
                  <Text style={s.signInBtnText}>Sign in to site</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={s.noSiteWrap}>
                <Ionicons name="location-outline" size={20} color={Colors.textTertiary} />
                <Text style={s.noSiteText}>No nearby sites</Text>
              </View>
            )}
          </View>
        </View>

        {/* ── 4. Module tile grid ── */}
        <View style={s.tilesSection}>
          <Text style={s.sectionTitle}>QUICK ACTIONS</Text>
          <View style={s.tilesGrid}>
            {d.modules.map((m) => (
              <ModuleTile key={m.key} module={m} onPress={() => router.push(m.route as any)} />
            ))}
          </View>
        </View>

        {/* Bottom spacer */}
        <View style={{ height: 32 }} />
      </ScrollView>
    </View>
  );
}

// ── Module Tile component ──
function ModuleTile({ module: m, onPress }: { module: HomeModule; onPress: () => void }) {
  return (
    <TouchableOpacity testID={`home-tile-${m.key}`} style={s.tile} onPress={onPress} activeOpacity={0.7}>
      <View style={s.tileIconWrap}>
        <Ionicons name={moduleIcon(m.icon, true)} size={24} color={Colors.white} />
      </View>
      {m.badge != null && m.badge > 0 && (
        <View style={s.tileBadge}>
          <Text style={s.tileBadgeText}>{m.badge}</Text>
        </View>
      )}
      <Text style={s.tileLabel} numberOfLines={2}>{m.label}</Text>
    </TouchableOpacity>
  );
}

// ── Styles ──
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  scroll: { flexGrow: 1 },
  loadingCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { fontSize: 14, color: Colors.textSecondary },
  errorTitle: { fontSize: 17, fontWeight: '600', color: Colors.textSecondary, marginTop: 8 },
  retryBtn: {
    backgroundColor: Colors.orange, borderRadius: 10,
    paddingHorizontal: 24, paddingVertical: 10, marginTop: 12,
  },
  retryText: { color: Colors.white, fontWeight: '700', fontSize: 15 },

  // ── Greeting header ──
  greetingHeader: {
    backgroundColor: Colors.navy,
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20,
  },
  greetingRow: { flexDirection: 'row', alignItems: 'center' },
  avatar: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: Colors.orange,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: Colors.white, fontSize: 17, fontWeight: '800' },
  greetingTextWrap: { flex: 1, marginLeft: 12 },
  greetingText: { color: Colors.white, fontSize: 22, fontWeight: '700' },
  employeeNum: { color: 'rgba(255,255,255,0.5)', fontSize: 13, fontWeight: '500', marginTop: 2 },
  bellBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  bellBadge: {
    position: 'absolute', top: 4, right: 4,
    backgroundColor: Colors.error, borderRadius: 10,
    minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 4,
  },
  bellBadgeText: { color: Colors.white, fontSize: 10, fontWeight: '800' },

  // ── Company row ──
  companyRow: {
    paddingHorizontal: 20, paddingVertical: 12,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },

  // ── Hero card ──
  heroCard: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    marginHorizontal: 16, marginTop: 16,
    borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: Colors.border,
  },
  heroLeft: { flex: 1 },
  heroDateLabel: { fontSize: 12, fontWeight: '600', color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5 },
  heroDate: { fontSize: 15, fontWeight: '600', color: Colors.ink, marginTop: 4 },
  weatherRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  weatherText: { fontSize: 14, fontWeight: '600', color: Colors.ink },
  windText: { fontSize: 13, color: Colors.textSecondary },
  heroRight: { marginLeft: 16, justifyContent: 'center', alignItems: 'flex-end', maxWidth: 150 },
  signedInChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.successSoft, borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 6,
  },
  signedInText: { fontSize: 12, fontWeight: '600', color: Colors.success, flexShrink: 1 },
  nearestWrap: { alignItems: 'flex-end', gap: 4 },
  nearestLabel: { fontSize: 13, fontWeight: '600', color: Colors.ink, textAlign: 'right' },
  nearestDist: { fontSize: 12, color: Colors.textTertiary },
  signInBtn: {
    backgroundColor: Colors.orange, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 8, marginTop: 4,
  },
  signInBtnText: { color: Colors.white, fontSize: 12, fontWeight: '700' },
  noSiteWrap: { alignItems: 'center', gap: 4 },
  noSiteText: { fontSize: 12, color: Colors.textTertiary },

  // ── Module tiles ──
  tilesSection: { paddingHorizontal: 16, marginTop: 24 },
  sectionTitle: {
    fontSize: 12, fontWeight: '700', color: Colors.textTertiary,
    letterSpacing: 1, marginBottom: 12,
  },
  tilesGrid: {
    flexDirection: 'row', flexWrap: 'wrap',
    gap: 12,
  },
  tile: {
    width: '30%', minWidth: 100, flexGrow: 1,
    backgroundColor: Colors.surface, borderRadius: 16,
    padding: 16, alignItems: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },
  tileIconWrap: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: Colors.navy,
    alignItems: 'center', justifyContent: 'center',
  },
  tileBadge: {
    position: 'absolute', top: 8, right: 8,
    backgroundColor: Colors.orange, borderRadius: 10,
    minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 5,
  },
  tileBadgeText: { color: Colors.white, fontSize: 11, fontWeight: '800' },
  tileLabel: {
    fontSize: 13, fontWeight: '700', color: Colors.ink,
    textAlign: 'center', marginTop: 10,
  },
});
