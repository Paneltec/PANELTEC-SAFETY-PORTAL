/**
 * ConfirmModal — cross-platform destructive-confirm dialog.
 *
 * v160.2.1 — Replaces the `Alert.alert(...)` used by the form-fill
 * Cancel button. RN Web does NOT render `Alert.alert` at all; on native
 * it renders as an OS-controlled modal (fine). This component uses a
 * pure RN `<Modal>` (which works on iOS, Android, AND RN Web) so the
 * discard-confirm dialog is visible in the browser preview too — which
 * has been repeatedly requested during on-web QA cycles.
 *
 * Promise-based API:
 *   const ok = await confirmDiscard();
 *
 * Or JSX-controlled by parent state (used by forms/fill/[id].tsx):
 *   <ConfirmModal visible={showDiscard} onConfirm={...} onCancel={...} />
 */
import React from 'react';
import { View, Text, Modal, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../lib/colors';

type Props = {
  visible: boolean;
  title: string;
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  testID?: string;
};

export default function ConfirmModal(props: Props) {
  const confirmBg = props.destructive ? Colors.imError : Colors.imBronze;
  return (
    <Modal
      visible={props.visible}
      transparent
      animationType="fade"
      onRequestClose={props.onCancel}
    >
      <View style={s.backdrop} testID={props.testID || 'confirm-modal'}>
        <View style={s.card}>
          <View style={s.iconWrap}>
            <Ionicons
              name={props.destructive ? 'warning' : 'help-circle'}
              size={28}
              color={confirmBg}
            />
          </View>
          <Text style={s.title}>{props.title}</Text>
          <Text style={s.body}>{props.body}</Text>
          <View style={s.actions}>
            <TouchableOpacity
              testID={(props.testID || 'confirm-modal') + '-cancel'}
              style={s.cancelBtn}
              onPress={props.onCancel}
              activeOpacity={0.75}
            >
              <Text style={s.cancelText}>{props.cancelLabel || 'Keep filling'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID={(props.testID || 'confirm-modal') + '-confirm'}
              style={[s.confirmBtn, { backgroundColor: confirmBg }]}
              onPress={props.onConfirm}
              activeOpacity={0.85}
            >
              <Text style={s.confirmText}>{props.confirmLabel || 'Discard'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: 'rgba(15,23,42,0.65)',
    alignItems: 'center', justifyContent: 'center', padding: 24,
  },
  card: {
    width: '100%', maxWidth: 380,
    backgroundColor: Colors.imSurface, borderRadius: 18,
    padding: 22, gap: 10, alignItems: 'center',
    shadowColor: '#000', shadowOpacity: 0.28, shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 }, elevation: 10,
  },
  iconWrap: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: Colors.imConcrete,
    alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  title: { fontSize: 17, fontWeight: '800', color: Colors.imInk, textAlign: 'center' },
  body: { fontSize: 13, color: Colors.imInkMuted, textAlign: 'center', lineHeight: 19 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 14, width: '100%' },
  cancelBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 10,
    borderWidth: 1, borderColor: Colors.imBorder, backgroundColor: Colors.imSurface,
    alignItems: 'center', justifyContent: 'center', minHeight: 44,
  },
  cancelText: { fontSize: 14, fontWeight: '700', color: Colors.imInk },
  confirmBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center', minHeight: 44,
  },
  confirmText: { fontSize: 14, fontWeight: '800', color: Colors.imSurface },
});
