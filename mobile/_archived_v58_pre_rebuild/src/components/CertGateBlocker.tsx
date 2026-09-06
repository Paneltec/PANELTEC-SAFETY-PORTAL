/**
 * v160.3.0 — Qualification-gated forms blocker.
 *
 * Shown by `app/forms/fill/[id].tsx` when the backend
 * `/access-check` endpoint returns `ok: false`. Renders a full-screen
 * (in-safearea) "you can't fill this form yet" panel with a per-slug
 * status list — red for missing/expired, olive for valid/expiring
 * soon. Only exit is "Back to forms" — no override path, no dismiss.
 * Admins bypass server-side, so they never see this component.
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../lib/colors';

type RequiredCert = {
  slug: string;
  label: string;
  status: 'valid' | 'expiring_soon' | 'no_expiry' | 'expired' | 'missing';
  expiry_date?: string | null;
};

const STATUS_STYLE: Record<string, { icon: any; ink: string; bg: string; label: string }> = {
  valid:         { icon: 'checkmark-circle', ink: Colors.imSuccess, bg: 'rgba(107,127,92,0.12)',  label: 'Valid' },
  expiring_soon: { icon: 'time-outline',     ink: Colors.imWarning, bg: 'rgba(192,128,64,0.14)',  label: 'Expiring soon' },
  no_expiry:     { icon: 'infinite',         ink: Colors.imSuccess, bg: 'rgba(107,127,92,0.12)',  label: 'No expiry' },
  expired:       { icon: 'alert-circle',     ink: Colors.imError,   bg: 'rgba(139,58,58,0.14)',   label: 'Expired' },
  missing:       { icon: 'close-circle',     ink: Colors.imError,   bg: 'rgba(139,58,58,0.14)',   label: 'Missing' },
};

function shortDate(iso?: string | null) {
  if (!iso || iso.length < 10) return '';
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}`;
}

interface Props {
  templateName: string;
  required: RequiredCert[];
  onBack: () => void;
}

export default function CertGateBlocker({ templateName, required, onBack }: Props) {
  const blocking = required.filter((r) => r.status === 'expired' || r.status === 'missing');

  return (
    <View testID="cert-gate-blocker" style={s.wrap}>
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <View style={s.iconWrap}>
          <Ionicons name="shield-half-outline" size={44} color={Colors.imError} />
        </View>
        <Text style={s.eyebrow}>QUALIFICATION REQUIRED</Text>
        <Text testID="cert-gate-title" style={s.title}>You can't fill this form yet</Text>
        <Text style={s.sub}>
          <Text style={{ fontWeight: '700' }}>{templateName}</Text> needs one or more
          qualifications on file. Ask your admin to add or renew them from the
          Workers screen, then come back.
        </Text>

        <Text style={s.sectionLabel}>REQUIREMENTS</Text>
        <View style={s.list}>
          {required.map((r) => {
            const st = STATUS_STYLE[r.status] || STATUS_STYLE.missing;
            return (
              <View
                key={r.slug}
                testID={`cert-gate-row-${r.slug}`}
                style={[s.row, { backgroundColor: st.bg, borderColor: st.ink }]}
              >
                <Ionicons name={st.icon} size={18} color={st.ink} />
                <View style={{ flex: 1 }}>
                  <Text style={[s.rowLabel, { color: st.ink }]}>{r.label}</Text>
                  <Text style={s.rowMeta}>
                    {st.label}
                    {r.expiry_date ? ` · Expiry ${shortDate(r.expiry_date)}` : ''}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>

        {blocking.length > 0 && (
          <Text testID="cert-gate-blocking-hint" style={s.hint}>
            {blocking.length === 1
              ? '1 requirement is blocking access.'
              : `${blocking.length} requirements are blocking access.`}
          </Text>
        )}
      </ScrollView>

      <View style={s.footer}>
        <TouchableOpacity
          testID="cert-gate-back-btn"
          style={s.backBtn}
          onPress={onBack}
          activeOpacity={0.8}
        >
          <Ionicons name="arrow-back" size={16} color={Colors.imSurface} />
          <Text style={s.backBtnText}>Back to forms</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: Colors.surface },
  content: { padding: 24, paddingBottom: 40 },
  iconWrap: {
    alignSelf: 'flex-start', width: 72, height: 72, borderRadius: 20,
    backgroundColor: 'rgba(139,58,58,0.10)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  eyebrow: {
    fontSize: 10, letterSpacing: 1.5, color: Colors.imBronze,
    fontWeight: '700', marginBottom: 4,
  },
  title: { fontSize: 22, fontWeight: '700', color: Colors.imInk, marginBottom: 8 },
  sub: { fontSize: 14, lineHeight: 20, color: Colors.textSecondary, marginBottom: 20 },
  sectionLabel: {
    fontSize: 10, letterSpacing: 1.2, color: Colors.textTertiary,
    fontWeight: '700', marginBottom: 8,
  },
  list: { gap: 8 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderWidth: 1, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 10,
  },
  rowLabel: { fontSize: 14, fontWeight: '600' },
  rowMeta: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  hint: {
    marginTop: 16, fontSize: 13, color: Colors.imError, fontWeight: '600',
    fontStyle: 'italic',
  },
  footer: {
    padding: 16, borderTopWidth: 1, borderTopColor: Colors.borderLight,
    backgroundColor: Colors.surface,
  },
  backBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.orange, paddingVertical: 14, borderRadius: 12,
  },
  backBtnText: {
    color: Colors.imSurface, fontSize: 15, fontWeight: '700',
    // linter-ok: pure white on brand orange
  },
});
