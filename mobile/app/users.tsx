import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  RefreshControl, ActivityIndicator, Alert, TextInput, Switch, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import api, { apiError } from '../src/lib/api';
import { getUser } from '../src/lib/auth';
import { Colors } from '../src/lib/colors';

const ROLES = ['admin', 'hseq_lead', 'supervisor', 'worker', 'auditor'];
const ROLE_LABELS: Record<string, string> = { admin: 'Admin', hseq_lead: 'HSEQ Lead', supervisor: 'Supervisor', worker: 'Worker', auditor: 'Auditor' };
const STATUSES = ['active', 'invited', 'disabled'];

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { bg: string; text: string }> = {
    active: { bg: '#D1FAE5', text: '#047857' },
    invited: { bg: '#FEF3C7', text: '#B45309' },
    disabled: { bg: '#F1F5F9', text: '#475569' },
  };
  const c = map[status] || map.active;
  return (
    <View style={[us.pill, { backgroundColor: c.bg }]}>
      <Text style={[us.pillText, { color: c.text }]}>{status || 'active'}</Text>
    </View>
  );
}

export default function UsersScreen() {
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [simproConnected, setSimproConnected] = useState(false);
  const [simproCompanies, setSimproCompanies] = useState<any[]>([]);
  const [importOpen, setImportOpen] = useState(false);

  const isAdmin = currentUser?.role === 'admin';
  const canEdit = ['admin', 'hseq_lead'].includes(currentUser?.role);

  useEffect(() => { getUser().then(setCurrentUser); }, []);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/users');
      setUsers(data);
    } catch (e) { Alert.alert('Error', apiError(e)); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  const loadSimpro = useCallback(async () => {
    try {
      const { data } = await api.get('/integrations/simpro');
      const ok = data?.status === 'connected';
      const companies = (data?.companies_status || []).filter((c: any) => c.status === 'ok');
      setSimproConnected(ok && companies.length > 0);
      setSimproCompanies(companies);
    } catch { setSimproConnected(false); }
  }, []);

  useEffect(() => { load(); loadSimpro(); }, [load, loadSimpro]);

  const filtered = users.filter((u) =>
    (!roleFilter || u.role === roleFilter) && (!statusFilter || u.status === statusFilter)
  );

  const forceSignout = (u: any) => {
    Alert.alert('Force sign-out', `Force ${u.name || u.email} to sign out?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Force sign-out', style: 'destructive', onPress: async () => {
        try { await api.post(`/users/${u.id}/force-signout`); Alert.alert('Done', 'User signed out'); load(); }
        catch (e) { Alert.alert('Error', apiError(e)); }
      }},
    ]);
  };

  const disableUser = (u: any) => {
    Alert.alert('Disable user', `Disable ${u.name || u.email}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Disable', style: 'destructive', onPress: async () => {
        try { await api.delete(`/users/${u.id}`); Alert.alert('Done', 'User disabled'); load(); }
        catch (e) { Alert.alert('Error', apiError(e)); }
      }},
    ]);
  };

  return (
    <SafeAreaView style={us.safe}>
      <ScrollView
        testID="users-page"
        style={us.scroll}
        contentContainerStyle={us.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={Colors.blue} />}
      >
        <Text style={us.overline}>SETTINGS</Text>
        <Text style={us.heading}>Users & Permissions</Text>
        <Text style={us.sub}>{users.length} users in your org</Text>

        {/* Import button */}
        {canEdit && (
          <View style={us.toolbar}>
            <TouchableOpacity testID="import-from-simpro-btn" style={[us.importBtn, !simproConnected && { opacity: 0.5 }]}
              onPress={() => simproConnected ? setImportOpen(true) : Alert.alert('Not connected', 'Connect Simpro first')}
              disabled={!simproConnected}>
              <Ionicons name="download" size={14} color="#4f3a8c" />
              <Text style={us.importBtnText}>Import from Simpro</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Filters */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={us.filterScroll}>
          <TouchableOpacity style={[us.chip, !roleFilter && !statusFilter && us.chipActive]}
            onPress={() => { setRoleFilter(''); setStatusFilter(''); }}>
            <Text style={[us.chipText, !roleFilter && !statusFilter && us.chipTextActive]}>All</Text>
          </TouchableOpacity>
          {ROLES.map((r) => (
            <TouchableOpacity key={r} testID={`filter-role-${r}`} style={[us.chip, roleFilter === r && us.chipActive]}
              onPress={() => setRoleFilter(roleFilter === r ? '' : r)}>
              <Text style={[us.chipText, roleFilter === r && us.chipTextActive]}>{ROLE_LABELS[r]}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {loading ? <ActivityIndicator style={{ marginTop: 30 }} color={Colors.blue} /> :
         filtered.length === 0 ? (
          <View style={us.emptyBox}><Text style={us.emptyText}>No users match that filter</Text></View>
        ) : filtered.map((u) => (
          <View key={u.id} testID={`user-row-${u.id}`} style={us.card}>
            <View style={us.cardTop}>
              <View style={us.avatar}>
                <Text style={us.avatarText}>{(u.name || u.email || 'U').slice(0, 2).toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={us.cardName}>{u.name || u.email}</Text>
                <Text style={us.cardEmail}>{u.email}</Text>
                <View style={us.cardMeta}>
                  <View style={us.roleBadge}>
                    <Text style={us.roleText}>{ROLE_LABELS[u.role] || u.role}</Text>
                  </View>
                  <StatusPill status={u.status || 'active'} />
                </View>
              </View>
            </View>
            {isAdmin && u.id !== currentUser?.id && (
              <View style={us.actionRow}>
                <TouchableOpacity testID={`force-signout-${u.id}`} style={us.actionBtn} onPress={() => forceSignout(u)}>
                  <Ionicons name="log-out" size={12} color={Colors.textSecondary} />
                  <Text style={us.actionText}>Force sign-out</Text>
                </TouchableOpacity>
                {u.status !== 'disabled' && (
                  <TouchableOpacity testID={`disable-user-${u.id}`} style={[us.actionBtn, us.dangerBtn]} onPress={() => disableUser(u)}>
                    <Ionicons name="close-circle" size={12} color={Colors.red} />
                    <Text style={[us.actionText, { color: Colors.red }]}>Disable</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
        ))}
      </ScrollView>

      {importOpen && (
        <ImportFromSimproModal
          companies={simproCompanies}
          onClose={() => setImportOpen(false)}
          onImported={() => { setImportOpen(false); load(); }}
        />
      )}
    </SafeAreaView>
  );
}

/* ─── Import from Simpro ─── */
function ImportFromSimproModal({ companies, onClose, onImported }: any) {
  const [employees, setEmployees] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [defaultRole, setDefaultRole] = useState('worker');
  const [importing, setImporting] = useState(false);
  const [roleOpen, setRoleOpen] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const companyIds = companies.map((c: any) => c.company_id).join(',');
        const { data } = await api.get('/integrations/simpro/employees', { params: { company_ids: companyIds, filter: 'all' } });
        setEmployees(data || []);
      } catch (e) { Alert.alert('Error', apiError(e)); }
      finally { setLoading(false); }
    })();
  }, [companies]);

  const importable = employees.filter((e) => e.importable && !e.is_already_imported);
  const toggleAll = () => {
    if (selected.size === importable.length) setSelected(new Set());
    else setSelected(new Set(importable.map((e) => e.simpro_employee_id)));
  };
  const toggle = (id: string) => {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const doImport = async () => {
    if (selected.size === 0) return;
    setImporting(true);
    try {
      const payload = {
        employees: employees.filter((e) => selected.has(e.simpro_employee_id)),
        default_role: defaultRole,
        workspace_ids: [],
        send_invite: false,
      };
      const { data } = await api.post('/users/import-from-simpro', payload);
      Alert.alert('Imported', `${data.imported || selected.size} users imported`);
      onImported();
    } catch (e) { Alert.alert('Error', apiError(e)); }
    finally { setImporting(false); }
  };

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={us.safe}>
        <View testID="import-simpro-modal" style={{ flex: 1 }}>
          <View style={us.modalHeader}>
            <Text style={us.modalTitle}>Import from Simpro</Text>
            <TouchableOpacity onPress={onClose} style={{ padding: 6 }}>
              <Ionicons name="close" size={22} color={Colors.textTertiary} />
            </TouchableOpacity>
          </View>

          <View style={us.importToolbar}>
            <TouchableOpacity style={us.selectAllBtn} onPress={toggleAll}>
              <Ionicons name={selected.size === importable.length && importable.length > 0 ? 'checkbox' : 'square-outline'} size={18} color={Colors.blue} />
              <Text style={us.selectAllText}>Select all ({importable.length})</Text>
            </TouchableOpacity>
            <TouchableOpacity style={us.roleDropdown} onPress={() => setRoleOpen(true)}>
              <Text style={us.roleDropdownText}>{ROLE_LABELS[defaultRole]}</Text>
              <Ionicons name="chevron-down" size={14} color={Colors.textTertiary} />
            </TouchableOpacity>
          </View>

          <ScrollView style={{ flex: 1 }}>
            {loading ? <ActivityIndicator style={{ marginTop: 30 }} color={Colors.blue} /> :
             employees.map((e) => {
              const disabled = !e.importable || e.is_already_imported;
              const isSelected = selected.has(e.simpro_employee_id);
              return (
                <TouchableOpacity key={e.simpro_employee_id} testID={`import-row-${e.simpro_employee_id}`}
                  style={[us.importRow, disabled && { opacity: 0.4 }]}
                  onPress={() => !disabled && toggle(e.simpro_employee_id)}
                  disabled={disabled}>
                  <Ionicons name={isSelected ? 'checkbox' : 'square-outline'} size={18} color={isSelected ? Colors.blue : Colors.textTertiary} />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={us.importName}>{e.name}</Text>
                    <Text style={us.importEmail}>{e.email || 'No email'}</Text>
                  </View>
                  {e.is_already_imported && <Text style={us.alreadyBadge}>Already imported</Text>}
                  {e.email_missing && <Text style={us.missingBadge}>No email</Text>}
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <View style={us.importFooter}>
            <TouchableOpacity style={us.ghostBtn} onPress={onClose}>
              <Text style={us.ghostBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity testID="import-users-btn" style={[us.primaryBtn, selected.size === 0 && { opacity: 0.5 }]}
              onPress={doImport} disabled={importing || selected.size === 0}>
              {importing ? <ActivityIndicator color="#fff" size="small" /> :
                <Text style={us.primaryBtnText}>Import {selected.size} user{selected.size !== 1 ? 's' : ''}</Text>}
            </TouchableOpacity>
          </View>
        </View>

        {/* Role picker */}
        <Modal visible={roleOpen} transparent animationType="fade" onRequestClose={() => setRoleOpen(false)}>
          <TouchableOpacity style={us.pickerOverlay} activeOpacity={1} onPress={() => setRoleOpen(false)}>
            <View style={us.pickerBox}>
              <Text style={us.pickerTitle}>Default role</Text>
              {ROLES.map((r) => (
                <TouchableOpacity key={r} style={us.pickerItem} onPress={() => { setDefaultRole(r); setRoleOpen(false); }}>
                  <Text style={[us.pickerItemText, defaultRole === r && { color: Colors.blue, fontWeight: '700' }]}>{ROLE_LABELS[r]}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </TouchableOpacity>
        </Modal>
      </SafeAreaView>
    </Modal>
  );
}

const us = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 32 },
  overline: { fontSize: 10, fontWeight: '700', letterSpacing: 1.5, color: Colors.blue },
  heading: { fontSize: 26, fontWeight: '700', color: Colors.ink, marginTop: 4, letterSpacing: -0.5 },
  sub: { fontSize: 13, color: Colors.textSecondary, marginTop: 4 },
  toolbar: { flexDirection: 'row', gap: 8, marginTop: 14 },
  importBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.white },
  importBtnText: { fontSize: 12, fontWeight: '600', color: '#4f3a8c' },
  filterScroll: { marginTop: 12, marginBottom: 12, flexGrow: 0 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.white, marginRight: 6 },
  chipActive: { backgroundColor: Colors.blue, borderColor: Colors.blue },
  chipText: { fontSize: 12, fontWeight: '500', color: Colors.textSecondary },
  chipTextActive: { color: '#fff' },
  emptyBox: { alignItems: 'center', paddingVertical: 40 },
  emptyText: { fontSize: 14, color: Colors.textTertiary },
  card: { backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: 14, padding: 14, marginBottom: 8 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start' },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.blue, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  cardName: { fontSize: 15, fontWeight: '600', color: Colors.ink },
  cardEmail: { fontSize: 12, color: Colors.textTertiary, marginTop: 2 },
  cardMeta: { flexDirection: 'row', gap: 6, marginTop: 6 },
  roleBadge: { backgroundColor: Colors.blueSoft, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  roleText: { fontSize: 10, fontWeight: '700', color: Colors.blue, textTransform: 'uppercase', letterSpacing: 0.5 },
  pill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  pillText: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  actionRow: { flexDirection: 'row', gap: 8, marginTop: 10, borderTopWidth: 1, borderTopColor: Colors.borderLight, paddingTop: 10 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.bg },
  dangerBtn: { borderColor: Colors.redSoft },
  actionText: { fontSize: 11, fontWeight: '500', color: Colors.textSecondary },
  // Modal
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Colors.border, backgroundColor: Colors.white },
  modalTitle: { fontSize: 17, fontWeight: '700', color: Colors.ink },
  importToolbar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  selectAllBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  selectAllText: { fontSize: 13, color: Colors.text },
  roleDropdown: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.white },
  roleDropdownText: { fontSize: 12, color: Colors.text },
  importRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  importName: { fontSize: 14, fontWeight: '500', color: Colors.ink },
  importEmail: { fontSize: 12, color: Colors.textTertiary, marginTop: 1 },
  alreadyBadge: { fontSize: 10, fontWeight: '600', color: Colors.emeraldDark, backgroundColor: Colors.mint, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  missingBadge: { fontSize: 10, fontWeight: '600', color: Colors.amber, backgroundColor: Colors.amberSoft, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  importFooter: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingVertical: 14, borderTopWidth: 1, borderTopColor: Colors.border, backgroundColor: '#F8FAFC' },
  ghostBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.white, alignItems: 'center' },
  ghostBtnText: { fontSize: 14, fontWeight: '500', color: Colors.textSecondary },
  primaryBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: Colors.blue, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { fontSize: 14, fontWeight: '600', color: '#fff' },
  pickerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  pickerBox: { backgroundColor: Colors.white, borderRadius: 16, padding: 16, width: '100%', maxWidth: 300 },
  pickerTitle: { fontSize: 16, fontWeight: '700', color: Colors.ink, marginBottom: 12 },
  pickerItem: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  pickerItemText: { fontSize: 15, color: Colors.text },
});
