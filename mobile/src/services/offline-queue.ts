/**
 * Offline queue — AsyncStorage-backed request queue.
 * Scaffolded in M1. Not called by any screen yet.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const QUEUE_KEY = '@paneltec_offline_queue';

export type QueueItem = {
  id: string;
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  url: string;
  body: any;
  createdAt: string;
};

export async function enqueue(item: Omit<QueueItem, 'id' | 'createdAt'>): Promise<void> {
  const items = await pending();
  items.push({
    ...item,
    id: `oq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
  });
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(items));
}

export async function pending(): Promise<QueueItem[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

export async function flush(
  sender: (item: QueueItem) => Promise<boolean>,
): Promise<{ sent: number; failed: number }> {
  const items = await pending();
  let sent = 0;
  let failed = 0;
  const remaining: QueueItem[] = [];
  for (const item of items) {
    try {
      const ok = await sender(item);
      if (ok) { sent++; } else { remaining.push(item); failed++; }
    } catch {
      remaining.push(item);
      failed++;
    }
  }
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(remaining));
  return { sent, failed };
}
