/**
 * PickerModal — Reusable full-screen modal for search + pick from a list.
 * Used by all 7 picker field types in the form runner.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Modal, View, Text, TextInput, FlatList, TouchableOpacity,
  ActivityIndicator, StyleSheet, SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../theme/colors';

interface PickerModalProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  fetchItems: (query: string) => Promise<any[]>;
  renderRow: (item: any) => React.ReactNode;
  onPick: (item: any) => void;
  topSlot?: React.ReactNode;
  pinnedRow?: React.ReactNode;
  keyExtractor?: (item: any) => string;
  selectedIds?: Set<string>;
}

export default function PickerModal({
  visible, onClose, title, fetchItems, renderRow, onPick,
  topSlot, pinnedRow, keyExtractor, selectedIds,
}: PickerModalProps) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<TextInput>(null);

  // Fetch on open and when query changes (debounced)
  const doFetch = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const results = await fetchItems(q);
      setItems(results);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [fetchItems]);

  useEffect(() => {
    if (!visible) {
      setQuery('');
      setItems([]);
      return;
    }
    doFetch('');
  }, [visible, doFetch]);

  useEffect(() => {
    if (!visible) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doFetch(query), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, visible, doFetch]);

  const handlePick = useCallback((item: any) => {
    onPick(item);
  }, [onPick]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={ms.container}>
        {/* Header */}
        <View style={ms.header}>
          <Text style={ms.headerTitle}>{title}</Text>
          <TouchableOpacity testID="picker-modal-close" style={ms.closeBtn} onPress={onClose}>
            <Ionicons name="close" size={22} color={Colors.ink} />
          </TouchableOpacity>
        </View>

        {/* Top slot (e.g. company toggle) */}
        {topSlot}

        {/* Search */}
        <View style={ms.searchRow}>
          <Ionicons name="search" size={16} color={Colors.textTertiary} />
          <TextInput
            ref={inputRef}
            testID="picker-modal-search"
            style={ms.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Type to search…"
            placeholderTextColor={Colors.textTertiary}
            autoFocus={false}
            returnKeyType="search"
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery('')} testID="picker-modal-clear-search">
              <Ionicons name="close-circle" size={18} color={Colors.textTertiary} />
            </TouchableOpacity>
          )}
        </View>

        {/* Pinned row (e.g. GPS location) */}
        {pinnedRow}

        {/* List */}
        {loading ? (
          <View style={ms.loadingWrap}>
            <ActivityIndicator size="small" color={Colors.orange} />
            <Text style={ms.loadingText}>Loading…</Text>
          </View>
        ) : (
          <FlatList
            data={items}
            keyExtractor={keyExtractor || ((item) => item.id || String(Math.random()))}
            renderItem={({ item }) => (
              <TouchableOpacity
                testID={`picker-row-${item.id}`}
                style={[
                  ms.row,
                  selectedIds?.has(item.id) && ms.rowSelected,
                ]}
                onPress={() => handlePick(item)}
              >
                {renderRow(item)}
                {selectedIds?.has(item.id) && (
                  <View style={ms.checkBadge}>
                    <Ionicons name="checkmark" size={12} color={Colors.white} />
                  </View>
                )}
              </TouchableOpacity>
            )}
            contentContainerStyle={ms.listContent}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <View style={ms.emptyWrap}>
                <Ionicons name="search-outline" size={28} color={Colors.textTertiary} />
                <Text style={ms.emptyText}>
                  {query ? 'No matches found' : 'Start typing to search'}
                </Text>
              </View>
            }
          />
        )}
      </SafeAreaView>
    </Modal>
  );
}

const ms = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1,
    borderBottomColor: Colors.border, backgroundColor: Colors.surface,
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: Colors.ink },
  closeBtn: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.borderLight,
    alignItems: 'center', justifyContent: 'center',
  },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 16, marginTop: 12, marginBottom: 8,
    backgroundColor: Colors.surface, borderRadius: 12, borderWidth: 1,
    borderColor: Colors.border, paddingHorizontal: 12, paddingVertical: 10,
  },
  searchInput: { flex: 1, fontSize: 15, color: Colors.ink, paddingVertical: 0 },
  loadingWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: 20, justifyContent: 'center',
  },
  loadingText: { fontSize: 13, color: Colors.textTertiary },
  listContent: { paddingHorizontal: 16, paddingBottom: 40 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: Colors.surface, borderRadius: 12, padding: 12,
    marginBottom: 6, borderWidth: 1, borderColor: Colors.border,
    minHeight: 52,
  },
  rowSelected: { borderColor: Colors.success, backgroundColor: '#F0FDF4' },
  checkBadge: {
    width: 20, height: 20, borderRadius: 10, backgroundColor: Colors.success,
    alignItems: 'center', justifyContent: 'center',
  },
  emptyWrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 40, gap: 8 },
  emptyText: { fontSize: 14, color: Colors.textTertiary },
});
