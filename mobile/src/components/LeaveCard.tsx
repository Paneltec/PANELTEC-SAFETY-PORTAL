/** Leave request row card + status → chip tone. Used by My Leave and Home. */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../theme/colors';
import { Chip } from './ui';
import { niceDate, CATEGORIES, type MyLeave, type LeaveStatus } from '../services/leave';

export const STATUS_TONE: Record<LeaveStatus, 'orange' | 'green' | 'grey' | 'red'> = {
  pending: 'orange', info_requested: 'orange', approved: 'green', rejected: 'red', cancelled: 'grey',
};

export function LeaveCard({ r, onPress }: { r: MyLeave; onPress: () => void }) {
  const cat = CATEGORIES.find((c) => c.key === r.category) ?? CATEGORIES[4];
  const oneDay = r.start_date === r.end_date;
  return (
    <TouchableOpacity testID={`leave-${r.id}`} style={s.card} onPress={onPress} activeOpacity={0.8}>
      <View style={s.cardIcon}><Ionicons name={cat.icon as any} size={20} color={Colors.orange} /></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.cardTitle} numberOfLines={1}>
          {oneDay ? niceDate(r.start_date) : `${niceDate(r.start_date)} – ${niceDate(r.end_date)}`}
        </Text>
        <Text style={s.cardSub} numberOfLines={1}>{cat.label} · {r.hours} h</Text>
      </View>
      <Chip text={r.status_label.toUpperCase()} tone={STATUS_TONE[r.status]} />
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 66, padding: 12,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.cardBorder, borderRadius: 14,
  },
  cardIcon: { width: 40, height: 40, borderRadius: 10, backgroundColor: Colors.orangeSoft, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 15, fontWeight: '700', color: Colors.onCard },
  cardSub: { fontSize: 12, color: Colors.onCardMuted, marginTop: 2 },
});
