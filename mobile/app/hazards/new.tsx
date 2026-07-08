import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TextInput, TouchableOpacity,
  Alert, KeyboardAvoidingView, Platform, ActivityIndicator, Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import api, { apiError } from '../../src/lib/api';
import { getUser } from '../../src/lib/auth';
import PrimaryButton from '../../src/components/PrimaryButton';
import GhostButton from '../../src/components/GhostButton';
import WorkerPicker from '../../src/components/WorkerPicker';
import GpsLocationChip, { GpsFix } from '../../src/components/GpsLocationChip';
import { Colors } from '../../src/lib/colors';
import { toast } from '../../src/lib/toast';

export default function HazardNewScreen() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [aiAnalysis, setAiAnalysis] = useState<any>(null);
  const [reportedBy, setReportedBy] = useState<string | null>(null);
  const [gps, setGps] = useState<GpsFix | null>(null);
  // v160.0.11.1 — auto-default "Reported by" to the logged-in worker's own
  // linked worker record. `GET /api/workers` returns only own row for
  // non-privileged callers (v160.0.8), so [0] is the caller.
  useEffect(() => {
    let live = true;
    api.get('/workers').then(({ data }) => {
      if (!live) return;
      const own = (data || []).find((w: any) => w.active !== false) || data?.[0];
      if (own?.id) setReportedBy((v) => v ?? own.id);
    }).catch(() => {});
    return () => { live = false; };
  }, []);
  const [form, setForm] = useState({
    title: '', description: '', location: '', severity: 'medium',
    controls: [] as string[], status: 'open',
  });

  const pickPhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Camera access is required to capture hazard photos.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.7,
      allowsEditing: true,
    });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      setPhotoUri(asset.uri);
      analyzeWithAI(asset.uri);
    }
  };

  const pickFromGallery = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
      allowsEditing: true,
    });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      setPhotoUri(asset.uri);
      analyzeWithAI(asset.uri);
    }
  };

  const analyzeWithAI = async (uri: string) => {
    setAiBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', {
        uri,
        name: 'hazard.jpg',
        type: 'image/jpeg',
      } as any);
      const { data } = await api.post('/ai/hazard-vision', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setAiAnalysis(data);
      setForm(f => ({
        ...f,
        title: f.title || (data.identified_hazards?.[0] || 'Hazard'),
        description: f.description || data.summary || '',
        severity: data.severity || 'medium',
        controls: data.suggested_controls?.length ? data.suggested_controls : f.controls,
      }));
      Alert.alert('AI classified the hazard', data.summary || 'Review and save.');
    } catch (e: any) {
      Alert.alert('AI vision failed', 'Fill in the form manually. ' + apiError(e));
    } finally {
      setAiBusy(false);
    }
  };

  const addControl = () => setForm(f => ({ ...f, controls: [...f.controls, ''] }));
  const updControl = (i: number, v: string) =>
    setForm(f => ({ ...f, controls: f.controls.map((x, j) => j === i ? v : x) }));
  const delControl = (i: number) =>
    setForm(f => ({ ...f, controls: f.controls.filter((_, j) => j !== i) }));

  const save = async () => {
    if (!form.title) { Alert.alert('Error', 'Title required'); return; }
    setBusy(true);
    try {
      const user = await getUser();
      await api.post('/hazards', {
        ...form,
        workspace_id: user?.workspace_ids?.[0],
        photo_url: photoUri,
        ai_analysis: aiAnalysis,
        controls: form.controls.filter(Boolean),
        reported_by: reportedBy,
        gps_latitude: gps?.latitude,
        gps_longitude: gps?.longitude,
        gps_accuracy: gps?.accuracy,
        gps_street: gps?.street,
        gps_suburb: gps?.suburb,
      });
      toast.success('Hazard reported');
      router.back();
    } catch (e: any) { Alert.alert('Error', apiError(e)); }
    finally { setBusy(false); }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
      <ScrollView testID="hazard-new" style={s.scroll} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <Text style={s.heading}>Report a Hazard</Text>

        {/* Photo capture */}
        <View style={s.card}>
          <Text style={s.label}>Capture photo</Text>
          {photoUri ? (
            <View style={s.photoWrap}>
              <Image source={{ uri: photoUri }} style={s.photo} resizeMode="cover" />
              {aiBusy && (
                <View style={s.aiOverlay}>
                  <ActivityIndicator color={Colors.violet} />
                  <Text style={s.aiOverlayText}>AI analyzing...</Text>
                </View>
              )}
              <TouchableOpacity style={s.removePhoto} onPress={() => { setPhotoUri(null); setAiAnalysis(null); }}>
                <Ionicons name="close-circle" size={28} color={Colors.red} />
              </TouchableOpacity>
            </View>
          ) : (
            <View style={s.photoButtons}>
              <TouchableOpacity testID="hazard-camera-btn" style={s.photoPicker} onPress={pickPhoto}>
                <Ionicons name="camera" size={28} color={Colors.blue} />
                <Text style={s.photoPickerText}>Take Photo</Text>
              </TouchableOpacity>
              <TouchableOpacity testID="hazard-gallery-btn" style={s.photoPicker} onPress={pickFromGallery}>
                <Ionicons name="image" size={28} color={Colors.violet} />
                <Text style={s.photoPickerText}>Gallery</Text>
              </TouchableOpacity>
            </View>
          )}
          <Text style={s.photoHint}>AI will classify risk and suggest controls from the photo.</Text>
        </View>

        {/* AI analysis result */}
        {aiAnalysis && (
          <View testID="ai-analysis-card" style={s.aiCard}>
            <View style={s.aiHeader}>
              <Ionicons name="sparkles" size={16} color={Colors.violet} />
              <Text style={s.aiTitle}>AI Analysis</Text>
            </View>
            <Text style={s.aiSummary}>{aiAnalysis.summary}</Text>
            {aiAnalysis.identified_hazards?.length > 0 && (
              <View style={s.aiTags}>
                {aiAnalysis.identified_hazards.map((h: string, i: number) => (
                  <View key={i} style={s.aiTag}>
                    <Text style={s.aiTagText}>{h}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {/* Form fields */}
        <View style={s.card}>
          <Text style={s.label}>Title *</Text>
          <TextInput testID="hazard-title" style={s.input} value={form.title} onChangeText={v => setForm({...form, title: v})} placeholder="Hazard title" placeholderTextColor={Colors.textTertiary} />

          <Text style={s.label}>Description</Text>
          <TextInput testID="hazard-description" style={[s.input, { minHeight: 70, textAlignVertical: 'top' }]} value={form.description} onChangeText={v => setForm({...form, description: v})} placeholder="Describe the hazard" placeholderTextColor={Colors.textTertiary} multiline />

          <Text style={s.label}>Location</Text>
          <TextInput testID="hazard-location" style={s.input} value={form.location} onChangeText={v => setForm({...form, location: v})} placeholder="Where?" placeholderTextColor={Colors.placeholder} />
          <GpsLocationChip
            value={gps}
            onChange={(fix) => {
              setGps(fix);
              if (fix?.formatted && !form.location) setForm(f => ({ ...f, location: fix.formatted! }));
            }}
          />

          <WorkerPicker
            label="Reported by"
            required
            value={reportedBy}
            onChange={(id) => setReportedBy(id)}
            testID="hazard-reported-by"
          />

          <Text style={s.label}>Severity</Text>
          <View style={s.severityRow}>
            {['low', 'medium', 'high', 'critical'].map(sev => (
              <TouchableOpacity key={sev} testID={`hazard-severity-${sev}`} style={[s.sevBtn, form.severity === sev && s.sevBtnActive]} onPress={() => setForm({...form, severity: sev})}>
                <Text style={[s.sevText, form.severity === sev && s.sevTextActive]}>{sev}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Controls */}
        <View style={s.card}>
          <View style={s.controlsHeader}>
            <Text style={s.label}>Controls</Text>
            <TouchableOpacity testID="add-control-btn" onPress={addControl}>
              <Ionicons name="add-circle" size={24} color={Colors.blue} />
            </TouchableOpacity>
          </View>
          {form.controls.map((c, i) => (
            <View key={i} style={s.controlRow}>
              <TextInput
                testID={`control-${i}`}
                style={[s.input, { flex: 1 }]}
                value={c}
                onChangeText={v => updControl(i, v)}
                placeholder="Control measure"
                placeholderTextColor={Colors.textTertiary}
              />
              <TouchableOpacity onPress={() => delControl(i)} style={s.delCtrl}>
                <Ionicons name="trash" size={16} color={Colors.textTertiary} />
              </TouchableOpacity>
            </View>
          ))}
        </View>

        <View style={s.btnRow}>
          <GhostButton onPress={() => router.back()}>Cancel</GhostButton>
          <PrimaryButton testID="hazard-submit" onPress={save} busy={busy}>Save hazard</PrimaryButton>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: Colors.bg },
  content: { padding: 16, paddingBottom: 40 },
  heading: { fontSize: 22, fontWeight: '700', color: Colors.ink, marginBottom: 16 },
  card: { backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: 16, padding: 16, marginBottom: 12 },
  label: { fontSize: 14, fontWeight: '500', color: Colors.textSecondary, marginBottom: 6, marginTop: 4 },
  input: { backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: Colors.text },
  photoButtons: { flexDirection: 'row', gap: 12, marginTop: 4 },
  photoPicker: {
    flex: 1, alignItems: 'center', gap: 6, paddingVertical: 20,
    borderWidth: 2, borderColor: Colors.border, borderStyle: 'dashed', borderRadius: 12,
    backgroundColor: Colors.bg,
  },
  photoPickerText: { fontSize: 12, color: Colors.textSecondary, fontWeight: '500' },
  photoHint: { fontSize: 11, color: Colors.textTertiary, fontStyle: 'italic', marginTop: 8 },
  photoWrap: { width: '100%', height: 200, borderRadius: 12, overflow: 'hidden', marginTop: 4, position: 'relative' },
  photo: { width: '100%', height: '100%' },
  aiOverlay: {
    ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(124,58,237,0.15)',
    alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  aiOverlayText: { color: Colors.violet, fontSize: 13, fontWeight: '600' },
  removePhoto: { position: 'absolute', top: 8, right: 8 },
  aiCard: {
    borderWidth: 2, borderColor: Colors.violet, borderRadius: 16, padding: 14,
    backgroundColor: Colors.violetSoft, marginBottom: 12,
  },
  aiHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  aiTitle: { fontSize: 14, fontWeight: '700', color: Colors.violet },
  aiSummary: { fontSize: 13, color: Colors.textSecondary, lineHeight: 18 },
  aiTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  aiTag: { backgroundColor: Colors.violetSoft, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  aiTagText: { fontSize: 11, color: Colors.violet, fontWeight: '600' },
  severityRow: { flexDirection: 'row', gap: 6 },
  sevBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.white },
  sevBtnActive: { borderColor: Colors.blue, backgroundColor: Colors.blueSoft },
  sevText: { fontSize: 13, color: Colors.textSecondary, textTransform: 'capitalize' },
  sevTextActive: { color: Colors.orangeLight, fontWeight: '600' },
  controlsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  controlRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  delCtrl: { padding: 8 },
  btnRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 8 },
});
