/**
 * ExpiryBadge — colored expiry pill for SDS and certification files.
 * v58.13.132mi — Port from web ExpiryBadge.jsx (.132mg).
 *
 * Color rules:
 *   🟢 Green  — expires >6 months out
 *   🟡 Amber  — expires within 6 months
 *   🔴 Red    — expired
 *   null      — no badge if expires_at is null
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { expiryBucket, type ExpiryBucket } from '../../lib/filenameExpiry';

interface Props {
  expiresAt: Date | string | null | undefined;
  /** Optional: pass pre-computed bucket to skip re-computing */
  bucket?: ExpiryBucket;
  /** Compact mode: icon only, no text */
  compact?: boolean;
}

const BUCKET_STYLES: Record<string, { bg: string; fg: string; icon: keyof typeof Ionicons.glyphMap; label: string }> = {
  valid:         { bg: '#D1FAE5', fg: '#047857', icon: 'checkmark-circle', label: 'Valid' },
  expiring_soon: { bg: '#FEF3C7', fg: '#B45309', icon: 'alert-circle',    label: 'Expiring' },
  expired:       { bg: '#FEE2E2', fg: '#B91C1C', icon: 'close-circle',    label: 'Expired' },
};

function formatDate(d: Date | string | null | undefined): string {
  if (!d) return '';
  const date = typeof d === 'string' ? new Date(d) : d;
  if (isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function ExpiryBadge({ expiresAt, bucket: bucketProp, compact }: Props) {
  const b = bucketProp || expiryBucket(expiresAt);
  if (!b) return null;

  const style = BUCKET_STYLES[b];
  if (!style) return null;

  if (compact) {
    return (
      <View testID={`expiry-badge-${b}`} style={[st.compactBadge, { backgroundColor: style.bg }]}>
        <Ionicons name={style.icon} size={14} color={style.fg} />
      </View>
    );
  }

  return (
    <View testID={`expiry-badge-${b}`} style={[st.badge, { backgroundColor: style.bg }]}>
      <Ionicons name={style.icon} size={12} color={style.fg} />
      <Text style={[st.label, { color: style.fg }]}>
        {style.label}{expiresAt ? ` ${formatDate(expiresAt)}` : ''}
      </Text>
    </View>
  );
}

const st = StyleSheet.create({
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10,
    alignSelf: 'flex-start',
  },
  compactBadge: {
    width: 22, height: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
  },
  label: {
    fontSize: 11, fontWeight: '700', letterSpacing: 0.3,
  },
});
