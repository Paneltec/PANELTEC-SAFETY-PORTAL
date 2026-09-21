/**
 * Docs tab — v58.13.132js
 * Document library with folder navigation.
 * .132js — error-state UI + focus refetch + session expiry redirect.
 * GET /api/document-library/folders → folder list
 * GET /api/document-library/folders/{id}/files → files in folder
 * GET /api/document-library/folders/{id}/subfolders → subfolders
 */
import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  RefreshControl, ActivityIndicator, TextInput, Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Colors } from '../../src/theme/colors';
import { authGet } from '../../src/services/apiClient';
import { clearSession } from '../../src/services/auth';
import { useRouter, useFocusEffect } from 'expo-router';
import { folderIcon } from '../../src/lib/folderIcons';

interface DocFolder {
  id: string;
  name: string;
  parent_id?: string | null;
  file_count?: number;
  subfolder_count?: number;
  [key: string]: unknown;
}

interface DocFile {
  id: string;
  file_id?: string;
  name: string;
  filename?: string;
  mime_type?: string;
  file_size?: number;
  uploaded_at?: string;
  url?: string;
  [key: string]: unknown;
}

async function fetchRootFolders(): Promise<DocFolder[]> {
  const res = await authGet<DocFolder[] | { folders: DocFolder[] }>('/api/document-library/folders');
  if (res.ok) {
    const d = res.data;
    return Array.isArray(d) ? d : (d as { folders: DocFolder[] }).folders || [];
  }
  if ('expired' in res && res.expired) throw new Error('SESSION_EXPIRED');
  throw new Error('error' in res ? res.error : 'Failed to load folders');
}

async function fetchSubfolders(folderId: string): Promise<DocFolder[]> {
  const res = await authGet<DocFolder[] | { subfolders: DocFolder[] }>(
    `/api/document-library/folders/${folderId}/subfolders`
  );
  if (res.ok) {
    const d = res.data;
    return Array.isArray(d) ? d : (d as { subfolders: DocFolder[] }).subfolders || [];
  }
  if ('expired' in res && res.expired) throw new Error('SESSION_EXPIRED');
  return [];
}

async function fetchFiles(folderId: string): Promise<DocFile[]> {
  const res = await authGet<DocFile[] | { files: DocFile[] }>(
    `/api/document-library/folders/${folderId}/files`
  );
  if (res.ok) {
    const d = res.data;
    return Array.isArray(d) ? d : (d as { files: DocFile[] }).files || [];
  }
  if ('expired' in res && res.expired) throw new Error('SESSION_EXPIRED');
  return [];
}

const FILE_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  pdf: 'document-text',
  doc: 'document',
  docx: 'document',
  xls: 'grid',
  xlsx: 'grid',
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
  csv: 'grid',
  txt: 'reader',
};

function getFileIcon(name: string): keyof typeof Ionicons.glyphMap {
  const ext = (name || '').split('.').pop()?.toLowerCase() || '';
  return FILE_ICONS[ext] || 'document-outline';
}

function formatSize(bytes?: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

export default function DocsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [breadcrumb, setBreadcrumb] = useState<{ id: string; name: string }[]>([]);
  const [search, setSearch] = useState('');

  const currentFolderId = breadcrumb.length > 0 ? breadcrumb[breadcrumb.length - 1].id : null;

  const { data: rootFolders, isLoading: rootLoading, isError: rootIsError, refetch: refetchRoot, isRefetching: rootRefreshing, error: rootError } = useQuery<DocFolder[]>({
    queryKey: ['doc-folders-root'],
    queryFn: fetchRootFolders,
    staleTime: 60_000,
    retry: (failureCount, err) => {
      if (err?.message === 'SESSION_EXPIRED') return false;
      return failureCount < 2;
    },
  });

  const { data: subfolders, isLoading: subLoading, isError: subIsError, error: subError, refetch: refetchSub, isRefetching: subRefreshing } = useQuery<DocFolder[]>({
    queryKey: ['doc-subfolders', currentFolderId],
    queryFn: () => fetchSubfolders(currentFolderId!),
    enabled: !!currentFolderId,
    staleTime: 60_000,
    retry: (failureCount, err) => {
      if (err?.message === 'SESSION_EXPIRED') return false;
      return failureCount < 2;
    },
  });

  const { data: files, isLoading: filesLoading, isError: filesIsError, error: filesError, refetch: refetchFiles, isRefetching: filesRefreshing } = useQuery<DocFile[]>({
    queryKey: ['doc-files', currentFolderId],
    queryFn: () => fetchFiles(currentFolderId!),
    enabled: !!currentFolderId,
    staleTime: 60_000,
    retry: (failureCount, err) => {
      if (err?.message === 'SESSION_EXPIRED') return false;
      return failureCount < 2;
    },
  });

  // Refetch root when tab gains focus (tabs don't unmount)
  useFocusEffect(
    useCallback(() => {
      refetchRoot();
    }, [refetchRoot]),
  );

  const handleExpired = useCallback(async () => {
    await clearSession();
    router.replace('/(auth)/pin-entry');
  }, [router]);

  const isRoot = !currentFolderId;
  const folders = isRoot ? rootFolders : subfolders;
  const isLoading = isRoot ? rootLoading : (subLoading || filesLoading);
  const isRefreshing = isRoot ? rootRefreshing : (subRefreshing || filesRefreshing);

  // Unified error detection across all queries
  const anySessionExpired = [rootError, subError, filesError].some(e => e?.message === 'SESSION_EXPIRED');
  const hasNonSessionError = isRoot
    ? (rootIsError && rootError?.message !== 'SESSION_EXPIRED')
    : ((subIsError && subError?.message !== 'SESSION_EXPIRED') || (filesIsError && filesError?.message !== 'SESSION_EXPIRED'));
  const activeErrorMsg = isRoot
    ? rootError?.message
    : (subError?.message || filesError?.message);

  const onRefresh = useCallback(async () => {
    if (isRoot) await refetchRoot();
    else {
      await Promise.all([refetchSub(), refetchFiles()]);
    }
  }, [isRoot, refetchRoot, refetchSub, refetchFiles]);

  const filteredFolders = useMemo(() => {
    if (!folders || !search.trim()) return folders || [];
    const q = search.toLowerCase();
    return folders.filter(f => f.name.toLowerCase().includes(q));
  }, [folders, search]);

  const filteredFiles = useMemo(() => {
    if (!files || !search.trim()) return files || [];
    const q = search.toLowerCase();
    return files.filter(f => (f.name || f.filename || '').toLowerCase().includes(q));
  }, [files, search]);

  type ListItem =
    | { type: 'folder'; data: DocFolder }
    | { type: 'file'; data: DocFile };

  const listData: ListItem[] = useMemo(() => {
    const items: ListItem[] = [];
    for (const f of filteredFolders) items.push({ type: 'folder', data: f });
    if (!isRoot) {
      for (const f of filteredFiles) items.push({ type: 'file', data: f });
    }
    return items;
  }, [filteredFolders, filteredFiles, isRoot]);

  // Handle session expiry AFTER all hooks
  if (anySessionExpired) {
    handleExpired();
    return null;
  }

  const navigateToFolder = (folder: DocFolder) => {
    setBreadcrumb(prev => [...prev, { id: folder.id, name: folder.name }]);
    setSearch('');
  };

  const navigateBack = () => {
    setBreadcrumb(prev => prev.slice(0, -1));
    setSearch('');
  };

  const navigateToBreadcrumb = (index: number) => {
    setBreadcrumb(prev => prev.slice(0, index + 1));
    setSearch('');
  };

  const handleFilePress = (file: DocFile) => {
    if (file.url) {
      const baseUrl = process.env.EXPO_PUBLIC_BACKEND_URL || '';
      const fullUrl = file.url.startsWith('http') ? file.url : `${baseUrl}${file.url}`;
      Linking.openURL(fullUrl);
    }
  };

  const renderItem = ({ item }: { item: ListItem }) => {
    if (item.type === 'folder') {
      const folder = item.data;
      const fi = folderIcon(folder.name);
      return (
        <TouchableOpacity
          testID={`doc-folder-${folder.id}`}
          style={st.row}
          onPress={() => navigateToFolder(folder)}
          activeOpacity={0.7}
        >
          <View style={[st.folderIcon, { backgroundColor: fi.tint + '18' }]}>
            <Ionicons name={fi.icon} size={22} color={fi.tint} />
          </View>
          <View style={st.rowInfo}>
            <Text style={st.rowName} numberOfLines={1}>{folder.name}</Text>
            {folder.file_count != null && (
              <Text style={st.rowMeta}>{folder.file_count} file{folder.file_count !== 1 ? 's' : ''}</Text>
            )}
          </View>
          <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />
        </TouchableOpacity>
      );
    }
    const file = item.data;
    const fname = file.name || file.filename || 'Unknown';
    return (
      <TouchableOpacity
        testID={`doc-file-${file.id || file.file_id}`}
        style={st.row}
        onPress={() => handleFilePress(file)}
        activeOpacity={0.7}
      >
        <View style={st.fileIcon}>
          <Ionicons name={getFileIcon(fname)} size={20} color={Colors.info} />
        </View>
        <View style={st.rowInfo}>
          <Text style={st.rowName} numberOfLines={1}>{fname}</Text>
          <Text style={st.rowMeta}>
            {[formatSize(file.file_size), file.uploaded_at ? new Date(file.uploaded_at).toLocaleDateString() : ''].filter(Boolean).join(' · ')}
          </Text>
        </View>
        <Ionicons name="open-outline" size={16} color={Colors.textTertiary} />
      </TouchableOpacity>
    );
  };

  return (
    <View testID="docs-screen" style={[st.container, { paddingTop: insets.top }]}>
      <View style={st.header}>
        <View style={st.headerRow}>
          {!isRoot && (
            <TouchableOpacity testID="docs-back" onPress={navigateBack} style={st.backBtn}>
              <Ionicons name="chevron-back" size={24} color={Colors.white} />
            </TouchableOpacity>
          )}
          <View style={{ flex: 1 }}>
            <Text testID="docs-title" style={st.headerTitle}>
              {isRoot ? 'Documents' : breadcrumb[breadcrumb.length - 1].name}
            </Text>
            {isRoot && (
              <Text style={st.headerSub}>Document library</Text>
            )}
          </View>
        </View>
        {/* Breadcrumb */}
        {breadcrumb.length > 0 && (
          <View style={st.breadcrumb}>
            <TouchableOpacity onPress={() => setBreadcrumb([])}>
              <Text style={st.breadcrumbItem}>Root</Text>
            </TouchableOpacity>
            {breadcrumb.map((b, i) => (
              <React.Fragment key={b.id}>
                <Ionicons name="chevron-forward" size={12} color="rgba(255,255,255,0.35)" />
                <TouchableOpacity onPress={() => navigateToBreadcrumb(i)}>
                  <Text style={[st.breadcrumbItem, i === breadcrumb.length - 1 && st.breadcrumbActive]}>
                    {b.name}
                  </Text>
                </TouchableOpacity>
              </React.Fragment>
            ))}
          </View>
        )}
      </View>

      <View style={st.searchWrap}>
        <Ionicons name="search-outline" size={18} color={Colors.textTertiary} />
        <TextInput
          testID="docs-search-input"
          style={st.searchInput}
          placeholder={isRoot ? 'Search folders...' : 'Search in this folder...'}
          placeholderTextColor={Colors.textTertiary}
          value={search}
          onChangeText={setSearch}
          returnKeyType="search"
          autoCorrect={false}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')}>
            <Ionicons name="close-circle" size={18} color={Colors.textTertiary} />
          </TouchableOpacity>
        )}
      </View>

      {isLoading ? (
        <View style={st.center}>
          <ActivityIndicator size="large" color={Colors.orange} />
          <Text style={st.loadingText}>Loading documents...</Text>
        </View>
      ) : hasNonSessionError && !folders?.length ? (
        <View testID="docs-error" style={st.center}>
          <Ionicons name="cloud-offline-outline" size={48} color={Colors.error} />
          <Text style={st.errorTitle}>Failed to load documents</Text>
          <Text style={st.errorText}>{activeErrorMsg || 'Network error — check your connection'}</Text>
          <TouchableOpacity testID="docs-retry-btn" style={st.retryBtn} onPress={onRefresh} activeOpacity={0.7}>
            <Ionicons name="refresh" size={18} color={Colors.white} />
            <Text style={st.retryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : listData.length === 0 ? (
        <View style={st.center}>
          <Ionicons name="folder-open-outline" size={48} color={Colors.textTertiary} />
          <Text style={st.emptyTitle}>{search ? 'No matches' : 'Empty folder'}</Text>
          <Text style={st.emptyText}>
            {search ? `Nothing matches "${search}"` : 'No documents in this location'}
          </Text>
        </View>
      ) : (
        <FlatList
          testID="docs-list"
          data={listData}
          keyExtractor={(item, i) => {
            if (item.type === 'folder') return `f-${item.data.id}`;
            return `d-${item.data.id || item.data.file_id || i}`;
          }}
          renderItem={renderItem}
          contentContainerStyle={st.listContent}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={onRefresh}
              tintColor={Colors.orange}
              colors={[Colors.orange]}
            />
          }
          ItemSeparatorComponent={() => <View style={{ height: 4 }} />}
        />
      )}
    </View>
  );
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.navyLight },
  header: { backgroundColor: Colors.navy, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 14 },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  backBtn: { padding: 4, marginRight: 8 },
  headerTitle: { color: Colors.white, fontSize: 26, fontWeight: '800' },
  headerSub: { color: 'rgba(255,255,255,0.5)', fontSize: 14, fontWeight: '500', marginTop: 2 },
  breadcrumb: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    marginTop: 8, flexWrap: 'wrap',
  },
  breadcrumbItem: { fontSize: 12, color: 'rgba(255,255,255,0.5)', fontWeight: '500' },
  breadcrumbActive: { color: 'rgba(255,255,255,0.9)', fontWeight: '700' },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.surface, borderRadius: 14,
    marginHorizontal: 16, marginTop: 12, marginBottom: 8,
    paddingHorizontal: 14, paddingVertical: 12,
    borderWidth: 1, borderColor: Colors.border,
  },
  searchInput: { flex: 1, fontSize: 16, color: Colors.ink, padding: 0 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 32 },
  loadingText: { fontSize: 15, color: 'rgba(255,255,255,0.7)' },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: Colors.white },
  emptyText: { fontSize: 14, color: 'rgba(255,255,255,0.55)', textAlign: 'center' },

  // Error state
  errorTitle: { fontSize: 18, fontWeight: '700', color: Colors.white, marginTop: 8 },
  errorText: { fontSize: 14, color: 'rgba(255,255,255,0.55)', textAlign: 'center' },
  retryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.orange, borderRadius: 12,
    paddingHorizontal: 24, paddingVertical: 14, marginTop: 16,
    minHeight: 48,
  },
  retryBtnText: { color: Colors.white, fontSize: 16, fontWeight: '700' },
  listContent: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.surface, borderRadius: 14, padding: 16,
    minHeight: 64,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03, shadowRadius: 3, elevation: 1,
  },
  folderIcon: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: '#FEF3C7', alignItems: 'center', justifyContent: 'center',
  },
  fileIcon: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: Colors.infoSoft, alignItems: 'center', justifyContent: 'center',
  },
  rowInfo: { flex: 1 },
  rowName: { fontSize: 15, fontWeight: '600', color: Colors.ink },
  rowMeta: { fontSize: 13, color: Colors.textTertiary, marginTop: 2 },
});
