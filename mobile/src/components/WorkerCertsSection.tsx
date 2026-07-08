import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ActivityIndicator, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import api, { apiError } from '../lib/api';
import { Colors } from '../lib/colors';

/* ─── Status badge logic ─── */
function certStatus(c: any): { key: string; label: string; bg: string; ink: string; icon?: string } {
  const hasFile = !!c.file_url || !!c.file_id;
  if (!hasFile && c.status !== 'no_expiry') {
    return { key: 'missing_file', label: 'MISSING FILE', bg: '#FEF3C7', ink: '#92400E', icon: 'warning' };
  }
  if (c.status === 'expired') {
    const days = c.days_since_expiry ?? daysSince(c.expiry_date);
    return { key: 'expired', label: `EXPIRED${days ? ` ${days}d AGO` : ''}`, bg: '#FCE4EC', ink: '#7a1f33' };
  }
  if (c.status === 'expiring_soon') {
    const days = c.days_until_expiry ?? daysUntil(c.expiry_date);
    return { key: 'expiring_soon', label: `EXPIRES IN ${days ?? '?'}d`, bg: '#FEF3C7', ink: '#92400E' };
  }
  if (c.status === 'no_expiry') {
    return { key: 'no_expiry', label: 'NO EXPIRY', bg: '#e6eff9', ink: '#1e4a8c' };
  }
  return { key: 'valid', label: 'VALID', bg: '#d8ecdd', ink: '#1f7a3f' };
}

function daysSince(d: string | null) {
  if (!d) return null;
  const diff = Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
  return diff > 0 ? diff : null;
}
function daysUntil(d: string | null) {
  if (!d) return null;
  const diff = Math.floor((new Date(d).getTime() - Date.now()) / 86400000);
  return diff >= 0 ? diff : null;
}
function fmtDate(s: string | null | undefined) {
  return s ? s.slice(0, 10) : '—';
}

function StatusBadge({ cert }: { cert: any }) {
  const s = certStatus(cert);
  return (
    <View style={[st.badge, { backgroundColor: s.bg }]}>
      {s.icon && <Ionicons name={s.icon as any} size={10} color={s.ink} />}
      <Text style={[st.badgeText, { color: s.ink }]}>{s.label}</Text>
    </View>
  );
}

/* ─── Inline Edit Form ─── */
function CertForm({ initial, onSave, onCancel }: {
  initial?: any; onSave: (data: any) => Promise<void>; onCancel: () => void;
}) {
  const [f, setF] = useState({
    name:        initial?.name        || '',
    issuer:      initial?.issuer      || '',
    issue_date:  initial?.issue_date  || '',
    expiry_date: initial?.expiry_date || '',
    notes:       initial?.notes       || '',
  });
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!f.name.trim()) { Alert.alert('Required', 'Certification name is required'); return; }
    setSaving(true);
    try { await onSave(f); } finally { setSaving(false); }
  };

  return (
    <View testID="cert-form" style={st.formBox}>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Text style={st.label}>Name *</Text>
          <TextInput testID="cert-name" style={st.input} value={f.name}
            onChangeText={(v) => setF({ ...f, name: v })} placeholder="e.g. White Card"
            placeholderTextColor={Colors.textTertiary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={st.label}>Issuer</Text>
          <TextInput testID="cert-issuer" style={st.input} value={f.issuer}
            onChangeText={(v) => setF({ ...f, issuer: v })} placeholder="Issuing body"
            placeholderTextColor={Colors.textTertiary} />
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Text style={st.label}>Issued</Text>
          <TextInput testID="cert-issue-date" style={st.input} value={f.issue_date}
            onChangeText={(v) => setF({ ...f, issue_date: v })} placeholder="YYYY-MM-DD"
            placeholderTextColor={Colors.textTertiary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={st.label}>Expiry</Text>
          <TextInput testID="cert-expiry-date" style={st.input} value={f.expiry_date}
            onChangeText={(v) => setF({ ...f, expiry_date: v })} placeholder="YYYY-MM-DD"
            placeholderTextColor={Colors.textTertiary} />
        </View>
      </View>
      <Text style={st.label}>Notes</Text>
      <TextInput testID="cert-notes" style={[st.input, { minHeight: 40 }]} multiline value={f.notes}
        onChangeText={(v) => setF({ ...f, notes: v })} placeholder="Optional notes"
        placeholderTextColor={Colors.textTertiary} />
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 6, marginTop: 6 }}>
        <TouchableOpacity style={st.cancelBtn} onPress={onCancel}>
          <Text style={st.cancelBtnText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity testID="cert-save" style={st.saveBtn} onPress={submit} disabled={saving}>
          {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={st.saveBtnText}>Save</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

/* ─── Main exported component ─── */
export default function WorkerCertsSection({ workerId, canEdit }: {
  workerId: string; canEdit: boolean;
}) {
  const [certs, setCerts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addingManual, setAddingManual] = useState(false);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/workers/${workerId}/certifications`);
      setCerts(data || []);
    } catch (e: any) { Alert.alert('Error', apiError(e)); }
    finally { setLoading(false); }
  }, [workerId]);

  useEffect(() => { load(); }, [load]);

  const pickAndUpload = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.length) return;
      setUploading(true);
      const asset = result.assets[0];
      const formData = new FormData();
      formData.append('file', { uri: asset.uri, name: asset.name, type: asset.mimeType || 'application/octet-stream' } as any);
      await api.post(`/workers/${workerId}/certifications/upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      Alert.alert('Uploaded', `${asset.name} uploaded — fill in the details below.`);
      await load();
      // auto-expand newly created cert for editing
    } catch (e: any) { Alert.alert('Upload error', apiError(e)); }
    finally { setUploading(false); }
  };

  const createStub = async (data: any) => {
    try {
      await api.post(`/workers/${workerId}/certifications`, data);
      setAddingManual(false);
      await load();
    } catch (e: any) { Alert.alert('Error', apiError(e)); }
  };

  const updateCert = async (certId: string, data: any) => {
    try {
      await api.patch(`/workers/certifications/${certId}`, data);
      setEditingId(null);
      await load();
    } catch (e: any) { Alert.alert('Error', apiError(e)); }
  };

  const deleteCert = (c: any) => {
    Alert.alert('Delete certification', `Remove "${c.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try { await api.delete(`/workers/certifications/${c.id}`); await load(); }
        catch (e: any) { Alert.alert('Error', apiError(e)); }
      }},
    ]);
  };

  const sendReminder = async (c: any) => {
    try {
      await api.post(`/workers/certifications/${c.id}/send-reminder`);
      Alert.alert('Sent', `Reminder sent for "${c.name}".`);
    } catch (e: any) { Alert.alert('Error', apiError(e)); }
  };

  if (loading) {
    return <ActivityIndicator testID="certs-loading" style={{ marginTop: 12 }} color="#92400E" />;
  }

  return (
    <View testID="certs-section">
      {/* Actions bar */}
      {canEdit && (
        <View style={st.actionsBar}>
          <TouchableOpacity testID="cert-upload-btn" style={st.uploadBtn} onPress={pickAndUpload} disabled={uploading}>
            {uploading ? <ActivityIndicator size="small" color="#92400E" /> : <Ionicons name="cloud-upload" size={13} color="#92400E" />}
            <Text style={st.uploadBtnText}>Upload cert</Text>
          </TouchableOpacity>
          <TouchableOpacity testID="cert-add-manual-btn" style={st.manualBtn} onPress={() => setAddingManual(true)}>
            <Ionicons name="add" size={13} color="#92400E" />
            <Text style={st.manualBtnText}>Add (no file)</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Manual add form */}
      {addingManual && (
        <CertForm onSave={createStub} onCancel={() => setAddingManual(false)} />
      )}

      {/* Cert list */}
      {certs.length === 0 && !addingManual ? (
        <View style={st.empty}>
          <Ionicons name="ribbon" size={24} color={Colors.textTertiary} />
          <Text style={st.emptyText}>No certifications yet.</Text>
          {canEdit && <Text style={st.emptyHint}>Upload a cert file or add one manually above.</Text>}
        </View>
      ) : certs.map((c) => (
        editingId === c.id ? (
          <CertForm key={c.id} initial={c} onSave={(d) => updateCert(c.id, d)} onCancel={() => setEditingId(null)} />
        ) : (
          <View key={c.id} testID={`cert-card-${c.id}`} style={st.certCard}>
            {/* Top: name + status */}
            <View style={st.certTop}>
              <Text style={st.certName} numberOfLines={1}>{c.name || '(untitled)'}</Text>
              <StatusBadge cert={c} />
            </View>
            {/* Middle: issuer + dates */}
            <View style={st.certMid}>
              {c.issuer ? <Text style={st.certMeta}>{c.issuer}</Text> : null}
              <Text style={st.certMeta}>
                Issued {fmtDate(c.issue_date)} · Expires {fmtDate(c.expiry_date)}
              </Text>
            </View>
            {c.notes ? <Text style={st.certNotes}>{c.notes}</Text> : null}
            {/* Actions */}
            <View style={st.certActions}>
              {(c.file_url || c.file_id) && (
                <TouchableOpacity testID={`cert-view-${c.id}`} style={[st.actionChip, { backgroundColor: '#e6eff9' }]}>
                  <Ionicons name="document" size={11} color="#1e4a8c" />
                  <Text style={[st.actionChipText, { color: Colors.orangeLight }]}>File</Text>
                </TouchableOpacity>
              )}
              {canEdit && (
                <>
                  <TouchableOpacity testID={`cert-edit-${c.id}`}
                    style={[st.actionChip, { backgroundColor: '#FEF3C7' }]}
                    onPress={() => setEditingId(c.id)}>
                    <Ionicons name="pencil" size={11} color="#92400E" />
                    <Text style={[st.actionChipText, { color: '#92400E' }]}>Edit</Text>
                  </TouchableOpacity>
                  <TouchableOpacity testID={`cert-remind-${c.id}`}
                    style={[st.actionChip, { backgroundColor: '#ece6f4' }]}
                    onPress={() => sendReminder(c)}>
                    <Ionicons name="paper-plane" size={11} color="#4f3a8c" />
                  </TouchableOpacity>
                  <TouchableOpacity testID={`cert-delete-${c.id}`}
                    style={[st.actionChip, { backgroundColor: '#FCE4EC' }]}
                    onPress={() => deleteCert(c)}>
                    <Ionicons name="trash" size={11} color="#7a1f33" />
                  </TouchableOpacity>
                </>
              )}
            </View>
          </View>
        )
      ))}
    </View>
  );
}

const st = StyleSheet.create({
  actionsBar: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  uploadBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: '#FEF3C7', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10,
    borderWidth: 1, borderColor: '#FDE68A',
  },
  uploadBtnText: { fontSize: 12, fontWeight: '600', color: '#92400E' },
  manualBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#F8FAFC', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10,
    borderWidth: 1, borderColor: Colors.border,
  },
  manualBtnText: { fontSize: 12, fontWeight: '500', color: Colors.textSecondary },
  empty: { alignItems: 'center', paddingVertical: 24, gap: 4 },
  emptyText: { fontSize: 13, fontWeight: '500', color: Colors.textSecondary },
  emptyHint: { fontSize: 11, color: Colors.textTertiary },
  // Badge
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8,
  },
  badgeText: { fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
  // Card
  certCard: {
    backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 12, padding: 10, marginBottom: 6,
  },
  certTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  certName: { flex: 1, fontSize: 14, fontWeight: '600', color: Colors.ink },
  certMid: { marginTop: 4, gap: 1 },
  certMeta: { fontSize: 11, color: Colors.textSecondary },
  certNotes: { fontSize: 11, color: Colors.textTertiary, marginTop: 4, fontStyle: 'italic' },
  certActions: { flexDirection: 'row', gap: 6, marginTop: 8 },
  actionChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8,
  },
  actionChipText: { fontSize: 10, fontWeight: '600' },
  // Form
  formBox: {
    borderWidth: 1, borderColor: '#FDE68A', borderRadius: 12,
    backgroundColor: '#FEF3C720', padding: 10, marginBottom: 8,
  },
  label: { fontSize: 10, fontWeight: '500', color: Colors.textSecondary, marginBottom: 3, marginTop: 4 },
  input: {
    backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 7, fontSize: 13, color: Colors.text,
  },
  cancelBtn: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8,
    borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.white,
  },
  cancelBtnText: { fontSize: 11, color: Colors.textSecondary },
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8, backgroundColor: '#92400E',
  },
  saveBtnText: { fontSize: 11, fontWeight: '600', color: '#fff' },
});
