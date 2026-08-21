// v160.3.9.58.12.1 — Render arms for the 3 BYDA field types.
// Fill-mode + read-only view flow via a shared `readOnly` prop so
// `SubmissionViewer` can reuse the same components.
//
// AttachmentField upload flow (multipart to
// POST /forms/submissions/{id}/attachments) is deferred to v58.12.2
// — it needs post-submit orchestration in the shared FormRunner that
// I don't want to touch in this ship. In v58.12.1 the attachment
// field renders server-uploaded rows read-only (download links) in
// both fill and view mode; users seed attachments today via curl.
import React, { useEffect, useState } from 'react';
import { Trash2, Plus, FileText, Download } from 'lucide-react';
import api from '../../lib/api';

export function ReferenceMatrixField({ field }) {
  const cfg = field.config || {};
  const columns = cfg.columns || [];
  const rows = cfg.rows || [];
  const sections = cfg.sections || [];
  // Group rows by section (rows already carry a `section` key matching
  // sections[i].title in the seeded template). Preserve section order.
  const bySection = new Map();
  for (const s of sections) bySection.set(s.title, { section: s, rows: [] });
  for (const r of rows) {
    const key = r.section || '';
    if (!bySection.has(key)) bySection.set(key, { section: { title: key, header_style: 'plain' }, rows: [] });
    bySection.get(key).rows.push(r);
  }
  return (
    <div className="rounded-2xl border border-slate-200 overflow-hidden" data-testid={`ref-matrix-${field.id}`}>
      <div className="grid text-xs font-semibold text-slate-600 bg-slate-50 border-b border-slate-200"
           style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0,1fr))` }}>
        {columns.map((c) => <div key={c.key} className="px-3 py-2">{c.label}</div>)}
      </div>
      {Array.from(bySection.values()).map(({ section, rows: srows }) => (
        <div key={section.title}>
          <div className={
            'px-3 py-2 text-sm font-semibold border-b border-slate-200 ' +
            (section.header_style === 'highlighted'
              ? 'bg-yellow-100 text-yellow-900'
              : 'bg-slate-100 text-slate-800')
          } data-testid={`ref-matrix-section-${section.title.toLowerCase().replace(/\s+/g,'-')}`}>
            {section.title}
          </div>
          {srows.map((r, i) => (
            <div key={i} className="grid text-sm border-b border-slate-100 hover:bg-slate-50"
                 style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0,1fr))` }}>
              {columns.map((c) => (
                <div key={c.key} className="px-3 py-2 text-slate-700 whitespace-pre-wrap">{r[c.key] || ''}</div>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function AttachmentField({ field, value, submissionId }) {
  const files = Array.isArray(value) ? value : [];
  return (
    <div className="space-y-2" data-testid={`attachment-field-${field.id}`}>
      {files.length === 0 && (
        <div className="text-xs text-slate-400 italic">No attachments yet. Upload via API (v58.12.2 will add drag-and-drop).</div>
      )}
      {files.map((f) => (
        <div key={f.file_id || f.stored_name} className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 bg-white"
             data-testid={`attachment-row-${f.file_id || f.stored_name}`}>
          <FileText size={18} className="text-slate-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-slate-900 truncate">{f.name || f.stored_name}</div>
            {f.description && <div className="text-xs text-slate-500 truncate">{f.description}</div>}
            <div className="text-[10px] text-slate-400">{f.mime} · {f.size ? `${Math.round(f.size/1024)} KB` : ''}</div>
          </div>
          {f.url && (
            <a href={f.url} target="_blank" rel="noreferrer"
               className="text-brand-blue hover:underline text-xs inline-flex items-center gap-1"
               data-testid={`attachment-download-${f.file_id || f.stored_name}`}>
              <Download size={14} /> Download
            </a>
          )}
        </div>
      ))}
    </div>
  );
}

function useWorkerDirectory() {
  const [techs, setTechs] = useState([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let cancel = false;
    api.get('/workers/directory', { params: { active: true, source: 'simpro' } })
      .then((r) => { if (!cancel) { setTechs(Array.isArray(r.data) ? r.data : []); setLoaded(true); } })
      .catch(() => { if (!cancel) setLoaded(true); });
    return () => { cancel = true; };
  }, []);
  return { techs, loaded };
}

export function ActionsField({ field, value, onChange, readOnly }) {
  const cfg = field.config || {};
  const columns = cfg.columns || [];
  const rows = Array.isArray(value) ? value : [];
  const { techs } = useWorkerDirectory();
  const setRow = (i, patch) => {
    if (readOnly) return;
    const next = rows.map((r, j) => j === i ? { ...r, ...patch } : r);
    onChange && onChange(next);
  };
  const addRow = () => {
    if (readOnly) return;
    onChange && onChange([...rows, { status: 'Open' }]);
  };
  const removeRow = (i) => {
    if (readOnly) return;
    // Rows previously saved (have an `id`) — keep in payload as-is;
    // server won't delete anything. Just filter locally for fresh rows.
    if (rows[i].id) return; // v58.12.2 will add proper delete
    onChange && onChange(rows.filter((_, j) => j !== i));
  };
  return (
    <div className="space-y-2" data-testid={`actions-field-${field.id}`}>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-600">
            <tr>
              {columns.map((c) => <th key={c.key} className="px-2 py-2 text-left font-semibold">{c.label}</th>)}
              {!readOnly && <th className="w-8" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const closedInvalid = r.status === 'Closed' && !r.date_closed;
              return (
                <tr key={r.id || i} data-testid={`actions-row-${i}`} className="border-t border-slate-100 align-top">
                  {columns.map((c) => {
                    const cellId = `${field.id}-${i}-${c.key}`;
                    if (readOnly) {
                      let display = '';
                      if (c.key === 'actionee_id') display = r.actionee_name || '';
                      else display = r[c.key] ?? '';
                      return <td key={c.key} className="px-2 py-2 text-slate-700 whitespace-pre-wrap">{display || '—'}</td>;
                    }
                    if (c.type === 'textarea') return (
                      <td key={c.key} className="px-2 py-1">
                        <textarea rows={2} value={r[c.key] || ''} onChange={(e) => setRow(i, { [c.key]: e.target.value })}
                          className="w-full px-2 py-1 border border-slate-200 rounded" data-testid={`actions-input-${cellId}`} />
                      </td>);
                    if (c.type === 'date') return (
                      <td key={c.key} className="px-2 py-1">
                        <input type="date" value={r[c.key] || ''} onChange={(e) => setRow(i, { [c.key]: e.target.value })}
                          className={'w-full px-2 py-1 border rounded ' + (c.key === 'date_closed' && closedInvalid ? 'border-red-500' : 'border-slate-200')}
                          title={c.key === 'date_closed' && closedInvalid ? 'Required when Status = Closed' : ''}
                          data-testid={`actions-input-${cellId}`} />
                      </td>);
                    if (c.type === 'select') return (
                      <td key={c.key} className="px-2 py-1">
                        <select value={r[c.key] || ''} onChange={(e) => setRow(i, { [c.key]: e.target.value })}
                          className="w-full px-2 py-1 border border-slate-200 rounded bg-white" data-testid={`actions-input-${cellId}`}>
                          {(c.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                      </td>);
                    if (c.type === 'worker_directory') {
                      const offRoster = !!r._off_roster || (r.actionee_name && !r.actionee_id);
                      return (
                        <td key={c.key} className="px-2 py-1 min-w-[220px]">
                          {offRoster ? (
                            <div className="flex gap-1 items-center">
                              <input value={r.actionee_name || ''} onChange={(e) => setRow(i, { actionee_name: e.target.value, actionee_id: '' })}
                                placeholder="Off-roster name" className="flex-1 px-2 py-1 border border-slate-200 rounded"
                                data-testid={`actions-input-${cellId}-freetext`} />
                              <button type="button" onClick={() => setRow(i, { _off_roster: false, actionee_name: '' })}
                                className="text-[10px] text-slate-500 underline" data-testid={`actions-tech-back-${i}`}>from list</button>
                            </div>
                          ) : (
                            <select value={r.actionee_id || ''} onChange={(e) => {
                              if (e.target.value === '__off__') { setRow(i, { _off_roster: true, actionee_id: '', actionee_name: '' }); return; }
                              const t = techs.find((x) => x.id === e.target.value);
                              setRow(i, { actionee_id: e.target.value, actionee_name: t ? t.name : '' });
                            }}
                              className="w-full px-2 py-1 border border-slate-200 rounded bg-white" data-testid={`actions-input-${cellId}`}>
                              <option value="">— Select —</option>
                              {techs.map((t) => <option key={t.id} value={t.id}>{t.name}{t.simpro_employee_id ? ` · #${t.simpro_employee_id}` : ''}</option>)}
                              <option value="__off__">— Off-roster contractor —</option>
                            </select>
                          )}
                        </td>);
                    }
                    // text default
                    return (
                      <td key={c.key} className="px-2 py-1">
                        <input value={r[c.key] || ''} onChange={(e) => setRow(i, { [c.key]: e.target.value })}
                          className="w-full px-2 py-1 border border-slate-200 rounded" data-testid={`actions-input-${cellId}`} />
                      </td>);
                  })}
                  {!readOnly && (
                    <td className="px-2 py-1">
                      <button type="button" onClick={() => removeRow(i)} disabled={!!r.id}
                        className={'p-1 ' + (r.id ? 'text-slate-300 cursor-not-allowed' : 'text-slate-400 hover:text-red-600')}
                        title={r.id ? 'Delete lands in v58.12.2' : 'Remove row'}
                        data-testid={`actions-remove-${i}`}><Trash2 size={14} /></button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!readOnly && (
        <button type="button" onClick={addRow} className="inline-flex items-center gap-1 text-sm text-brand-blue hover:underline"
                data-testid="actions-add-row"><Plus size={14} /> Add row</button>
      )}
    </div>
  );
}
