/**
 * Home — Option B design.
 *
 *   header (brand · avatar)
 *   TODAY'S JOB card        ← /api/mobile/home today_job (issued by the office)
 *   CAPTURE tiles           ← pre-starts, hazards, incidents, site diary, inspections
 *   FORMS & COMPLIANCE      ← forms library, SWMS, certifications, ID card
 *
 * Every tile opens a real screen. Nothing says "Coming soon".
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../src/theme/colors';
import { Screen, SectionLabel, Tile, Chip } from '../../src/components/ui';
import { getStoredUser } from '../../src/services/auth';
import { fetchHome, type HomeData } from '../../src/services/home';
import { MODULE_CONFIG, type CaptureModuleKey } from '../../src/services/capture';

const CAPTURE: { key: CaptureModuleKey; icon: any; desc: string }[] = [
  { key: 'pre-starts', icon: 'clipboard', desc: 'Crew pre-start checks and sign-ons' },
  { key: 'hazards', icon: 'warning', desc: 'Snap a hazard — photo, location, severity' },
  { key: 'incidents', icon: 'alert-circle', desc: 'Report an incident or near miss' },
  { key: 'site-diary', icon: 'book', desc: "Today's site notes" },
  { key: 'inspections', icon: 'checkmark-circle', desc: 'Site walk, plant, working at height' },
];

export default function HomeScreen() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [home, setHome] = useState<HomeData | null>(null);
  const [loadError, setLoadError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setUser(await getStoredUser());
    try {
      setHome(await fetchHome());
      setLoadError('');
    } catch {
      setLoadError("Couldn't reach the office server — showing what's on this phone.");
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const initial = (user?.name || user?.email || '?').toString().trim().charAt(0).toUpperCase();
  const job = home?.today_job ?? null;
  const jobStatus = home?.today_job_status ?? 'no_job';
  const firstName = (user?.name || '').split(' ')[0];

  return (
    <Screen testID="home-screen" refreshing={refreshing} onRefresh={onRefresh}>
      <View style={s.header}>
        <View>
          <Text style={s.brand}>PANELTEC GROUP</Text>
          <Text style={s.heading}>{firstName ? `Hi ${firstName}` : 'HOME'}</Text>
          {!!home?.today?.day_name && <Text style={s.sub}>{home.today.day_name}{home.site?.site_name ? ` · ${home.site.site_name}` : ''}</Text>}
        </View>
        <TouchableOpacity testID="home-avatar" style={s.avatar} onPress={() => router.push('/(tabs)/profile')}>
          <Text style={s.avatarText}>{initial}</Text>
        </TouchableOpacity>
      </View>

      {!!loadError && (
        <View style={s.offline}>
          <Ionicons name="cloud-offline-outline" size={14} color={Colors.onScreenMuted} />
          <Text style={s.offlineText}>{loadError}</Text>
        </View>
      )}

      {/* Today's job — the whiteboard → phone flow */}
      {job && jobStatus !== 'declined' ? (
        <TouchableOpacity
          testID="today-job-card"
          style={[s.jobCard, jobStatus === 'pending_accept' && s.jobCardPending]}
          activeOpacity={0.8}
          onPress={() => router.push({ pathname: '/job/[id]', params: { id: job.id } } as never)}
        >
          <View style={[s.jobIcon, { backgroundColor: jobStatus === 'accepted' ? Colors.greenSoft : Colors.orangeSoftOnNavy }]}>
            <Ionicons name="briefcase" size={20} color={jobStatus === 'accepted' ? Colors.green : Colors.orange} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[s.jobOverline, { color: jobStatus === 'accepted' ? Colors.green : Colors.orange }]}>
              {jobStatus === 'accepted' ? "TODAY'S JOB · ACCEPTED" : "TODAY'S JOB · TAP TO ACCEPT"}
            </Text>
            <Text style={s.jobTitle} numberOfLines={1}>{job.site_name || 'Job site'}</Text>
            <Text style={s.jobSub} numberOfLines={1}>{job.site_address || 'Address to follow'}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={Colors.onCardSubtle} />
        </TouchableOpacity>
      ) : (
        <View testID="no-job-card" style={s.noJob}>
          <Ionicons name="calendar-outline" size={16} color={Colors.onScreenMuted} />
          <Text style={s.noJobText}>No job issued for today yet. You'll get a notification when the office allocates one.</Text>
        </View>
      )}

      <SectionLabel style={{ marginTop: 18 }}>CAPTURE</SectionLabel>
      <View style={s.list}>
        <Tile testID="tile-scan" icon="qr-code" title="Scan QR Code" desc="Sign on to a site, check a vehicle or a worker card"
          onPress={() => router.push('/(tabs)/scan' as never)} />
        {CAPTURE.map(c => (
          <Tile
            key={c.key}
            testID={`tile-${c.key}`}
            icon={c.icon}
            title={MODULE_CONFIG[c.key].labelPlural.replace(' Checks', '').replace(' Reports', '').replace(' Entries', '')}
            desc={c.desc}
            onPress={() => router.push({ pathname: '/capture/[module]', params: { module: c.key } } as never)}
          />
        ))}
      </View>

      <SectionLabel style={{ marginTop: 18 }}>FORMS &amp; COMPLIANCE</SectionLabel>
      <View style={s.list}>
        <Tile testID="tile-forms" icon="document-text" title="Forms Library" desc="Fillable templates with signature, photo & GPS"
          badge={home?.module_badges?.forms ? String(home.module_badges.forms) : undefined}
          onPress={() => router.push('/(tabs)/forms' as never)} />
        <Tile testID="tile-swms" icon="shield-checkmark" title="My SWMS" desc="Safe Work Method Statements assigned to you"
          onPress={() => router.push({ pathname: '/profile/swms/[id]', params: { id: 'list' } } as never)} />
        <Tile testID="tile-certs" icon="ribbon" title="My Certifications" desc="Tickets, licences and expiry dates"
          badge={home?.module_badges?.certifications ? String(home.module_badges.certifications) : undefined}
          onPress={() => router.push('/profile/certifications' as never)} />
        <Tile testID="tile-idcard" icon="card" title="My ID Card" desc="Digital worker ID with QR"
          onPress={() => router.push('/profile/id-card' as never)} />
        <Tile testID="tile-leave" icon="calendar" title="My Leave" desc="Request time off, sick days and see your balance"
          onPress={() => router.push('/leave' as never)} />
      </View>

      {home?.site?.signed_in && home.site.site_name && (
        <View style={s.onsite}>
          <Chip text="ON SITE" tone="green" />
          <Text style={s.onsiteText} numberOfLines={1}>{home.site.site_name}</Text>
        </View>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  brand: { fontSize: 10, fontWeight: '800', letterSpacing: 1.5, color: Colors.orange },
  heading: { fontSize: 26, fontWeight: '800', color: Colors.onScreen, marginTop: 3, letterSpacing: 0.5 },
  sub: { fontSize: 13, color: Colors.onScreenMuted, marginTop: 4 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.orange, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: Colors.white, fontSize: 15, fontWeight: '800' },
  offline: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginBottom: 12 },
  offlineText: { flex: 1, fontSize: 12, color: Colors.onScreenMuted, lineHeight: 17 },
  jobCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, minHeight: 72,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.cardBorder, borderRadius: 14,
  },
  jobCardPending: { borderColor: Colors.orange, borderWidth: 1.5 },
  jobIcon: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  jobOverline: { fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  jobTitle: { fontSize: 15, fontWeight: '700', color: Colors.onCard, marginTop: 2 },
  jobSub: { fontSize: 12, color: Colors.onCardMuted, marginTop: 1 },
  noJob: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', padding: 12, borderRadius: 12, backgroundColor: Colors.screenCard },
  noJobText: { flex: 1, fontSize: 12, color: Colors.onScreenMuted, lineHeight: 17 },
  list: { gap: 8 },
  onsite: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 20 },
  onsiteText: { flex: 1, fontSize: 12, color: Colors.onScreenMuted },
});
