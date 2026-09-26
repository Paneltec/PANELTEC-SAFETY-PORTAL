/**
 * smsReceiver.ts — v58.13.132p1
 *
 * JS-side listener for the Android SMS BroadcastReceiver events.
 * On iOS this module is a no-op — iPhone users use the paste flow.
 *
 * Flow:
 *   BroadcastReceiver → DeviceEventEmitter "paneltec-sms-received"
 *   → parseJobSms() → POST /api/mobile/daily-jobs → local notification
 */
import { Platform, DeviceEventEmitter } from 'react-native';
import * as Notifications from 'expo-notifications';
import { parseJobSms, isPaneltecJobSms } from './parseJobSms';
import { storeSms, type StoredSms } from './smsStore';
import { authPost } from '../services/apiClient';

const SMS_EVENT = 'paneltec-sms-received';

interface SmsEventPayload {
  sender: string;
  body: string;
  timestamp: number;
}

type OnJobCreated = (job: any) => void;

let _listener: ReturnType<typeof DeviceEventEmitter.addListener> | null = null;
let _onJobCreated: OnJobCreated | null = null;

/** Set a callback to be notified when a job is auto-created from SMS. */
export function setOnJobCreated(cb: OnJobCreated | null) {
  _onJobCreated = cb;
}

/** Start listening for SMS events (Android only). */
export function startSmsListener() {
  if (Platform.OS !== 'android' || _listener) return;

  _listener = DeviceEventEmitter.addListener(SMS_EVENT, async (evt: SmsEventPayload) => {
    console.log('[SMS] Received from', evt.sender, '— length:', evt.body?.length);

    if (!evt.body || !isPaneltecJobSms(evt.body)) {
      console.log('[SMS] Not a Paneltec job SMS, ignoring');
      return;
    }

    // Parse locally
    const parsed = parseJobSms(evt.body);
    if (!parsed.truck && !parsed.site_name) {
      console.log('[SMS] Parser returned empty, ignoring');
      return;
    }

    // Store locally (offline-safe, retry queue)
    const stored: StoredSms = {
      id: `sms_${evt.timestamp || Date.now()}`,
      sender: evt.sender,
      body: evt.body,
      parsed,
      receivedAt: new Date(evt.timestamp || Date.now()).toISOString(),
      synced: false,
    };
    await storeSms(stored);

    // Try to POST to backend
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
        stored.synced = true;
        stored.jobId = res.data.id;
        await storeSms(stored);

        // Fire local notification
        await Notifications.scheduleNotificationAsync({
          content: {
            title: '📋 New job allocation',
            body: `${parsed.site_name || 'New site'} · ${parsed.truck || 'Unknown truck'} · ${parsed.date || 'Today'}`,
            data: { jobId: res.data.id, type: 'new_job' },
            sound: true,
          },
          trigger: null, // Immediate
        });

        _onJobCreated?.(res.data);
        console.log('[SMS] Job created:', res.data.id);
      } else {
        console.warn('[SMS] Backend POST failed, queued for retry');
      }
    } catch (err) {
      console.warn('[SMS] Network error, queued for retry:', err);
    }
  });

  console.log('[SMS] Listener registered for Android SMS events');
}

/** Stop listening. */
export function stopSmsListener() {
  _listener?.remove();
  _listener = null;
}
