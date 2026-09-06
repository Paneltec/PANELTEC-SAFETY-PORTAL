import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, RefreshControl, Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import api, { apiError } from '../../src/lib/api';
import StatusBadge from '../../src/components/StatusBadge';
import EmptyState from '../../src/components/EmptyState';
import PrimaryButton from '../../src/components/PrimaryButton';
import PasteSwmsModal from '../../src/components/swms/PasteSwmsModal';
import ScanSwmsModal from '../../src/components/swms/ScanSwmsModal';
import { Colors } from '../../src/lib/colors';
import { useCan } from '../../src/lib/AuthContext';

export default function SwmsListScreen() {
  const router = useRouter();
  const can = useCan();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Phase 4.5/4.6 modals
  const [pasteOpen, setPasteOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);

  // Multi-select for bulk delete
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const load = useCallback(() => {
    api.get('/swms')
      .then(r => setItems(r.data))
      .catch(() => {})
      .finally(() => { setLoading(false); setRefreshing(false); });
  }, []);

  useEffect(() => { load(); }, []);

  // Toggle selection on a single row
  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Exit selection mode
  const clearSelection = () => {
    setSelectMode(false);
    setSelected(new Set());
  };

  // Bulk delete
  const confirmBulkDelete = () => {
    const count = selected.size;
    if (!count) return;
    Alert.alert(
      `Delete ${count} SWMS?`,
      'You can restore them from the Recycle Bin within 30 days. Items you don\'t own will be skipped.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: `Delete ${count}`, style: 'destructive', onPress: executeBulkDelete },
      ],
    );
  };

  const executeBulkDelete = async () => {
    const ids = Array.from(selected);
    setBulkBusy(true);
    try {
      const { data } = await api.post('/swms/bulk-delete', { ids });
      const { deleted, refused_ids } = data;
      setItems(prev => prev.filter(x => !ids.includes(x.id)));
      clearSelection();
      if (refused_ids?.length) {
        Alert.alert('Partial delete', `Deleted ${deleted} · skipped ${refused_ids.length} you don't own.`);
      } else {
        Alert.alert('Deleted', `${deleted} SWMS moved to Recycle Bin.`);
      }
    } catch (e: any) {
      Alert.alert('Error', apiError(e));
    } finally {
      setBulkBusy(false);
    }
  };

  // After paste/scan creates a new SWMS
  const handleCreated = (doc: any, kind: 'paste' | 'scan') => {
    // Add new doc to top of list
    setItems(prev => [doc, ...prev]);
    const msg = kind === 'scan'
      ? `Scanned SWMS parsed (${doc.ocr_chars || 0} chars OCR'd). Review and approve when ready.`
      : 'AI-parsed draft created. Review and approve when ready.';
    Alert.alert('Success', msg, [
      { text: 'Stay here', style: 'cancel' },
      { text: 'Open in editor', onPress: () => router.push(`/swms/${doc.id}`) },
    ]);
  };

  // Row press handler
  const onRowPress = (item: any) => {
    if (selectMode) {
      toggleSelect(item.id);
    } else {
      router.push(`/swms/${item.id}`);
    }
  };

  // Long-press starts selection
  const onRowLongPress = (item: any) => {
    if (!selectMode) {
      setSelectMode(true);
      setSelected(new Set([item.id]));
    }
  };

  const canCreate = can('swms', 'open');

  return (
    <View style={s.container}>
      <ScrollView
        testID="swms-list"
        style={s.scroll}
        contentContainerStyle={s.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={Colors.blue} />
        }
      >
        {/* Header */}
        <View style={s.header}>
          <View style={{ flex: 1 }}>
            <Text style={s.heading}>Safe Work Method Statements</Text>
            <Text style={s.sub}>Draft, review and approve SWMS.</Text>
          </View>
        </View>

        {/* Action buttons row */}
        {canCreate && (
          <View style={s.actionsRow}>
            <TouchableOpacity
              testID="swms-paste-btn"
              style={s.pasteBtn}
              onPress={() => setPasteOpen(true)}
              activeOpacity={0.7}
            >
              <Ionicons name="clipboard" size={15} color={Colors.imBronze} />
              <Text style={s.pasteBtnText}>Paste</Text>
            </TouchableOpacity>

            <TouchableOpacity
              testID="swms-scan-btn"
              style={s.scanBtn}
              onPress={() => setScanOpen(true)}
              activeOpacity={0.7}
            >
              <Ionicons name="scan" size={15} color={Colors.imBronze} />
              <Text style={s.scanBtnText}>Scan</Text>
            </TouchableOpacity>

            <TouchableOpacity
              testID="swms-create-btn"
              style={s.addBtn}
              onPress={() => router.push('/swms/new')}
            >
              <Ionicons name="add" size={16} color={Colors.imSurface} />
              <Text style={s.addText}>Create</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* List */}
        {loading ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={Colors.blue} />
        ) : items.length === 0 ? (
          <EmptyState title="No SWMS yet" body="Draft your first Safe Work Method Statement." />
        ) : (
          items.map(sw => {
            const isSelected = selected.has(sw.id);
            return (
              <TouchableOpacity
                key={sw.id}
                testID={`swms-row-${sw.id}`}
                style={[s.card, isSelected && s.cardSelected]}
                onPress={() => onRowPress(sw)}
                onLongPress={() => onRowLongPress(sw)}
                delayLongPress={400}
                activeOpacity={0.7}
              >
                {selectMode && (
                  <View style={[s.checkbox, isSelected && s.checkboxChecked]}>
                    {isSelected && <Ionicons name="checkmark" size={14} color={Colors.imSurface} />}
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={s.cardTitle}>{sw.title}</Text>
                  <Text style={s.cardSub} numberOfLines={1}>{sw.job_description}</Text>
                </View>
                <View style={s.cardRight}>
                  <StatusBadge value={sw.status} />
                  <Text style={s.cardDate}>{(sw.created_at || '').slice(0, 10)}</Text>
                </View>
              </TouchableOpacity>
            );
          })
        )}

        {/* Spacer for bottom bar */}
        {selectMode && <View style={{ height: 80 }} />}
      </ScrollView>

      {/* Bulk action bottom bar */}
      {selectMode && (
        <View testID="swms-bulk-bar" style={s.bulkBar}>
          <View style={s.bulkLeft}>
            <View style={s.bulkDot} />
            <Text style={s.bulkCount}>{selected.size} selected</Text>
          </View>
          <View style={s.bulkRight}>
            <TouchableOpacity testID="swms-bulk-clear" style={s.bulkClearBtn} onPress={clearSelection}>
              <Ionicons name="close" size={14} color={Colors.imBorder} />
              <Text style={s.bulkClearText}>Clear</Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID="swms-bulk-delete-btn"
              style={[s.bulkDeleteBtn, bulkBusy && { opacity: 0.6 }]}
              onPress={confirmBulkDelete}
              disabled={bulkBusy || selected.size === 0}
            >
              {bulkBusy ? (
                <ActivityIndicator size="small" color={Colors.imSurface} />
              ) : (
                <>
                  <Ionicons name="trash" size={14} color={Colors.imSurface} />
                  <Text style={s.bulkDeleteText}>Delete</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Modals */}
      <PasteSwmsModal
        visible={pasteOpen}
        onClose={() => setPasteOpen(false)}
        onCreated={(doc: any) => handleCreated(doc, 'paste')}
      />
      <ScanSwmsModal
        visible={scanOpen}
        onClose={() => setScanOpen(false)}
        onCreated={(doc: any) => handleCreated(doc, 'scan')}
      />
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 32 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  heading: { fontSize: 22, fontWeight: '700', color: Colors.ink },
  sub: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },

  // Action buttons row
  actionsRow: { flexDirection: 'row', gap: 8, marginBottom: 14, flexWrap: 'wrap' },
  pasteBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 9,
    borderRadius: 10, borderWidth: 1, borderColor: Colors.imBronze,
    backgroundColor: Colors.orangeSoft,
  },
  pasteBtnText: { fontSize: 13, fontWeight: '600', color: Colors.orangeLight },
  scanBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 9,
    borderRadius: 10, borderWidth: 1, borderColor: Colors.imBronze,
    backgroundColor: Colors.surface,
  },
  scanBtnText: { fontSize: 13, fontWeight: '600', color: Colors.orangeLight },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.blue, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 10,
    marginLeft: 'auto',
  },
  addText: { color: Colors.imSurface, fontSize: 13, fontWeight: '600' },

  // Cards
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 14, padding: 14, marginBottom: 8,
  },
  cardSelected: { borderColor: Colors.imBronze, backgroundColor: Colors.orangeSoft },
  cardTitle: { fontSize: 15, fontWeight: '600', color: Colors.ink },
  cardSub: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  cardRight: { alignItems: 'flex-end', gap: 4 },
  cardDate: { fontSize: 11, color: Colors.textTertiary },

  // Checkbox
  checkbox: {
    width: 22, height: 22, borderRadius: 6,
    borderWidth: 2, borderColor: Colors.imBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: Colors.imBronze, borderColor: Colors.imBronze },

  // Bulk action bar
  bulkBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.imInk, paddingHorizontal: 16, paddingVertical: 12,
    borderTopLeftRadius: 16, borderTopRightRadius: 16,
    boxShadow: '0px -4px 8px rgba(0,0,0,0.15)',
    elevation: 12,
  },
  bulkLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bulkDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.imBronze },
  bulkCount: { fontSize: 14, fontWeight: '600', color: Colors.imSurface },
  bulkRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bulkClearBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8,
  },
  bulkClearText: { fontSize: 12, fontWeight: '600', color: Colors.imBorder },
  bulkDeleteBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8,
    backgroundColor: Colors.imBronze,
  },
  bulkDeleteText: { fontSize: 13, fontWeight: '700', color: Colors.imSurface },
});
