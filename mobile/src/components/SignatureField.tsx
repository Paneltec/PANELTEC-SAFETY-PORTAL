/**
 * SignatureField — v58.13.132jd
 * Full-screen modal signature pad using react-native-signature-canvas.
 * Saves as base64 data URL. Opens via tap on placeholder.
 */
import React, { useRef, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import SignatureScreen, { SignatureViewRef } from 'react-native-signature-canvas';
import { Colors } from '../theme/colors';
import { lightHaptic, mediumHaptic } from '../services/haptics';

interface SignatureFieldProps {
  value: string | null;
  onChange: (value: string | null) => void;
  label?: string;
}

export default function SignatureField({ value, onChange, label }: SignatureFieldProps) {
  const [modalVisible, setModalVisible] = useState(false);

  const openPad = useCallback(() => {
    lightHaptic();
    setModalVisible(true);
  }, []);

  const handleSave = useCallback((signature: string) => {
    mediumHaptic();
    onChange(signature);
    setModalVisible(false);
  }, [onChange]);

  const handleClear = useCallback(() => {
    onChange(null);
  }, [onChange]);

  return (
    <View>
      {value ? (
        <View testID="signature-preview" style={s.previewWrap}>
          <Image
            source={{ uri: value }}
            style={s.previewImage}
            resizeMode="contain"
          />
          <View style={s.previewActions}>
            <TouchableOpacity
              testID="signature-redo-btn"
              style={s.actionBtn}
              onPress={openPad}
              activeOpacity={0.7}
            >
              <Ionicons name="create-outline" size={16} color={Colors.info} />
              <Text style={s.actionBtnText}>Re-sign</Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID="signature-clear-btn"
              style={s.actionBtn}
              onPress={handleClear}
              activeOpacity={0.7}
            >
              <Ionicons name="trash-outline" size={16} color={Colors.error} />
              <Text style={[s.actionBtnText, { color: Colors.error }]}>Clear</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <TouchableOpacity
          testID="signature-tap-to-sign"
          style={s.placeholder}
          onPress={openPad}
          activeOpacity={0.7}
        >
          <Ionicons name="create-outline" size={28} color={Colors.orange} />
          <Text style={s.placeholderTitle}>Tap to sign</Text>
          <Text style={s.placeholderHint}>{label || 'Draw your signature'}</Text>
        </TouchableOpacity>
      )}

      <SignatureModal
        visible={modalVisible}
        onSave={handleSave}
        onCancel={() => setModalVisible(false)}
        label={label}
      />
    </View>
  );
}

function SignatureModal({ visible, onSave, onCancel, label }: {
  visible: boolean;
  onSave: (sig: string) => void;
  onCancel: () => void;
  label?: string;
}) {
  const signatureRef = useRef<SignatureViewRef>(null);
  const insets = useSafeAreaInsets();
  const [hasStrokes, setHasStrokes] = useState(false);

  const handleOK = useCallback((signature: string) => {
    onSave(signature);
    setHasStrokes(false);
  }, [onSave]);

  const handleClear = useCallback(() => {
    signatureRef.current?.clearSignature();
    setHasStrokes(false);
  }, []);

  const handleDone = useCallback(() => {
    if (hasStrokes) {
      signatureRef.current?.readSignature();
    }
  }, [hasStrokes]);

  const handleEnd = useCallback(() => {
    setHasStrokes(true);
    lightHaptic();
  }, []);

  const handleCancel = useCallback(() => {
    setHasStrokes(false);
    onCancel();
  }, [onCancel]);

  const webStyle = `
    .m-signature-pad { box-shadow: none; border: none; margin: 0; }
    .m-signature-pad--body { border: none; }
    .m-signature-pad--footer { display: none; }
    body, html { margin: 0; padding: 0; width: 100%; height: 100%; }
    canvas { width: 100% !important; height: 100% !important; }
  `;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={handleCancel}
    >
      <View
        testID="signature-modal"
        style={[sm.container, {
          paddingTop: insets.top + 8,
          paddingBottom: insets.bottom + 8,
        }]}
      >
        {/* Header */}
        <View style={sm.header}>
          <TouchableOpacity
            testID="signature-modal-cancel"
            style={sm.headerBtn}
            onPress={handleCancel}
          >
            <Text style={sm.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <View style={sm.headerCenter}>
            <Ionicons name="create-outline" size={18} color={Colors.orange} />
            <Text style={sm.headerTitle}>{label || 'Signature'}</Text>
          </View>
          <TouchableOpacity
            testID="signature-modal-done"
            style={[sm.headerBtn, sm.doneBtn, !hasStrokes && sm.doneBtnDisabled]}
            onPress={handleDone}
            disabled={!hasStrokes}
          >
            <Text style={[sm.doneText, !hasStrokes && sm.doneTextDisabled]}>Done</Text>
          </TouchableOpacity>
        </View>

        {/* Instruction */}
        <Text style={sm.instruction}>Sign in the area below</Text>

        {/* Signature canvas */}
        <View style={sm.canvasWrap}>
          <SignatureScreen
            ref={signatureRef}
            onOK={handleOK}
            onEnd={handleEnd}
            webStyle={webStyle}
            backgroundColor="white"
            penColor="black"
            minWidth={1.5}
            maxWidth={3}
            dotSize={2}
            descriptionText=""
            style={sm.canvas}
          />
          {/* Baseline guide */}
          <View style={sm.baseline} pointerEvents="none" />
        </View>

        {/* Footer actions */}
        <View style={sm.footer}>
          <TouchableOpacity
            testID="signature-modal-clear"
            style={sm.clearBtn}
            onPress={handleClear}
          >
            <Ionicons name="refresh-outline" size={18} color={Colors.textTertiary} />
            <Text style={sm.clearText}>Clear</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

/* ── Placeholder & Preview Styles ── */
const s = StyleSheet.create({
  placeholder: {
    alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: Colors.surface, borderRadius: 14, padding: 28,
    borderWidth: 2, borderColor: Colors.orange, borderStyle: 'dashed',
    minHeight: 100,
  },
  placeholderTitle: { fontSize: 16, fontWeight: '700', color: Colors.orange },
  placeholderHint: { fontSize: 13, color: Colors.textTertiary },

  previewWrap: {
    backgroundColor: Colors.surface, borderRadius: 14, overflow: 'hidden',
    borderWidth: 1, borderColor: Colors.border,
  },
  previewImage: {
    width: '100%', height: 120, backgroundColor: '#fff',
  },
  previewActions: {
    flexDirection: 'row', justifyContent: 'center', gap: 16,
    paddingVertical: 10, borderTopWidth: 1, borderTopColor: Colors.borderLight,
  },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10,
    backgroundColor: Colors.bg,
  },
  actionBtnText: { fontSize: 14, fontWeight: '600', color: Colors.info },
});

/* ── Modal Styles ── */
const sm = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  headerBtn: { minWidth: 64, paddingVertical: 8 },
  headerCenter: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: Colors.ink },
  cancelText: { fontSize: 16, color: Colors.textTertiary, fontWeight: '500' },
  doneBtn: {
    backgroundColor: Colors.orange, borderRadius: 10,
    paddingHorizontal: 18, alignItems: 'center',
  },
  doneBtnDisabled: { backgroundColor: Colors.borderLight },
  doneText: { fontSize: 16, fontWeight: '700', color: Colors.white, textAlign: 'right' },
  doneTextDisabled: { color: Colors.textTertiary },

  instruction: {
    textAlign: 'center', fontSize: 14, color: Colors.textTertiary,
    fontWeight: '500', paddingTop: 12, paddingBottom: 8,
  },

  canvasWrap: {
    flex: 1, marginHorizontal: 16, marginBottom: 8,
    borderRadius: 16, overflow: 'hidden',
    backgroundColor: '#fff',
    borderWidth: 1, borderColor: Colors.border,
  },
  canvas: { flex: 1 },
  baseline: {
    position: 'absolute', bottom: '25%', left: 24, right: 24,
    height: 1, backgroundColor: '#E5E7EB',
  },

  footer: {
    flexDirection: 'row', justifyContent: 'center',
    paddingVertical: 12,
  },
  clearBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 24, paddingVertical: 12,
    borderRadius: 12, borderWidth: 1.5, borderColor: Colors.border,
    minHeight: 48,
  },
  clearText: { fontSize: 15, fontWeight: '600', color: Colors.textTertiary },
});
