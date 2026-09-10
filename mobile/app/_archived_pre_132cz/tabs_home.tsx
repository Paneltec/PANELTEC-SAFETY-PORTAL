/**
 * Home screen — v58.13.132cj role-based landing.
 *
 * Reads stored role_id from auth service and renders a role-specific
 * dashboard skeleton:
 *   admin             → full admin dashboard shell
 *   paneltec_civil    → field-worker home (forms, pre-starts, SWMS, timesheets)
 *   viatec_traffic    → field-worker home with traffic control extras
 *   external_contractor → limited contractor view (assigned SWMS + ack)
 */
import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../src/theme/colors';
import {
  getStoredUser, getStoredRole, getStoredRoleLabel,
  type RoleId,
} from '../../src/services/auth';

type Module = {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  route?: string;
  color?: string;
};

const ADMIN_MODULES: Module[] = [
  { key: 'forms',    label: 'Forms Library',   icon: 'document-text',     route: '/(tabs)/forms',  color: Colors.orange },
  { key: 'workers',  label: 'Workers',         icon: 'people',            color: Colors.info },
  { key: 'sites',    label: 'Sites',           icon: 'location',          color: Colors.success },
  { key: 'swms',     label: 'SWMS',            icon: 'shield-checkmark',  color: Colors.warning },
  { key: 'fleet',    label: 'Fleet',           icon: 'car',               color: '#8B5CF6' },
  { key: 'reports',  label: 'Reports',         icon: 'bar-chart',         color: '#EC4899' },
  { key: 'settings', label: 'Settings',        icon: 'settings',          color: Colors.muted },
  { key: 'audit',    label: 'Audit Log',       icon: 'list',              color: Colors.textSecondary },
];

const CIVIL_MODULES: Module[] = [
  { key: 'forms',      label: 'Forms',            icon: 'document-text',     route: '/(tabs)/forms',  color: Colors.orange },
  { key: 'prestarts',  label: 'Pre-Starts',       icon: 'checkbox',          color: Colors.success },
  { key: 'swms',       label: 'My SWMS',          icon: 'shield-checkmark',  color: Colors.warning },
  { key: 'timesheets', label: 'Timesheets',       icon: 'time',              color: Colors.info },
  { key: 'hazards',    label: 'Hazards',          icon: 'warning',           color: Colors.error },
  { key: 'incidents',  label: 'Incidents',         icon: 'alert-circle',      color: '#DC2626' },
];

const VIATEC_MODULES: Module[] = [
  { key: 'forms',      label: 'Forms',            icon: 'document-text',     route: '/(tabs)/forms',  color: Colors.orange },
  { key: 'sitescan',   label: 'Site Scan',        icon: 'scan',              color: Colors.viatec },
  { key: 'prestarts',  label: 'Pre-Starts',       icon: 'checkbox',          color: Colors.success },
  { key: 'incidents',  label: 'Incident Report',  icon: 'alert-circle',      color: Colors.error },
  { key: 'swms',       label: 'My SWMS',          icon: 'shield-checkmark',  color: Colors.warning },
  { key: 'timesheets', label: 'Timesheets',       icon: 'time',              color: Colors.info },
];

const CONTRACTOR_MODULES: Module[] = [
  { key: 'swms',   label: 'Assigned SWMS',   icon: 'shield-checkmark', color: Colors.warning },
  { key: 'ack',    label: 'Acknowledgements', icon: 'checkmark-done',   color: Colors.success },
];

const ROLE_CONFIG: Record<RoleId, {
  title: string;
  subtitle: string;
  accent: string;
  modules: Module[];
}> = {
  admin: {
    title: 'Admin Dashboard',
    subtitle: 'Full system access',
    accent: Colors.orange,
    modules: ADMIN_MODULES,
  },
  paneltec_civil: {
    title: 'Paneltec Civil',
    subtitle: 'Civil & Construction',
    accent: Colors.orange,
    modules: CIVIL_MODULES,
  },
  viatec_traffic: {
    title: 'Viatec Traffic',
    subtitle: 'Traffic Management',
    accent: Colors.viatec,
    modules: VIATEC_MODULES,
  },
  external_contractor: {
    title: 'Contractor Portal',
    subtitle: 'Assigned work only',
    accent: '#6B7280',
    modules: CONTRACTOR_MODULES,
  },
};

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [user, setUser] = useState<any>(null);
  const [roleId, setRoleId] = useState<RoleId | null>(null);
  const [roleLabel, setRoleLabel] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const loadData = async () => {
    const [u, r, rl] = await Promise.all([
      getStoredUser(),
      getStoredRole(),
      getStoredRoleLabel(),
    ]);
    setUser(u);
    setRoleId(r);
    setRoleLabel(rl || '');
  };

  useEffect(() => { loadData(); }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const config = roleId ? ROLE_CONFIG[roleId] : ROLE_CONFIG.paneltec_civil;
  const greeting = user?.name ? `Hi, ${user.name.split(' ')[0]}` : 'Welcome';

  return (
    <View testID="home-screen" style={[s.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={[s.header, { backgroundColor: config.accent === Colors.viatec ? Colors.viatec : Colors.navy }]}>
        {/* Holding-company brand — always "Paneltec Group" */}
        <Text testID="home-brand-name" style={s.brandName}>Paneltec Group</Text>
        <View style={s.headerTop}>
          <View style={s.headerLeft}>
            <Text testID="home-greeting" style={s.greeting}>{greeting}</Text>
            <Text testID="home-role-label" style={s.roleLabel}>{config.subtitle}</Text>
          </View>
          <TouchableOpacity
            testID="home-profile-btn"
            style={s.profileBtn}
            onPress={() => router.push('/(tabs)/profile')}
          >
            <View style={s.avatar}>
              <Text style={s.avatarText}>
                {user?.name ? user.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase() : '?'}
              </Text>
            </View>
          </TouchableOpacity>
        </View>
        <View style={s.rolePill}>
          <View style={[s.roleDot, { backgroundColor: config.accent }]} />
          <Text testID="home-role-id" style={s.rolePillText}>
            {roleLabel || config.title}
          </Text>
        </View>
      </View>

      {/* Modules grid */}
      <ScrollView
        contentContainerStyle={s.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[Colors.orange]} />}
      >
        <Text style={s.sectionTitle}>Quick Actions</Text>
        <View style={s.grid}>
          {config.modules.map((mod) => (
            <TouchableOpacity
              key={mod.key}
              testID={`home-module-${mod.key}`}
              style={s.tile}
              onPress={() => {
                if (mod.route) router.push(mod.route as never);
              }}
              activeOpacity={0.8}
            >
              <View style={[s.tileIcon, { backgroundColor: (mod.color || Colors.orange) + '14' }]}>
                <Ionicons name={mod.icon} size={28} color={mod.color || Colors.orange} />
              </View>
              <Text style={s.tileLabel}>{mod.label}</Text>
              {!mod.route && (
                <Text style={s.tileSoon}>Coming soon</Text>
              )}
            </TouchableOpacity>
          ))}
        </View>

        {/* Role info card */}
        <View style={s.infoCard}>
          <View style={s.infoRow}>
            <Ionicons name="information-circle-outline" size={18} color={Colors.info} />
            <View style={s.infoText}>
              <Text style={s.infoTitle}>
                {roleId === 'admin' ? 'Administrator Access' :
                 roleId === 'external_contractor' ? 'Limited Contractor Access' :
                 'Field Worker Access'}
              </Text>
              <Text style={s.infoSub}>
                {roleId === 'admin'
                  ? 'You have full access to all modules. Use with care.'
                  : roleId === 'external_contractor'
                  ? 'You can only view and acknowledge assigned SWMS documents.'
                  : `Signed in as ${roleLabel || config.title}. Your modules are role-filtered.`}
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },

  header: {
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 20,
  },
  brandName: {
    color: 'rgba(255,255,255,0.4)', fontSize: 11, fontWeight: '800',
    letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 10,
  },
  headerTop: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 12,
  },
  headerLeft: { flex: 1, gap: 2 },
  greeting: { color: Colors.white, fontSize: 24, fontWeight: '800' },
  roleLabel: { color: 'rgba(255,255,255,0.55)', fontSize: 13, fontWeight: '500' },
  profileBtn: {},
  avatar: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: Colors.white, fontSize: 16, fontWeight: '800' },

  rolePill: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6,
    alignSelf: 'flex-start',
  },
  roleDot: { width: 8, height: 8, borderRadius: 4 },
  rolePillText: {
    color: 'rgba(255,255,255,0.8)', fontSize: 12, fontWeight: '700',
    letterSpacing: 0.3,
  },

  scroll: { padding: 16, paddingBottom: 40 },
  sectionTitle: {
    fontSize: 16, fontWeight: '800', color: Colors.ink, marginBottom: 12,
  },

  grid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 12,
    marginBottom: 20,
  },
  tile: {
    width: '47%' as any,
    backgroundColor: Colors.surface, borderRadius: 18,
    padding: 18, gap: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  tileIcon: {
    width: 52, height: 52, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  tileLabel: { fontSize: 14, fontWeight: '700', color: Colors.ink },
  tileSoon: { fontSize: 10, color: Colors.textTertiary, fontWeight: '600' },

  infoCard: {
    backgroundColor: Colors.infoSoft, borderRadius: 16, padding: 16,
  },
  infoRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  infoText: { flex: 1 },
  infoTitle: { fontSize: 13, fontWeight: '700', color: Colors.info, marginBottom: 4 },
  infoSub: { fontSize: 12, color: Colors.textSecondary, lineHeight: 18 },
});
