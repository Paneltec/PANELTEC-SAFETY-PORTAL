import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  RefreshControl, ActivityIndicator, Alert, TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as Linking from 'expo-linking';
import api, { API_BASE, apiError } from '../src/lib/api';
import { getUser, getToken } from '../src/lib/auth';
import { Colors } from '../src/lib/colors';

const WRITE_ROLES = new Set(['admin', 'hseq_lead']);
const DELETE_FOLDER_ROLES = new Set(['admin']);

const PASTEL_BG: Record<string, string> = {
  mint: '#e8f3eb', sky: '#e6eff9', peach: '#fbeadf', blush: '#fbe4e7',
  lavender: '#ece6f4', butter: '#fbf3df', sage: '#e8efe2', coral: '#fbe4dc',
  lilac: '#efe7f7', slate: '#F1F5F9',
};
const PASTEL_ICON: Record<string, string> = {
  mint: '#1f7a3f', sky: '#1e4a8c', peach: '#a8480f', blush: '#a8324c',
  lavender: '#4f3a8c', butter: '#8c6a1a', sage: '#2e5e2e', coral: '#a83a2e',
  lilac: '#6e3aa6', slate: '#475569',
};

function humanSize(n: number | undefined) {
  if (!n && n !== 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DocumentLibraryScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ folderId?: string }>();
  const folderId = params.folderId;
  const [user, setUser] = useState<any>(null);
  const canEdit = WRITE_ROLES.has(user?.role);
  const canDeleteFolder = DELETE_FOLDER_ROLES.has(user?.role);

  useEffect(() => { getUser().then(setUser); }, []);

  if (folderId) return <FolderDetail folderId={folderId} user={user} canEdit={canEdit} />;
  return <FolderGrid user={user} canEdit={canEdit} canDeleteFolder={canDeleteFolder} />;
}

/* ─── Folder Grid ─── */
function FolderGrid({ user, canEdit, canDeleteFolder }: any) {
  const router = useRouter();
  const [folders, setFolders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState<any>(null);
  const [searchBusy, setSearchBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.get('/document-library/folders')
      .then((r) => setFolders(r.data || []))
      .catch((e) => Alert.alert('Error', apiError(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return folders;
    return folders.filter((f) => f.name.toLowerCase().includes(q));
  }, [folders, filter]);

  const saveCreate = async () => {
    if (!newName.trim()) return;
    setBusy(true);
    try {
      await api.post('/document-library/folders', { name: newName.trim() });
      Alert.alert('Created', 'Folder created');
      setCreating(false); setNewName('');
      load();
    } catch (e) { Alert.alert('Error', apiError(e)); }
    finally { setBusy(false); }
  };

  const deleteFolder = (f: any) => {
    Alert.alert('Delete folder', `Delete "${f.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try { await api.delete(`/document-library/folders/${f.id}`); Alert.alert('Deleted'); load(); }
        catch (e) { Alert.alert('Error', apiError(e)); }
      }},
    ]);
  };

  const runSearch = async () => {
    const q = searchQ.trim();
    if (!q) { setSearchResults(null); return; }
    setSearchBusy(true);
    try {
      const { data } = await api.get('/document-library/search', { params: { q } });
      setSearchResults(data);
    } catch (e) { Alert.alert('Error', apiError(e)); }
    finally { setSearchBusy(false); }
  };

  return (
    <SafeAreaView style={ds.safe}>
      <ScrollView testID="document-library-page" style={ds.scroll} contentContainerStyle={ds.content}>
        <TouchableOpacity testID="doclib-back-btn" onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/settings')} style={ds.navBack}>
          <Ionicons name="arrow-back" size={20} color="#1e4a8c" />
          <Text style={ds.navBackText}>Back</Text>
        </TouchableOpacity>
        <Text style={ds.overline}>COMPLIANCE</Text>
        <Text style={ds.heading}>Document Library</Text>
        <Text style={ds.sub}>All your Risk & Compliance documents.</Text>

        {/* AI Search */}
        <View testID="smart-search-panel" style={ds.searchPanel}>
          <View style={ds.searchPanelHeader}>
            <Ionicons name="sparkles" size={12} color="#8c6a1a" />
            <Text style={ds.searchPanelLabel}>AI SMART SEARCH</Text>
          </View>
          <View style={ds.searchPanelRow}>
            <TextInput testID="smart-search-input" style={ds.searchPanelInput}
              placeholder="e.g. 'PPE requirements'" placeholderTextColor={Colors.textTertiary}
              value={searchQ} onChangeText={setSearchQ} onSubmitEditing={runSearch} />
            <TouchableOpacity testID="smart-search-submit" style={ds.searchPanelBtn} onPress={runSearch} disabled={searchBusy}>
              {searchBusy ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="search" size={14} color="#fff" />}
            </TouchableOpacity>
          </View>
          {searchResults && (
            <View testID="smart-search-results" style={ds.searchResults}>
              <Text style={ds.searchResultCount}>{searchResults.count} match{searchResults.count === 1 ? '' : 'es'}</Text>
              {(searchResults.results || []).map((r: any) => (
                <TouchableOpacity key={r.id} style={ds.searchResultRow}
                  onPress={() => router.push(`/document-library?folderId=${r.folder?.id || ''}`)}>
                  <Ionicons name="document-text" size={14} color={Colors.textTertiary} />
                  <View style={{ flex: 1 }}>
                    <Text style={ds.searchResultFile} numberOfLines={1}>{r.filename}</Text>
                    <Text style={ds.searchResultFolder}>in {r.folder?.name || 'Unknown'} · {humanSize(r.size)}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        {/* Filter + create */}
        <View style={ds.toolbar}>
          <View style={ds.filterRow}>
            <Ionicons name="search" size={14} color={Colors.textTertiary} />
            <TextInput testID="folder-filter-input" style={ds.filterInput}
              placeholder="Filter folders..." placeholderTextColor={Colors.textTertiary}
              value={filter} onChangeText={setFilter} />
          </View>
          {canEdit && (
            <TouchableOpacity testID="folder-create-btn" style={ds.createBtn} onPress={() => setCreating(true)}>
              <Ionicons name="add" size={16} color="#fff" />
              <Text style={ds.createBtnText}>New folder</Text>
            </TouchableOpacity>
          )}
        </View>

        {creating && (
          <View testID="folder-create-form" style={ds.createForm}>
            <TextInput testID="folder-create-input" style={ds.createInput} autoFocus
              placeholder="Folder name" value={newName} onChangeText={setNewName}
              onSubmitEditing={saveCreate} />
            <TouchableOpacity testID="folder-create-save" style={ds.smallPrimaryBtn} onPress={saveCreate} disabled={busy}>
              {busy ? <ActivityIndicator size="small" color="#fff" /> : <Text style={ds.smallBtnText}>Create</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={ds.smallGhostBtn} onPress={() => { setCreating(false); setNewName(''); }}>
              <Text style={ds.smallGhostText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Folder grid */}
        {loading ? <ActivityIndicator style={{ marginTop: 30 }} color={Colors.blue} /> :
         filtered.length === 0 ? (
          <View style={ds.emptyBox}>
            <Ionicons name="folder-open" size={28} color={Colors.textTertiary} />
            <Text style={ds.emptyTitle}>No folders</Text>
          </View>
        ) : (
          <View testID="folder-grid" style={ds.grid}>
            {filtered.map((f) => {
              const bg = PASTEL_BG[f.color_key] || PASTEL_BG.sky;
              const ic = PASTEL_ICON[f.color_key] || PASTEL_ICON.sky;
              return (
                <TouchableOpacity key={f.id} testID={`folder-card-${f.id}`}
                  style={[ds.folderCard, { backgroundColor: bg }]}
                  onPress={() => router.push(`/document-library?folderId=${f.id}`)}
                  onLongPress={() => canDeleteFolder && !f.is_system ? deleteFolder(f) : undefined}
                  activeOpacity={0.7}>
                  <Ionicons name="folder-open" size={24} color={ic} />
                  <Text style={ds.folderName} numberOfLines={2}>{f.name}</Text>
                  <Text style={ds.folderCount}>{f.file_count} {f.file_count === 1 ? 'file' : 'files'}</Text>
                  {f.is_system && <Text style={ds.systemBadge}>System</Text>}
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/* ─── Folder Detail ─── */
function FolderDetail({ folderId, user, canEdit }: any) {
  const router = useRouter();
  const [folder, setFolder] = useState<any>(null);
  const [files, setFiles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    try {
      const [foldersRes, filesRes] = await Promise.all([
        api.get('/document-library/folders'),
        api.get(`/document-library/folders/${folderId}/files`),
      ]);
      const match = (foldersRes.data || []).find((f: any) => f.id === folderId);
      setFolder(match || { name: 'Folder' });
      setFiles(filesRes.data || []);
    } catch (e) { Alert.alert('Error', apiError(e)); }
    finally { setLoading(false); }
  }, [folderId]);

  useEffect(() => { loadFiles(); }, [loadFiles]);

  const pickAndUpload = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'image/png', 'image/jpeg', 'text/plain', 'text/csv'],
        multiple: true,
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.length) return;
      setUploading(true);
      const formData = new FormData();
      for (const asset of result.assets) {
        formData.append('files', { uri: asset.uri, name: asset.name, type: asset.mimeType || 'application/octet-stream' } as any);
      }
      const { data } = await api.post(`/document-library/folders/${folderId}/files`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const ok = (data.saved || []).length;
      const rejected = data.rejected || [];
      if (ok) Alert.alert('Uploaded', `${ok} file${ok === 1 ? '' : 's'} uploaded`);
      rejected.forEach((r: any) => Alert.alert('Rejected', `${r.filename}: ${r.reason}`));
      await loadFiles();
    } catch (e: any) { Alert.alert('Error', apiError(e)); }
    finally { setUploading(false); }
  };

  const deleteFile = (f: any) => {
    Alert.alert('Delete file', `Delete "${f.filename}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try { await api.delete(`/document-library/files/${f.id}`); loadFiles(); }
        catch (e) { Alert.alert('Error', apiError(e)); }
      }},
    ]);
  };

  const downloadFile = async (f: any) => {
    try {
      const token = await getToken();
      const url = `${API_BASE}/document-library/files/${f.id}/download`;
      await Linking.openURL(`${url}?token=${token}`);
    } catch {
      Alert.alert('Error', 'Could not download file');
    }
  };

  return (
    <SafeAreaView style={ds.safe}>
      <ScrollView testID="document-folder-page" style={ds.scroll} contentContainerStyle={ds.content}>
        <TouchableOpacity testID="folder-back-btn" style={ds.backBtn} onPress={() => router.push('/document-library')}>
          <Ionicons name="arrow-back" size={16} color={Colors.blue} />
          <Text style={ds.backText}>Document Library</Text>
        </TouchableOpacity>

        <View style={ds.folderHeader}>
          <View style={{ flex: 1 }}>
            <Text style={ds.heading}>{folder?.name || 'Loading...'}</Text>
            <Text style={ds.sub}>{files.length} file{files.length === 1 ? '' : 's'}</Text>
          </View>
          {canEdit && (
            <TouchableOpacity testID="folder-upload-btn" style={ds.uploadBtn} onPress={pickAndUpload} disabled={uploading}>
              {uploading ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="cloud-upload" size={14} color="#fff" />}
              <Text style={ds.uploadBtnText}>Upload</Text>
            </TouchableOpacity>
          )}
        </View>

        {loading ? <ActivityIndicator style={{ marginTop: 30 }} color={Colors.blue} /> :
         files.length === 0 ? (
          <View style={ds.emptyBox}>
            <Ionicons name="document" size={28} color={Colors.textTertiary} />
            <Text style={ds.emptyTitle}>This folder is empty</Text>
            <Text style={ds.emptyBody}>{canEdit ? 'Upload files with the button above.' : 'Files will appear here once uploaded.'}</Text>
          </View>
        ) : files.map((f) => (
          <View key={f.id} testID={`file-row-${f.id}`} style={ds.fileRow}>
            <Ionicons name={f.mime?.startsWith('image/') ? 'image' : f.mime?.includes('pdf') ? 'document-text' : 'document'} size={18} color={Colors.textTertiary} />
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={ds.fileName} numberOfLines={1}>{f.filename}</Text>
              <Text style={ds.fileMeta}>{humanSize(f.size)} · {(f.uploaded_at || '').slice(0, 10)}</Text>
              {(f.ai_tags || []).length > 0 && (
                <View style={ds.tagRow}>
                  {f.ai_tags.slice(0, 3).map((t: string) => (
                    <View key={t} style={ds.aiTag}><Text style={ds.aiTagText}>{t}</Text></View>
                  ))}
                </View>
              )}
            </View>
            <TouchableOpacity testID={`file-download-${f.id}`} style={ds.fileAction} onPress={() => downloadFile(f)}>
              <Ionicons name="download" size={16} color={Colors.blue} />
            </TouchableOpacity>
            {canEdit && (
              <TouchableOpacity testID={`file-delete-${f.id}`} style={ds.fileAction} onPress={() => deleteFile(f)}>
                <Ionicons name="trash" size={16} color={Colors.textTertiary} />
              </TouchableOpacity>
            )}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const ds = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 32 },
  overline: { fontSize: 10, fontWeight: '700', letterSpacing: 1.5, color: Colors.blue },
  heading: { fontSize: 26, fontWeight: '700', color: Colors.ink, marginTop: 4, letterSpacing: -0.5 },
  sub: { fontSize: 13, color: Colors.textSecondary, marginTop: 4 },
  searchPanel: { marginTop: 14, borderRadius: 16, borderWidth: 1, borderColor: '#e6d99c', backgroundColor: '#fbf3df', padding: 12, marginBottom: 14 },
  searchPanelHeader: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 8 },
  searchPanelLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1.2, color: '#8c6a1a' },
  searchPanelRow: { flexDirection: 'row', gap: 8 },
  searchPanelInput: { flex: 1, backgroundColor: Colors.white, borderWidth: 1, borderColor: '#e6d99c', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, color: Colors.text },
  searchPanelBtn: { width: 40, borderRadius: 10, backgroundColor: '#8c6a1a', alignItems: 'center', justifyContent: 'center' },
  searchResults: { marginTop: 10 },
  searchResultCount: { fontSize: 11, color: '#8c6a1a', marginBottom: 6 },
  searchResultRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.white, borderWidth: 1, borderColor: '#f0e6c6', borderRadius: 10, padding: 8, marginBottom: 4 },
  searchResultFile: { fontSize: 13, fontWeight: '500', color: Colors.ink },
  searchResultFolder: { fontSize: 11, color: Colors.textTertiary },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  filterRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  filterInput: { flex: 1, fontSize: 14, color: Colors.text, padding: 0 },
  createBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.blue, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  createBtnText: { fontSize: 12, fontWeight: '600', color: '#fff' },
  createForm: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14, backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.blue, borderRadius: 12, padding: 10 },
  createInput: { flex: 1, fontSize: 14, color: Colors.text, borderWidth: 1, borderColor: Colors.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  smallPrimaryBtn: { backgroundColor: Colors.blue, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  smallBtnText: { fontSize: 12, fontWeight: '600', color: '#fff' },
  smallGhostBtn: { borderWidth: 1, borderColor: Colors.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  smallGhostText: { fontSize: 12, color: Colors.textSecondary },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  folderCard: { width: '47%', borderRadius: 14, borderWidth: 1, borderColor: '#E2E8F0', padding: 14, minHeight: 100 },
  folderName: { fontSize: 13, fontWeight: '600', color: Colors.ink, marginTop: 6, lineHeight: 18, minHeight: 36 },
  folderCount: { fontSize: 11, color: Colors.textTertiary, marginTop: 4 },
  systemBadge: { position: 'absolute', top: 6, right: 6, fontSize: 8, fontWeight: '700', color: Colors.textTertiary, backgroundColor: 'rgba(255,255,255,0.8)', paddingHorizontal: 4, paddingVertical: 1, borderRadius: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
  emptyBox: { alignItems: 'center', justifyContent: 'center', paddingVertical: 48 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: Colors.ink, marginTop: 10 },
  emptyBody: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center', marginTop: 4, maxWidth: 280 },
  // Folder detail
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 12 },
  backText: { fontSize: 13, fontWeight: '600', color: Colors.blue },
  folderHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  uploadBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.blue, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  uploadBtnText: { fontSize: 12, fontWeight: '600', color: '#fff' },
  fileRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: 12, padding: 12, marginBottom: 6 },
  fileName: { fontSize: 14, fontWeight: '500', color: Colors.ink },
  fileMeta: { fontSize: 11, color: Colors.textTertiary, marginTop: 2 },
  tagRow: { flexDirection: 'row', gap: 4, marginTop: 4 },
  aiTag: { backgroundColor: '#ece6f4', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  aiTagText: { fontSize: 9, fontWeight: '700', color: '#4f3a8c', textTransform: 'uppercase', letterSpacing: 0.5 },
  fileAction: { padding: 8 },
  navBack: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8, paddingVertical: 4 },
  navBackText: { fontSize: 14, fontWeight: '600', color: '#1e4a8c' },
});
