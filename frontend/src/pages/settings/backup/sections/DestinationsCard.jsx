/* v155a · Backup admin — Destinations (SMB) CRUD card.
 * Byte-identical extraction from the pre-v155a BackupTab.jsx monolith.
 */
import React, { useState, useMemo } from "react";
import { Server, Plus, Trash2 } from "lucide-react";
import { api, API, authHdr } from "../lib/api";
import { fmtAge } from "../lib/format";
import { Section, Row, Field, Empty, Pill, INK, PAPER, inp, th, td, btn, cardStyle, ACCENT } from "../lib/styles";

// ============================================================
// Destinations
// ============================================================
export default function DestinationsCard({ destinations, onReload, discovered }) {
  // adding mode: null = closed, "new" = add form, "<id>" = edit form
  const [adding, setAdding] = useState(null);
  // Two-click delete pattern — bypasses window.confirm which some
  // browsers silently block. The first click marks the row red and
  // shows "Click again"; a second click within 5s commits the delete.
  const [pendingDelete, setPendingDelete] = useState(null);
  const blankForm = () => ({
    name: "Office UGREEN tower",
    kind: "smb_lan",
    host: "192.168.15.165",
    share: "Backups",
    path_prefix: "/paneltec-hub",
    username: "",
    password: "",
  });
  const [form, setForm] = useState(blankForm());

  // If the agent has discovered any SMB hosts, offer them as quick-fill
  // chips so the operator doesn't have to type the IP / share manually.
  const quickFill = useMemo(() => {
    const seen = new Set();
    return (discovered || [])
      .filter(d => (d.addresses || []).length)
      .map(d => ({
        host: d.addresses[0],
        name: d.name?.split("._smb._tcp")[0] || d.server,
        server: d.server,
      }))
      .filter(d => {
        const k = d.host;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
  }, [discovered]);

  const startAdd = () => {
    setForm(blankForm());
    setAdding("new");
  };
  const startEdit = (d) => {
    setForm({
      name: d.name || "",
      kind: d.kind || "smb_lan",
      host: d.host || "",
      share: d.share || "",
      path_prefix: d.path_prefix || "",
      username: d.username || "",
      password: "",   // never round-tripped from backend
    });
    setAdding(d.id);
  };

  const save = async () => {
    try {
      const { password, ...rest } = form;
      const qs = password ? `?password=${encodeURIComponent(password)}` : "";
      if (adding === "new") {
        await api.post(`${API}/destinations${qs}`, rest, { headers: authHdr() });
      } else {
        // Edit existing — PUT keeps the saved password unless re-entered.
        await api.put(`${API}/destinations/${adding}${qs}`, rest, { headers: authHdr() });
      }
      setAdding(null);
      setForm(blankForm());
      await onReload();
    } catch (e) {
      alert(e?.response?.data?.detail || e.message);
    }
  };

  const del = async (id) => {
    if (pendingDelete !== id) {
      setPendingDelete(id);
      setTimeout(() => setPendingDelete(p => p === id ? null : p), 5000);
      return;
    }
    setPendingDelete(null);
    await api.delete(`${API}/destinations/${id}`, { headers: authHdr() });
    await onReload();
  };

  // Quick enable/disable toggle. The agent's installer endpoint only
  // ships credentials for destinations where `enabled: true`, so
  // flipping this off is the right way to silence a destination that
  // is permanently unreachable (e.g. wrong subnet, retired NAS) without
  // losing its config — just in case you want to re-enable it later.
  const toggleEnabled = async (d) => {
    try {
      const { id, password_set, created_at, last_seen_at, last_written_at, ...rest } = d;
      await api.put(`${API}/destinations/${id}`,
        { ...rest, enabled: !d.enabled },
        { headers: authHdr() });
      await onReload();
    } catch (e) {
      alert(e?.response?.data?.detail || e.message);
    }
  };

  const editingExisting = adding && adding !== "new";

  return (
    <Section title="Destinations"
      icon={<Server className="w-4 h-4"/>}
      action={
        <button type="button" onClick={() => adding ? setAdding(null) : startAdd()}
          data-testid="backup-add-destination-btn"
          style={btn(ACCENT)}>
          <Plus className="w-3.5 h-3.5"/>{adding ? "Cancel" : "Add destination"}
        </button>
      }>
      {adding && (
        <div style={cardStyle()} data-testid="backup-dest-form">
          {editingExisting && (
            <div style={{
              fontSize: 11, fontWeight: 800, letterSpacing: "0.18em",
              textTransform: "uppercase", color: "#92400e",
              background: "#fef3c7", border: "1px solid #fde68a",
              padding: "6px 10px", borderRadius: 4, marginBottom: 10,
              display: "inline-block",
            }}>
              Editing existing destination · leave password blank to keep saved value
            </div>
          )}
          <Row>
            <Field label="Name">
              <input value={form.name} onChange={e=>setForm({...form, name:e.target.value})}
                style={inp()} data-testid="backup-dest-name"/>
            </Field>
            <Field label="Type">
              <select value={form.kind} onChange={e=>setForm({...form, kind:e.target.value})}
                style={inp()}>
                <option value="smb_lan">SMB (LAN — UGREEN / Synology / QNAP / Windows share)</option>
              </select>
            </Field>
          </Row>
          <Row>
            <Field label="Host / IP">
              <input value={form.host} onChange={e=>setForm({...form, host:e.target.value})}
                placeholder="192.168.15.165" style={inp()} data-testid="backup-dest-host"/>
            </Field>
            <Field label="Share">
              <input value={form.share} onChange={e=>setForm({...form, share:e.target.value})}
                placeholder="Backups" style={inp()}/>
            </Field>
          </Row>
          <Row>
            <Field label="Path prefix">
              <input value={form.path_prefix} onChange={e=>setForm({...form, path_prefix:e.target.value})}
                placeholder="/paneltec-hub" style={inp()}/>
            </Field>
            <Field label="Username">
              <input value={form.username} onChange={e=>setForm({...form, username:e.target.value})}
                placeholder="PaneltecAdmin" style={inp()} data-testid="backup-dest-username"/>
            </Field>
            <Field label={editingExisting ? "Password (blank = keep saved)" : "Password"}>
              <input type="password" value={form.password}
                onChange={e=>setForm({...form, password:e.target.value})}
                placeholder={editingExisting ? "leave blank to keep saved" : ""}
                style={inp()} data-testid="backup-dest-password"/>
            </Field>
          </Row>
          {quickFill.length > 0 && (
            <div style={{ fontSize: 12, marginTop: 8, color: "#475569" }}>
              <strong>mDNS suggestions:</strong>{" "}
              {quickFill.map(q => (
                <button key={q.host} onClick={() => setForm({...form, host: q.host, name: q.name || form.name})}
                  style={{
                    background: "#e0f2fe", border: "1px solid #7dd3fc", color: "#0369a1",
                    padding: "3px 8px", borderRadius: 999, fontSize: 11, fontWeight: 600,
                    margin: "0 4px", cursor: "pointer",
                  }}>
                  {q.name || q.server} → {q.host}
                </button>
              ))}
            </div>
          )}
          <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
            <button onClick={save} style={btn(ACCENT)} data-testid="backup-dest-save">
              {editingExisting ? "Update destination" : "Save destination"}
            </button>
          </div>
        </div>
      )}

      {destinations.length === 0 ? (
        <Empty>No destinations yet. Add an SMB target your agent should ship to.</Empty>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: INK, color: PAPER }}>
              <th style={th()}>Name</th>
              <th style={th()}>Target</th>
              <th style={th()}>Last write</th>
              <th style={th()}>Status</th>
              <th style={th()}></th>
            </tr>
          </thead>
          <tbody>
            {destinations.map(d => (
              <tr key={d.id} style={{ borderBottom: "1px solid rgba(0,0,0,0.07)" }}>
                <td style={td()}><strong>{d.name}</strong></td>
                <td style={{ ...td(), fontFamily: "monospace", fontSize: 11 }}>
                  smb://{d.host}/{d.share}{d.path_prefix || ""}
                  {d.username && <div style={{ color: "#64748b" }}>user: {d.username}</div>}
                </td>
                <td style={td()}>{fmtAge(d.last_written_at)}</td>
                <td style={td()}>
                  {d.enabled ? <Pill ok>Enabled</Pill> : <Pill>Disabled</Pill>}
                  {d.password_set && <Pill ok mini>auth ✓</Pill>}
                </td>
                <td style={td()}>
                  <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                    <button onClick={() => toggleEnabled(d)}
                      data-testid={`backup-dest-toggle-${d.id}`}
                      title={d.enabled
                        ? "Stop the agent shipping snapshots to this destination (keeps config)"
                        : "Resume shipping snapshots to this destination"}
                      style={btn(d.enabled ? "#e0e7ff" : "#dcfce7")}>
                      {d.enabled ? "Disable" : "Enable"}
                    </button>
                    <button onClick={() => startEdit(d)}
                      data-testid={`backup-dest-edit-${d.id}`}
                      style={btn("#fef3c7")}>
                      Edit
                    </button>
                    <button onClick={() => del(d.id)}
                      data-testid={`backup-dest-delete-${d.id}`}
                      style={pendingDelete === d.id
                        ? { ...btn("#dc2626"), color: "white", borderColor: "#dc2626" }
                        : btn("#fee2e2")}>
                      {pendingDelete === d.id
                        ? <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.1em" }}>CLICK AGAIN</span>
                        : <Trash2 className="w-3.5 h-3.5"/>}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}
