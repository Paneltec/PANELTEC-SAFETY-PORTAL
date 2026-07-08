/**
 * AssetScanResult — displayed after a worker scans a Vehicle/Plant/Asset QR
 * code. Fetches the sanitised public asset payload via the token, shows the
 * asset info, and offers a "Start Pre-Start" primary action that deep-links
 * into `/pre-starts/new?asset_id=<id>` with the vehicle pre-linked.
 *
 * v160.0.11 — introduced for the Vehicle-QR pre-start flow.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import api, { apiError } from '../../lib/api';
import { Colors } from '../../lib/colors';

type Props = { token: string; onReset: () => void };

export default function AssetScanResult({ token, onReset }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [asset, setAsset] = useState<any>(null);

  useEffect(() => {
    let live = true;
    setBusy(true);
    api.get(`/assets/scan/${token}`)
      .then(({ data }) => { if (live) setAsset(data); })
      .catch((e) => { if (live) setErr(apiError(e)); })
      .finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [token]);

  const startPreStart = () => {
    if (!asset?.id) return;
    router.push({ pathname: '/pre-starts/new', params: { asset_id: asset.id } });
  };

  if (busy) return (
    <View style={s.wrap}>
      <ActivityIndicator size="large" color={Colors.orange} />
      <Text style={s.busyText}>Looking up asset…</Text>
    </View>
  );

  if (err || !asset) return (
    <View style={s.wrap}>
      <Ionicons name="alert-circle" size={40} color={Colors.red} />
      <Text style={s.errTitle}>Scan failed</Text>
      <Text style={s.errBody}>{err || 'Unknown scan token'}</Text>
      <TouchableOpacity testID="asset-scan-reset" style={s.ghostBtn} onPress={onReset}>
        <Text style={s.ghostBtnText}>Scan again</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={s.wrap}>
      <View style={s.iconRing}>
        <Ionicons name={(asset.type === 'vehicle') ? 'car' : 'construct'} size={36} color={Colors.orangeLight} />
      </View>
      <Text style={s.eyebrow}>ASSET SCANNED</Text>
      <Text style={s.title}>{asset.label || asset.rego_serial || 'Unnamed asset'}</Text>
      <Text style={s.meta}>
        {asset.type || 'asset'}{asset.rego_serial ? ` · ${asset.rego_serial}` : ''}
      </Text>
      {asset.meter_reading != null && (
        <Text style={s.meta}>Meter: {asset.meter_reading} {asset.meter_unit || ''}</Text>
      )}

      <TouchableOpacity testID="asset-start-prestart" style={s.primaryBtn} onPress={startPreStart}>
        <Ionicons name="clipboard" size={16} color="#FFFFFF" />
        <Text style={s.primaryBtnText}>Start Pre-Start for this asset</Text>
      </TouchableOpacity>
      <TouchableOpacity testID="asset-scan-reset" style={s.ghostBtn} onPress={onReset}>
        <Text style={s.ghostBtnText}>Scan another</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  iconRing: { width: 72, height: 72, borderRadius: 36, backgroundColor: Colors.orangeSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  eyebrow: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2, color: Colors.orangeLight },
  title: { fontSize: 22, fontWeight: '700', color: Colors.ink, textAlign: 'center' },
  meta: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center' },
  busyText: { color: Colors.textSecondary, marginTop: 10 },
  errTitle: { fontSize: 18, fontWeight: '700', color: Colors.red, marginTop: 8 },
  errBody: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center' },
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.orange, paddingHorizontal: 22, paddingVertical: 12, borderRadius: 12, marginTop: 12,
  },
  primaryBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 }, // linter-ok: on-brand button text
  ghostBtn: { paddingVertical: 10, paddingHorizontal: 18 },
  ghostBtnText: { color: Colors.textSecondary, fontWeight: '600' },
});
