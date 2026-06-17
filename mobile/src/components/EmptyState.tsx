import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '../lib/colors';

interface Props {
  title: string;
  body: string;
  action?: React.ReactNode;
  testID?: string;
}

export default function EmptyState({ title, body, action, testID }: Props) {
  return (
    <View testID={testID || 'empty-state'} style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
      {action && <View style={styles.actionWrap}>{action}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: Colors.border,
    borderRadius: 16,
    backgroundColor: Colors.white,
    padding: 40,
    alignItems: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
  },
  body: {
    marginTop: 8,
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    maxWidth: 300,
  },
  actionWrap: {
    marginTop: 16,
  },
});
