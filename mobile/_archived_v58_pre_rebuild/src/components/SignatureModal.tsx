/**
 * SignatureModal — reusable full-screen signature capture modal.
 * v160.0.10.2 — extracted from `forms/fill/[id].tsx` so any form can
 * capture an operator/reviewer signature. Native path uses
 * `react-native-signature-canvas`; web path uses `SignaturePadWeb`
 * (canvas fallback) — same interface both ways.
 */
import React, { useRef } from 'react';
import { View, Text, TouchableOpacity, Modal, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import SignatureScreen from 'react-native-signature-canvas';
import SignaturePadWeb from './SignaturePadWeb';
import { Colors } from '../lib/colors';

type Props = {
  visible: boolean;
  title?: string;
  onSave: (dataUrl: string) => void;
  onClose: () => void;
};

export default function SignatureModal({ visible, title = 'Sign below', onSave, onClose }: Props) {
  const sigRef = useRef<any>(null);
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: Colors.surface }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: Colors.border }}>
          <Text style={{ fontSize: 16, fontWeight: '700', color: Colors.ink }}>{title}</Text>
          <TouchableOpacity testID="sig-modal-close" onPress={onClose}>
            <Ionicons name="close" size={22} color={Colors.textTertiary} />
          </TouchableOpacity>
        </View>
        {Platform.OS === 'web' ? (
          <SignaturePadWeb onSave={onSave} onClose={onClose} />
        ) : (
          <SignatureScreen
            ref={sigRef}
            onOK={(sig: string) => onSave(sig)}
            onEmpty={() => Alert.alert('Please sign first')}
            descriptionText=""
            clearText="Clear"
            confirmText="Save"
            webStyle={`.m-signature-pad { box-shadow: none; border: 1px solid ${Colors.border}; border-radius: 12px; margin: 16px; background: #fff; }
              .m-signature-pad--body { border: none; }
              .m-signature-pad--footer .button { background-color: ${Colors.orange}; color: white; border-radius: 8px; padding: 10px 24px; font-weight: 600; }
              .m-signature-pad--footer .button.clear { background-color: ${Colors.surfaceLight}; color: ${Colors.textSecondary}; }`}
            style={{ flex: 1 }}
          />
        )}
      </SafeAreaView>
    </Modal>
  );
}
