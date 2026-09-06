import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import api, { apiError } from '../lib/api';
import { Colors } from '../lib/colors';

type Props = { resourceKind: string; recordId: string; title?: string; };

export default function PdfActions({ resourceKind, recordId, title }: Props) {
  const [busy, setBusy] = useState<'view' | 'download' | null>(null);

  const viewPdf = async () => {
    setBusy('view');
    try {
      const { data } = await api.post('/pdf-token', { resource: resourceKind, record_id: recordId, action: 'view' });
      await Linking.openURL(data.url);
    } catch (e: any) {
      Alert.alert('Error', "Couldn't open PDF — try again. " + apiError(e));
    } finally { setBusy(null); }
  };

  const downloadPdf = async () => {
    setBusy('download');
    try {
      const { data } = await api.post('/pdf-token', { resource: resourceKind, record_id: recordId, action: 'download' });
      const filename = `${resourceKind}_${recordId.slice(0, 8)}.pdf`;
      if (Platform.OS === 'web') {
        // On web, just open the download URL
        await Linking.openURL(data.url + '&download=1');
        Alert.alert('PDF ready', 'Download started');
      } else {
        const localUri = FileSystem.documentDirectory + filename;
        const dl = await FileSystem.downloadAsync(data.url + '&download=1', localUri);
        await Sharing.shareAsync(dl.uri, { mimeType: 'application/pdf', dialogTitle: title || 'Share PDF' });
      }
    } catch (e: any) {
      Alert.alert('Error', 'Could not download PDF. ' + apiError(e));
    } finally { setBusy(null); }
  };

  return (
    <View testID={`pdf-actions-${resourceKind}-${recordId}`} style={s.row}>
      <TouchableOpacity testID={`pdf-view-${recordId}`} style={s.btn} onPress={viewPdf} disabled={busy === 'view'} activeOpacity={0.7}>
        {busy === 'view' ? <ActivityIndicator size="small" color={Colors.blue} /> : <Ionicons name="document-text" size={14} color={Colors.blue} />}
        <Text style={s.btnText}>View PDF</Text>
      </TouchableOpacity>
      <TouchableOpacity testID={`pdf-dl-${recordId}`} style={s.btn} onPress={downloadPdf} disabled={busy === 'download'} activeOpacity={0.7}>
        {busy === 'download' ? <ActivityIndicator size="small" color={Colors.blue} /> : <Ionicons name="download" size={14} color={Colors.blue} />}
        <Text style={s.btnText}>Download</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', gap: 6 },
  btn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
    borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.white,
  },
  btnText: { fontSize: 12, fontWeight: '500', color: Colors.blue },
});
