/** Record detail — read-only view of one pre-start / hazard / incident / diary / inspection. */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Colors } from '../../../src/theme/colors';
import { Screen, BackHeader, Panel, KV, Loading, Chip, Empty } from '../../../src/components/ui';
import { getItem, type CaptureModuleKey, type CaptureItem } from '../../../src/services/capture';
import { TITLES } from './index';

const HIDE = new Set(['id', 'org_id', 'created_by', 'updated_at', 'deleted_at', 'workspace_id', 'ai_analysis', '_offline', 'structured_log', 'linked_swms_ids', 'linked_permits', 'crew_worker_ids', 'evidence_photos', 'follow_up_actions', 'corrective_actions', 'checklist_items', 'photo_url', 'source', 'gps_accuracy']);

function label(k: string) { return k.replace(/_/g, ' ').replace(/\bgps\b/i, 'GPS').toUpperCase(); }
function fmt(v: any): string {
  if (v == null || v === '') return '';
  if (Array.isArray(v)) return v.map(x => typeof x === 'object' ? (x.name ? `${x.name}${x.role ? ` (${x.role})` : ''}${x.signature_ts ? ' ✓' : ''}` : JSON.stringify(x)) : String(x)).join('\n');
  if (typeof v === 'object') return JSON.stringify(v);
  if (typeof v === 'number') return String(Math.round(v * 100000) / 100000);
  return String(v);
}

export default function CaptureDetailScreen() {
  const { module, id } = useLocalSearchParams<{ module: CaptureModuleKey; id: string }>();
  const key = (module || 'pre-starts') as CaptureModuleKey;
  const [item, setItem] = useState<CaptureItem | null | undefined>(undefined);

  useEffect(() => {
    if (!id) return;
    getItem(key, id).then(setItem).catch(() => setItem(null));
  }, [key, id]);

  const status = item?.status || item?.follow_up_status || item?.severity;
  const rows = item ? Object.entries(item).filter(([k, v]) => !HIDE.has(k) && v != null && v !== '' && !(Array.isArray(v) && v.length === 0)) : [];

  return (
    <Screen testID={`capture-detail-${key}`}>
      <BackHeader title={TITLES[key]} right={status ? <Chip text={String(status).replace(/_/g, ' ').toUpperCase()} tone={/closed|signed|complete/i.test(String(status)) ? 'green' : 'orange'} /> : undefined} />
      {item === undefined ? <Loading text="Loading…" /> : item === null ? (
        <Empty icon="cloud-offline-outline" title="Couldn't load this record" body="Check your connection and try again." />
      ) : (
        <Panel>
          {rows.map(([k, v], i) => <KV key={k} k={label(k)} v={fmt(v)} first={i === 0} />)}
        </Panel>
      )}
      {!!item?.created_at && <Text style={s.foot}>Created {String(item.created_at).replace('T', ' ').slice(0, 16)}</Text>}
    </Screen>
  );
}

const s = StyleSheet.create({ foot: { color: Colors.onScreenSubtle, fontSize: 11, textAlign: 'center', marginTop: 14 } });
