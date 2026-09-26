/**
 * smsReceiver.ts — v58.13.132p1b
 *
 * JS-side listener for the Android SMS BroadcastReceiver events.
 * On iOS this module is a no-op — iPhone users use the paste flow.
 *
 * Flow:
 *   BroadcastReceiver → DeviceEventEmitter "paneltec-sms-received"
 *   → parseJobSms() → POST /api/mobile/daily-jobs → local notification
 *
 * Retry: on each startSmsListener() call, retries unsynced items from smsStore.
 */
import { Platform, DeviceEventEmitter, AppState, type AppStateStatus } from 'react-native';
import * as Notifications from 'expo-notifications';
import { parseJobSms, isPaneltecJobSms } from './parseJobSms';
import { storeSms, getUnsyncedSms, markSynced, type StoredSms } from './smsStore';
import { authPost } from '../services/apiClient';

const SMS_EVENT = 'paneltec-sms-received';

interface SmsEventPayload {
  sender: string;
  body: string;
  timestamp: number;
}

type OnJobCreated = (job: any) => void;

let _listener: ReturnType<typeof DeviceEventEmitter.addListener> | null = null;
let _appStateListener: ReturnType<typeof AppState.addEventListener> | null = null;
let _onJobCreated: OnJobCreated | null = null;

/** Set a callback to be notified when a job is auto-created from SMS. */
export function setOnJobCreated(cb: OnJobCreated | null) {
  _onJobCreated = cb;
}

/** Post parsed SMS to backend and fire local notification on success. */
async function postAndNotify(parsed: ReturnType<typeof parseJobSms>, stored: StoredSms): Promise<boolean> {
  try {
    const res = await authPost<any>('/api/mobile/daily-jobs', {
      truck: parsed.truck || '',
      date: parsed.date || new Date().toISOString().slice(0, 10),
      site_name: parsed.site_name || '',
      address: parsed.address || '',
      customer: parsed.customer || '',
      staff: parsed.staff,
      notes: parsed.notes || '',
      source: 'android_sms',
    });

    if (res.ok && res.data?.id) {
      await markSynced(stored.id, res.data.id);

      await Notifications.scheduleNotificationAsync({
        content: {
          title: '📋 New job allocation',
          body: `${parsed.site_name || 'New site'} · ${parsed.truck || 'Unknown truck'} · ${parsed.date || 'Today'}. Tap to accept.`,
          data: { jobId: res.data.id, type: 'new_job', deepLink: `paneltec://job/${res.data.id}` },
          sound: true,
        },
        trigger: null,
      });

      _onJobCreated?.(res.data);
      console.log('[SMS] Job created:', res.data.id);
      return true;
    }
  } catch (err) {
    console.warn('[SMS] POST failed, queued for retry:', err);
  }
  return false;
}

/** Retry all unsynced SMS from the store. Called on foreground + listener start. */
async function retryUnsynced() {
  try {
    const pending = await getUnsyncedSms();
    if (!pending.length) return;
    console.log(`[SMS] Retrying ${pending.length} unsynced SMS...`);
    for (const item of pending) {
      const parsed = parseJobSms(item.body);
      if (parsed.truck || parsed.site_name) {
        const ok = await postAndNotify(parsed, item);
        if (!ok) break; // network down, stop retrying
      }
    }
  } catch (err) {
    console.warn('[SMS] Retry error:', err);
  }
}

/** Handle incoming SMS event from BroadcastReceiver. */
async function handleSmsEvent(evt: SmsEventPayload) {
  console.log('[SMS] Received from', evt.sender, '— length:', evt.body?.length);

  if (!evt.body || !isPaneltecJobSms(evt.body)) {
    console.log('[SMS] Not a Paneltec job SMS, ignoring');
    return;
  }

  const parsed = parseJobSms(evt.body);
  if (!parsed.truck && !parsed.site_name) {
    console.log('[SMS] Parser returned empty, ignoring');
    return;
  }

  const stored: StoredSms = {
    id: `sms_${evt.timestamp || Date.now()}`,
    sender: evt.sender,
    body: evt.body,
    parsed,
    receivedAt: new Date(evt.timestamp || Date.now()).toISOString(),
    synced: false,
  };
  await storeSms(stored);
  await postAndNotify(parsed, stored);
}

/** Start listening for SMS events (Android only). Also retries unsynced items. */
export function startSmsListener() {
  if (Platform.OS !== 'android' || _listener) return;

  _listener = DeviceEventEmitter.addListener(SMS_EVENT, handleSmsEvent);

  // Retry unsynced on start
  retryUnsynced();

  // Retry on foreground
  _appStateListener = AppState.addEventListener('change', (state: AppStateStatus) => {
    if (state === 'active') retryUnsynced();
  });

  console.log('[SMS] Listener registered for Android SMS events');
}

/** Stop listening. */
export function stopSmsListener() {
  _listener?.remove();
  _listener = null;
  _appStateListener?.remove();
  _appStateListener = null;
}

/**
 * DEV ONLY: Simulate receiving an SMS. Fires the same event handler.
 * Used by the debug button on Home screen for testing without a real SMS.
 */
export function debugFireTestSms() {
  const testBody = `Hi DANIEL BUTLER, you have been allocated to the following job.
Truck: Cappellotto 2 - Volvo - XT48AK
Date: 15-09-26
Site: 78 Corin Street West Launceston
Address: 78 Corin Street West Launceston
Customer: Shaw
Staff on this job: DANIEL BUTLER, JARROD TARGETT, JASON DONNELLAN
Notes: Kroll to site to expose main, ring Jason to complete tapping when exposed`;

  handleSmsEvent({
    sender: 'Paneltec01',
    body: testBody,
    timestamp: Date.now(),
  });
}
