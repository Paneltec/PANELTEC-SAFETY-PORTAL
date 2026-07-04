/* v155a · Backup admin — Auto-snapshot schedule read-only view. */
import React, { useState, useEffect, useCallback } from "react";
import { RefreshCw } from "lucide-react";
import { api, authHdr } from "../lib/api";
import { Section, cardStyle } from "../lib/styles";

// ============================================================
// Auto-snapshot schedule — read-only view of the two APScheduler
// cron jobs that server.py registers on startup (backup_snapshot_6h
// + backup_snapshot_cob). Introspects the live scheduler via
// GET /api/backup/schedule so the panel reflects reality even if the
// cron cadence is ever tuned in server.py.
// ============================================================
export default function ScheduleCard() {
  const SCHED_API = (process.env.REACT_APP_BACKEND_URL || "") + "/api/backup/schedule";
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await api.get(SCHED_API, { headers: authHdr() });
      setData(r.data);
      setErr("");
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message);
    }
  }, [SCHED_API]);
  useEffect(() => { load(); }, [load]);

  if (!data) {
    return (
      <Section title="Auto-snapshot schedule" icon={<RefreshCw className="w-4 h-4"/>}>
        <div style={{ padding: 10, color: "#64748b" }}>{err || "Loading…"}</div>
      </Section>
    );
  }

  const jobs = Array.isArray(data.jobs) ? data.jobs : [];
  const fmt = (iso) => {
    if (!iso) return "—";
    try {
      const d = new Date(iso);
      return d.toLocaleString();
    } catch { return iso; }
  };
  const labelFor = (id) => ({
    backup_snapshot_6h:  "Every 6 hours",
    backup_snapshot_cob: "Close-of-business (mon-fri)",
  }[id] || id);

  return (
    <Section title="Auto-snapshot schedule"
      icon={<RefreshCw className="w-4 h-4"/>}>
      <div style={cardStyle()} data-testid="backup-schedule-card">
        <div style={{ fontSize: 12, color: "#475569", marginBottom: 10 }}>
          The Hub runs these APScheduler cron jobs automatically. The LAN agent
          picks up each new snapshot on its next 60-second poll — no manual
          clicks needed.
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "#64748b",
                         fontSize: 11, textTransform: "uppercase",
                         letterSpacing: "0.05em" }}>
              <th style={{ padding: "6px 8px" }}>Job</th>
              <th style={{ padding: "6px 8px" }}>Cron</th>
              <th style={{ padding: "6px 8px" }}>Timezone</th>
              <th style={{ padding: "6px 8px" }}>Next run</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id} data-testid={`backup-schedule-row-${j.id}`}
                  style={{ borderTop: "1px solid #e2e8f0" }}>
                <td style={{ padding: "8px", fontWeight: 700, color: "#0f172a" }}>
                  {labelFor(j.id)}
                  <div style={{ fontWeight: 400, fontSize: 11,
                                color: "#94a3b8", fontFamily: "monospace" }}>
                    {j.id}
                  </div>
                </td>
                <td style={{ padding: "8px", fontFamily: "monospace",
                             color: "#0f172a" }}>
                  {j.cron || "—"}
                </td>
                <td style={{ padding: "8px", color: "#475569" }}>
                  {j.timezone || "—"}
                </td>
                <td style={{ padding: "8px", color: "#475569" }}>
                  {fmt(j.next_run_at)}
                </td>
              </tr>
            ))}
            {jobs.length === 0 && (
              <tr>
                <td colSpan={4} style={{ padding: 12, color: "#94a3b8" }}>
                  No scheduled jobs registered.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {data.retention_last_run_at && (
          <div style={{ marginTop: 10, fontSize: 11, color: "#475569",
                        fontFamily: "monospace" }}
               data-testid="backup-schedule-retention-last-run">
            Retention last run: {fmt(data.retention_last_run_at)}
          </div>
        )}
        {err && (
          <div style={{ marginTop: 8, color: "#b91c1c", fontSize: 12 }}>{err}</div>
        )}
      </div>
    </Section>
  );
}
