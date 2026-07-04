/* v155a · Backup admin — Live LAN delivery card + inline DiskGauge.
 * Byte-identical extraction from the pre-v155a BackupTab.jsx monolith.
 */
import React, { useState, useEffect, useCallback } from "react";
import { Server, RefreshCw, AlertCircle, CheckCircle2 } from "lucide-react";
import { api, authHdr } from "../lib/api";
import { fmtAge, fmtBytes } from "../lib/format";
import { Section, btn, ACCENT } from "../lib/styles";

// ============================================================
// Live "Last LAN delivery" card — the most-important visual at
// the top of the Backup tab. Green tick when snapshots are
// landing on the NAS within the last 6 h, amber if behind/stale,
// red if the container has gone silent. Polls every 30 s.
// ============================================================
export default function LanDeliveryCard() {
  const LAN_API = (process.env.REACT_APP_BACKEND_URL || "") + "/api/backup/lan-status";
  const [s, setS] = useState(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await api.get(LAN_API, { headers: authHdr() });
      setS(r.data);
      setErr("");
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message);
    }
  }, [LAN_API]);
  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  if (!s) {
    return (
      <Section title="Last LAN delivery" icon={<Server className="w-4 h-4"/>}>
        <div style={{ padding: 10, color: "#64748b" }}>{err || "Loading…"}</div>
      </Section>
    );
  }

  // Colour scheme keyed off the rollup health
  const palette = {
    ok:     { bg: "#ecfdf5", border: "#10b981", fg: "#065f46", chip: "#10b981", chipFg: "white", label: "Healthy" },
    stale:  { bg: "#fff7ed", border: "#f59e0b", fg: "#7c2d12", chip: "#f59e0b", chipFg: "white", label: "Stale" },
    behind: { bg: "#fff7ed", border: "#f59e0b", fg: "#7c2d12", chip: "#f59e0b", chipFg: "white", label: "Behind" },
    down:   { bg: "#fef2f2", border: "#ef4444", fg: "#7f1d1d", chip: "#ef4444", chipFg: "white", label: "Agent down" },
    never:  { bg: "#f3f4f6", border: "#6b7280", fg: "#374151", chip: "#6b7280", chipFg: "white", label: "Never delivered" },
  }[s.health] || { bg: "#f3f4f6", border: "#6b7280", fg: "#374151", chip: "#6b7280", chipFg: "white", label: s.health };

  const fmtMin = (m) => {
    if (m == null) return "—";
    if (m < 1) return `${Math.round(m * 60)} sec ago`;
    if (m < 60) return `${Math.round(m)} min ago`;
    if (m < 60 * 24) return `${(m / 60).toFixed(1)} h ago`;
    return `${(m / (60 * 24)).toFixed(1)} d ago`;
  };

  // Friendly one-line explainer per health state
  const explainer = {
    ok:     <>Snapshots are landing on your NAS as expected.</>,
    stale:  <>Last delivery is older than {s.stale_after_h}h — check the agent is still polling.</>,
    behind: <>A newer snapshot is sitting on the Hub but the agent hasn't shipped it yet. It usually catches up within a minute.</>,
    down:   <>The LAN agent hasn't checked in for {fmtMin(s.last_any_report_age_min)}. The container may be stopped.</>,
    never:  <>No snapshots have ever been delivered to the NAS. Register an agent and start the Docker container.</>,
  }[s.health] || null;

  return (
    <Section title="Last LAN delivery"
      icon={<Server className="w-4 h-4"/>}
      action={
        <button type="button" onClick={load} style={btn(ACCENT)}
          data-testid="backup-lan-refresh">
          <RefreshCw className="w-3.5 h-3.5"/>Refresh
        </button>
      }>
      <div
        data-testid="backup-lan-status"
        data-health={s.health}
        style={{
          background: palette.bg,
          borderLeft: `4px solid ${palette.border}`,
          padding: "14px 18px",
          borderRadius: 8,
          color: palette.fg,
          fontSize: 13,
          lineHeight: 1.55,
        }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12,
                      flexWrap: "wrap", marginBottom: 8 }}>
          <span style={{
            background: palette.chip, color: palette.chipFg,
            padding: "3px 10px", borderRadius: 999,
            fontSize: 10, fontWeight: 900, letterSpacing: "0.16em",
            textTransform: "uppercase",
          }}>
            {s.health === "ok" ? <CheckCircle2 className="w-3 h-3 inline-block mr-1" style={{ verticalAlign: -2 }}/>
              : <AlertCircle className="w-3 h-3 inline-block mr-1" style={{ verticalAlign: -2 }}/>}
            {palette.label}
          </span>
          {s.last_delivery ? (
            <span style={{ fontWeight: 700 }}>
              Last shipped to NAS: <strong>{fmtMin(s.last_delivery_age_min)}</strong>
              {s.last_delivery.bytes_written && (
                <> · {fmtBytes(s.last_delivery.bytes_written)}</>
              )}
            </span>
          ) : (
            <span style={{ fontWeight: 700 }}>No deliveries on record yet.</span>
          )}
        </div>
        {explainer && <div style={{ marginBottom: 8 }}>{explainer}</div>}

        {/* Detail grid */}
        <div style={{
          display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 18px",
          fontSize: 12, fontFamily: "monospace", color: palette.fg,
        }}>
          {s.last_delivery?.target_path && (
            <div style={{ gridColumn: "1 / -1" }}>
              <strong>Target:</strong> {s.last_delivery.target_path}
            </div>
          )}
          <div>
            <strong>Agent heartbeat:</strong> {fmtMin(s.agent_last_seen_age_min)}
            {s.agent?.name && <> ({s.agent.name})</>}
          </div>
          <div>
            <strong>Latest Hub snapshot:</strong> {fmtMin(s.latest_snapshot_age_min)}
            {s.latest_snapshot?.size && <> · {fmtBytes(s.latest_snapshot.size)}</>}
          </div>
          {/* "Last failure" intentionally hidden — the green/amber/red
              health pill at the top of the card already conveys the
              current state, and showing a stale failure line from a
              transient 502 just looks alarming. */}
        </div>

        {/* NAS disk usage gauge — reported by the agent on every
            poll. Coloured: green <70%, amber 70-90%, red >90%. */}
        {s.disk_usage && <DiskGauge usage={s.disk_usage} reportedAt={s.disk_usage_at}/>}
      </div>
    </Section>
  );
}


// Compact disk-usage bar. Lives inside LanDeliveryCard.
function DiskGauge({ usage, reportedAt }) {
  const used = Number(usage.used_bytes) || 0;
  const total = Number(usage.total_bytes) || 1;
  const free = Number(usage.free_bytes) || 0;
  const pct = Math.min(100, Math.round((used / total) * 100));
  // Traffic-light colour band.
  const colour =
    pct >= 90 ? "#ef4444" :
    pct >= 70 ? "#f59e0b" :
                "#10b981";
  const fmtGB = (b) =>
    b >= 1024 ** 4 ? `${(b / 1024 ** 4).toFixed(2)} TB` :
    b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` :
                     `${(b / 1024 ** 2).toFixed(0)} MB`;
  return (
    <div data-testid="backup-disk-gauge"
      style={{
        marginTop: 12, paddingTop: 12, borderTop: "1px dashed rgba(0,0,0,0.12)",
        fontSize: 12, fontFamily: "monospace",
      }}>
      <div style={{ display: "flex", justifyContent: "space-between",
                    marginBottom: 4 }}>
        <span><strong>NAS disk · {usage.path}</strong></span>
        <span style={{ color: colour, fontWeight: 800 }}>
          {fmtGB(free)} free of {fmtGB(total)} · {pct}% used
        </span>
      </div>
      <div style={{
        background: "rgba(0,0,0,0.08)", height: 8, borderRadius: 4,
        overflow: "hidden",
      }}>
        <div style={{
          background: colour, height: "100%", width: `${pct}%`,
          transition: "width 600ms ease, background 600ms ease",
        }}/>
      </div>
      {reportedAt && (
        <div style={{ fontSize: 10, color: "rgba(0,0,0,0.5)", marginTop: 2 }}>
          Reported {fmtAge(reportedAt)}
        </div>
      )}
    </div>
  );
}
