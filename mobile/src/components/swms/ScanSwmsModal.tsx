import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, Modal, ActivityIndicator,
  Platform, Alert, Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import api, { apiError } from '../../lib/api';
import { Colors } from '../../lib/colors';

const MAX_SIZE = 25 * 1024 * 1024; // 25 MB

interface Props { visible: boolean; onClose: () => void; onCreated: (swms: any) => void; }

type PickedFile = { uri: string; name: string; type: string; size?: number };

export default function ScanSwmsModal({ visible, onClose, onCreated }: Props) {
  const [file, setFile] = useState<PickedFile | null>(null);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<'choose' | 'confirm'>('choose');

  const reset = () => { setFile(null); setTitle(''); setBusy(false); setStep('choose'); };

  const pickCamera = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { Alert.alert('Camera access needed', 'Enable camera in Settings.'); return; }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (result.canceled || !result.assets?.[0]) return;
    const a = result.assets[0];
    const size = a.fileSize || 0;
    if (size > MAX_SIZE) { Alert.alert('File too large', 'Max 25 MB. Try a lower-res photo.'); return; }
    setFile({ uri: a.uri, name: a.fileName || `scan_${Date.now()}.jpg`, type: a.mimeType || 'image/jpeg', size });
    setStep('confirm');
  };

  const pickLibrary = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (result.canceled || !result.assets?.[0]) return;
    const a = result.assets[0];
    const size = a.fileSize || 0;
    if (size > MAX_SIZE) { Alert.alert('File too large', 'Max 25 MB.'); return; }
    setFile({ uri: a.uri, name: a.fileName || `photo_${Date.now()}.jpg`, type: a.mimeType || 'image/jpeg', size });
    setStep('confirm');
  };

  const pickDocument = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/png', 'image/jpeg'] });
    if (result.canceled || !result.assets?.[0]) return;
    const a = result.assets[0];
    const size = a.size || 0;
    if (size > MAX_SIZE) { Alert.alert('File too large', 'Max 25 MB.'); return; }
    setFile({ uri: a.uri, name: a.name || 'document.pdf', type: a.mimeType || 'application/pdf', size });
    setStep('confirm');
  };

  const submit = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', { uri: file.uri, name: file.name, type: file.type } as any);
      if (title.trim()) fd.append('title_hint', title.trim());
      const { data } = await api.post('/swms/from-scan', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120000,
      });
      reset();
      onClose();
      onCreated(data);
    } catch (e: any) {
      const status = e?.response?.status;
      if (status === 413) Alert.alert('File too large', 'Max 25 MB.');
      else if (status === 400) Alert.alert('Could not parse', e?.response?.data?.detail || 'OCR found insufficient text. Try a clearer image.');
      else Alert.alert('Error', apiError(e));
    } finally {
      setBusy(false);
    }
  };

  const sizeStr = file?.size ? `${(file.size / 1024).toFixed(0)} KB` : '';
  const isImage = file?.type?.startsWith('image/');

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={() => { reset(); onClose(); }}>
      <View style={s.overlay}>
        <View style={s.modal}>
          {/* Header */}
          <View style={s.header}>
            <View style={s.headerIcon}>
              <Ionicons name="scan" size={16} color={Colors.paneltecBlue} />
            </View>
            <Text style={s.headerTitle}>{step === 'choose' ? 'Scan SWMS' : 'Confirm & Parse'}</Text>
            <TouchableOpacity testID="scan-modal-close" onPress={() => { reset(); onClose(); }} hitSlop={12}>
              <Ionicons name="close" size={20} color={Colors.ink} />
            </TouchableOpacity>
          </View>

          {step === 'choose' ? (
            /* Choice sheet */
            <View style={s.choices}>
              <Text style={s.choiceHint}>Upload a photo or PDF of a signed SWMS to extract tasks, hazards and controls with AI.</Text>

              <TouchableOpacity testID="scan-camera" style={s.choiceBtn} onPress={pickCamera} activeOpacity={0.7}>
                <View style={[s.choiceIcon, { backgroundColor: Colors.imConcrete }]}>
                  <Ionicons name="camera" size={20} color={Colors.paneltecBlue} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.choiceTitle}>Take Photo</Text>
                  <Text style={s.choiceSub}>Snap a signed SWMS page with your camera</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />
              </TouchableOpacity>

              <TouchableOpacity testID="scan-library" style={s.choiceBtn} onPress={pickLibrary} activeOpacity={0.7}>
                <View style={[s.choiceIcon, { backgroundColor: Colors.imConcrete }]}>
                  <Ionicons name="images" size={20} color={Colors.imSuccess} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.choiceTitle}>Choose from Library</Text>
                  <Text style={s.choiceSub}>Select an existing photo (JPG/PNG)</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />
              </TouchableOpacity>

              <TouchableOpacity testID="scan-pdf" style={s.choiceBtn} onPress={pickDocument} activeOpacity={0.7}>
                <View style={[s.choiceIcon, { backgroundColor: Colors.imConcrete }]}>
                  <Ionicons name="document" size={20} color={Colors.imError} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.choiceTitle}>Pick PDF</Text>
                  <Text style={s.choiceSub}>Select a PDF file from device storage</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />
              </TouchableOpacity>
            </View>
          ) : (
            /* Confirm screen */
            <View style={s.confirmArea}>
              {/* File preview */}
              <View style={s.previewCard}>
                {isImage && file?.uri ? (
                  <Image source={{ uri: file.uri }} style={s.previewImage} resizeMode="cover" />
                ) : (
                  <View style={s.previewPdf}>
                    <Ionicons name="document" size={32} color={Colors.imError} />
                    <Text style={s.previewPdfText}>PDF</Text>
                  </View>
                )}
                <View style={s.fileInfo}>
                  <Text style={s.fileName} numberOfLines={2}>{file?.name}</Text>
                  {sizeStr ? <Text style={s.fileSize}>{sizeStr}</Text> : null}
                </View>
              </View>

              {/* Title input */}
              <Text style={s.label}>Title hint (optional)</Text>
              <TextInput
                testID="scan-title-input"
                style={s.titleInput}
                value={title}
                onChangeText={setTitle}
                placeholder="e.g. Roof Works — signed copy"
                placeholderTextColor={Colors.textTertiary}
              />

              {/* Actions */}
              <View style={s.actions}>
                <TouchableOpacity testID="scan-back" style={s.backBtn} onPress={() => { setFile(null); setStep('choose'); }}>
                  <Ionicons name="arrow-back" size={14} color={Colors.textSecondary} />
                  <Text style={s.backText}>Back</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  testID="scan-submit"
                  style={[s.submitBtn, busy && { opacity: 0.6 }]}
                  onPress={submit}
                  disabled={busy}
                  activeOpacity={0.7}
                >
                  {busy ? (
                    <View style={s.busyCol}>
                      <ActivityIndicator size="small" color={Colors.imSurface} />
                      <Text style={s.busyText}>Reading your document… (~20-40s)</Text>
                      <Text style={s.busySub}>OCR + AI parse running</Text>
                    </View>
                  ) : (
                    <>
                      <Ionicons name="sparkles" size={14} color={Colors.imSurface} />
                      <Text style={s.submitText}>Read & Parse with AI</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.5)', justifyContent: 'flex-end' },
  modal: { backgroundColor: Colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingBottom: 32, paddingTop: 16, maxHeight: '90%' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
  headerIcon: { width: 32, height: 32, borderRadius: 8, backgroundColor: Colors.imConcrete, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: '700', color: Colors.ink },
  // Choice sheet
  choices: { gap: 8 },
  choiceHint: { fontSize: 13, color: Colors.textSecondary, lineHeight: 19, marginBottom: 8 },
  choiceBtn: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderWidth: 1, borderColor: Colors.border, borderRadius: 14 },
  choiceIcon: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  choiceTitle: { fontSize: 15, fontWeight: '600', color: Colors.ink },
  choiceSub: { fontSize: 12, color: Colors.textSecondary, marginTop: 1 },
  // Confirm
  confirmArea: {},
  previewCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Colors.imConcrete, borderWidth: 1, borderColor: Colors.border, borderRadius: 14, padding: 12, marginBottom: 12 },
  previewImage: { width: 56, height: 56, borderRadius: 8 },
  previewPdf: { width: 56, height: 56, borderRadius: 8, backgroundColor: Colors.imConcrete, alignItems: 'center', justifyContent: 'center' },
  previewPdfText: { fontSize: 9, fontWeight: '700', color: Colors.imError, marginTop: 2 },
  fileInfo: { flex: 1 },
  fileName: { fontSize: 13, fontWeight: '600', color: Colors.ink },
  fileSize: { fontSize: 11, color: Colors.textTertiary, marginTop: 2 },
  label: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary, marginBottom: 4, marginTop: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  titleInput: { backgroundColor: Colors.imConcrete, borderWidth: 1, borderColor: Colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: Colors.text },
  actions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1, borderColor: Colors.border },
  backText: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary },
  submitBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: Colors.paneltecBlue, borderRadius: 12, paddingVertical: 14, minHeight: 50 },
  submitText: { fontSize: 14, fontWeight: '700', color: Colors.imSurface },
  busyCol: { alignItems: 'center', gap: 4 },
  busyText: { fontSize: 12, fontWeight: '600', color: Colors.imSurface },
  busySub: { fontSize: 10, color: 'rgba(255,255,255,0.7)' },
});
