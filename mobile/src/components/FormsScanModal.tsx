/**
 * FormsScanModal — reusable camera-QR scanner for the Forms Library.
 *
 * v160.2.5b — Accepts three QR payload shapes:
 *   · A bare UUID template id
 *   · `paneltec://form/{id}` deep link
 *   · An asset scan token — resolves via `GET /api/assets/scan/{token}`
 *     and opens the asset's `default_form_id` if any, else toasts
 *     "This QR doesn't have a form attached."
 *
 * UX mirrors `NavixyVehiclePicker.tsx`'s Scan modal: hardware-safe
 * transparent Modal, camera surface only mounted when the modal is
 * open, neutral concrete background on the camera box, plain
 * text-input fallback to paste a URL / token.
 */
import React, { useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, TextInput, Modal, StyleSheet,
  ActivityIndicator, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import api, { apiError } from '../lib/api';
import { Colors } from '../lib/colors';
import { toast } from '../lib/toast';
import { parseFormToken } from '../lib/scan';

type Props = {
  visible: boolean;
  onClose: () => void;
  onResolved: (templateId: string) => void;
};

export default function FormsScanModal({ visible, onClose, onResolved }: Props) {
  const [input, setInput] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const scannedOnceRef = useRef(false);
  const [camPerm, requestCamPerm] = useCameraPermissions();

  // Reset guard whenever the modal (re)opens.
  React.useEffect(() => {
    if (visible) {
      scannedOnceRef.current = false;
      setErr(null);
      setInput('');
    }
  }, [visible]);

  const resolve = async (raw: string) => {
    const parsed = parseFormToken(raw);
    if (!parsed) {
      setErr('Not a form or asset QR code');
      scannedOnceRef.current = false;
      return;
    }
    setBusy(true); setErr(null);
    try {
      if (parsed.kind === 'form') {
        onResolved(parsed.templateId);
        onClose();
      } else {
        // Asset token — look up its default form.
        const { data: asset } = await api.get(`/assets/scan/${parsed.token}`);
        const tid = asset?.default_form_id || asset?.default_template_id;
        if (!tid) {
          setErr("This QR doesn't have a form attached.");
          scannedOnceRef.current = false;
          return;
        }
        toast.info(`Opening ${asset?.name || 'form'}`);
        onResolved(String(tid));
        onClose();
      }
    } catch (e: any) {
      setErr(apiError(e) || 'Could not resolve QR');
      scannedOnceRef.current = false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      presentationStyle="overFullScreen"
      statusBarTranslucent={true}
      hardwareAccelerated={false}
      onRequestClose={onClose}
    >
      <View style={s.backdrop}>
        <View style={s.sheet}>
          <View style={s.header}>
            <Text style={s.title}>Scan a form QR</Text>
            <TouchableOpacity testID="forms-scan-close" onPress={onClose}>
              <Ionicons name="close" size={22} color={Colors.textSecondary} />
            </TouchableOpacity>
          </View>
          <Text style={s.hint}>Point the camera at a form or plant sticker — or paste the URL / token below.</Text>

          {visible && camPerm?.granted && Platform.OS !== 'web' ? (
            <View testID="forms-scan-camera" style={s.cameraBox}>
              <CameraView
                style={{ flex: 1 }}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={(result) => {
                  if (scannedOnceRef.current || busy) return;
                  const raw = result?.data;
                  if (!raw) return;
                  scannedOnceRef.current = true;
                  resolve(String(raw));
                }}
              />
              <View style={s.reticle} />
            </View>
          ) : Platform.OS === 'web' ? null : (
            <TouchableOpacity
              testID="forms-scan-permission"
              style={s.permissionBox}
              onPress={() => requestCamPerm()}
            >
              <Ionicons name="camera" size={22} color={Colors.imBronze} />
              <Text style={s.permissionText}>Enable camera to scan</Text>
              <Text style={s.permissionSub}>Or paste the URL below</Text>
            </TouchableOpacity>
          )}

          <View style={s.inputRow}>
            <Ionicons name="link" size={16} color={Colors.textTertiary} />
            <TextInput
              testID="forms-scan-url"
              style={s.textInput}
              value={input}
              onChangeText={setInput}
              placeholder="Paste form URL, token or template id"
              placeholderTextColor={Colors.placeholder}
              autoCapitalize="none"
              autoCorrect={false}
              underlineColorAndroid="transparent"
              selectionColor={Colors.imBronze}
            />
            <TouchableOpacity
              testID="forms-scan-submit"
              onPress={() => resolve(input)}
              disabled={busy || !input.trim()}
              style={s.submitBtn}
            >
              {busy
                ? <ActivityIndicator size="small" color={Colors.imSurface} />
                : <Ionicons name="arrow-forward" size={16} color={Colors.imSurface} />}
            </TouchableOpacity>
          </View>
          {err && <Text style={s.err}>{err}</Text>}
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(2,6,23,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.imSurface,
    borderTopLeftRadius: 18, borderTopRightRadius: 18,
    padding: 16, maxHeight: '85%',
  },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 8,
  },
  title: { fontSize: 16, fontWeight: '800', color: Colors.imInk },
  hint: { fontSize: 12, color: Colors.textSecondary, marginBottom: 12 },
  cameraBox: {
    height: 220, borderRadius: 12, overflow: 'hidden',
    backgroundColor: Colors.imConcrete, marginBottom: 12,
  },
  reticle: {
    position: 'absolute', top: '50%', left: '50%',
    width: 160, height: 160, marginLeft: -80, marginTop: -80,
    borderWidth: 3, borderColor: Colors.imBronze, borderRadius: 16, opacity: 0.85,
    pointerEvents: 'none',
  },
  permissionBox: {
    backgroundColor: Colors.imConcrete, borderRadius: 10, padding: 12,
    marginBottom: 12, alignItems: 'center',
  },
  permissionText: { color: Colors.imBronze, fontWeight: '800', marginTop: 4 },
  permissionSub: { color: Colors.textSecondary, fontSize: 11, marginTop: 2 },
  inputRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: Colors.imBorder, borderRadius: 10,
    backgroundColor: Colors.imConcrete, paddingHorizontal: 10,
  },
  textInput: {
    flex: 1, paddingVertical: 10, fontSize: 14, color: Colors.imInk,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none', outlineWidth: 0 } as any : {}),
  },
  submitBtn: {
    backgroundColor: Colors.imBronze, borderRadius: 8, width: 32, height: 32,
    alignItems: 'center', justifyContent: 'center',
  },
  err: { color: Colors.imError, marginTop: 8, fontSize: 13, fontWeight: '600' },
});
