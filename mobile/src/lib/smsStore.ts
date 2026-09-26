/**
 * smsStore.ts — v58.13.132p1
 *
 * Local storage for received SMS messages.
 * Rolling cap of 30 messages. AsyncStorage-backed.
 * Used for offline retry queue.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ParsedSms } from './parseJobSms';

const STORE_KEY = 'paneltec_sms_inbox';
const MAX_STORED = 30;

export interface StoredSms {
  id: string;
  sender: string;
  body: string;
  parsed: ParsedSms;
  receivedAt: string;
  synced: boolean;
  jobId?: string;
}

/** Get all stored SMS messages. */
export async function getStoredSms(): Promise<StoredSms[]> {
  try {
    const raw = await AsyncStorage.getItem(STORE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/** Store or update a single SMS. Rolling cap 30. */
export async function storeSms(sms: StoredSms): Promise<void> {
  try {
    const list = await getStoredSms();
    const idx = list.findIndex(s => s.id === sms.id);
    if (idx >= 0) {
      list[idx] = sms;
    } else {
      list.unshift(sms);
    }
    // Rolling cap
    const trimmed = list.slice(0, MAX_STORED);
    await AsyncStorage.setItem(STORE_KEY, JSON.stringify(trimmed));
  } catch (e) {
    console.warn('[smsStore] Failed to persist:', e);
  }
}

/** Get unsynced SMS for retry. */
export async function getUnsyncedSms(): Promise<StoredSms[]> {
  const list = await getStoredSms();
  return list.filter(s => !s.synced);
}

/** Mark a stored SMS as synced. */
export async function markSynced(id: string, jobId?: string): Promise<void> {
  const list = await getStoredSms();
  const item = list.find(s => s.id === id);
  if (item) {
    item.synced = true;
    if (jobId) item.jobId = jobId;
    await AsyncStorage.setItem(STORE_KEY, JSON.stringify(list));
  }
}
