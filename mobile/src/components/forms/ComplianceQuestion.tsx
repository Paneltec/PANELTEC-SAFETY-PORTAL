/**
 * ComplianceQuestion — Mobile 3-state compliance widget.
 * Mirrors web's /frontend/src/components/forms/ComplianceQuestion.jsx
 *
 * 3 pill buttons: COMPLIANT (emerald) | AT RISK (rose) | N/A (slate)
 * + info (i) icon → Alert with help_text
 * + camera icon → expo-image-picker for multi-photo
 * + notes icon → inline TextInput, 2000 char cap
 * + inline photo thumbnail grid with tap-to-preview
 *
 * Value shape: { status: 'compliant'|'at_risk'|'na'|null, photos: [...], notes: string }
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, TextInput,
  Alert, Image, Modal, Platform, ScrollView, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../theme/colors';

// ── Status button definitions ──
const STATUS_BUTTONS = [
  { key: 'compliant', label: 'COMPLIANT', activeBg: '#10B981', activeBorder: '#10B981' },
  { key: 'at_risk',   label: 'AT RISK',   activeBg: '#F43F5E', activeBorder: '#F43F5E' },
  { key: 'na',        label: 'N/A',        activeBg: '#94A3B8', activeBorder: '#94A3B8' },
] as const;

type StatusKey = 'compliant' | 'at_risk' | 'na' | null;

interface ComplianceValue {
  status: StatusKey;
  photos: { uri: string; uploaded_at?: string }[];
  notes: string;
}

interface Props {
  field: { id: string; label: string; help_text?: string; required?: boolean };
  value: unknown;
  onChange: (v: ComplianceValue) => void;
  questionNumber?: number | null;
}

function readValue(value: unknown): ComplianceValue {
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    return {
      status: (typeof v.status === 'string' ? v.status : null) as StatusKey,
      photos: Array.isArray(v.photos) ? v.photos : [],
      notes: typeof v.notes === 'string' ? v.notes : '',
    };
  }
  return { status: null, photos: [], notes: '' };
}

export default function ComplianceQuestion({ field, value, onChange, questionNumber }: Props) {
  const cv = useMemo(() => readValue(value), [value]);
  const helpText = (field.help_text || '').trim();
  const prefix = questionNumber != null ? `${questionNumber}. ` : '';

  // ── Notes state (local draft, commits on blur) ──
  const [notesOpen, setNotesOpen] = useState(() => cv.notes.length > 0);
  const [notesDraft, setNotesDraft] = useState(cv.notes);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  useEffect(() => { setNotesDraft(cv.notes); }, [cv.notes]);

  // ── Helpers ──
  const commit = useCallback((patch: Partial<ComplianceValue>) => {
    onChange({ ...cv, ...patch });
  }, [cv, onChange]);

  const commitStatus = useCallback((key: StatusKey) => {
    commit({ status: key });
  }, [commit]);

  const commitNotes = useCallback(() => {
    const trimmed = (notesDraft || '').slice(0, 2000);
    if (trimmed === cv.notes) return;
    commit({ notes: trimmed });
  }, [notesDraft, cv.notes, commit]);

  const showInfo = useCallback(() => {
    Alert.alert(field.label, helpText || 'No additional guidance provided.');
  }, [field.label, helpText]);

  // ── Photo picking (reuses pattern from PhotoCapture.tsx) ──
  const pickPhoto = useCallback(async () => {
    setPicking(true);
    try {
      if (Platform.OS === 'web') {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.multiple = true;
        input.onchange = (e: any) => {
          const files = Array.from(e.target?.files || []) as File[];
          let loaded = 0;
          const uris: string[] = [];
          files.forEach((file) => {
            const reader = new FileReader();
            reader.onload = () => {
              if (reader.result) uris.push(reader.result as string);
              loaded++;
              if (loaded === files.length && uris.length > 0) {
                const newPhotos = uris.map((uri) => ({ uri, uploaded_at: new Date().toISOString() }));
                commit({ photos: [...cv.photos, ...newPhotos] });
              }
              setPicking(false);
            };
            reader.readAsDataURL(file);
          });
          if (files.length === 0) setPicking(false);
        };
        input.click();
        return;
      }

      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const ImagePicker = require('expo-image-picker');
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission needed', 'Camera access is required to take photos');
        setPicking(false);
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: 'images',
        quality: 0.6,
        allowsEditing: false,
      });
      if (!result.canceled && result.assets?.[0]?.uri) {
        const newPhoto = { uri: result.assets[0].uri, uploaded_at: new Date().toISOString() };
        commit({ photos: [...cv.photos, newPhoto] });
      }
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Could not pick image');
    } finally {
      setPicking(false);
    }
  }, [cv.photos, commit]);

  const removePhoto = useCallback((idx: number) => {
    const next = cv.photos.slice();
    next.splice(idx, 1);
    commit({ photos: next });
  }, [cv.photos, commit]);

  const testId = `compliance-question-${field.id}`;

  return (
    <View testID={testId} style={cq.card}>
      {/* ── Question label ── */}
      <Text style={cq.label}>
        {prefix}{field.label}
        {field.required && <Text style={cq.required}> *</Text>}
      </Text>

      {/* ── Status pills + utility icons ── */}
      <View style={cq.controlRow}>
        <View style={cq.pillRow}>
          {STATUS_BUTTONS.map((btn) => {
            const active = cv.status === btn.key;
            return (
              <TouchableOpacity
                key={btn.key}
                testID={`compliance-btn-${btn.key}-${field.id}`}
                style={[
                  cq.pill,
                  active
                    ? { backgroundColor: btn.activeBg, borderColor: btn.activeBorder }
                    : { backgroundColor: '#FFFFFF', borderColor: Colors.border },
                ]}
                onPress={() => commitStatus(active ? null : btn.key)}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    cq.pillText,
                    active ? { color: '#FFFFFF' } : { color: Colors.textSecondary },
                  ]}
                >
                  {btn.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={cq.iconRow}>
          {helpText ? (
            <TouchableOpacity
              testID={`compliance-info-${field.id}`}
              style={cq.iconBtn}
              onPress={showInfo}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <Ionicons name="information-circle-outline" size={18} color={Colors.textTertiary} />
            </TouchableOpacity>
          ) : null}

          <TouchableOpacity
            testID={`compliance-camera-${field.id}`}
            style={cq.iconBtn}
            onPress={pickPhoto}
            disabled={picking}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            {picking
              ? <ActivityIndicator size="small" color={Colors.textTertiary} />
              : <Ionicons name="camera-outline" size={18} color={Colors.textSecondary} />
            }
          </TouchableOpacity>

          <TouchableOpacity
            testID={`compliance-notes-${field.id}`}
            style={[
              cq.iconBtn,
              (notesOpen || notesDraft) ? cq.iconBtnActive : null,
            ]}
            onPress={() => setNotesOpen((v) => !v)}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <Ionicons
              name="document-text-outline"
              size={18}
              color={(notesOpen || notesDraft) ? Colors.info : Colors.textSecondary}
            />
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Photo thumbnails ── */}
      {cv.photos.length > 0 && (
        <View testID={`compliance-photos-${field.id}`} style={cq.thumbGrid}>
          {cv.photos.map((p, i) => (
            <View key={`p-${i}`} style={cq.thumbWrap}>
              <TouchableOpacity
                testID={`compliance-photo-thumb-${field.id}-${i}`}
                style={cq.thumb}
                onPress={() => setPreviewUri(p.uri || p.file_url)}
                activeOpacity={0.8}
              >
                <Image
                  source={{ uri: p.uri || p.file_url }}
                  style={cq.thumbImg}
                  resizeMode="cover"
                />
              </TouchableOpacity>
              <TouchableOpacity
                testID={`compliance-photo-remove-${field.id}-${i}`}
                style={cq.thumbRemove}
                onPress={() => removePhoto(i)}
                hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
              >
                <Ionicons name="close" size={10} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      {/* ── Notes textarea ── */}
      {notesOpen && (
        <View testID={`compliance-notes-panel-${field.id}`} style={cq.notesPanel}>
          <TextInput
            testID={`compliance-notes-input-${field.id}`}
            style={cq.notesInput}
            value={notesDraft}
            onChangeText={(t) => setNotesDraft(t.slice(0, 2000))}
            onBlur={commitNotes}
            placeholder="Add a note for this question…"
            placeholderTextColor={Colors.textTertiary}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
            maxLength={2000}
          />
          <Text style={cq.notesCounter}>{notesDraft.length} / 2000</Text>
        </View>
      )}

      {/* ── Full-screen image preview modal ── */}
      {previewUri && (
        <Modal
          visible
          transparent
          animationType="fade"
          onRequestClose={() => setPreviewUri(null)}
        >
          <View style={cq.previewOverlay}>
            <TouchableOpacity
              testID={`compliance-preview-close-${field.id}`}
              style={cq.previewCloseBtn}
              onPress={() => setPreviewUri(null)}
            >
              <Ionicons name="close" size={24} color="#FFFFFF" />
            </TouchableOpacity>
            <ScrollView
              contentContainerStyle={cq.previewScrollContent}
              maximumZoomScale={3}
              minimumZoomScale={1}
            >
              <Image
                source={{ uri: previewUri }}
                style={cq.previewImg}
                resizeMode="contain"
              />
            </ScrollView>
          </View>
        </Modal>
      )}
    </View>
  );
}

// ── Styles ──
const cq = StyleSheet.create({
  card: {
    borderRadius: 14, borderWidth: 1, borderColor: Colors.border,
    backgroundColor: Colors.surface, padding: 14, gap: 10,
  },
  label: { fontSize: 14, fontWeight: '600', color: Colors.ink, lineHeight: 20 },
  required: { color: '#F43F5E', fontWeight: '600' },

  controlRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    flexWrap: 'wrap', gap: 8,
  },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pill: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    borderWidth: 1.5, minHeight: 36, alignItems: 'center', justifyContent: 'center',
  },
  pillText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },

  iconRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  iconBtn: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center',
  },
  iconBtnActive: { backgroundColor: '#EFF6FF' },

  // Photo thumbnails
  thumbGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8,
  },
  thumbWrap: { position: 'relative' },
  thumb: {
    width: 64, height: 64, borderRadius: 10, overflow: 'hidden',
    borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.borderLight,
  },
  thumbImg: { width: '100%', height: '100%' },
  thumbRemove: {
    position: 'absolute', top: -4, right: -4,
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: '#F43F5E', alignItems: 'center', justifyContent: 'center',
  },

  // Notes
  notesPanel: { gap: 2 },
  notesInput: {
    backgroundColor: '#F8FAFC', borderRadius: 10, borderWidth: 1,
    borderColor: Colors.border, paddingHorizontal: 12, paddingTop: 10,
    paddingBottom: 10, fontSize: 13, color: Colors.ink, lineHeight: 18,
    minHeight: 64, textAlignVertical: 'top',
  },
  notesCounter: { fontSize: 10, color: Colors.textTertiary, textAlign: 'right' },

  // Preview modal
  previewOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.92)',
    justifyContent: 'center', alignItems: 'center',
  },
  previewCloseBtn: {
    position: 'absolute', top: 50, right: 20, zIndex: 10,
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },
  previewScrollContent: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  previewImg: { width: '90%', height: '80%' },
});
