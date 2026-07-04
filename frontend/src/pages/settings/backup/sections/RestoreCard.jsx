/* v155a · Backup admin — Restore from snapshot.
 *
 * BYTE-IDENTICAL extraction from the pre-v155a BackupTab.jsx.
 * This is the highest-risk card in the file (destructive write path)
 * — the extraction copies the render tree verbatim; only the import
 * surface is new.
 */
import React, { useState } from "react";
import { Download, CheckCircle2, Server } from "lucide-react";
import { api, API, authHdr } from "../lib/api";
import { Section, Pill, td, btn, ACCENT } from "../lib/styles";

export default function RestoreCard() {
  const [file, setFile] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const onPick = (f) => {
    if (!f) return;
    if (!f.name.endsWith(".zip")) {
      setError("Pick a .zip snapshot file");
      return;
    }
    setFile(f);
    setPreview(null);
    setResult(null);
    setError("");
  };

  const send = async (mode) => {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const qs = mode === "dry_run" ? "?mode=dry_run" :
                                      `?mode=${mode}&confirm=RESTORE`;
      const r = await api.post(`${API}/restore${qs}`, fd, {
        headers: { ...authHdr(), "Content-Type": "multipart/form-data" },
      });
      if (mode === "dry_run") setPreview(r.data);
      else setResult(r.data);
    } catch (e) {
      setError(e?.response?.data?.detail || e.message);
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setFile(null); setPreview(null); setResult(null); setError("");
  };

  return (
    <Section
      title="Restore from snapshot"
      icon={<Server className="w-4 h-4"/>}>
      <div style={{ padding: 16 }}>
        <div style={{
          background: "#fef2f2", border: "1px solid #fecaca",
          borderLeft: "4px solid #dc2626", color: "#7f1d1d",
          padding: "10px 14px", borderRadius: 8, marginBottom: 14,
          fontSize: 13, lineHeight: 1.5,
        }}>
          <strong>⚠️ Destructive operation.</strong> <em>Replace</em> mode
          wipes each collection in the ZIP before re-inserting.
          <em> Merge</em> is non-destructive (upserts by <code>id</code>).
          Auth sessions and GridFS internals are never touched.
        </div>

        {/* Paneltec Civil (v143) — restore _id caveat. Civil uses UUID `id`
            fields for every internal cross-reference, so the ObjectId
            regeneration inherent in a full JSON dump/restore is safe. Called
            out plainly here so admins running Restore see it before they
            click. */}
        <div
          data-testid="backup-restore-id-caveat"
          style={{
            marginBottom: 14, padding: "10px 12px", borderRadius: 8,
            background: "#fef3c7", border: "1px solid #f59e0b",
            color: "#78350f", fontSize: 12, lineHeight: 1.5,
          }}>
          <strong style={{ fontWeight: 800 }}>Restoring regenerates internal MongoDB <code>_id</code> fields.</strong> Civil references use UUID <code>id</code> fields and are unaffected. Auth sessions and GridFS internals are never touched.
        </div>

        {/* Drop zone */}
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => {
            e.preventDefault(); setDragging(false);
            onPick(e.dataTransfer.files[0]);
          }}
          onClick={() => document.getElementById("backup-restore-input")?.click()}
          data-testid="backup-restore-dropzone"
          style={{
            border: `2px dashed ${dragging ? "#fbbf24" : "#94a3b8"}`,
            background: dragging ? "#fef3c7" : "#f8fafc",
            padding: 24, borderRadius: 8, textAlign: "center",
            cursor: "pointer", transition: "all 0.15s",
            marginBottom: 14,
          }}>
          <Download className="w-6 h-6 inline-block mb-2" style={{ transform: "rotate(180deg)" }}/>
          <div style={{ fontSize: 13, fontWeight: 700 }}>
            {file ? file.name : "Drop a paneltec-snapshot-….zip here"}
          </div>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>
            {file
              ? `${(file.size / (1024 * 1024)).toFixed(1)} MB · click to change`
              : "or click to browse"}
          </div>
          <input id="backup-restore-input" type="file" accept=".zip"
            style={{ display: "none" }}
            onChange={e => onPick(e.target.files[0])}
            data-testid="backup-restore-file"/>
        </div>

        {file && !preview && !result && (
          <button onClick={() => send("dry_run")} disabled={busy}
            style={btn(ACCENT)} data-testid="backup-restore-preview-btn">
            {busy ? "Reading…" : "Preview contents"}
          </button>
        )}

        {error && (
          <div style={{
            background: "#fef2f2", color: "#991b1b",
            padding: "8px 12px", borderRadius: 6, marginTop: 10,
            fontSize: 13,
          }}>{error}</div>
        )}

        {preview && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 13 }}>
              Preview · {preview.manifest?.snapshot_id?.slice(0, 8) || "—"} ·
              {" "}{preview.collections.length} collections
            </div>
            <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#f1f5f9" }}>
                  <th style={td()}>Collection</th>
                  <th style={td()}>In ZIP</th>
                  <th style={td()}>In DB</th>
                  <th style={td()}>Status</th>
                </tr>
              </thead>
              <tbody>
                {preview.collections.map((c, i) => (
                  <tr key={c.collection || `col-${i}`} style={{ borderBottom: "1px solid #e2e8f0" }}>
                    <td style={td()}>{c.collection}</td>
                    <td style={td()}>{c.rows_in_zip ?? "—"}</td>
                    <td style={td()}>{c.rows_existing ?? "—"}</td>
                    <td style={td()}>
                      <Pill>{c.status}{c.reason ? ` · ${c.reason}` : ""}</Pill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={() => {
                if (window.confirm("MERGE: insert new rows + update existing by id. Continue?")) send("merge");
              }} disabled={busy}
                style={btn(ACCENT)} data-testid="backup-restore-merge-btn">
                ✚ Merge (non-destructive)
              </button>
              <button onClick={() => {
                if (window.confirm("REPLACE: WIPE each collection in the ZIP before re-inserting. THIS IS DESTRUCTIVE. Continue?")) send("replace");
              }} disabled={busy}
                style={btn("#fee2e2")} data-testid="backup-restore-replace-btn">
                ⚠ Replace (destructive)
              </button>
              <button onClick={reset} style={btn()}>Cancel</button>
            </div>
          </div>
        )}

        {result && (
          <div style={{ marginTop: 14 }}>
            <div style={{
              background: "#ecfdf5", border: "1px solid #6ee7b7",
              padding: 12, borderRadius: 6, marginBottom: 10, fontSize: 13,
            }}>
              <CheckCircle2 className="w-4 h-4 inline mr-2"/>
              <strong>Restored.</strong> Mode: {result.mode} ·
              {" "}Collections touched: {result.collections.length}
            </div>
            <button onClick={reset} style={btn()}>Done</button>
          </div>
        )}
      </div>
    </Section>
  );
}
