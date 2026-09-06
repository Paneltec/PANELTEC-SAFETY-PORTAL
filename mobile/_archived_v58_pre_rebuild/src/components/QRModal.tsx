/**
 * QRModal — v58.13.107
 *
 * Shared modal for displaying a site QR code with visitor_url,
 * Copy and Share buttons. Used by both Create Site success and My Sites.
 */
import React from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Modal, Share,
  SafeAreaView, ScrollView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import * as Clipboard from 'expo-clipboard';
import { Colors } from '../lib/colors';
import { toast } from '../lib/toast';

type Props = {
  visible: boolean;
  onClose: () => void;
  siteName: string;
  visitorUrl: string;
  qrPayload: string;
  reused?: boolean;
};

export default function QRModal({ visible, onClose, siteName, visitorUrl, qrPayload, reused }: Props) {
  const handleCopy = async () => {
    await Clipboard.setStringAsync(visitorUrl);
    toast('Link copied to clipboard');
  };

  const handleShare = async () => {
    try {
      await Share.share({
        message: `Sign on to ${siteName}: ${visitorUrl}`,
        url: visitorUrl,
      });
    } catch {}
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={s.safe}>
        <View style={s.header}>
          <View style={{ flex: 1 }} />
          <Text style={s.headerTitle}>Site QR Code</Text>
          <TouchableOpacity testID="qr-modal-close" onPress={onClose} style={s.closeBtn}>
            <Ionicons name="close" size={22} color={Colors.ink} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={s.content}>
          <Text testID="qr-modal-site-name" style={s.siteName}>{siteName}</Text>

          {reused && (
            <View testID="qr-modal-reused-pill" style={s.reusedPill}>
              <Ionicons name="information-circle" size={14} color="#92400E" />
              <Text style={s.reusedText}>Reused nearby site created earlier today</Text>
            </View>
          )}

          <View style={s.qrContainer}>
            <QRCode
              value={qrPayload || visitorUrl}
              size={220}
              color="#111827"
              backgroundColor="#FFFFFF"
            />
          </View>

          <Text style={s.urlLabel}>VISITOR SIGN-ON LINK</Text>
          <View style={s.urlBox}>
            <Text testID="qr-modal-url" style={s.urlText} selectable numberOfLines={3}>
              {visitorUrl}
            </Text>
          </View>

          <View style={s.actions}>
            <TouchableOpacity testID="qr-modal-copy" style={s.actionBtn} onPress={handleCopy}>
              <Ionicons name="copy-outline" size={18} color={Colors.orange} />
              <Text style={s.actionText}>Copy link</Text>
            </TouchableOpacity>
            <TouchableOpacity testID="qr-modal-share" style={[s.actionBtn, s.actionBtnPrimary]} onPress={handleShare}>
              <Ionicons name="share-outline" size={18} color="#FFFFFF" />
              <Text style={[s.actionText, { color: '#FFFFFF' }]}>Share</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  headerTitle: { fontSize: 16, fontWeight: '700', color: Colors.ink },
  closeBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  content: { alignItems: 'center', padding: 24, paddingBottom: 48 },
  siteName: { fontSize: 22, fontWeight: '800', color: Colors.ink, textAlign: 'center', marginBottom: 16 },
  reusedPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#FEF3C7', borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 8, marginBottom: 20,
  },
  reusedText: { fontSize: 12, fontWeight: '600', color: '#92400E' },
  qrContainer: {
    padding: 24, backgroundColor: '#FFFFFF', borderRadius: 20,
    borderWidth: 1, borderColor: Colors.border,
    boxShadow: '0px 2px 8px rgba(0,0,0,0.06)',
    elevation: 3, marginBottom: 24,
  },
  urlLabel: {
    fontSize: 10, fontWeight: '700', letterSpacing: 1.2, color: Colors.textTertiary,
    marginBottom: 8, textTransform: 'uppercase',
  },
  urlBox: {
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 12, padding: 14, width: '100%', marginBottom: 20,
  },
  urlText: { fontSize: 13, color: Colors.orange, lineHeight: 20 },
  actions: { flexDirection: 'row', gap: 12, width: '100%' },
  actionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: 14, borderWidth: 1.5, borderColor: Colors.border,
    backgroundColor: Colors.surface, minHeight: 50,
  },
  actionBtnPrimary: {
    backgroundColor: Colors.orange, borderColor: Colors.orange,
  },
  actionText: { fontSize: 14, fontWeight: '600', color: Colors.ink },
});
