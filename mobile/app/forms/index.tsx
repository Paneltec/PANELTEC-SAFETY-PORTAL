import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput,
  ActivityIndicator, RefreshControl, Alert, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import api, { apiError } from '../../src/lib/api';
import { getUser } from '../../src/lib/auth';
import { Colors } from '../../src/lib/colors';
import PreviewModal from '../../src/components/forms/PreviewModal';
import AiBuilderModal from '../../src/components/forms/AiBuilderModal';
import TemplateBuilder from '../../src/components/forms/TemplateBuilder';

const WRITE_ROLES = new Set(['admin', 'hseq_lead']);

const CATEGORIES = [
  { key: 'all',        label: 'All categories', bg: '#f1f5f9', ink: '#334155' },
  { key: 'incident',   label: 'Incident',       bg: '#fde2e4', ink: '#9f1239' },
  { key: 'inspection', label: 'Inspection',     bg: '#dbeafe', ink: '#1e40af' },
  { key: 'toolbox',    label: 'Toolbox',        bg: '#fef3c7', ink: '#92400e' },
  { key: 'near_miss',  label: 'Near Miss',      bg: '#fed7aa', ink: '#c2410c' },
  { key: 'general',    label: 'General',        bg: '#e2e8f0', ink: '#475569' },
];
const CAT_MAP: Record<string, typeof CATEGORIES[0]> = {};
CATEGORIES.forEach((c) => { CAT_MAP[c.key] = c; });

/* ─── Import Modal (JSON paste) ─── */
function ImportModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const doImport = async () => {
    let parsed: any;
    try { parsed = JSON.parse(text); } catch { Alert.alert('Error', 'Invalid JSON'); return; }
    if (!parsed?.templates || !Array.isArray(parsed.templates)) {
      Alert.alert('Error', 'JSON must have a "templates" array'); return;
    }
    setBusy(true);
    try {
      const { data } = await api.post('/forms/templates/import', parsed);
      Alert.alert('Imported', `Created ${data.created} template(s)`);
      onImported(); onClose();
    } catch (e: any) { Alert.alert('Error', apiError(e)); }
    finally { setBusy(false); }
  };
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
        <View style={imp.hdr}>
          <View>
            <Text style={imp.hdrTitle}>Import Civil Library</Text>
            <Text style={imp.hdrSub}>Paste JSON with a "templates" array</Text>
          </View>
          <TouchableOpacity onPress={onClose}>
            <Ionicons name="close" size={22} color={Colors.textTertiary} />
          </TouchableOpacity>
        </View>
        <View style={{ flex: 1, padding: 16 }}>
          <TextInput testID="import-textarea" style={imp.ta}
            multiline value={text} onChangeText={setText}
            placeholder='{"templates":[{"name":"...","category":"...","fields":[...]}]}'
            placeholderTextColor={Colors.textTertiary} textAlignVertical="top" />
        </View>
        <View style={imp.foot}>
          <TouchableOpacity onPress={onClose} style={imp.cancelBtn}>
            <Text style={imp.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity testID="import-confirm" onPress={doImport}
            disabled={busy || !text.trim()}
            style={[imp.confirmBtn, (busy || !text.trim()) && { opacity: 0.5 }]}>
            {busy ? <ActivityIndicator size="small" color="#fff" /> :
              <Ionicons name="cloud-upload" size={14} color="#fff" />}
            <Text style={imp.confirmText}>Import</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
}
const imp = StyleSheet.create({
  hdr: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: Colors.border },
  hdrTitle: { fontSize: 18, fontWeight: '700', color: Colors.ink },
  hdrSub: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  ta: { flex: 1, borderWidth: 1, borderColor: Colors.border, borderRadius: 12, padding: 12, fontSize: 12, fontFamily: 'monospace', color: Colors.text },
  foot: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, padding: 16, borderTopWidth: 1, borderTopColor: Colors.border },
  cancelBtn: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: Colors.border },
  cancelText: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary },
  confirmBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12, backgroundColor: '#1e293b' },
  confirmText: { fontSize: 14, fontWeight: '700', color: '#fff' },
});

/* ─── Main screen ─── */
export default function FormsListScreen() {
  const router = useRouter();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [previewT, setPreviewT] = useState<any>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [builderTemplate, setBuilderTemplate] = useState<any | null>(null);
  const [importing, setImporting] = useState(false);

  const canEdit = WRITE_ROLES.has(user?.role);

  useEffect(() => { getUser().then(setUser); }, []);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/forms/templates');
      setRows(data || []);
    } catch { /* silent */ }
    finally { setLoading(false); setRefreshing(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length };
    CATEGORIES.forEach((cat) => { if (cat.key !== 'all') c[cat.key] = 0; });
    rows.forEach((r) => { if (c[r.category] !== undefined) c[r.category]++; });
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((r) => filter === 'all' || r.category === filter)
      .filter((r) => !q || `${r.name} ${r.description || ''}`.toLowerCase().includes(q))
      .sort((a: any, b: any) => (a.name || '').localeCompare(b.name || ''));
  }, [rows, filter, search]);

  const removeTemplate = (t: any) => {
    Alert.alert('Delete Template', `Delete "${t.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try { await api.delete(`/forms/templates/${t.id}`); load(); }
        catch (e: any) { Alert.alert('Error', apiError(e)); }
      }},
    ]);
  };

  const exportAll = async () => {
    const payload = {
      app: 'Paneltec Civil', exported_at: new Date().toISOString(),
      count: rows.length,
      templates: rows.map((r: any) => ({ name: r.name, category: r.category, description: r.description, fields: r.fields })),
    };
    try {
      const fileUri = `${FileSystem.cacheDirectory}forms-export.json`;
      await FileSystem.writeAsStringAsync(fileUri, JSON.stringify(payload, null, 2));
      await Sharing.shareAsync(fileUri, { mimeType: 'application/json' });
    } catch { Alert.alert('Error', 'Could not export forms'); }
  };

  const filterLabel = filter === 'all'
    ? `All categories (${counts.all})`
    : `${(CATEGORIES.find((c) => c.key === filter)?.label || filter)} (${counts[filter] ?? 0})`;

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      {/* Header */}
      <View testID="forms-header" style={s.header}>
        <TouchableOpacity testID="forms-back" onPress={() => router.back()} style={{ padding: 4 }}>
          <Ionicons name="arrow-back" size={20} color="#1e4a8c" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle}>Form Templates</Text>
          <Text style={s.headerSub}>Choose a form to fill, build your own, or generate with AI</Text>
        </View>
      </View>

      {/* Toolbar */}
      <View style={s.toolbarRow}>
        {canEdit && (
          <TouchableOpacity testID="toolbar-import" style={s.toolBtn}
            onPress={() => setImporting(true)}>
            <Ionicons name="download-outline" size={14} color={Colors.ink} />
            <Text style={s.toolBtnText}>Import</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity testID="toolbar-export" style={s.toolBtn}
          onPress={exportAll} disabled={rows.length === 0}>
          <Ionicons name="share-outline" size={14} color={Colors.ink} />
          <Text style={s.toolBtnText}>Export</Text>
        </TouchableOpacity>
        {canEdit && (
          <TouchableOpacity testID="toolbar-ai" style={s.aiBtn}
            onPress={() => setAiOpen(true)}>
            <Ionicons name="sparkles" size={14} color="#fff" />
            <Text style={s.aiBtnText}>Build with AI</Text>
          </TouchableOpacity>
        )}
        {canEdit && (
          <TouchableOpacity testID="toolbar-new" style={s.newBtn}
            onPress={() => setBuilderTemplate({})}>
            <Ionicons name="add" size={14} color="#78350f" />
            <Text style={s.newBtnText}>New Template</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Search + filter */}
      <View style={s.filterRow}>
        <View style={s.searchBox}>
          <Ionicons name="search" size={14} color={Colors.textTertiary} />
          <TextInput testID="forms-search" style={s.searchInput}
            value={search} onChangeText={setSearch}
            placeholder="Search forms…" placeholderTextColor={Colors.textTertiary} />
        </View>
        <TouchableOpacity testID="filter-dropdown" style={s.dropdownBtn}
          onPress={() => setFilterOpen(true)}>
          <Text style={s.dropdownBtnText} numberOfLines={1}>{filterLabel}</Text>
          <Ionicons name="chevron-down" size={14} color={Colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* Cards */}
      <ScrollView style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing}
          onRefresh={() => { setRefreshing(true); load(); }} />}>
        {loading ? (
          <ActivityIndicator testID="forms-loading" style={{ marginTop: 40 }} color={Colors.blue} />
        ) : filtered.length === 0 ? (
          <View testID="forms-empty" style={s.empty}>
            <Ionicons name="document-text" size={32} color={Colors.textTertiary} />
            <Text style={s.emptyTitle}>No templates match</Text>
            <Text style={s.emptyHint}>Try a different category or clear the search.</Text>
          </View>
        ) : filtered.map((t) => {
          const cat = CAT_MAP[t.category] || CAT_MAP.general;
          return (
            <View key={t.id} testID={`template-card-${t.id}`} style={s.card}>
              {/* Top row: pill + icons */}
              <View style={s.cardTopRow}>
                <View style={[s.catBadge, { backgroundColor: cat.bg }]}>
                  <Text style={[s.catBadgeText, { color: cat.ink }]}>{cat.label}</Text>
                </View>
                <View style={{ flex: 1 }} />
                <TouchableOpacity testID={`card-icon-preview-${t.id}`}
                  style={s.iconBtn} onPress={() => setPreviewT(t)}>
                  <Ionicons name="phone-portrait-outline" size={14} color="#2563eb" />
                </TouchableOpacity>
                {canEdit && (
                  <TouchableOpacity testID={`card-icon-edit-${t.id}`}
                    style={s.iconBtn} onPress={() => setBuilderTemplate(t)}>
                    <Ionicons name="pencil" size={14} color="#475569" />
                  </TouchableOpacity>
                )}
                {canEdit && (
                  <TouchableOpacity testID={`card-icon-delete-${t.id}`}
                    style={s.iconBtn} onPress={() => removeTemplate(t)}>
                    <Ionicons name="trash-outline" size={14} color="#dc2626" />
                  </TouchableOpacity>
                )}
              </View>

              <Text style={s.cardName}>{t.name}</Text>
              <Text style={s.cardDesc} numberOfLines={2}>{t.description || '—'}</Text>

              {/* Meta */}
              <View style={s.metaRow}>
                <Text style={s.metaText}>{(t.fields || []).length} fields</Text>
                {(t.submission_count ?? 0) > 0 && (
                  <TouchableOpacity style={s.sentBadge}
                    onPress={() => router.push(`/forms/submissions/${t.id}`)}>
                    <Text style={s.sentBadgeText}>{t.submission_count} sent</Text>
                  </TouchableOpacity>
                )}
                {t.source === 'ai' && (
                  <View style={s.aiBadge}>
                    <Ionicons name="sparkles" size={9} color="#7c3aed" />
                    <Text style={s.aiBadgeText}>AI draft</Text>
                  </View>
                )}
              </View>

              {/* Bottom buttons */}
              <View style={s.cardBtns}>
                <TouchableOpacity testID={`card-preview-${t.id}`}
                  style={s.previewBtn} onPress={() => setPreviewT(t)}>
                  <Ionicons name="phone-portrait-outline" size={13} color="#2563eb" />
                  <Text style={s.previewBtnText}>Preview</Text>
                </TouchableOpacity>
                <TouchableOpacity testID={`card-fill-${t.id}`}
                  style={s.fillBtn}
                  onPress={() => router.push(`/forms/fill/${t.id}`)}>
                  <Ionicons name="pencil" size={13} color="#fff" />
                  <Text style={s.fillBtnText}>Fill This Form</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })}
      </ScrollView>

      {/* Filter modal */}
      <Modal visible={filterOpen} transparent animationType="fade"
        onRequestClose={() => setFilterOpen(false)}>
        <TouchableOpacity style={s.overlay} activeOpacity={1}
          onPress={() => setFilterOpen(false)}>
          <View style={s.pickerBox}>
            <Text style={s.pickerTitle}>Filter by category</Text>
            {CATEGORIES.map((c) => (
              <TouchableOpacity key={c.key} testID={`filter-opt-${c.key}`}
                style={[s.pickerItem, filter === c.key && { backgroundColor: '#f1f5f9' }]}
                onPress={() => { setFilter(c.key); setFilterOpen(false); }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  {c.key !== 'all' && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.bg }} />}
                  <Text style={s.pickerItemText}>{c.label}</Text>
                </View>
                <Text style={s.pickerCount}>{counts[c.key] ?? 0}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Modals */}
      {importing && <ImportModal onClose={() => setImporting(false)} onImported={load} />}
      {previewT && (
        <PreviewModal template={previewT} onClose={() => setPreviewT(null)}
          onFill={() => { router.push(`/forms/fill/${previewT.id}`); setPreviewT(null); }} />
      )}
      {aiOpen && (
        <AiBuilderModal onClose={() => setAiOpen(false)}
          onCreated={(t: any) => { load(); setBuilderTemplate(t); }} />
      )}
      {builderTemplate !== null && (
        <TemplateBuilder template={builderTemplate}
          onClose={() => setBuilderTemplate(null)} onSaved={() => load()} />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingVertical: 14,
    backgroundColor: '#e6eff9', borderBottomWidth: 1, borderBottomColor: '#b9d2ec',
  },
  headerTitle: { fontSize: 22, fontWeight: '800', color: Colors.ink, letterSpacing: -0.3 },
  headerSub: { fontSize: 11, color: '#1e4a8c', marginTop: 2, opacity: 0.8 },
  toolbarRow: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, paddingVertical: 10, gap: 8, alignItems: 'center' },
  toolBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 16,
    borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.white,
  },
  toolBtnText: { fontSize: 12, fontWeight: '600', color: Colors.ink },
  aiBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 16, backgroundColor: '#9333ea',
  },
  aiBtnText: { fontSize: 12, fontWeight: '700', color: '#fff' },
  newBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 16, backgroundColor: '#f59e0b',
  },
  newBtnText: { fontSize: 12, fontWeight: '700', color: '#78350f' },
  filterRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingBottom: 8,
  },
  searchBox: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 12, paddingHorizontal: 12,
  },
  searchInput: { flex: 1, paddingVertical: 10, fontSize: 13, color: Colors.text },
  dropdownBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.white, maxWidth: 180,
  },
  dropdownBtnText: { fontSize: 12, fontWeight: '600', color: Colors.ink },
  card: {
    backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 18, padding: 16, marginBottom: 12,
  },
  cardTopRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  catBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 14 },
  catBadgeText: { fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  iconBtn: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  cardName: { fontSize: 18, fontWeight: '800', color: Colors.ink, letterSpacing: -0.2 },
  cardDesc: { fontSize: 13, color: Colors.textSecondary, marginTop: 4, lineHeight: 18 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  metaText: { fontSize: 11, color: Colors.textTertiary },
  sentBadge: { backgroundColor: '#ecfdf5', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  sentBadgeText: { fontSize: 10, fontWeight: '700', color: '#047857', textTransform: 'uppercase', letterSpacing: 0.5 },
  aiBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#f5f3ff', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  aiBadgeText: { fontSize: 10, fontWeight: '700', color: '#7c3aed', textTransform: 'uppercase', letterSpacing: 0.5 },
  cardBtns: { flexDirection: 'row', gap: 8, marginTop: 14 },
  previewBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: 12, borderWidth: 2, borderColor: '#bfdbfe', backgroundColor: '#fff', minHeight: 48,
  },
  previewBtnText: { fontSize: 13, fontWeight: '600', color: '#2563eb' },
  fillBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: 12, backgroundColor: '#1e293b', minHeight: 48,
  },
  fillBtnText: { fontSize: 13, fontWeight: '600', color: '#fff' },
  empty: { alignItems: 'center', paddingTop: 60, gap: 6 },
  emptyTitle: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary },
  emptyHint: { fontSize: 12, color: Colors.textTertiary },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  pickerBox: { backgroundColor: Colors.white, borderRadius: 20, padding: 16, width: '100%', maxWidth: 320 },
  pickerTitle: { fontSize: 16, fontWeight: '700', color: Colors.ink, marginBottom: 8 },
  pickerItem: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 12, paddingHorizontal: 8, borderRadius: 10,
  },
  pickerItemText: { fontSize: 14, color: Colors.text, fontWeight: '500' },
  pickerCount: { fontSize: 12, color: Colors.textTertiary },
});
