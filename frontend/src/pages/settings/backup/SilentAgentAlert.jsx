/* v155a · Backup admin — silent-agent red banner (v153 + v154 tick counter).
 * Byte-identical extraction from the pre-v155a BackupTab.jsx monolith.
 */
import React, { useState, useEffect } from "react";
import { AlertCircle } from "lucide-react";
import { api, authHdr } from "./lib/api";
import { fmtAge, ordinalSuffix } from "./lib/format";

// ============================================================
// v153 · Silent-agent red-banner alert.
// Non-dismissable. Renders at the very top of the Backup admin
// tab whenever the LAN delivery pipeline is silent even though
// the Hub is producing snapshots:
//   (a) any registered agent has never checked in
//       (last_seen_at === null);
//   (b) any registered agent has fallen silent (> 60 min stale);
//   (c) lan-status.health === "down" AND a fresh snapshot
//       exists on the Hub (< 30 min old) — proves the Hub is
//       still generating but nothing is being delivered.
// This is the exact scenario that let the July 4 2026 42-hour
// outage stay invisible: snapshots kept ticking; only the
// delivery leg was cold.
// ============================================================
export default function SilentAgentAlert({ agents, loading }) {
  const [lan, setLan] = useState(null);
  const LAN_URL = (process.env.REACT_APP_BACKEND_URL || "") + "/api/backup/lan-status";

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await api.get(LAN_URL, { headers: authHdr() });
        if (!cancelled) setLan(r.data);
      } catch (_e) {
        // Non-fatal — if lan-status is down we simply don't get
        // the (c) signal. The (a)/(b) agent-based signals still fire.
        if (!cancelled) setLan(null);
      }
    };
    load();
    // Match BackupTab's own 30 s refresh cadence.
    const t = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(t); };
  }, [LAN_URL]);

  if (loading) return null;
  if (!Array.isArray(agents) || agents.length === 0) return null;

  const now = Date.now();
  const STALE_MIN = 60;
  const staleMs = STALE_MIN * 60 * 1000;
  const dayMs = 24 * 60 * 60 * 1000;

  const neverSeen = agents.filter(a => a.last_seen_at == null);
  const stale = agents.filter(a => {
    if (a.last_seen_at == null) return false;
    const t = new Date(a.last_seen_at).getTime();
    return isFinite(t) && (now - t) > staleMs;
  });

  // v154 — tick counter: how many "never checked in" agents have
  // been REGISTERED in the last 24h. When > 1 this is almost
  // always the sign that the operator is re-registering hoping to
  // fix the outage, when the real problem is that the agent
  // PROCESS on the LAN box has stopped running.
  const recentGhostCount = agents.filter(a => {
    if (a.last_seen_at != null) return false;
    if (!a.created_at) return false;
    const c = new Date(a.created_at).getTime();
    return isFinite(c) && (now - c) < dayMs;
  }).length;

  const hubProducing = lan && lan.health === "down"
    && typeof lan.latest_snapshot_age_min === "number"
    && lan.latest_snapshot_age_min < 30;

  const affected = [...neverSeen, ...stale];
  const trigger = affected.length > 0 || hubProducing;
  if (!trigger) return null;

  const fmtAgentAge = (a) => {
    if (a.last_seen_at == null) return "never checked in";
    return `last seen ${fmtAge(a.last_seen_at)}`;
  };

  const scrollToAgents = () => {
    const el = document.querySelector('[data-testid="agents-card"]');
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div
      data-testid="silent-agent-alert"
      role="alert"
      style={{
        background: "linear-gradient(180deg, #7f1d1d 0%, #991b1b 100%)",
        color: "#fef2f2",
        border: "1px solid #7f1d1d",
        borderLeft: "6px solid #fca5a5",
        borderRadius: 10,
        padding: "16px 20px",
        marginBottom: 16,
        boxShadow: "0 10px 24px -12px rgba(127,29,29,0.55)",
      }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
        <div style={{
          flexShrink: 0, width: 36, height: 36, borderRadius: "50%",
          background: "rgba(254,202,202,0.18)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <AlertCircle className="w-5 h-5" style={{ color: "#fecaca" }}/>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontWeight: 900, fontSize: 14, letterSpacing: "0.02em",
            marginBottom: 4, color: "#fff",
          }}>
            LAN backup delivery is not running
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.55, color: "#fee2e2" }}>
            {affected.length > 0 && (
              <div data-testid="silent-agent-list" style={{ marginBottom: 6 }}>
                {affected.map((a, i) => (
                  <div key={a.id || i}>
                    <strong style={{ color: "#fff" }}>
                      {a.name || "Unnamed agent"}
                    </strong>{" "}
                    · <span style={{ color: "#fecaca" }}>{fmtAgentAge(a)}</span>
                  </div>
                ))}
              </div>
            )}
            {hubProducing && (
              <div data-testid="silent-agent-hub-producing" style={{ marginBottom: 6 }}>
                Hub produced a fresh snapshot{" "}
                <strong style={{ color: "#fff" }}>
                  {Math.round(lan.latest_snapshot_age_min)}&nbsp;min ago
                </strong>{" "}
                but LAN status is <strong style={{ color: "#fff" }}>down</strong>
                {typeof lan.last_delivery_age_min === "number" && (
                  <> · last successful delivery{" "}
                    <strong style={{ color: "#fff" }}>
                      {(lan.last_delivery_age_min / 60).toFixed(1)}&nbsp;h ago
                    </strong>
                  </>
                )}
                .
              </div>
            )}
            <div style={{
              marginTop: 8, padding: "8px 12px",
              background: "rgba(0,0,0,0.22)",
              borderRadius: 6, fontSize: 12, color: "#fee2e2",
            }}>
              Restart the agent process on your office machine with the
              current token to resume delivery. If the token is lost,
              rotate it below.
            </div>
            {recentGhostCount > 1 && (
              <div data-testid="silent-agent-tick-counter"
                   style={{
                     marginTop: 8, padding: "8px 12px",
                     background: "rgba(0,0,0,0.32)",
                     borderRadius: 6, fontSize: 12, color: "#fecaca",
                     borderLeft: "3px solid #fca5a5",
                   }}>
                This is the <strong style={{ color: "#fff" }}>
                  {recentGhostCount}
                  {ordinalSuffix(recentGhostCount)}
                </strong>{" "}
                registered agent in the last 24&nbsp;h that hasn't
                checked in. If restarting the agent binary hasn't
                helped, the process itself may not be running on the
                office machine.
              </div>
            )}
          </div>
          <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={scrollToAgents}
              data-testid="silent-agent-jump"
              style={{
                background: "#fff", color: "#991b1b",
                padding: "8px 14px", fontWeight: 800, fontSize: 12,
                letterSpacing: "0.14em", textTransform: "uppercase",
                border: "1px solid #fff",
                cursor: "pointer",
                fontFamily: "Archivo, sans-serif",
                borderRadius: 4,
              }}>
              Show token &amp; agent config
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
