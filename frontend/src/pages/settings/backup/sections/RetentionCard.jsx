/* v155a · Backup admin — Retention policy card + inline RetField.
 * Byte-identical extraction from the pre-v155a BackupTab.jsx monolith.
 */
import React, { useState, useEffect, useCallback } from "react";
import { Archive, Trash2 } from "lucide-react";
import { api, authHdr } from "../lib/api";
import { fmtAge } from "../lib/format";
import { Section, cardStyle, inp, btn } from "../lib/styles";

// ============================================================
// Retention policy — grandfather-father-son. Default keeps the Hub
// footprint roughly stable at ~18 GB after the first full year:
//   • All snapshots from the last 7 days     (dense recent recovery)
//   • One per day for the next 30 days       (daily history)
//   • One per week for the next 26 weeks     (~6 months weekly)
//   • One per month forever                  (long-term audit trail)
// The NAS side ignores retention by design (it's offline cold storage
// the operator manages manually via UGREEN File Manager).
// ============================================================
export default function RetentionCard() {
  const RET_API = (process.env.REACT_APP_BACKEND_URL || "") + "/api/backup/retention";
  const [policy, setPolicy] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [pendingRun, setPendingRun] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, pv] = await Promise.all([
        api.get(RET_API, { headers: authHdr() }),
        api.get(`${RET_API}/preview`, { headers: authHdr() }),
      ]);
      setPolicy(p.data);
      setPreview(pv.data);
      setErr("");
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message);
    }
  }, [RET_API]);
  useEffect(() => { load(); }, [load]);

  const save = async (patch) => {
    setBusy(true);
    setErr("");
    try {
      await api.put(RET_API, patch, { headers: authHdr() });
      await load();
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message);
    } finally {
      setBusy(false);
    }
  };

  const runNow = async () => {
    if (!pendingRun) {
      setPendingRun(true);
      setTimeout(() => setPendingRun(false), 5000);
      return;
    }
    setPendingRun(false);
    setBusy(true);
    try {
      await api.post(`${RET_API}/run`, {}, { headers: authHdr() });
      await load();
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!policy || !preview) {
    return (
      <Section title="Retention policy" icon={<Archive className="w-4 h-4"/>}>
        <div style={{ padding: 10, color: "#64748b" }}>{err || "Loading…"}</div>
      </Section>
    );
  }

  const fmtMB = (b) => (b / 1024 / 1024).toFixed(0) + " MB";
  const fmtGB = (b) => (b / 1024 / 1024 / 1024).toFixed(2) + " GB";

  // Sum of all kept snapshots — what the Hub footprint will be
  // AFTER the next retention run.
  const keptBytes = (preview.decisions || [])
    .filter(d => d.verdict === "keep")
    .reduce((s, d) => s + (d.size || 0), 0);
  const dropBytes = preview.bytes_to_free;

  return (
    <Section title="Retention policy"
      icon={<Archive className="w-4 h-4"/>}>
      <div style={cardStyle()} data-testid="backup-retention-card">
        <div style={{ display: "flex", alignItems: "center", gap: 16,
                      flexWrap: "wrap", marginBottom: 14 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8,
                          fontWeight: 700, fontSize: 13 }}>
            <input type="checkbox"
              data-testid="backup-retention-enabled"
              checked={!!policy.enabled}
              disabled={busy}
              onChange={e => save({ enabled: e.target.checked })}/>
            Retention policy enabled
          </label>
          <span style={{ fontSize: 11, color: "#64748b" }}>
            {policy.enabled
              ? "Old snapshots are pruned per policy after each new snap + every 6h."
              : "Snapshots accumulate forever (not recommended)."}
          </span>
        </div>

        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12, marginBottom: 14,
        }}>
          <RetField label="Keep ALL · last"
            value={policy.keep_all_days} unit="days"
            min={0} max={90} disabled={busy || !policy.enabled}
            testid="ret-all"
            onChange={v => save({ keep_all_days: v })}/>
          <RetField label="Then 1/day · next"
            value={policy.keep_daily_days} unit="days"
            min={0} max={365} disabled={busy || !policy.enabled}
            testid="ret-daily"
            onChange={v => save({ keep_daily_days: v })}/>
          <RetField label="Then 1/week · next"
            value={policy.keep_weekly_weeks} unit="weeks"
            min={0} max={260} disabled={busy || !policy.enabled}
            testid="ret-weekly"
            onChange={v => save({ keep_weekly_weeks: v })}/>
          <RetField label="Then 1/month · cap"
            value={policy.keep_monthly_months} unit="months"
            min={0} max={600} disabled={busy || !policy.enabled}
            hint="0 = keep forever"
            testid="ret-monthly"
            onChange={v => save({ keep_monthly_months: v })}/>
        </div>

        {/* Live preview banner */}
        <div style={{
          background: preview.dropped > 0 ? "#fff7ed" : "#ecfdf5",
          border: `1px solid ${preview.dropped > 0 ? "#fdba74" : "#86efac"}`,
          padding: "10px 14px", borderRadius: 6, fontSize: 12,
          color: preview.dropped > 0 ? "#7c2d12" : "#065f46",
          marginBottom: 12,
        }}>
          <div style={{ fontWeight: 800, marginBottom: 4 }}>
            {preview.dropped > 0
              ? `If applied now: keep ${preview.kept}, drop ${preview.dropped} (frees ${fmtMB(dropBytes)})`
              : `Nothing to prune — all ${preview.kept} snapshots fall inside the policy.`}
          </div>
          <div style={{ fontSize: 11, opacity: 0.85,
                        fontFamily: "monospace" }}>
            Per tier: all={preview.tier_counts.kept_all}
            {" · "}daily={preview.tier_counts.kept_daily}
            {" · "}weekly={preview.tier_counts.kept_weekly}
            {" · "}monthly={preview.tier_counts.kept_monthly}
            {" · "}<strong>Hub footprint after: ~{fmtGB(keptBytes)}</strong>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center",
                      flexWrap: "wrap" }}>
          <button onClick={runNow} disabled={busy || !policy.enabled}
            data-testid="backup-retention-run"
            style={pendingRun
              ? { ...btn("#dc2626"), color: "white", borderColor: "#dc2626" }
              : btn("#fef3c7")}>
            {pendingRun
              ? <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.1em" }}>
                  CLICK AGAIN TO PRUNE
                </span>
              : <><Trash2 className="w-3.5 h-3.5"/>Run retention now</>}
          </button>
          {policy.last_run_at && (
            <span style={{ fontSize: 11, color: "#64748b", fontFamily: "monospace" }}>
              Last run: {fmtAge(policy.last_run_at)}
              {policy.last_run_dropped > 0 && (
                <> · dropped {policy.last_run_dropped} ({fmtMB(policy.last_run_bytes_freed || 0)})</>
              )}
            </span>
          )}
        </div>
        {err && (
          <div style={{ marginTop: 8, color: "#b91c1c", fontSize: 12 }}>{err}</div>
        )}
      </div>
    </Section>
  );
}

// Small inline numeric field used inside the retention card.
function RetField({ label, value, unit, min, max, disabled, onChange, hint, testid }) {
  const [local, setLocal] = useState(String(value));
  useEffect(() => { setLocal(String(value)); }, [value]);
  const commit = () => {
    const n = Number(local);
    if (!Number.isFinite(n) || n < min || n > max) {
      setLocal(String(value));    // revert
      return;
    }
    if (n !== value) onChange(n);
  };
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#475569",
                    marginBottom: 4 }}>{label}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <input type="number" min={min} max={max} value={local}
          data-testid={testid}
          disabled={disabled}
          onChange={e => setLocal(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === "Enter") e.target.blur(); }}
          style={{ ...inp(), width: 80, textAlign: "right" }}/>
        <span style={{ fontSize: 12, color: "#64748b" }}>{unit}</span>
      </div>
      {hint && <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>{hint}</div>}
    </div>
  );
}
