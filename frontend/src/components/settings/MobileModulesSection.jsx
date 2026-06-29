// Phase 4.3 — Mobile App Module allocator (per-role).
// Phase 4.4 — Live "preview as role" phone-bezel iframe pinned to the right.
//
// Tab inside the Permission Presets / Matrix admin page. Admin sees a grid
// where rows are mobile modules and columns are roles (Worker, Supervisor,
// Contractor, Admin). Toggles control visibility on the Expo mobile app.
//
// • Admin column is rendered but locked (always-on) — the backend enforces
//   it on save so a hand-crafted PUT can't bypass.
// • Dirty-state sticky save bar at the bottom.
// • Brand: orange #F97316 (CTA + active toggle) + slate #1E293B (chrome).
// • Right panel (Phase 4.4): phone-bezel <iframe> pointed at the Expo web
//   build with `preview_token` + `preview_role` query params. Reloads
//   explicitly (never auto-syncs with the grid) so admins see exactly
//   what's currently saved, not the unsaved state.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import api, { apiError } from '@/lib/api';
import { getToken } from '@/lib/auth';
import {
  ClipboardTaskListLtr20Regular as PreStartIcon,
  Book20Regular as DiaryIcon,
  Warning20Regular as HazardIcon,
  ErrorCircle20Regular as IncidentIcon,
  ClipboardCheckmark20Regular as InspectionIcon,
  DocumentBulletList20Regular as SwmsIcon,
  HatGraduation20Regular as InductionsIcon,
  VehicleTruck20Regular as PlantIcon,
  Wrench20Regular as ServiceIcon,
  Ribbon20Regular as CertsIcon,
  Lightbulb20Regular as AskIcon,
  QrCode20Regular as SignOnIcon,
  Person20Regular as ProfileIcon,
  LockClosed20Regular,
  Save20Regular,
  ArrowReset20Regular,
  Phone20Regular,
  ArrowClockwise20Regular,
  Open20Regular,
} from '@fluentui/react-icons';

const ROLES = [
  { key: 'worker',     label: 'Worker'     },
  { key: 'supervisor', label: 'Supervisor' },
  { key: 'contractor', label: 'Contractor' },
  { key: 'admin',      label: 'Admin'      },
];

// Module catalogue mirrors `mobile_modules.MODULE_KEYS` on the backend.
// Friendly labels are taken verbatim from the Phase 4.3 brief.
const MODULES = [
  { key: 'pre_start',           label: 'Daily Pre-Starts',       Icon: PreStartIcon },
  { key: 'site_diary',          label: 'Site Diary',             Icon: DiaryIcon },
  { key: 'hazard',              label: 'Hazard Reports',         Icon: HazardIcon },
  { key: 'incident',            label: 'Incident Reports',       Icon: IncidentIcon },
  { key: 'inspection',          label: 'Inspection Reports',     Icon: InspectionIcon },
  { key: 'swms',                label: 'SWMS',                   Icon: SwmsIcon },
  { key: 'inductions',          label: 'Inductions',             Icon: InductionsIcon },
  { key: 'plant_vehicles',      label: 'Plant & Vehicles',       Icon: PlantIcon },
  { key: 'service_maintenance', label: 'Service & Maintenance',  Icon: ServiceIcon },
  { key: 'certifications',      label: 'Certifications',         Icon: CertsIcon },
  { key: 'ask_intel',           label: 'Ask Intelligence',       Icon: AskIcon },
  { key: 'sign_on',             label: 'Sign-on / Site Check-in',Icon: SignOnIcon },
  { key: 'profile',             label: 'My Profile',             Icon: ProfileIcon },
];

function ToggleCell({ on, locked, onChange, testid }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={locked}
      onClick={() => !locked && onChange(!on)}
      data-testid={testid}
      className={[
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
        on ? 'bg-orange-500' : 'bg-slate-200',
        locked ? 'opacity-60 cursor-not-allowed ring-1 ring-slate-300' : 'hover:ring-2 hover:ring-orange-200',
      ].join(' ')}
    >
      <span className={[
        'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
        on ? 'translate-x-5' : 'translate-x-0.5',
      ].join(' ')} />
      {locked && (
        <LockClosed20Regular className="absolute -right-5 text-slate-400" style={{ width: 12, height: 12 }} />
      )}
    </button>
  );
}

function deepClone(o) { return JSON.parse(JSON.stringify(o || {})); }
function deepEq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

// Phase 4.4 — derive the Expo web build URL from REACT_APP_BACKEND_URL.
// Convention in this environment: backend lives at
//   https://<sub>.preview.emergentagent.com
// and the Expo web build lives at
//   https://<sub>.expo.preview.emergentagent.com
// (matches EXPO_PACKAGER_PROXY_URL in /app/mobile/.env). An explicit
// REACT_APP_EXPO_URL override wins if defined.
function computeExpoUrl(role, token) {
  const explicit = process.env.REACT_APP_EXPO_URL;
  const backend = process.env.REACT_APP_BACKEND_URL || '';
  const base = (explicit && explicit.trim())
    || backend.replace(/^(https?:\/\/[^.]+)\./, '$1.expo.');
  if (!base) return '';
  const u = new URL(base);
  u.searchParams.set('preview_role', role);
  if (token) u.searchParams.set('preview_token', token);
  // Cache-bust so the iframe forces a fresh boot on every explicit reload.
  u.searchParams.set('_t', Date.now().toString());
  return u.toString();
}

function PhonePreview({ canEdit }) {
  const [role, setRole] = useState('worker');
  const [src, setSrc] = useState('');
  const iframeRef = useRef(null);

  // Build the src once on first render — and only rebuild when the admin
  // explicitly changes role or clicks Reload. Deliberately NOT reactive to
  // the matrix state above (we want the iframe to reflect *saved* config).
  const rebuild = (r = role) => setSrc(computeExpoUrl(r, getToken()));
  useEffect(() => { rebuild(role); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onRoleChange = (e) => {
    const r = e.target.value;
    setRole(r);
    rebuild(r);
  };
  const onReload = () => rebuild(role);
  const onOpen = () => {
    if (src) window.open(src, '_blank', 'noopener,noreferrer');
  };

  return (
    <aside className="space-y-3 lg:sticky lg:top-4" data-testid="mobile-preview-panel">
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="inline-flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-slate-900 text-orange-400 inline-flex items-center justify-center">
              <Phone20Regular />
            </span>
            <div>
              <div className="text-sm font-semibold text-slate-900">Live Preview</div>
              <div className="text-[11px] text-slate-500">Saved config · {role}</div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={onReload} data-testid="mobile-preview-reload"
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100" title="Reload preview">
              <ArrowClockwise20Regular />
            </button>
            <button type="button" onClick={onOpen} data-testid="mobile-preview-open"
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100" title="Open in new tab">
              <Open20Regular />
            </button>
          </div>
        </div>

        <label className="block">
          <span className="block text-[10px] uppercase tracking-[0.12em] font-semibold text-slate-400 mb-1">Preview as role</span>
          <select
            value={role}
            onChange={onRoleChange}
            data-testid="mobile-preview-role"
            disabled={!canEdit}
            className="w-full rounded-lg border border-slate-300 bg-white text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-orange-200 focus:border-orange-400"
          >
            {ROLES.map((r) => (
              <option key={r.key} value={r.key}>{r.label}</option>
            ))}
          </select>
        </label>

        {/* Phone bezel — slate body, orange notch accent. CSS-only,
            no images so it survives offline + dark scrollbars. */}
        <div className="mx-auto mt-4" style={{ width: 320 }}>
          <div
            className="relative bg-slate-900 rounded-[36px] p-3 shadow-2xl"
            style={{ height: 680 }}
            data-testid="mobile-preview-bezel"
          >
            {/* Notch */}
            <div className="absolute top-2 left-1/2 -translate-x-1/2 w-28 h-5 bg-slate-950 rounded-b-2xl flex items-center justify-center">
              <span className="block w-1.5 h-1.5 rounded-full bg-orange-500" />
            </div>
            <iframe
              ref={iframeRef}
              src={src || 'about:blank'}
              title="Paneltec Civil mobile preview"
              data-testid="mobile-preview-iframe"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
              referrerPolicy="no-referrer-when-downgrade"
              className="w-full h-full rounded-[24px] bg-white block"
              style={{ border: 0 }}
            />
          </div>
        </div>

        <p className="mt-3 text-[11px] text-slate-500 leading-relaxed">
          Preview reflects unsaved toggle changes <strong className="text-slate-700">only after Save</strong>.
          Click <span className="inline-flex items-center align-middle gap-0.5"><ArrowClockwise20Regular style={{ width: 12, height: 12 }} /></span> to reload once you&rsquo;ve saved.
        </p>
      </div>
    </aside>
  );
}

export default function MobileModulesSection({ canEdit }) {
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [original, setOriginal] = useState(null);
  const [matrix, setMatrix]     = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/settings/mobile-modules');
      setOriginal(deepClone(data.mobile_modules));
      setMatrix(deepClone(data.mobile_modules));
    } catch (e) { toast.error(apiError(e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const dirty = useMemo(() => matrix && original && !deepEq(matrix, original), [matrix, original]);

  const toggle = (role, mod) => {
    if (role === 'admin') return;          // locked
    if (!canEdit) return;
    setMatrix((m) => ({ ...m, [role]: { ...m[role], [mod]: !m[role][mod] } }));
  };

  const setAllInRole = (role, value) => {
    if (role === 'admin' || !canEdit) return;
    setMatrix((m) => ({
      ...m,
      [role]: Object.fromEntries(MODULES.map((mo) => [mo.key, value])),
    }));
  };

  const reset = () => setMatrix(deepClone(original));

  const save = async () => {
    setSaving(true);
    try {
      const r = await api.put('/settings/mobile-modules', { mobile_modules: matrix });
      toast.success(r.data.changes
        ? `Saved — ${r.data.changes} change${r.data.changes === 1 ? '' : 's'} applied.`
        : 'Saved.');
      setOriginal(deepClone(r.data.mobile_modules));
      setMatrix(deepClone(r.data.mobile_modules));
    } catch (e) { toast.error(apiError(e)); }
    finally { setSaving(false); }
  };

  if (loading || !matrix) {
    return <div className="text-sm text-slate-500 p-6" data-testid="mobile-modules-loading">Loading mobile module matrix…</div>;
  }

  return (
    <div className="space-y-4" data-testid="mobile-modules-section">
      <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-5">
        <div className="shrink-0 w-10 h-10 rounded-xl bg-orange-50 text-orange-600 inline-flex items-center justify-center">
          <Phone20Regular />
        </div>
        <div className="min-w-0">
          <h2 className="font-display text-xl font-semibold text-slate-900">Mobile App Modules</h2>
          <p className="text-sm text-slate-600 mt-1 max-w-2xl">
            Control which tabs and drawer entries appear in the Paneltec Civil
            mobile app for each role. Toggles take effect the next time a user
            signs in or pulls-to-refresh on Profile. Admins always see everything.
          </p>
        </div>
      </div>

      {/* Phase 4.4 — Two-column layout: matrix on the left, sticky
          phone-bezel preview on the right (stacks on < lg). */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_380px] gap-4 items-start">
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="mobile-modules-grid">
              <thead className="bg-slate-50 text-slate-500 text-[11px] uppercase tracking-wider">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold w-[42%]">Module</th>
                  {ROLES.map((r) => (
                    <th key={r.key} className="px-3 py-3 font-semibold text-center" data-testid={`mobile-col-${r.key}`}>
                      <div className="inline-flex items-center gap-1.5 justify-center">
                        <span className="text-slate-700">{r.label}</span>
                        {r.key === 'admin' && <LockClosed20Regular style={{ width: 12, height: 12 }} className="text-slate-400" />}
                      </div>
                      {r.key !== 'admin' && canEdit && (
                        <div className="flex items-center justify-center gap-1.5 mt-1.5 text-[10px] font-medium">
                          <button
                            type="button"
                            onClick={() => setAllInRole(r.key, true)}
                            data-testid={`mobile-all-on-${r.key}`}
                            className="text-orange-600 hover:text-orange-700 hover:underline"
                          >All on</button>
                          <span className="text-slate-300">·</span>
                          <button
                            type="button"
                            onClick={() => setAllInRole(r.key, false)}
                            data-testid={`mobile-all-off-${r.key}`}
                            className="text-slate-500 hover:text-slate-700 hover:underline"
                          >All off</button>
                        </div>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {MODULES.map(({ key, label, Icon }) => (
                  <tr key={key} className="border-t border-slate-100" data-testid={`mobile-row-${key}`}>
                    <td className="px-4 py-3">
                      <div className="inline-flex items-center gap-2.5">
                        <span className="w-8 h-8 rounded-lg bg-slate-100 text-slate-700 inline-flex items-center justify-center">
                          <Icon />
                        </span>
                        <span className="font-medium text-slate-800">{label}</span>
                      </div>
                    </td>
                    {ROLES.map((r) => {
                      const on = !!matrix[r.key]?.[key];
                      const locked = r.key === 'admin' || !canEdit;
                      return (
                        <td key={r.key} className="text-center px-3 py-3">
                          <ToggleCell
                            on={on}
                            locked={locked}
                            onChange={() => toggle(r.key, key)}
                            testid={`mobile-toggle-${r.key}-${key}`}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <PhonePreview canEdit={canEdit} />
      </div>

      {/* Sticky save bar — appears only when dirty so the page stays calm. */}
      {canEdit && dirty && (
        <div className="sticky bottom-4 z-10" data-testid="mobile-modules-savebar">
          <div className="mx-auto max-w-3xl rounded-2xl border border-slate-900/10 bg-slate-900 text-white shadow-2xl px-4 py-3 flex items-center justify-between gap-3">
            <div className="text-sm">
              <span className="inline-block w-2 h-2 rounded-full bg-orange-400 mr-2 align-middle"></span>
              Unsaved mobile module changes.
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={reset}
                disabled={saving}
                data-testid="mobile-modules-reset"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-slate-100 hover:bg-white/10"
              ><ArrowReset20Regular /> Reset</button>
              <button
                type="button"
                onClick={save}
                disabled={saving}
                data-testid="mobile-modules-save"
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-semibold bg-orange-500 hover:bg-orange-600 disabled:opacity-60"
              ><Save20Regular /> {saving ? 'Saving…' : 'Save changes'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
