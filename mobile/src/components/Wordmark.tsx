/**
 * Wordmark — Paneltec Group brand mark.
 * Orange chevron accent + PANELTEC GROUP text.
 * v58.13.132cl — renamed from "PANELTEC CIVIL" to "PANELTEC GROUP" (holding company).
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '../theme/colors';

type Props = {
  size?: 'sm' | 'md' | 'lg';
  color?: string;
  showSubtitle?: boolean;
};

const SIZES = {
  sm: { chevron: 20, title: 16, subtitle: 10, gap: 6 },
  md: { chevron: 32, title: 24, subtitle: 13, gap: 8 },
  lg: { chevron: 44, title: 32, subtitle: 15, gap: 10 },
};

export default function Wordmark({ size = 'md', color = Colors.white, showSubtitle = true }: Props) {
  const s = SIZES[size];
  return (
    <View testID="wordmark" style={styles.row}>
      {/* Orange chevron accent */}
      <View style={[styles.chevron, { width: s.chevron, height: s.chevron, borderRadius: s.chevron * 0.2 }]}>
        <Text style={[styles.chevronText, { fontSize: s.chevron * 0.6 }]}>›</Text>
      </View>
      <View style={{ gap: 2 }}>
        <Text style={[styles.title, { fontSize: s.title, color }]}>
          PANELTEC <Text style={{ color: Colors.orange }}>GROUP</Text>
        </Text>
        {showSubtitle && (
          <Text style={[styles.subtitle, { fontSize: s.subtitle, color: color === Colors.white ? 'rgba(255,255,255,0.6)' : Colors.textTertiary }]}>
            FIELD
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  chevron: {
    backgroundColor: Colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chevronText: {
    color: Colors.white,
    fontWeight: '900',
    marginTop: -2,
  },
  title: { fontWeight: '800', letterSpacing: 1 },
  subtitle: { fontWeight: '700', letterSpacing: 3, textTransform: 'uppercase' },
});
