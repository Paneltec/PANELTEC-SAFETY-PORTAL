// v58.13.18 — Service Inbox: org-wide DUE (schedules) + GENERATED
// (cron records) surface inside the Plant & Vehicles page.
//
// Single round-trip via `GET /assets/service/inbox` → { due, generated,
// counts }. Two sub-tabs; each renders GroupedTilesView grouped by
// asset name (matches how a mechanic mentally scans by vehicle).
//
// Actions
//   Due tile → "Log service"     → opens the exported RecordEditor
//                                  (from AssetServiceTabs.jsx) pre-
//                                  filled with { schedule_id,
//                                  type: schedule.task_type }.
//   Due tile → "Open schedule"   → navigates to /app/vehicles with
//                                  ?assetDrawer=<id>&tab=schedules so
//                                  PlantVehicles.jsx opens the drawer.
//   Gen tile → "Mark as performed" → PUT existing per-asset record
//                                    endpoint with {performed_at:
//                                    now, performed_by, performed_by_name,
//                                    hours_at, km_at}.
//   Gen tile → "Dismiss"          → DELETE existing per-asset record
//                                    endpoint (soft-delete admin-gated
//                                    per backend). Non-admins see a
//                                    disabled button + tooltip.
//
// v58.13.10 flash-bug guardrail: every tile action button stops the
// synthetic-event bubble AND prevents default so the freshly-mounted
// modal cannot receive its own opening click.
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  RefreshCw, Wrench, Sparkles, CheckCircle2, ExternalLink, XCircle,
  AlertTriangle,
} from 'lucide-react';
import api, { apiError, USER_KEY } from '../lib/api';
import GroupedTilesView from '../components/capture/GroupedTilesView';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import { RecordEditor } from '../components/AssetServiceTabs';
import { useCan } from '../lib/permissions';

function statusPill(status) {
  if (status === 'overdue')  return ['OVERDUE',  'bg-rose-100 text-rose-800 border-rose-200'];
  if (status === 'due_soon') return ['DUE SOON', 'bg-amber-100 text-amber-800 border-amber-200'];
  return ['OK', 'bg-emerald-100 text-emerald-800 border-emerald-200'];
}

function fmtDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString(); } catch { return String(iso); }
}

function getCurrentUser() {
  try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { return null; }
}

export default function ServiceInboxTab() {
  const navigate = useNavigate();
  const can = useCan();
  const canEdit = can('assets', 'edit');

  const currentUser = getCurrentUser();
  const isAdmin = (currentUser?.role || '') === 'admin';

  const [inbox, setInbox] = useState({ due: [], generated: [], counts: { overdue: 0, due_soon: 0, generated: 0 } });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [subtab, setSubtab] = useState('due');

  // In-place "Log service" modal state.
  //   { schedule, asset } → RecordEditor mounted for a DUE tile.
  const [logEditing, setLogEditing] = useState(null);
  // Per-row loading flag for GENERATED actions so multiple tiles don't fight.
  const [rowBusy, setRowBusy] = useState({});

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await api.get('/assets/service/inbox');
      setInbox(r.data || { due: [], generated: [], counts: { overdue: 0, due_soon: 0, generated: 0 } });
    } catch (e) {
      setError(apiError(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const openLogService = useCallback((e, row) => {
    e?.stopPropagation?.(); e?.preventDefault?.();
    // Synthesise the minimum "asset" shape RecordEditor needs — it
    // reads `asset.id`, `asset.hours_meter`, `asset.odo_km`. Everything
    // else in the modal is form-local.
    const asset = {
      id: row.asset_id,
      hours_meter: row.asset?.hours_meter ?? null,
      odo_km: row.asset?.odo_km ?? null,
      name: row.asset?.name || '',
    };
    setLogEditing({ asset, scheduleId: row.schedule_id, taskType: row.task_type });
  }, []);

  const openScheduleDrawer = useCallback((e, row) => {
    e?.stopPropagation?.(); e?.preventDefault?.();
    // PlantVehicles.jsx AssetDrawer opens from `?assetDrawer=<id>` query.
    // The `tab=schedules` hint is best-effort — if the drawer ignores
    // it, the user still lands on the correct asset.
    navigate(`/app/vehicles?assetDrawer=${encodeURIComponent(row.asset_id)}&tab=schedules`);
  }, [navigate]);

  const markAsPerformed = useCallback(async (e, row) => {
    e?.stopPropagation?.(); e?.preventDefault?.();
    if (!canEdit) { toast.error('You do not have permission to log services.'); return; }
    setRowBusy((b) => ({ ...b, [row.record_id]: 'perform' }));
    try {
      const now = new Date().toISOString();
      await api.put(`/assets/${row.asset_id}/records/${row.record_id}`, {
        // Note: backend RecordPatch supports `performed_at`,
        // `hours_at`, `km_at`. Sending current meter snapshot so the
        // performed record reflects the real reading at completion time.
        performed_at: now,
        hours_at: row.asset?.hours_meter ?? null,
        km_at: row.asset?.odo_km ?? null,
      });
      toast.success('Marked as performed');
      load();
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setRowBusy((b) => { const n = { ...b }; delete n[row.record_id]; return n; });
    }
  }, [canEdit, load]);

  const dismissGenerated = useCallback(async (e, row) => {
    e?.stopPropagation?.(); e?.preventDefault?.();
    if (!isAdmin) { toast.error('Only admins can dismiss generated services.'); return; }
    if (!window.confirm(`Dismiss "${row.title}"? This soft-deletes the record.`)) return;
    setRowBusy((b) => ({ ...b, [row.record_id]: 'dismiss' }));
    try {
      await api.delete(`/assets/${row.asset_id}/records/${row.record_id}`);
      toast.success('Dismissed');
      load();
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setRowBusy((b) => { const n = { ...b }; delete n[row.record_id]; return n; });
    }
  }, [isAdmin, load]);

  const dueGroupBy = (rec) => rec.asset?.name || rec.asset_id || 'Unknown asset';
  const genGroupBy = (rec) => rec.asset?.name || rec.asset_id || 'Unknown asset';

  const dueTile = useCallback((row) => {
    const [pillLabel, pillCls] = statusPill(row.status);
    const axisLabel = row.interval_kind === 'calendar'
      ? (row.calendar_unit || 'calendar')
      : row.interval_kind === 'hours'
        ? 'hours'
        : 'km';
    // v58.13.20 — km/hours schedules track by meter, not date, so
    // `next_due_at` is null for those axes. Fall back to
    // `next_due_value` + unit so the tile shows a useful signal
    // instead of the em-dash "—" `fmtDate` returns for null.
    const nextDueDisplay = (() => {
      if (row.next_due_at) return fmtDate(row.next_due_at);
      if (row.interval_kind === 'hours' && row.next_due_value != null) {
        return `${row.next_due_value} h`;
      }
      if (row.interval_kind === 'km' && row.next_due_value != null) {
        return `${row.next_due_value} km`;
      }
      return '—';
    })();
    return (
      <div className="p-3 space-y-2" data-testid={`inbox-due-tile-${row.schedule_id}`}>
        <div className="flex items-start gap-2">
          <Wrench size={14} className="text-slate-500 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm text-slate-900 truncate">
              {row.name || row.task_identification || 'Scheduled service'}
            </div>
            <div className="text-[11px] text-slate-600 mt-0.5">
              {row.asset?.name || '—'}
              {row.asset?.rego_serial && <span className="ml-1 text-slate-400">· {row.asset.rego_serial}</span>}
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              Next due: <span className="font-medium text-slate-800">{nextDueDisplay}</span>
              <span className="ml-1 text-slate-400">({axisLabel})</span>
              {row.priority && (
                <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-700 text-[10px] font-semibold uppercase tracking-wider">
                  {row.priority}
                </span>
              )}
            </div>
          </div>
          <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider border ${pillCls}`}
            data-testid={`inbox-due-status-${row.schedule_id}`}>{pillLabel}</span>
        </div>
        <div className="flex items-center gap-2 pt-1">
          <button type="button"
            onClick={(e) => openLogService(e, row)}
            data-testid={`inbox-due-log-${row.schedule_id}`}
            disabled={!canEdit}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-semibold disabled:opacity-50 disabled:cursor-not-allowed">
            <Wrench size={11} /> Log service
          </button>
          <button type="button"
            onClick={(e) => openScheduleDrawer(e, row)}
            data-testid={`inbox-due-open-${row.schedule_id}`}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-300 hover:bg-slate-50 text-slate-700 text-[11px] font-semibold">
            <ExternalLink size={11} /> Open schedule
          </button>
        </div>
      </div>
    );
  }, [canEdit, openLogService, openScheduleDrawer]);

  const generatedTile = useCallback((row) => {
    const busy = rowBusy[row.record_id];
    // Trim run-id suffix (format: "asset_service_generate:YYYY-MM-DD")
    const runLabel = (row.generated_by_run_id || '').split(':').slice(1).join(':') || 'auto-run';
    return (
      <div className="p-3 space-y-2" data-testid={`inbox-gen-tile-${row.record_id}`}>
        <div className="flex items-start gap-2">
          <Sparkles size={14} className="text-violet-500 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm text-slate-900 truncate">{row.title || 'Generated service'}</div>
            <div className="text-[11px] text-slate-600 mt-0.5">
              {row.asset?.name || '—'}
              {row.asset?.rego_serial && <span className="ml-1 text-slate-400">· {row.asset.rego_serial}</span>}
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              Created: <span className="font-medium text-slate-800">{fmtDate(row.created_at)}</span>
              <span className="ml-2 text-slate-400">Run: {runLabel}</span>
            </div>
          </div>
          <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider border bg-violet-100 text-violet-800 border-violet-200"
            data-testid={`inbox-gen-status-${row.record_id}`}>AUTO-GENERATED</span>
        </div>
        <div className="flex items-center gap-2 pt-1">
          <button type="button"
            onClick={(e) => markAsPerformed(e, row)}
            data-testid={`inbox-gen-perform-${row.record_id}`}
            disabled={!canEdit || busy === 'perform'}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold disabled:opacity-50 disabled:cursor-not-allowed">
            <CheckCircle2 size={11} /> {busy === 'perform' ? 'Saving…' : 'Mark as performed'}
          </button>
          <button type="button"
            onClick={(e) => dismissGenerated(e, row)}
            data-testid={`inbox-gen-dismiss-${row.record_id}`}
            disabled={!isAdmin || busy === 'dismiss'}
            title={isAdmin ? 'Soft-delete this generated record' : 'Admin-only'}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-300 hover:bg-rose-50 hover:border-rose-300 text-rose-600 text-[11px] font-semibold disabled:opacity-50 disabled:cursor-not-allowed">
            <XCircle size={11} /> {busy === 'dismiss' ? 'Dismissing…' : 'Dismiss'}
          </button>
        </div>
      </div>
    );
  }, [canEdit, isAdmin, rowBusy, markAsPerformed, dismissGenerated]);

  const counts = inbox.counts || { overdue: 0, due_soon: 0, generated: 0 };

  return (
    <div className="space-y-4" data-testid="service-inbox-tab">
      {/* Header + refresh */}
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <h3 className="font-display font-bold text-slate-900 text-base">Service Inbox</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Everything that needs attention across the fleet: schedules coming due, and
            auto-generated services waiting to be performed.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-rose-50 text-rose-700 text-[11px] font-bold border border-rose-200"
            data-testid="inbox-count-overdue">
            <AlertTriangle size={11} /> {counts.overdue} overdue
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-50 text-amber-700 text-[11px] font-bold border border-amber-200"
            data-testid="inbox-count-due-soon">
            {counts.due_soon} due soon
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-violet-50 text-violet-700 text-[11px] font-bold border border-violet-200"
            data-testid="inbox-count-generated">
            <Sparkles size={11} /> {counts.generated} generated
          </span>
          <button type="button" onClick={(e) => { e.preventDefault(); load(); }}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold"
            data-testid="inbox-refresh">
            <RefreshCw size={12} /> Refresh
          </button>
        </div>
      </div>

      <Tabs value={subtab} onValueChange={setSubtab} data-testid="service-inbox-subtabs">
        <TabsList className="w-full grid grid-cols-2 gap-2 bg-transparent p-0 h-auto rounded-none border-0 shadow-none">
          <TabsTrigger value="due" data-testid="inbox-subtab-due"
            className="inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold tracking-tight transition-colors
              border-amber-500 text-amber-700 bg-white hover:bg-amber-50
              data-[state=active]:bg-amber-500 data-[state=active]:text-white data-[state=active]:hover:bg-amber-500
              data-[state=active]:shadow-sm">
            Due
            {(counts.overdue + counts.due_soon) > 0 && (
              <span className="inline-flex items-center rounded-md !bg-amber-100 !text-amber-900 data-[state=active]:!bg-white/20 data-[state=active]:!text-white px-1.5 py-0.5 text-[11px] font-semibold tabular-nums"
                data-testid="inbox-subtab-due-count">
                {counts.overdue + counts.due_soon}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="generated" data-testid="inbox-subtab-generated"
            className="inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold tracking-tight transition-colors
              border-violet-500 text-violet-700 bg-white hover:bg-violet-50
              data-[state=active]:bg-violet-500 data-[state=active]:text-white data-[state=active]:hover:bg-violet-500
              data-[state=active]:shadow-sm">
            Generated
            {counts.generated > 0 && (
              <span className="inline-flex items-center rounded-md !bg-violet-100 !text-violet-900 data-[state=active]:!bg-white/20 data-[state=active]:!text-white px-1.5 py-0.5 text-[11px] font-semibold tabular-nums"
                data-testid="inbox-subtab-generated-count">
                {counts.generated}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="due" className="mt-4" data-testid="inbox-tab-due-content">
          <GroupedTilesView
            items={inbox.due || []}
            groupBy={dueGroupBy}
            renderTile={dueTile}
            dateFn={(r) => r.next_due_at || ''}
            loading={loading}
            error={error}
            onRetry={load}
            testidPrefix="inbox-due"
            emptyMessage={'Nothing due right now. Schedules whose meters cross the next-due threshold appear here. Configure schedules from any asset\u2019s Service tab.'}
          />
        </TabsContent>

        <TabsContent value="generated" className="mt-4" data-testid="inbox-tab-generated-content">
          <GroupedTilesView
            items={inbox.generated || []}
            groupBy={genGroupBy}
            renderTile={generatedTile}
            dateFn={(r) => r.created_at || ''}
            loading={loading}
            error={error}
            onRetry={load}
            testidPrefix="inbox-gen"
            emptyMessage={
              // v58.13.18 — Admin-only second sentence. Non-admins see
              // only the friendly headline; admins get the env-flag hint
              // so they know why the list is empty. `GroupedTilesView`
              // renders `emptyMessage` as a plain child, so we pass a
              // single string rather than a {title, body} object.
              isAdmin
                ? 'No auto-generated services waiting. Overnight cron records appear here once ASSET_SERVICE_GENERATE_CRON is enabled.'
                : 'No auto-generated services waiting.'
            }
          />
        </TabsContent>
      </Tabs>

      {logEditing && (
        <RecordEditor
          asset={logEditing.asset}
          kind={'service'}
          initial={{
            schedule_id: logEditing.scheduleId,
            title: 'Service performed',
          }}
          onClose={() => setLogEditing(null)}
          onSaved={() => { setLogEditing(null); load(); }}
        />
      )}
    </div>
  );
}
