import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  RefreshControl, ActivityIndicator, Alert, TextInput, Switch, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import api, { apiError } from '../src/lib/api';
import { Colors } from '../src/lib/colors';
import { getUser } from '../src/lib/auth';
import StatusBadge from '../src/components/StatusBadge';
import SupplierDrawer from '../src/components/SupplierDrawer';

const AU_STATES = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA'];
const WRITE_ROLES = new Set(['admin', 'hseq_lead']);

function mergeSupplier(s: any, meta: any) {
  const m = meta || {};
  const activeFinal = m.active_override === null || m.active_override === undefined
    ? !!s.active : !!m.active_override;
  return {
    ...s,
    contact_name: m.custom_contact ?? s.contact_name,
    phone: m.custom_phone ?? s.phone,
    address: m.custom_address ?? s.address,
    state: m.custom_state ?? s.state,
    parent_supplier_id: m.parent_supplier_id || null,
    location_on_map: !!m.location_on_map,
    active_final: activeFinal,
    notes: m.notes || '',
  };
}

function SuppliersScreenInner() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [connected, setConnected] = useState(true);
  const [rawSuppliers, setRawSuppliers] = useState<any[]>([]);
  const [metaMap, setMetaMap] = useState<any>({});
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [editing, setEditing] = useState<any>(null);
  const [renewalFor, setRenewalFor] = useState<any>(null);
  const [drawerSupplier, setDrawerSupplier] = useState<any>(null);
  const [drawerPanel, setDrawerPanel] = useState('tasks');

  const canEdit = WRITE_ROLES.has(user?.role);

  useEffect(() => { getUser().then(setUser); }, []);

  const load = useCallback(async () => {
    try {
      const [supRes, metaRes] = await Promise.all([
        api.get('/integrations/simpro/suppliers'),
        api.get('/suppliers/meta'),
      ]);
      setRawSuppliers(supRes.data.suppliers || []);
      setConnected(supRes.data.connected !== false);
      setCachedAt(supRes.data.cached_at);
      setMetaMap(metaRes.data || {});
    } catch {
      setConnected(false);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const sync = async () => {
    setSyncing(true);
    try {
      const { data } = await api.post('/integrations/simpro/suppliers/sync');
      Alert.alert('Synced', `${data.count} suppliers from Simpro`);
      await load();
    } catch (e) { Alert.alert('Error', apiError(e)); }
    finally { setSyncing(false); }
  };

  const merged = useMemo(
    () => rawSuppliers.map((s) => mergeSupplier(s, metaMap[s.simpro_supplier_id])),
    [rawSuppliers, metaMap],
  );

  const filtered = useMemo(() => {
    const q = searchQ.trim().toLowerCase();
    if (!q) return merged;
    return merged.filter((s) =>
      (s.name || '').toLowerCase().includes(q) ||
      (s.phone || '').toLowerCase().includes(q) ||
      (s.state || '').toLowerCase().includes(q)
    );
  }, [merged, searchQ]);

  if (!loading && !connected) {
    return (
      <SafeAreaView style={s.safe}>
        <ScrollView testID="suppliers-not-connected" contentContainerStyle={s.content}>
          <TouchableOpacity testID="suppliers-back-nc" onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/settings')} style={s.navBack}>
            <Ionicons name="arrow-back" size={20} color="#1e4a8c" />
            <Text style={s.navBackText}>Back</Text>
          </TouchableOpacity>
          <Text style={s.overline}>COMPLIANCE</Text>
          <Text style={s.heading}>Suppliers</Text>
          <View style={s.errorCard}>
            <Ionicons name="extension-puzzle" size={28} color={Colors.blue} />
            <Text style={s.errorTitle}>Simpro isn't connected</Text>
            <Text style={s.errorBody}>Suppliers are sourced from your Simpro account. Connect Simpro to populate this list.</Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView
        testID="suppliers-page"
        style={s.scroll}
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={Colors.blue} />}
      >
        <TouchableOpacity testID="suppliers-back-btn" onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/settings')} style={s.navBack}>
          <Ionicons name="arrow-back" size={20} color="#1e4a8c" />
          <Text style={s.navBackText}>Back</Text>
        </TouchableOpacity>
        <Text style={s.overline}>COMPLIANCE</Text>
        <Text style={s.heading}>Suppliers</Text>
        <Text style={s.sub}>Sourced live from Simpro. Org-local overrides stay in Paneltec.</Text>

        {/* Search + Sync */}
        <View style={s.toolbar}>
          <View style={s.searchRow}>
            <Ionicons name="search" size={14} color={Colors.textTertiary} />
            <TextInput
              testID="suppliers-search"
              style={s.searchInput}
              placeholder="Search suppliers..."
              placeholderTextColor={Colors.textTertiary}
              value={searchQ}
              onChangeText={setSearchQ}
            />
          </View>
          {canEdit && (
            <TouchableOpacity testID="sync-simpro" style={s.syncBtn} onPress={sync} disabled={syncing}>
              {syncing ? <ActivityIndicator size="small" color="#4f3a8c" /> : <Ionicons name="refresh" size={14} color="#4f3a8c" />}
              <Text style={s.syncText}>Sync</Text>
            </TouchableOpacity>
          )}
        </View>

        {loading ? <ActivityIndicator style={{ marginTop: 40 }} color={Colors.blue} /> :
          filtered.length === 0 ? (
            <View style={s.emptyBox}>
              <Ionicons name="people" size={28} color={Colors.textTertiary} />
              <Text style={s.emptyTitle}>{searchQ ? 'No suppliers match' : 'No suppliers yet'}</Text>
              <Text style={s.emptyBody}>{searchQ ? 'Try a different search term.' : 'Run a sync to pull suppliers from Simpro.'}</Text>
            </View>
          ) : filtered.map((sup) => (
            <TouchableOpacity
              key={sup.simpro_supplier_id}
              testID={`supplier-row-${sup.simpro_supplier_id}`}
              style={s.card}
              onPress={() => setEditing(sup)}
              activeOpacity={0.7}
            >
              <View style={s.cardTop}>
                <View style={{ flex: 1 }}>
                  <Text style={s.cardName} numberOfLines={1}>{sup.name}</Text>
                  {sup.phone ? <Text style={s.cardPhone}>{sup.phone}</Text> : null}
                </View>
                <View style={[s.statusPill, sup.active_final ? s.activePill : s.inactivePill]}>
                  <Text style={[s.statusText, { color: sup.active_final ? '#1f7a3f' : '#475569' }]}>
                    {sup.active_final ? 'Active' : 'Inactive'}
                  </Text>
                </View>
              </View>
              {/* Icon chips row — tapping opens the drawer on that panel */}
              <View style={s.chipRow}>
                <TouchableOpacity testID={`tasks-${sup.simpro_supplier_id}`} style={[s.iconChip, { backgroundColor: '#fbf3df' }]}
                  onPress={(e) => { e.stopPropagation?.(); setDrawerSupplier(sup); setDrawerPanel('tasks'); }}>
                  <Ionicons name="checkbox" size={12} color="#8c6a1a" />
                  <Text style={[s.chipCount, { color: '#8c6a1a' }]}>Tasks</Text>
                </TouchableOpacity>
                <TouchableOpacity testID={`notes-${sup.simpro_supplier_id}`} style={[s.iconChip, { backgroundColor: '#e6eff9' }]}
                  onPress={(e) => { e.stopPropagation?.(); setDrawerSupplier(sup); setDrawerPanel('notes'); }}>
                  <Ionicons name="document-text" size={12} color="#1e4a8c" />
                  <Text style={[s.chipCount, { color: '#1e4a8c' }]}>Notes</Text>
                </TouchableOpacity>
                <TouchableOpacity testID={`folders-${sup.simpro_supplier_id}`} style={[s.iconChip, { backgroundColor: '#ece6f4' }]}
                  onPress={(e) => { e.stopPropagation?.(); setDrawerSupplier(sup); setDrawerPanel('folders'); }}>
                  <Ionicons name="folder" size={12} color="#4f3a8c" />
                  <Text style={[s.chipCount, { color: '#4f3a8c' }]}>Folders</Text>
                </TouchableOpacity>
                <TouchableOpacity testID={`members-${sup.simpro_supplier_id}`} style={[s.iconChip, { backgroundColor: '#fbeadf' }]}
                  onPress={(e) => { e.stopPropagation?.(); setDrawerSupplier(sup); setDrawerPanel('members'); }}>
                  <Ionicons name="people" size={12} color="#a8480f" />
                  <Text style={[s.chipCount, { color: '#a8480f' }]}>Members</Text>
                </TouchableOpacity>
              </View>
              {(sup.state || sup.address) ? (
                <Text style={s.cardAddr} numberOfLines={1}>
                  {[sup.address, sup.state].filter(Boolean).join(', ')}
                </Text>
              ) : null}
            </TouchableOpacity>
          ))}

        {cachedAt && (
          <Text style={s.cacheNote}>Last synced: {cachedAt.slice(0, 19).replace('T', ' ')}</Text>
        )}
      </ScrollView>

      {/* Edit modal */}
      {editing && (
        <EditSupplierModal
          supplier={editing}
          allSuppliers={merged}
          canEdit={canEdit}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}

      {/* Renewal modal */}
      {renewalFor && (
        <RenewalEmailModal
          supplier={renewalFor}
          onClose={() => setRenewalFor(null)}
          onSent={() => setRenewalFor(null)}
        />
      )}

      {/* Sub-panels drawer */}
      {drawerSupplier && (
        <SupplierDrawer
          supplier={drawerSupplier}
          initialPanel={drawerPanel}
          onClose={() => setDrawerSupplier(null)}
          onChanged={load}
        />
      )}
    </SafeAreaView>
  );
}

/* ─── Edit Supplier Modal ─── */
function EditSupplierModal({ supplier, allSuppliers, canEdit, onClose, onSaved }: any) {
  const [form, setForm] = useState({
    custom_contact: supplier.contact_name || '',
    custom_phone: supplier.phone || '',
    custom_address: supplier.address || '',
    custom_state: supplier.state || '',
    parent_supplier_id: supplier.parent_supplier_id || '',
    active_override: supplier.active_final,
    notes: supplier.notes || '',
  });
  const [saving, setSaving] = useState(false);
  const [stateOpen, setStateOpen] = useState(false);

  const submit = async () => {
    if (!canEdit) return;
    setSaving(true);
    try {
      await api.patch(`/suppliers/${supplier.simpro_supplier_id}/meta`, {
        custom_contact: form.custom_contact || null,
        custom_phone: form.custom_phone || null,
        custom_address: form.custom_address || null,
        custom_state: form.custom_state || null,
        parent_supplier_id: form.parent_supplier_id || null,
        active_override: form.active_override,
        notes: form.notes || null,
      });
      Alert.alert('Success', 'Supplier updated');
      onSaved();
    } catch (e: any) { Alert.alert('Error', apiError(e)); }
    finally { setSaving(false); }
  };

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={s.modalSafe}>
        <View testID="supplier-edit-modal" style={s.modalContainer}>
          <View style={s.modalHeader}>
            <View style={{ flex: 1 }}>
              <Text style={s.modalOverline}>EDIT SUPPLIER</Text>
              <Text style={s.modalTitle}>{supplier.name}</Text>
            </View>
            <TouchableOpacity testID="modal-close" onPress={onClose} style={s.closeBtn}>
              <Ionicons name="close" size={22} color={Colors.textTertiary} />
            </TouchableOpacity>
          </View>

          <View style={s.simproBanner}>
            <Ionicons name="extension-puzzle" size={12} color="#8c6a1a" />
            <Text style={s.simproBannerText}>Name and Simpro ID are synced from Simpro. Fields below are org-local overrides.</Text>
          </View>

          <ScrollView style={s.modalBody} keyboardShouldPersistTaps="handled">
            <Text style={s.fieldLabel}>Address</Text>
            <TextInput testID="supplier-address-input" style={[s.fieldInput, { minHeight: 60 }]} multiline
              value={form.custom_address} onChangeText={(v) => setForm({ ...form, custom_address: v })}
              placeholder="Address" placeholderTextColor={Colors.textTertiary} />

            <Text style={s.fieldLabel}>State</Text>
            <TouchableOpacity style={s.fieldInput} onPress={() => setStateOpen(true)}>
              <Text style={{ color: form.custom_state ? Colors.text : Colors.textTertiary }}>
                {form.custom_state || 'Select state'}
              </Text>
            </TouchableOpacity>

            <Text style={s.fieldLabel}>Phone</Text>
            <TextInput testID="supplier-phone-input" style={s.fieldInput}
              value={form.custom_phone} onChangeText={(v) => setForm({ ...form, custom_phone: v })}
              placeholder="Phone" placeholderTextColor={Colors.textTertiary} keyboardType="phone-pad" />

            <Text style={s.fieldLabel}>Contact name</Text>
            <TextInput testID="supplier-contact-input" style={s.fieldInput}
              value={form.custom_contact} onChangeText={(v) => setForm({ ...form, custom_contact: v })}
              placeholder="Contact name" placeholderTextColor={Colors.textTertiary} />

            <Text style={s.fieldLabel}>Notes</Text>
            <TextInput testID="supplier-notes-input" style={[s.fieldInput, { minHeight: 60 }]} multiline
              value={form.notes} onChangeText={(v) => setForm({ ...form, notes: v })}
              placeholder="Internal notes" placeholderTextColor={Colors.textTertiary} />

            <View style={s.switchRow}>
              <Text style={s.fieldLabel}>Active</Text>
              <Switch testID="supplier-active-checkbox"
                value={form.active_override}
                onValueChange={(v) => setForm({ ...form, active_override: v })}
                trackColor={{ true: '#10B981', false: '#CBD5E1' }}
              />
            </View>
          </ScrollView>

          {canEdit && (
            <View style={s.modalFooter}>
              <TouchableOpacity testID="modal-cancel" style={s.ghostBtn} onPress={onClose}>
                <Text style={s.ghostBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity testID="modal-update" style={s.primaryBtn} onPress={submit} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.primaryBtnText}>Update</Text>}
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* State picker modal */}
        <Modal visible={stateOpen} transparent animationType="fade" onRequestClose={() => setStateOpen(false)}>
          <TouchableOpacity style={s.pickerOverlay} activeOpacity={1} onPress={() => setStateOpen(false)}>
            <View style={s.pickerBox}>
              <Text style={s.pickerTitle}>Select State</Text>
              <TouchableOpacity style={s.pickerItem} onPress={() => { setForm({ ...form, custom_state: '' }); setStateOpen(false); }}>
                <Text style={s.pickerItemText}>— None —</Text>
              </TouchableOpacity>
              {AU_STATES.map((st) => (
                <TouchableOpacity key={st} testID={`state-${st}`} style={s.pickerItem}
                  onPress={() => { setForm({ ...form, custom_state: st }); setStateOpen(false); }}>
                  <Text style={[s.pickerItemText, form.custom_state === st && { color: Colors.blue, fontWeight: '700' }]}>{st}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </TouchableOpacity>
        </Modal>
      </SafeAreaView>
    </Modal>
  );
}

/* ─── Renewal Email Modal ─── */
function RenewalEmailModal({ supplier, onClose, onSent }: any) {
  const today = new Date();
  const due = new Date(today.getTime() + 30 * 86400000).toISOString().slice(0, 10);
  const [form, setForm] = useState({
    recipient_email: supplier.email || '',
    subject: `Annual compliance renewal — ${supplier.name}`,
    body_html: `Hi ${supplier.contact_name || supplier.name},\n\nPlease confirm or update the following by ${due}:\n- Insurance certificates\n- Licences and tickets\n- SWMS for high-risk activities\n- Any other safety docs\n\nThanks,\n— Paneltec Civil`,
  });
  const [sending, setSending] = useState(false);

  const send = async () => {
    if (!form.recipient_email.trim()) return;
    setSending(true);
    try {
      await api.post(`/suppliers/${supplier.simpro_supplier_id}/send-renewal`, form);
      Alert.alert('Sent', `Renewal email queued for ${supplier.name}`);
      onSent();
    } catch (e: any) { Alert.alert('Error', apiError(e)); }
    finally { setSending(false); }
  };

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={s.modalSafe}>
        <View testID="renewal-modal" style={s.modalContainer}>
          <View style={[s.modalHeader, { backgroundColor: '#ece6f4' }]}>
            <View style={{ flex: 1 }}>
              <Text style={[s.modalOverline, { color: '#4f3a8c' }]}>SEND RENEWAL EMAIL</Text>
              <Text style={s.modalTitle}>{supplier.name}</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={s.closeBtn}>
              <Ionicons name="close" size={22} color={Colors.textTertiary} />
            </TouchableOpacity>
          </View>
          <ScrollView style={s.modalBody} keyboardShouldPersistTaps="handled">
            <Text style={s.fieldLabel}>Recipient email</Text>
            <TextInput testID="renewal-recipient" style={s.fieldInput}
              value={form.recipient_email} onChangeText={(v) => setForm({ ...form, recipient_email: v })}
              keyboardType="email-address" autoCapitalize="none" />

            <Text style={s.fieldLabel}>Subject</Text>
            <TextInput testID="renewal-subject" style={s.fieldInput}
              value={form.subject} onChangeText={(v) => setForm({ ...form, subject: v })} />

            <Text style={s.fieldLabel}>Body</Text>
            <TextInput testID="renewal-body" style={[s.fieldInput, { minHeight: 140 }]} multiline
              value={form.body_html} onChangeText={(v) => setForm({ ...form, body_html: v })} />
          </ScrollView>
          <View style={s.modalFooter}>
            <TouchableOpacity style={s.ghostBtn} onPress={onClose}>
              <Text style={s.ghostBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity testID="renewal-send" style={[s.primaryBtn, { backgroundColor: '#4f3a8c' }]} onPress={send} disabled={sending}>
              {sending ? <ActivityIndicator color="#fff" size="small" /> : (
                <><Ionicons name="mail" size={14} color="#fff" /><Text style={s.primaryBtnText}>Send</Text></>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 32 },
  overline: { fontSize: 10, fontWeight: '700', letterSpacing: 1.5, color: Colors.blue },
  heading: { fontSize: 26, fontWeight: '700', color: Colors.ink, marginTop: 4, letterSpacing: -0.5 },
  sub: { fontSize: 13, color: Colors.textSecondary, marginTop: 4 },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14, marginBottom: 14 },
  searchRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  searchInput: { flex: 1, fontSize: 14, color: Colors.text, padding: 0 },
  syncBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, backgroundColor: '#ece6f4' },
  syncText: { fontSize: 12, fontWeight: '600', color: '#4f3a8c' },
  emptyBox: { alignItems: 'center', justifyContent: 'center', paddingVertical: 48 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: Colors.ink, textAlign: 'center', marginTop: 10 },
  emptyBody: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center', marginTop: 4, maxWidth: 280 },
  errorCard: { alignItems: 'center', paddingVertical: 40, paddingHorizontal: 20, backgroundColor: '#F5EFE0', borderWidth: 1, borderColor: '#D8CFB8', borderRadius: 16, marginTop: 16 },
  errorTitle: { fontSize: 18, fontWeight: '700', color: Colors.ink, textAlign: 'center', marginTop: 12 },
  errorBody: { fontSize: 13, color: '#475569', textAlign: 'center', marginTop: 8, maxWidth: 300 },
  card: { backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: 14, padding: 14, marginBottom: 8 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardName: { fontSize: 15, fontWeight: '600', color: Colors.ink },
  cardPhone: { fontSize: 12, color: Colors.textTertiary, marginTop: 2 },
  statusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, borderWidth: 1 },
  activePill: { backgroundColor: '#d8ecdd', borderColor: '#b6dcbf' },
  inactivePill: { backgroundColor: '#F1F5F9', borderColor: '#E2E8F0' },
  statusText: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  chipRow: { flexDirection: 'row', gap: 6, marginTop: 10 },
  iconChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8 },
  chipCount: { fontSize: 10, fontWeight: '700' },
  cardAddr: { fontSize: 11, color: Colors.textTertiary, marginTop: 6 },
  cacheNote: { fontSize: 11, color: Colors.textTertiary, textAlign: 'right', marginTop: 8 },
  // Modal styles
  modalSafe: { flex: 1, backgroundColor: Colors.bg },
  modalContainer: { flex: 1 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Colors.border, backgroundColor: '#e8efe2' },
  modalOverline: { fontSize: 10, fontWeight: '700', letterSpacing: 1.2, color: '#2e5e2e' },
  modalTitle: { fontSize: 18, fontWeight: '700', color: Colors.ink, marginTop: 2 },
  closeBtn: { padding: 6 },
  simproBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#fbf3df', borderBottomWidth: 1, borderBottomColor: '#e6d99c' },
  simproBannerText: { fontSize: 11, color: '#8c6a1a', flex: 1, lineHeight: 16 },
  modalBody: { flex: 1, padding: 16 },
  fieldLabel: { fontSize: 12, fontWeight: '600', color: '#334155', marginBottom: 4, marginTop: 12 },
  fieldInput: { backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: Colors.text },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, paddingVertical: 8 },
  modalFooter: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingVertical: 14, borderTopWidth: 1, borderTopColor: Colors.border, backgroundColor: '#F8FAFC' },
  ghostBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.white, alignItems: 'center' },
  ghostBtnText: { fontSize: 14, fontWeight: '500', color: Colors.textSecondary },
  primaryBtn: { flex: 1, flexDirection: 'row', gap: 6, paddingVertical: 12, borderRadius: 10, backgroundColor: Colors.blue, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { fontSize: 14, fontWeight: '600', color: '#fff' },
  pickerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  pickerBox: { backgroundColor: Colors.white, borderRadius: 16, padding: 16, width: '100%', maxWidth: 300, maxHeight: 400 },
  pickerTitle: { fontSize: 16, fontWeight: '700', color: Colors.ink, marginBottom: 12 },
  pickerItem: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  pickerItemText: { fontSize: 15, color: Colors.text },
  navBack: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8, paddingVertical: 4 },
  navBackText: { fontSize: 14, fontWeight: '600', color: '#1e4a8c' },
});

// v158 — Wrap the screen in a ModuleGate so admins can turn this feature
// off per-role via the Mobile App Modules admin allocator.
import { ModuleGate } from '../src/components/ModuleGate';
export default function GatedScreen() {
  return <ModuleGate module="suppliers" featureName="Suppliers"><SuppliersScreenInner /></ModuleGate>;
}
