import React, { useState } from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import EmailSendSheet from './EmailSendSheet';
import { EMAIL_ENDPOINTS } from '../lib/permissions';
import { Colors } from '../lib/colors';

type Props = {
  resourceKind: string;
  recordId: string;
  subject?: string;
  body?: string;
  recipients?: string[];
  attachments?: { label: string }[];
  label?: string;
};

export default function EmailButton({
  resourceKind, recordId,
  subject = '', body = '', recipients = [],
  attachments = [], label = 'Send via email',
}: Props) {
  const [open, setOpen] = useState(false);
  const endpoint = EMAIL_ENDPOINTS[resourceKind] || '';

  return (
    <>
      <TouchableOpacity
        testID={`email-btn-${resourceKind}-${recordId || 'x'}`}
        style={s.btn}
        onPress={() => setOpen(true)}
        activeOpacity={0.7}
      >
        <Ionicons name="mail" size={14} color={Colors.violet} />
        <Text style={s.text}>{label}</Text>
      </TouchableOpacity>
      <EmailSendSheet
        visible={open}
        onClose={() => setOpen(false)}
        resourceKind={resourceKind}
        recordId={recordId}
        convenienceEndpoint={endpoint}
        defaultSubject={subject}
        defaultBody={body}
        defaultRecipients={recipients}
        attachments={attachments}
      />
    </>
  );
}

const s = StyleSheet.create({
  btn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
    borderWidth: 1, borderColor: Colors.violet, backgroundColor: Colors.violetSoft,
  },
  text: { fontSize: 12, fontWeight: '500', color: Colors.violet },
});
