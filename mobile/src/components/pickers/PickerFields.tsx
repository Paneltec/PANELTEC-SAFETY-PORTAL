/**
 * PickerFields — 7 picker field components for the mobile form runner.
 * Mirrors web's /frontend/src/components/forms/PickerFields.jsx
 *
 * Types: worker_picker, vehicle_navixy, customer_picker, site_picker,
 *        job_picker, asset_scan, contact_picker
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, TextInput, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../theme/colors';
import PickerModal from './PickerModal';
import {
  fetchWorkers, fetchVehicles, fetchCustomers, fetchSites, fetchJobs,
  fetchAssets, lookupAsset,
  type WorkerItem, type VehicleItem, type CustomerItem,
  type SiteItem, type JobItem, type AssetItem,
} from '../../services/pickerApi';
import * as Location from 'expo-location';
import { CameraView, useCameraPermissions } from 'expo-camera';

// ── Shared types ──
interface PickerProps {
  field: { id: string; label: string; type: string; config?: Record<string, any> };
  value: any;
  onChange: (v: any) => void;
  allValues?: Record<string, any>;
  allFields?: { id: string; label: string; type: string; config?: Record<string, any> }[];
}

// ── Shared chip for selected value ──
function SelectedChip({
  icon, primary, secondary, onClear, testId,
}: {
  icon: string; primary: string; secondary?: string; onClear: () => void; testId: string;
}) {
  return (
    <View testID={testId} style={cs.chip}>
      <View style={cs.chipIcon}>
        <Ionicons name={icon as any} size={14} color={Colors.success} />
      </View>
      <View style={cs.chipBody}>
        <Text style={cs.chipPrimary} numberOfLines={1}>{primary}</Text>
        {secondary ? <Text style={cs.chipSecondary} numberOfLines={1}>{secondary}</Text> : null}
      </View>
      <TouchableOpacity testID={`${testId}-clear`} onPress={onClear} style={cs.chipClear}>
        <Ionicons name="close" size={14} color={Colors.success} />
      </TouchableOpacity>
    </View>
  );
}

// ── Trigger button (placeholder when nothing selected) ──
function PickerTrigger({
  icon, placeholder, onPress, testId,
}: {
  icon: string; placeholder: string; onPress: () => void; testId: string;
}) {
  return (
    <TouchableOpacity testID={testId} style={cs.trigger} onPress={onPress}>
      <View style={cs.triggerIcon}>
        <Ionicons name={icon as any} size={14} color={Colors.textTertiary} />
      </View>
      <Text style={cs.triggerText} numberOfLines={1}>{placeholder}</Text>
      <Ionicons name="chevron-down" size={16} color={Colors.textTertiary} />
    </TouchableOpacity>
  );
}

// ── Row renderers (shared) ──
function InitialsAvatar({ name, bg, fg }: { name: string; bg: string; fg: string }) {
  const initials = (name || '?').split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  return (
    <View style={[cs.avatar, { backgroundColor: bg }]}>
      <Text style={[cs.avatarText, { color: fg }]}>{initials}</Text>
    </View>
  );
}

function IconAvatar({ icon, bg, fg }: { icon: string; bg: string; fg: string }) {
  return (
    <View style={[cs.avatar, { backgroundColor: bg }]}>
      <Ionicons name={icon as any} size={14} color={fg} />
    </View>
  );
}

// ═══════════════════════════════════════════════════
// 1. WORKER PICKER
// ═══════════════════════════════════════════════════
export function WorkerPicker({ field, value, onChange, allValues, allFields }: PickerProps) {
  const cfg = field.config || {};
  const multi = !!cfg.multi;
  const inlineToggle = !!cfg.inline_company_toggle;
  const companyOptions: { label: string; simpro_id: string }[] =
    Array.isArray(cfg.company_options) ? cfg.company_options : [];

  const [modalOpen, setModalOpen] = useState(false);
  const [companyFilter, setCompanyFilter] = useState<string | null>(null);

  const testId = `worker-picker-${field.id}`;

  // Multi values
  const values = useMemo<WorkerItem[]>(
    () => multi ? (Array.isArray(value) ? value : []) : [],
    [multi, value],
  );
  const selectedIds = useMemo(() => new Set(values.map((w) => w.id)), [values]);

  const fetchFn = useCallback(async (q: string) => {
    return fetchWorkers(q || undefined, companyFilter || undefined);
  }, [companyFilter]);

  const handlePickMulti = useCallback((w: WorkerItem) => {
    if (selectedIds.has(w.id)) return;
    onChange([...values, w]);
  }, [values, selectedIds, onChange]);

  const handlePickSingle = useCallback((w: WorkerItem) => {
    onChange(w);
    setModalOpen(false);
  }, [onChange]);

  const removeWorker = useCallback((idx: number) => {
    const next = values.slice();
    next.splice(idx, 1);
    onChange(next);
  }, [values, onChange]);

  // Company toggle top slot
  const topSlot = inlineToggle && companyOptions.length > 0 ? (
    <View style={cs.companyRow}>
      <TouchableOpacity
        testID={`${testId}-company-all`}
        style={[cs.companyChip, companyFilter === null && cs.companyChipActive]}
        onPress={() => setCompanyFilter(null)}
      >
        <Text style={[cs.companyChipText, companyFilter === null && cs.companyChipTextActive]}>
          All
        </Text>
      </TouchableOpacity>
      {companyOptions.map((opt) => (
        <TouchableOpacity
          key={opt.simpro_id}
          testID={`${testId}-company-${opt.simpro_id}`}
          style={[cs.companyChip, companyFilter === String(opt.simpro_id) && cs.companyChipActive]}
          onPress={() => setCompanyFilter(String(opt.simpro_id))}
        >
          <Text style={[
            cs.companyChipText,
            companyFilter === String(opt.simpro_id) && cs.companyChipTextActive,
          ]}>
            {opt.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  ) : undefined;

  const renderRow = useCallback((w: WorkerItem) => (
    <>
      <InitialsAvatar name={w.name} bg="#DBEAFE" fg="#1D4ED8" />
      <View style={cs.rowBody}>
        <Text style={cs.rowPrimary} numberOfLines={1}>{w.name}</Text>
        <Text style={cs.rowSecondary} numberOfLines={1}>
          {[w.trade, w.phone].filter(Boolean).join(' · ')}
        </Text>
      </View>
    </>
  ), []);

  // ── Multi mode ──
  if (multi) {
    return (
      <View testID={`${testId}-multi`}>
        {values.length > 0 && (
          <View style={cs.multiChipsRow}>
            {values.map((w, idx) => (
              <View key={`${w.id}-${idx}`} testID={`${testId}-multi-chip-${w.id}`} style={cs.multiChip}>
                <Ionicons name="person" size={11} color={Colors.success} />
                <Text style={cs.multiChipName}>{w.name}</Text>
                <TouchableOpacity
                  testID={`${testId}-multi-remove-${w.id}`}
                  onPress={() => removeWorker(idx)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="close" size={12} color={Colors.success} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}
        <PickerTrigger
          icon="people"
          placeholder={field.config?.placeholder || `Add ${field.label || 'workers'}…`}
          onPress={() => setModalOpen(true)}
          testId={`${testId}-toggle`}
        />
        <PickerModal
          visible={modalOpen}
          onClose={() => setModalOpen(false)}
          title={field.label || 'Select Workers'}
          fetchItems={fetchFn}
          renderRow={renderRow}
          onPick={handlePickMulti}
          topSlot={topSlot}
          selectedIds={selectedIds}
        />
      </View>
    );
  }

  // ── Single mode ──
  if (value && typeof value === 'object' && value.id) {
    return (
      <SelectedChip
        icon="person"
        primary={value.name}
        secondary={[value.trade, value.phone].filter(Boolean).join(' · ')}
        onClear={() => onChange(null)}
        testId={`${testId}-chip`}
      />
    );
  }

  return (
    <>
      <PickerTrigger
        icon="person"
        placeholder={field.config?.placeholder || `Search ${field.label || 'workers'}…`}
        onPress={() => setModalOpen(true)}
        testId={`${testId}-toggle`}
      />
      <PickerModal
        visible={modalOpen}
        onClose={() => setModalOpen(false)}
        title={field.label || 'Select Worker'}
        fetchItems={fetchFn}
        renderRow={renderRow}
        onPick={handlePickSingle}
        topSlot={topSlot}
      />
    </>
  );
}

// ═══════════════════════════════════════════════════
// 2. VEHICLE NAVIXY PICKER
// ═══════════════════════════════════════════════════
export function VehicleNavixyPicker({ field, value, onChange }: PickerProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [manualReg, setManualReg] = useState('');
  const [disconnectedMsg, setDisconnectedMsg] = useState<string | null>(null);
  const testId = `vehicle-picker-${field.id}`;

  const fetchFn = useCallback(async (q: string) => {
    const result = await fetchVehicles();
    if (result.status === 'navixy_disconnected' || result.status === 'navixy_unavailable') {
      setDisconnectedMsg(result.message || 'Fleet integration needs reconnecting.');
    } else if (result.status === 'local_fleet_fallback') {
      setDisconnectedMsg(result.message || null);
    } else {
      setDisconnectedMsg(null);
    }
    if (q) {
      const lower = q.toLowerCase();
      return result.vehicles.filter((v) =>
        v.label?.toLowerCase().includes(lower) ||
        v.registration?.toLowerCase().includes(lower) ||
        v.plate?.toLowerCase().includes(lower)
      );
    }
    return result.vehicles;
  }, []);

  const handlePick = useCallback((v: VehicleItem) => {
    onChange({
      id: v.id, navixy_id: v.id, label: v.label,
      registration: v.registration || v.plate,
      vehicle_type: v.vehicle_type,
    });
    setModalOpen(false);
  }, [onChange]);

  const handleManualSave = useCallback(() => {
    if (!manualReg.trim()) return;
    onChange({
      id: null, navixy_id: null, label: manualReg.trim(),
      registration: manualReg.trim(), vehicle_type: 'manual_entry',
    });
    setManualMode(false);
  }, [manualReg, onChange]);

  const renderRow = useCallback((v: VehicleItem) => (
    <>
      <IconAvatar icon="car" bg="#FEF3C7" fg="#92400E" />
      <View style={cs.rowBody}>
        <Text style={cs.rowPrimary} numberOfLines={1}>{v.label || v.registration}</Text>
        <Text style={cs.rowSecondary} numberOfLines={1}>
          {[v.vehicle_type, v.registration].filter(Boolean).join(' · ')}
        </Text>
      </View>
    </>
  ), []);

  if (value && typeof value === 'object' && (value.id || value.registration)) {
    return (
      <SelectedChip
        icon="car"
        primary={value.label || value.registration || 'Vehicle'}
        secondary={value.vehicle_type || undefined}
        onClear={() => onChange(null)}
        testId={`${testId}-chip`}
      />
    );
  }

  return (
    <View>
      {disconnectedMsg && (
        <View style={cs.warnBanner}>
          <Ionicons name="alert-circle" size={14} color={Colors.warning} />
          <Text style={cs.warnText}>{disconnectedMsg}</Text>
        </View>
      )}

      {manualMode ? (
        <View style={cs.manualRow}>
          <TextInput
            testID={`${testId}-manual-input`}
            style={cs.manualInput}
            value={manualReg}
            onChangeText={setManualReg}
            placeholder="Enter registration…"
            placeholderTextColor={Colors.textTertiary}
            autoCapitalize="characters"
          />
          <TouchableOpacity testID={`${testId}-manual-save`} style={cs.manualSaveBtn} onPress={handleManualSave}>
            <Ionicons name="checkmark" size={18} color={Colors.white} />
          </TouchableOpacity>
          <TouchableOpacity testID={`${testId}-manual-cancel`} style={cs.manualCancelBtn} onPress={() => setManualMode(false)}>
            <Ionicons name="close" size={18} color={Colors.textTertiary} />
          </TouchableOpacity>
        </View>
      ) : (
        <View style={cs.vehicleActions}>
          <TouchableOpacity style={cs.vehicleTriggerBtn} onPress={() => setModalOpen(true)} testID={`${testId}-toggle`}>
            <Ionicons name="car" size={14} color={Colors.textTertiary} />
            <Text style={cs.triggerText} numberOfLines={1}>Select vehicle…</Text>
            <Ionicons name="chevron-down" size={16} color={Colors.textTertiary} />
          </TouchableOpacity>
          <TouchableOpacity style={cs.manualToggle} onPress={() => setManualMode(true)} testID={`${testId}-manual-toggle`}>
            <Ionicons name="create-outline" size={14} color={Colors.info} />
            <Text style={cs.manualToggleText}>Manual</Text>
          </TouchableOpacity>
        </View>
      )}

      <PickerModal
        visible={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Select Vehicle"
        fetchItems={fetchFn}
        renderRow={renderRow}
        onPick={handlePick}
      />
    </View>
  );
}

// ═══════════════════════════════════════════════════
// 3. CUSTOMER PICKER
// ═══════════════════════════════════════════════════
export function CustomerPicker({ field, value, onChange }: PickerProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const testId = `customer-picker-${field.id}`;

  const fetchFn = useCallback(async (q: string) => {
    return fetchCustomers(q || undefined);
  }, []);

  const handlePick = useCallback((c: CustomerItem) => {
    onChange(c);
    setModalOpen(false);
  }, [onChange]);

  const renderRow = useCallback((c: CustomerItem) => (
    <>
      <IconAvatar icon="business" bg="#EDE9FE" fg="#7C3AED" />
      <View style={cs.rowBody}>
        <Text style={cs.rowPrimary} numberOfLines={1}>{c.name}</Text>
        <Text style={cs.rowSecondary} numberOfLines={1}>{c.company_label || 'Simpro'}</Text>
      </View>
    </>
  ), []);

  if (value && typeof value === 'object' && value.id) {
    return (
      <SelectedChip
        icon="business"
        primary={value.name}
        secondary={value.company_label || undefined}
        onClear={() => onChange(null)}
        testId={`${testId}-chip`}
      />
    );
  }

  return (
    <>
      <PickerTrigger
        icon="business"
        placeholder={`Search ${field.label || 'customers'}…`}
        onPress={() => setModalOpen(true)}
        testId={`${testId}-toggle`}
      />
      <PickerModal
        visible={modalOpen}
        onClose={() => setModalOpen(false)}
        title={field.label || 'Select Customer'}
        fetchItems={fetchFn}
        renderRow={renderRow}
        onPick={handlePick}
      />
    </>
  );
}

// ═══════════════════════════════════════════════════
// 4. SITE PICKER (with GPS + dependsOn)
// ═══════════════════════════════════════════════════
export function SitePicker({ field, value, onChange, allValues, allFields }: PickerProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [geo, setGeo] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const testId = `site-picker-${field.id}`;

  const depId = field.config?.dependsOn || null;
  const depValue = useMemo(() => {
    if (!depId || !allValues) return null;
    const v = allValues[depId];
    if (!v) return null;
    if (typeof v === 'string') return v;
    return v.name || v.customer_name || v.simpro_customer_id || v.id || null;
  }, [allValues, depId]);

  // Request GPS once
  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setGeo({ lat: loc.coords.latitude, lng: loc.coords.longitude, accuracy: Math.round(loc.coords.accuracy || 0) });
      } catch { /* ignore */ }
    })();
  }, []);

  const fetchFn = useCallback(async (q: string) => {
    return fetchSites(
      q || undefined,
      depValue ? String(depValue) : undefined,
      geo?.lat, geo?.lng,
    );
  }, [depValue, geo]);

  const handlePick = useCallback((s: SiteItem) => {
    onChange(s);
    setModalOpen(false);
  }, [onChange]);

  const handleUseGps = useCallback(() => {
    if (!geo) return;
    onChange({
      id: `gps:${geo.lat.toFixed(5)},${geo.lng.toFixed(5)}`,
      name: `Custom location · ${geo.lat.toFixed(4)}, ${geo.lng.toFixed(4)}`,
      lat: geo.lat, lng: geo.lng, accuracy: geo.accuracy,
      captured_at: new Date().toISOString(), freeform: true,
    });
    setModalOpen(false);
  }, [geo, onChange]);

  const pinnedRow = geo ? (
    <TouchableOpacity testID={`${testId}-use-gps`} style={cs.gpsRow} onPress={handleUseGps}>
      <IconAvatar icon="location" bg="#D1FAE5" fg="#10B981" />
      <View style={cs.rowBody}>
        <Text style={[cs.rowPrimary, { color: Colors.success }]}>Use current location</Text>
        <Text style={cs.rowSecondary}>
          {geo.lat.toFixed(4)}, {geo.lng.toFixed(4)} (±{geo.accuracy}m)
        </Text>
      </View>
    </TouchableOpacity>
  ) : undefined;

  const renderRow = useCallback((s: SiteItem) => (
    <>
      <IconAvatar icon="location" bg="#D1FAE5" fg="#10B981" />
      <View style={cs.rowBody}>
        <Text style={cs.rowPrimary} numberOfLines={1}>{s.name}</Text>
        <Text style={cs.rowSecondary} numberOfLines={1}>
          {[s.customer_name, s.address, s.distance_km != null ? `${s.distance_km.toFixed(1)} km` : null]
            .filter(Boolean).join(' · ')}
        </Text>
      </View>
    </>
  ), []);

  if (value && typeof value === 'object' && value.id) {
    const secondary = value.freeform
      ? `±${value.accuracy || 0}m`
      : (value.customer_name || value.address || undefined);
    return (
      <SelectedChip
        icon="location"
        primary={value.name || value.label || 'Site'}
        secondary={secondary}
        onClear={() => onChange(null)}
        testId={`${testId}-chip`}
      />
    );
  }

  return (
    <>
      <PickerTrigger
        icon="location"
        placeholder={`Search ${field.label || 'sites'}…`}
        onPress={() => setModalOpen(true)}
        testId={`${testId}-toggle`}
      />
      <PickerModal
        visible={modalOpen}
        onClose={() => setModalOpen(false)}
        title={field.label || 'Select Site'}
        fetchItems={fetchFn}
        renderRow={renderRow}
        onPick={handlePick}
        pinnedRow={pinnedRow}
      />
    </>
  );
}

// ═══════════════════════════════════════════════════
// 5. JOB PICKER (with dependsOn)
// ═══════════════════════════════════════════════════
export function JobPicker({ field, value, onChange, allValues, allFields }: PickerProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const testId = `job-picker-${field.id}`;

  const depId = field.config?.dependsOn || null;
  const depFieldType = useMemo(() => {
    if (!depId || !allFields) return null;
    const f = allFields.find((x) => x.id === depId);
    return f?.type || null;
  }, [allFields, depId]);

  const depValue = useMemo(() => {
    if (!depId || !allValues) return null;
    const v = allValues[depId];
    if (!v) return null;
    if (typeof v === 'string') return v;
    return v.name || v.customer_name || v.simpro_customer_id || v.id || null;
  }, [allValues, depId]);

  const fetchParams = useMemo(() => {
    const p: Record<string, string> = { status: 'open' };
    if (depValue) {
      if (depFieldType === 'customer_picker') p.customer_id = String(depValue);
      else if (depFieldType === 'site_picker') p.site_id = String(depValue);
    }
    return p;
  }, [depValue, depFieldType]);

  const fetchFn = useCallback(async (q: string) => {
    return fetchJobs(q || undefined, fetchParams);
  }, [fetchParams]);

  const handlePick = useCallback((j: JobItem) => {
    onChange(j);
    setModalOpen(false);
  }, [onChange]);

  const renderRow = useCallback((j: JobItem) => (
    <>
      <IconAvatar icon="briefcase" bg="#FEF3C7" fg="#92400E" />
      <View style={cs.rowBody}>
        <Text style={cs.rowPrimary} numberOfLines={1}>
          {j.name || `Job #${j.simpro_job_id}`}
        </Text>
        <Text style={cs.rowSecondary} numberOfLines={1}>
          {[j.customer_name, j.site_name, j.stage].filter(Boolean).join(' · ')}
        </Text>
      </View>
    </>
  ), []);

  // Block if dependency not yet picked
  if (depId && !depValue) {
    const depLabel = allFields?.find((x) => x.id === depId)?.label || 'parent';
    return (
      <View testID={`${testId}-blocked`} style={cs.blockedWrap}>
        <Ionicons name="briefcase-outline" size={20} color={Colors.textTertiary} />
        <Text style={cs.blockedTitle}>Pick a {depLabel} first</Text>
        <Text style={cs.blockedHint}>Jobs filter to the selected parent record.</Text>
      </View>
    );
  }

  if (value && typeof value === 'object' && value.id) {
    return (
      <SelectedChip
        icon="briefcase"
        primary={value.name || `Job #${value.simpro_job_id}`}
        secondary={[value.customer_name, value.site_name, value.stage].filter(Boolean).join(' · ')}
        onClear={() => onChange(null)}
        testId={`${testId}-chip`}
      />
    );
  }

  return (
    <>
      <PickerTrigger
        icon="briefcase"
        placeholder={`Search ${field.label || 'jobs'}…`}
        onPress={() => setModalOpen(true)}
        testId={`${testId}-toggle`}
      />
      <PickerModal
        visible={modalOpen}
        onClose={() => setModalOpen(false)}
        title={field.label || 'Select Job'}
        fetchItems={fetchFn}
        renderRow={renderRow}
        onPick={handlePick}
      />
    </>
  );
}

// ═══════════════════════════════════════════════════
// 6. ASSET SCAN (QR camera + manual pick)
// ═══════════════════════════════════════════════════

const SCAN_TOKEN_RE = /\/scan\/([A-Za-z0-9_-]{6,32})$/;
const RAW_TOKEN_RE = /^[A-Za-z0-9_-]{6,32}$/;

/** Parse a scan token from raw QR data (raw token or /scan/{token} URL). */
function parseScanToken(payload: string): string | null {
  if (!payload) return null;
  const trimmed = payload.trim();
  if (RAW_TOKEN_RE.test(trimmed)) return trimmed;
  try {
    const u = new URL(trimmed);
    const m = u.pathname.match(SCAN_TOKEN_RE);
    if (m) return m[1];
  } catch { /* not a URL */ }
  const m = trimmed.match(SCAN_TOKEN_RE);
  return m ? m[1] : null;
}

export function AssetScanPicker({ field, value, onChange }: PickerProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [resolved, setResolved] = useState<any>(null);
  const [scanErr, setScanErr] = useState('');
  const [scanned, setScanned] = useState(false);
  const [camPermission, requestCamPermission] = useCameraPermissions();
  const testId = `asset-scan-${field.id}`;

  const fetchFn = useCallback(async (q: string) => {
    return fetchAssets(q || undefined);
  }, []);

  const handlePick = useCallback((a: AssetItem) => {
    onChange({
      asset_id: a.id, scan_token: a.scan_token, name: a.name,
      rego_serial: a.rego_serial, asset_type: a.asset_type,
      kind: a.kind, resolved_via: 'manual_pick',
      resolved_at: new Date().toISOString(),
    });
    setModalOpen(false);
  }, [onChange]);

  const commitResolved = useCallback((asset: any, via: string) => {
    onChange({
      asset_id: asset.id, scan_token: asset.scan_token, name: asset.name,
      rego_serial: asset.rego_serial, asset_type: asset.asset_type,
      kind: asset.kind, resolved_via: via,
      resolved_at: new Date().toISOString(),
    });
    setResolved(null); setScanning(false); setScanErr('');
  }, [onChange]);

  const handleBarcodeScan = useCallback(async ({ data }: { data: string }) => {
    if (scanned || resolving) return;
    setScanned(true);
    const token = parseScanToken(data);
    if (!token) {
      setScanErr('Not a valid asset code. Try again or pick manually.');
      setTimeout(() => setScanned(false), 2000);
      return;
    }
    setResolving(true); setScanErr('');
    try {
      const asset = await lookupAsset(token);
      if (!asset) {
        setScanErr('Unknown asset code. Try again or pick manually.');
        setTimeout(() => setScanned(false), 2000);
      } else {
        setResolved({ ...asset, _via: 'qr_scan' });
      }
    } catch {
      setScanErr('Lookup failed. Try again.');
      setTimeout(() => setScanned(false), 2000);
    } finally {
      setResolving(false);
    }
  }, [scanned, resolving]);

  const openScanner = useCallback(async () => {
    setScanErr('');
    setScanned(false);
    setResolved(null);
    if (!camPermission?.granted) {
      const result = await requestCamPermission();
      if (!result.granted) {
        setScanErr('Camera permission denied. Use manual search instead.');
        return;
      }
    }
    setScanning(true);
  }, [camPermission, requestCamPermission]);

  const renderRow = useCallback((a: AssetItem) => (
    <>
      <IconAvatar icon="hardware-chip" bg="#DBEAFE" fg="#1D4ED8" />
      <View style={cs.rowBody}>
        <Text style={cs.rowPrimary} numberOfLines={1}>{a.name || a.rego_serial}</Text>
        <Text style={cs.rowSecondary} numberOfLines={1}>
          {[a.asset_type, a.rego_serial].filter(Boolean).join(' · ')}
        </Text>
      </View>
    </>
  ), []);

  // Already-filled view
  if (value && typeof value === 'object' && (value.asset_id || value.id)) {
    return (
      <SelectedChip
        icon="hardware-chip"
        primary={value.name || value.rego_serial || 'Asset'}
        secondary={value.asset_type || undefined}
        onClear={() => onChange(null)}
        testId={`${testId}-chip`}
      />
    );
  }

  // Confirmation card after QR scan resolves
  if (resolved) {
    return (
      <View testID={`${testId}-confirm`} style={cs.confirmCard}>
        <View style={cs.confirmHeader}>
          <IconAvatar icon="checkmark-circle" bg="#D1FAE5" fg="#10B981" />
          <View style={cs.rowBody}>
            <Text style={cs.rowPrimary}>{resolved.name || resolved.rego_serial}</Text>
            <Text style={cs.rowSecondary}>
              {[resolved.asset_type, resolved.rego_serial].filter(Boolean).join(' · ')}
            </Text>
          </View>
        </View>
        <View style={cs.confirmActions}>
          <TouchableOpacity
            testID={`${testId}-confirm-use`}
            style={cs.confirmUseBtn}
            onPress={() => commitResolved(resolved, resolved._via || 'qr_scan')}
          >
            <Ionicons name="checkmark" size={16} color="#FFFFFF" />
            <Text style={cs.confirmUseBtnText}>Use this asset</Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID={`${testId}-confirm-retry`}
            style={cs.confirmRetryBtn}
            onPress={() => { setResolved(null); setScanned(false); }}
          >
            <Text style={cs.confirmRetryText}>Scan again</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // QR camera scanning view
  if (scanning) {
    return (
      <View testID={`${testId}-scanner`} style={cs.scannerWrap}>
        <View style={cs.cameraBox}>
          <CameraView
            style={cs.camera}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr', 'code128', 'ean13', 'ean8'] }}
            onBarcodeScanned={scanned ? undefined : handleBarcodeScan}
          />
          {resolving && (
            <View style={cs.scanOverlay}>
              <ActivityIndicator size="small" color="#FFFFFF" />
              <Text style={cs.scanOverlayText}>Looking up asset…</Text>
            </View>
          )}
          <View style={cs.scanFrame} />
        </View>
        {scanErr ? (
          <View style={cs.scanErrRow}>
            <Ionicons name="alert-circle" size={14} color={Colors.error} />
            <Text style={cs.scanErrText}>{scanErr}</Text>
          </View>
        ) : (
          <Text style={cs.scanHint}>Point camera at asset QR code</Text>
        )}
        <View style={cs.scanActions}>
          <TouchableOpacity testID={`${testId}-scanner-close`} style={cs.scanCloseBtn} onPress={() => setScanning(false)}>
            <Ionicons name="close" size={16} color={Colors.textSecondary} />
            <Text style={cs.scanCloseBtnText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity testID={`${testId}-scanner-manual`} style={cs.scanManualBtn} onPress={() => { setScanning(false); setModalOpen(true); }}>
            <Ionicons name="search" size={14} color={Colors.info} />
            <Text style={cs.scanManualBtnText}>Search manually</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View>
      {scanErr && !scanning ? (
        <View style={[cs.scanErrRow, { marginBottom: 8 }]}>
          <Ionicons name="alert-circle" size={14} color={Colors.warning} />
          <Text style={cs.scanErrText}>{scanErr}</Text>
        </View>
      ) : null}
      <View style={cs.assetActions}>
        <TouchableOpacity testID={`${testId}-scan`} style={cs.assetScanBtn} onPress={openScanner}>
          <Ionicons name="scan" size={18} color="#FFFFFF" />
          <Text style={cs.assetScanBtnText}>Scan QR</Text>
        </TouchableOpacity>
        <TouchableOpacity testID={`${testId}-pick`} style={cs.assetPickBtn} onPress={() => setModalOpen(true)}>
          <Ionicons name="search" size={16} color={Colors.info} />
          <Text style={cs.assetPickText}>Search</Text>
        </TouchableOpacity>
      </View>
      <PickerModal
        visible={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Select Asset"
        fetchItems={fetchFn}
        renderRow={renderRow}
        onPick={handlePick}
      />
    </View>
  );
}

// ═══════════════════════════════════════════════════
// 7. CONTACT PICKER (no backend endpoint — text fallback)
// ═══════════════════════════════════════════════════
export function ContactPicker({ field, value, onChange }: PickerProps) {
  const testId = `contact-picker-${field.id}`;
  const current = typeof value === 'object' && value ? value : { name: value || '' };

  return (
    <View testID={testId}>
      <View style={cs.contactNote}>
        <Ionicons name="information-circle-outline" size={14} color={Colors.info} />
        <Text style={cs.contactNoteText}>Enter contact name manually</Text>
      </View>
      <TextInput
        testID={`${testId}-input`}
        style={cs.contactInput}
        value={current.name || ''}
        onChangeText={(text) => onChange({ name: text, id: null, manual: true })}
        placeholder={`Enter ${field.label || 'contact'}…`}
        placeholderTextColor={Colors.textTertiary}
      />
    </View>
  );
}

// ═══════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════
const cs = StyleSheet.create({
  // Chip (selected value)
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12,
    borderWidth: 1, borderColor: '#A7F3D0', backgroundColor: '#ECFDF5',
    minHeight: 48,
  },
  chipIcon: {
    width: 28, height: 28, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.7)',
    alignItems: 'center', justifyContent: 'center',
  },
  chipBody: { flex: 1, minWidth: 0 },
  chipPrimary: { fontSize: 14, fontWeight: '600', color: '#064E3B' },
  chipSecondary: { fontSize: 11, color: '#047857', marginTop: 1 },
  chipClear: {
    width: 28, height: 28, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
  },

  // Trigger
  trigger: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 12, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface,
    minHeight: 48,
  },
  triggerIcon: {
    width: 28, height: 28, borderRadius: 8, backgroundColor: Colors.borderLight,
    alignItems: 'center', justifyContent: 'center',
  },
  triggerText: { flex: 1, fontSize: 14, color: Colors.textTertiary },

  // Row renderers
  avatar: {
    width: 32, height: 32, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: 11, fontWeight: '700' },
  rowBody: { flex: 1, minWidth: 0 },
  rowPrimary: { fontSize: 14, fontWeight: '600', color: Colors.ink },
  rowSecondary: { fontSize: 11, color: Colors.textTertiary, marginTop: 1 },

  // Multi-select chips
  multiChipsRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8,
  },
  multiChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20,
    backgroundColor: '#ECFDF5', borderWidth: 1, borderColor: '#A7F3D0',
  },
  multiChipName: { fontSize: 12, fontWeight: '600', color: '#064E3B' },

  // Company toggle
  companyRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 6,
    paddingHorizontal: 16, paddingVertical: 8,
  },
  companyChip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
    borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface,
  },
  companyChipActive: {
    backgroundColor: Colors.navy, borderColor: Colors.navy,
  },
  companyChipText: { fontSize: 11, fontWeight: '600', color: Colors.textSecondary },
  companyChipTextActive: { color: Colors.white },

  // Vehicle picker
  vehicleActions: { flexDirection: 'row', gap: 8 },
  vehicleTriggerBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 12, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface,
    minHeight: 48,
  },
  manualToggle: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 12, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.info, backgroundColor: Colors.infoSoft,
    minHeight: 48,
  },
  manualToggleText: { fontSize: 12, fontWeight: '600', color: Colors.info },
  manualRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  manualInput: {
    flex: 1, backgroundColor: Colors.surface, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: Colors.ink,
    borderWidth: 1, borderColor: Colors.border,
  },
  manualSaveBtn: {
    width: 44, height: 44, borderRadius: 12, backgroundColor: Colors.success,
    alignItems: 'center', justifyContent: 'center',
  },
  manualCancelBtn: {
    width: 44, height: 44, borderRadius: 12, backgroundColor: Colors.borderLight,
    alignItems: 'center', justifyContent: 'center',
  },

  // Warning banner
  warnBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.warningSoft, borderRadius: 10, padding: 10, marginBottom: 8,
  },
  warnText: { fontSize: 12, color: '#92400E', flex: 1 },

  // Blocked state (dependsOn not met)
  blockedWrap: {
    alignItems: 'center', justifyContent: 'center', gap: 4,
    borderRadius: 12, borderWidth: 1.5, borderStyle: 'dashed',
    borderColor: Colors.border, backgroundColor: Colors.borderLight,
    paddingVertical: 16, paddingHorizontal: 12,
  },
  blockedTitle: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary },
  blockedHint: { fontSize: 11, color: Colors.textTertiary, textAlign: 'center' },

  // GPS pinned row
  gpsRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: 16, marginBottom: 8, padding: 12,
    borderRadius: 12, backgroundColor: '#ECFDF5', borderWidth: 1, borderColor: '#A7F3D0',
  },

  // Asset scan
  assetActions: { flexDirection: 'row', gap: 8 },
  assetScanBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: 12,
    backgroundColor: Colors.navy, minHeight: 48,
  },
  assetScanBtnText: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },
  assetPickBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, paddingHorizontal: 16, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.info, backgroundColor: Colors.infoSoft,
    minHeight: 48,
  },
  assetPickText: { fontSize: 14, fontWeight: '600', color: Colors.info },

  // QR scanner
  scannerWrap: { gap: 10 },
  cameraBox: {
    height: 220, borderRadius: 16, overflow: 'hidden',
    backgroundColor: '#000', position: 'relative',
  },
  camera: { flex: 1 },
  scanFrame: {
    position: 'absolute', top: '20%', left: '20%', width: '60%', height: '60%',
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.5)', borderRadius: 12,
  },
  scanOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  scanOverlayText: { fontSize: 13, color: '#FFFFFF', fontWeight: '600' },
  scanHint: { fontSize: 12, color: Colors.textTertiary, textAlign: 'center' },
  scanErrRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#FEF2F2', borderRadius: 10, padding: 10,
  },
  scanErrText: { fontSize: 12, color: '#991B1B', flex: 1 },
  scanActions: { flexDirection: 'row', gap: 8 },
  scanCloseBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10, borderRadius: 12, backgroundColor: Colors.borderLight,
    minHeight: 44,
  },
  scanCloseBtnText: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  scanManualBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.info, backgroundColor: Colors.infoSoft,
    minHeight: 44,
  },
  scanManualBtnText: { fontSize: 13, fontWeight: '600', color: Colors.info },

  // Confirmation card
  confirmCard: {
    backgroundColor: '#F0FDF4', borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: '#A7F3D0', gap: 12,
  },
  confirmHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  confirmActions: { flexDirection: 'row', gap: 8 },
  confirmUseBtn: {
    flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: 12, backgroundColor: Colors.success,
    minHeight: 44,
  },
  confirmUseBtnText: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },
  confirmRetryBtn: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 12, borderRadius: 12, backgroundColor: Colors.borderLight,
    minHeight: 44,
  },
  confirmRetryText: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },

  // Contact picker
  contactNote: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginBottom: 6,
  },
  contactNoteText: { fontSize: 11, color: Colors.info },
  contactInput: {
    backgroundColor: Colors.surface, borderRadius: 12, paddingHorizontal: 14,
    paddingVertical: 12, fontSize: 15, color: Colors.ink,
    borderWidth: 1, borderColor: Colors.border,
  },
});
