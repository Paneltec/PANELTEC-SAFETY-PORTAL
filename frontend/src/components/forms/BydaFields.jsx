// v160.3.9.58.12.2 — Render arms for the 3 BYDA field types.
// Fill-mode + read-only view flow via a shared `readOnly` prop so
// `SubmissionViewer` can reuse the same components.
//
// v58.12.2 close-out of the pieces deferred in v58.12.1:
//   · AttachmentField — full drag-and-drop upload UI. Client MIME +
//     size pre-flight matches backend/forms.py:1084/1088. Uploads
//     immediately on file add (matches how photos work). If the
//     submission has not been created yet (`submissionId == null`)
//     the dropzone renders disabled with a "save the form first"
//     hint — same guard the photo endpoint relies on.
//   · ActionsField — `_off_roster` moved to component-local state
//     so it never leaks into the submit payload. Closed-requires-
//     date_closed now emits a `data-testid="actions-row-error-{i}"`
//     span that Forms.jsx reads via the `actionsFieldErrors` helper
//     below to BLOCK submit (previously the red border was cosmetic
//     only). Saved-row Remove button tooltip bumped to v58.12.3.
//   · downloadAttachment — bare <a href> would drop the Bearer JWT
//     and the FileResponse would 401. Route every download through
//     the auth'd api client instead (same pattern as PdfPreviewModal
//     and AssetDrawer).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Trash2, Plus, FileText, Download, Loader2, AlertCircle, X, RefreshCw,
} from 'lucide-react';
import api from '../../lib/api';
import OpenAsPdfButton from '../OpenAsPdfButton';

// Pure helper — exported for jsdom tests.
// Returns { ok: true } or { ok: false, error: string } per the client
// pre-flight rules. Server enforces the SAME rules independently at
// backend/forms.py:1084 (415) and :1088 (413).
export function attachmentPreflight(file, cfg = {}) {
  const allowed = Array.isArray(cfg.allowed_mimes) ? cfg.allowed_mimes : [];
  const maxBytes = Number.isFinite(cfg.max_bytes) ? cfg.max_bytes : 25 * 1024 * 1024;
  const mime = ((file && file.type) || '').toLowerCase();
  if (allowed.length > 0 && !allowed.includes(mime)) {
    return { ok: false, error: `Unsupported file type: ${mime || 'unknown'}. Allowed: ${allowed.join(', ')}` };
  }
  if (file && file.size > maxBytes) {
    const mb = Math.round((file.size / 1024 / 1024) * 10) / 10;
    const capMb = Math.round(maxBytes / 1024 / 1024);
    return { ok: false, error: `File too large: ${mb} MB > ${capMb} MB` };
  }
  return { ok: true };
}

// Pure helper — exported for jsdom tests + Forms.jsx submit gate.
// Returns an array of { rowIndex } for every actions row where
// status === 'Closed' but date_closed is empty. Non-actions fields
// return []. Non-array values return [] (empty is valid — the
// invariant only triggers on rows already marked Closed).
export function actionsFieldErrors(field, value) {
  if (!field || field.type !== 'actions') return [];
  const rows = Array.isArray(value) ? value : [];
  const errs = [];
  rows.forEach((r, i) => {
    if (r && r.status === 'Closed' && !r.date_closed) {
      errs.push({ rowIndex: i });
    }
  });
  return errs;
}

// Route every attachment download through the auth'd api client.
// Prefer the server-provided `url` (strip its /api prefix since
// api.get re-prepends the baseURL), fall back to a client-composed
// path when older records lack the field.
// v58.13.14 — `basePath` param lets callers reuse this component for
// non-form-submissions parents. Default preserves the historic
// `/forms/submissions/{id}/attachments` behaviour so every existing
// callsite is untouched.
async function downloadAttachment(submissionId, att, basePath = '/forms/submissions') {
  let path;
  if (att && att.url) {
    path = att.url.startsWith('/api/') ? att.url.slice(4) : att.url;
  } else {
    path = `${basePath}/${submissionId}/attachments/${att.stored_name || att.file_id}`;
  }
  const r = await api.get(path, { responseType: 'blob' });
  const url = URL.createObjectURL(r.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = (att && (att.name || att.stored_name)) || 'attachment';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

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

// v58.13.14 — `apiBasePath` prop makes this component reusable by any
// parent record that follows the `${basePath}/${id}/attachments`
// endpoint convention. Default `/forms/submissions` preserves 100%
// back-compat for every existing FillOutModal callsite. New use:
// AssetServiceTabs schedule form passes
// `apiBasePath="/assets/{asset_id}/schedules"` so the sid slots into
// the same `submissionId` slot without touching the internals.
// `onDelete` — optional callback fired AFTER a server file is removed
// (used by AssetServiceTabs to update the parent form state). Default
// server-file delete just drops the row from local state (previous
// behaviour). When `apiDeletePath` is provided the row is DELETEd on
// the server first.
export function AttachmentField({
  field, value, submissionId, readOnly, onStageChange,
  apiBasePath = '/forms/submissions',
  apiDeletePath,
  onServerFileDeleted,
  // v58.13.132hk — Optional: `(att) => ({source, ref})` mapping so
  // this shared field can render a universal "Open as PDF" button
  // for callers that opt in. Absent → download-only, matches the
  // pre-.132hk UI.
  previewSourceFor,
}) {
  const cfg = field.config || {};
  const allowMultiple = cfg.allow_multiple !== false;
  const [serverFiles, setServerFiles] = useState(Array.isArray(value) ? value : []);
  // v58.12.4 — one state, two lifecycle branches:
  //   isStaging (submissionId == null): rows land as status='staged'
  //     and NEVER upload immediately. Parent (Forms.jsx FillOutModal)
  //     receives them via onStageChange and POSTs after the submission
  //     itself is created — same shape as `photoFiles`.
  //   !isStaging: rows land as status='pending' and upload immediately
  //     via `uploadOne` (kept for the future re-open / edit path).
  const [pending, setPending] = useState([]);
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  const isStaging = !submissionId;
  const canUpload = !readOnly;

  // Merge in server records if the parent re-fetches (dedup by stored_name).
  useEffect(() => {
    if (!Array.isArray(value)) return;
    setServerFiles((prev) => {
      const known = new Set(prev.map((f) => f.stored_name));
      const extra = value.filter((f) => !known.has(f.stored_name));
      return extra.length ? [...prev, ...extra] : prev;
    });
  }, [value]);

  // v58.12.4 — Emit staged (valid) rows up to the parent whenever the
  // pending list changes. Non-staging mode never fires this callback.
  useEffect(() => {
    if (!isStaging || !onStageChange) return;
    const stagedList = pending
      .filter((p) => p.status === 'staged')
      .map((p) => ({
        tempId: p.tempKey,
        file: p.file,
        name: p.name,
        description: p.description,
        mime: p.file?.type || '',
        size: p.file?.size || 0,
      }));
    onStageChange(field.id, stagedList);
  }, [pending, isStaging, field.id]);

  const uploadOne = useCallback(async (entry) => {
    const abort = new AbortController();
    setPending((p) => p.map((x) => x.tempKey === entry.tempKey
      ? { ...x, abort, status: 'pending', error: null } : x));
    const fd = new FormData();
    fd.append('field_id', field.id);
    fd.append('files', entry.file);
    fd.append('names', entry.name);
    fd.append('descriptions', entry.description);
    try {
      const r = await api.post(
        `${apiBasePath}/${submissionId}/attachments`, fd, { signal: abort.signal },
      );
      const saved = r?.data?.attachments?.[0];
      if (!saved) throw new Error('No attachment record returned');
      setServerFiles((prev) => [...prev, saved]);
      setPending((p) => p.filter((x) => x.tempKey !== entry.tempKey));
    } catch (e) {
      if (e?.name === 'CanceledError' || e?.name === 'AbortError') return;
      const msg = e?.response?.data?.detail || e?.message || 'Upload failed';
      setPending((p) => p.map((x) => x.tempKey === entry.tempKey
        ? { ...x, status: 'error', error: msg, abort: null } : x));
    }
  }, [field.id, submissionId, apiBasePath]);

  const addFiles = useCallback((fileList) => {
    if (!canUpload) return;
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    const toUpload = allowMultiple ? files : files.slice(0, 1);
    const nowKey = () => `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const newRows = toUpload.map((file) => {
      const chk = attachmentPreflight(file, cfg);
      const stripped = (file.name || 'file').replace(/\.[^.]+$/, '').trim() || (file.name || 'file');
      return {
        tempKey: nowKey(), file,
        name: stripped, description: '',
        status: chk.ok ? (isStaging ? 'staged' : 'pending') : 'error',
        error: chk.ok ? null : chk.error,
        abort: null,
      };
    });
    setPending((p) => [...p, ...newRows]);
    // Only fire immediate uploads outside staging mode.
    if (!isStaging) {
      newRows.forEach((r) => { if (r.status === 'pending') uploadOne(r); });
    }
  }, [canUpload, cfg, allowMultiple, uploadOne, isStaging]);

  const onDrop = (e) => {
    e.preventDefault(); e.stopPropagation();
    setDragOver(false);
    if (!canUpload) return;
    addFiles(e.dataTransfer?.files);
  };
  const onDragOver = (e) => {
    e.preventDefault(); e.stopPropagation();
    if (canUpload) setDragOver(true);
  };
  const onDragLeave = (e) => {
    e.preventDefault(); e.stopPropagation();
    setDragOver(false);
  };
  const cancelPending = (tempKey) => {
    const row = pending.find((x) => x.tempKey === tempKey);
    if (row?.abort) { try { row.abort.abort(); } catch { /* noop */ } }
    setPending((p) => p.filter((x) => x.tempKey !== tempKey));
  };
  const retryPending = (tempKey) => {
    const row = pending.find((x) => x.tempKey === tempKey);
    if (!row) return;
    const chk = attachmentPreflight(row.file, cfg);
    if (!chk.ok) {
      setPending((p) => p.map((x) => x.tempKey === tempKey
        ? { ...x, status: 'error', error: chk.error } : x));
      return;
    }
    setPending((p) => p.map((x) => x.tempKey === tempKey
      ? { ...x, status: isStaging ? 'staged' : 'pending', error: null } : x));
    if (!isStaging) uploadOne(row);
  };
  const updatePending = (tempKey, patch) => {
    setPending((p) => p.map((x) => x.tempKey === tempKey ? { ...x, ...patch } : x));
  };
  const download = async (att) => {
    try { await downloadAttachment(submissionId, att, apiBasePath); }
    catch { /* click again — user-facing error is acceptable on network fail */ }
  };
  // v58.13.14 — Optional server-side delete. Callers that don't pass
  // `apiDeletePath` retain the historic behaviour (row disappears
  // locally only). Callers that do (e.g. AssetServiceTabs) also
  // hard-delete the blob on the server.
  const removeServerFile = async (att) => {
    if (apiDeletePath) {
      try {
        await api.delete(
          `${apiDeletePath}/${submissionId}/attachments/${att.stored_name || att.file_id}`,
        );
      } catch (e) {
        console.warn('attachment-delete failed', e);
        return;
      }
    }
    setServerFiles((prev) => prev.filter(
      (f) => (f.stored_name || f.file_id) !== (att.stored_name || att.file_id),
    ));
    if (onServerFileDeleted) onServerFileDeleted(att);
  };

  const allowedList = (cfg.allowed_mimes || []).join(', ') || 'server default';
  const maxMB = Math.round((cfg.max_bytes || 25 * 1024 * 1024) / 1024 / 1024);
  const liveServer = serverFiles.filter((f) => !f.deleted_at);

  return (
    <div className="space-y-2" data-testid={`attachment-field-${field.id}`}>
      {!readOnly && (
        <div
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragEnter={onDragOver}
          onDragLeave={onDragLeave}
          onClick={() => { if (canUpload) inputRef.current?.click(); }}
          role="button"
          tabIndex={canUpload ? 0 : -1}
          data-testid={`attachment-dropzone-${field.id}`}
          data-canupload={canUpload ? '1' : '0'}
          data-mode={isStaging ? 'staging' : 'immediate'}
          className={
            'rounded-2xl border-2 border-dashed px-4 py-6 text-center transition-colors ' +
            (canUpload
              ? (dragOver
                ? 'border-brand-blue bg-blue-50 cursor-pointer'
                : 'border-slate-300 bg-slate-50 hover:bg-slate-100 cursor-pointer')
              : 'border-slate-200 bg-slate-50 cursor-not-allowed opacity-70')
          }
        >
          <div className="flex flex-col items-center gap-1 text-sm text-slate-600">
            <FileText size={20} className="text-slate-400" />
            <span className="font-semibold">Drop files here or click to browse</span>
            <span className="text-xs text-slate-500">
              Allowed: {allowedList} · Max {maxMB} MB {allowMultiple ? '· multiple ok' : '· single file'}
            </span>
          </div>
          <input
            ref={inputRef}
            type="file"
            multiple={allowMultiple}
            className="hidden"
            data-testid={`attachment-input-${field.id}`}
            onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
            disabled={!canUpload}
          />
        </div>
      )}

      {pending.map((row) => {
        const isStaged = row.status === 'staged';
        // Testid: staged rows carry a distinct id so tests can assert
        // the local-staging branch. Non-staged rows (pending / error in
        // immediate-upload mode) keep the pre-v58.12.4 testid.
        const rowTestId = isStaged
          ? `attachment-row-staged-${row.tempKey}`
          : `attachment-row-${row.tempKey}`;
        return (
          <div key={row.tempKey}
               data-testid={rowTestId}
               data-status={row.status}
               className={
                 'flex items-start gap-3 rounded-lg border px-3 py-2 ' +
                 (row.status === 'error'
                   ? 'border-rose-300 bg-rose-50'
                   : isStaged
                     ? 'border-brand-blue/40 bg-blue-50/40'
                     : 'border-slate-200 bg-white')
               }>
            {row.status === 'pending'
              ? <Loader2 size={18} className="text-brand-blue animate-spin shrink-0 mt-1" />
              : row.status === 'error'
                ? <AlertCircle size={18} className="text-rose-600 shrink-0 mt-1" />
                : <FileText size={18} className="text-brand-blue shrink-0 mt-1" />}
            <div className="flex-1 min-w-0 space-y-1">
              <input value={row.name}
                     onChange={(e) => updatePending(row.tempKey, { name: e.target.value })}
                     placeholder="Name"
                     data-testid={`attachment-row-name-${row.tempKey}`}
                     className="w-full px-2 py-1 text-sm border border-slate-200 rounded"
                     disabled={row.status === 'pending'} />
              <input value={row.description}
                     onChange={(e) => updatePending(row.tempKey, { description: e.target.value })}
                     placeholder="Description (optional)"
                     data-testid={`attachment-row-desc-${row.tempKey}`}
                     className="w-full px-2 py-1 text-xs border border-slate-200 rounded"
                     disabled={row.status === 'pending'} />
              <div className="text-[10px] text-slate-500 truncate">
                {row.file?.name} · {row.file?.type || 'unknown/unknown'}
                {row.file?.size ? ` · ${Math.round(row.file.size / 1024)} KB` : ''}
              </div>
              {row.status === 'error' && row.error && (
                <div className="text-xs font-semibold text-rose-700"
                     data-testid={`attachment-row-error-${row.tempKey}`}>
                  {row.error}
                </div>
              )}
              {isStaged && (
                <div className="text-[10px] text-brand-blue font-semibold">
                  Staged — will upload when you submit the form.
                </div>
              )}
            </div>
            <div className="flex flex-col gap-1 shrink-0">
              {row.status === 'error' && (
                <button type="button" onClick={() => retryPending(row.tempKey)}
                        data-testid={`attachment-row-retry-${row.tempKey}`}
                        className="inline-flex items-center gap-1 text-xs text-brand-blue hover:underline">
                  <RefreshCw size={12} /> Retry
                </button>
              )}
              <button type="button" onClick={() => cancelPending(row.tempKey)}
                      data-testid={`attachment-row-remove-${row.tempKey}`}
                      className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-rose-600">
                <X size={12} /> {row.status === 'pending' ? 'Cancel' : 'Remove'}
              </button>
            </div>
          </div>
        );
      })}

      {liveServer.map((f) => {
        const preview = previewSourceFor ? previewSourceFor(f) : null;
        return (
        <div key={f.file_id || f.stored_name}
             data-testid={`attachment-row-${f.file_id || f.stored_name}`}
             className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 bg-white">
          <FileText size={18} className="text-slate-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-slate-900 truncate">{f.name || f.stored_name}</div>
            {f.description && <div className="text-xs text-slate-500 truncate">{f.description}</div>}
            <div className="text-[10px] text-slate-400">
              {f.mime} · {f.size ? `${Math.round(f.size / 1024)} KB` : ''}
            </div>
          </div>
          {preview && (
            <OpenAsPdfButton
              source={preview.source}
              refObj={preview.ref}
              filename={f.name || f.stored_name}
              mime={f.mime}
              onDownloadOriginal={() => download(f)}
              label="Open"
              variant="link"
              data-testid={`attachment-open-${f.file_id || f.stored_name}`}
            />
          )}
          <button type="button" onClick={() => download(f)}
                  data-testid={`attachment-download-${f.file_id || f.stored_name}`}
                  className="inline-flex items-center gap-1 text-xs text-brand-blue hover:underline">
            <Download size={14} /> Download
          </button>
          <button type="button"
                  onClick={() => removeServerFile(f)}
                  disabled={readOnly || !apiDeletePath}
                  title={apiDeletePath ? 'Delete attachment' : 'Delete lands per-parent — pass apiDeletePath to enable'}
                  data-testid={`attachment-row-remove-${f.file_id || f.stored_name}`}
                  className={
                    'p-1 ' + (readOnly || !apiDeletePath
                      ? 'text-slate-300 cursor-not-allowed'
                      : 'text-red-600 hover:bg-red-50 rounded')
                  }>
            <Trash2 size={14} />
          </button>
        </div>
        );
      })}

      {liveServer.length === 0 && pending.length === 0 && readOnly && (
        <div className="text-xs text-slate-400 italic">No attachments.</div>
      )}
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
  // v58.12.2 — off-roster is a LOCAL flag, never leaked into payload.
  // Initialize from saved rows: any row with a name but no id was
  // captured off-roster previously.
  const [offRoster, setOffRoster] = useState(() => {
    const init = {};
    rows.forEach((r, i) => {
      if (r && r.actionee_name && !r.actionee_id) init[i] = true;
    });
    return init;
  });
  const isOff = (i) => !!offRoster[i];
  const setOff = (i, val) => setOffRoster((p) => ({ ...p, [i]: val }));

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
    if (rows[i].id) return; // saved-row delete lands in v58.12.3
    onChange && onChange(rows.filter((_, j) => j !== i));
    // Shift off-roster flags left across the removed index.
    setOffRoster((p) => {
      const next = {};
      Object.entries(p).forEach(([k, v]) => {
        const idx = Number(k);
        if (idx < i) next[idx] = v;
        else if (idx > i) next[idx - 1] = v;
      });
      return next;
    });
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
                <tr key={r.id || i} data-testid={`actions-row-${i}`}
                    className={'border-t border-slate-100 align-top ' + (closedInvalid ? 'bg-rose-50/40' : '')}>
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
                          className={'w-full px-2 py-1 border rounded ' + (c.key === 'date_closed' && closedInvalid ? 'border-rose-500' : 'border-slate-200')}
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
                      const off = isOff(i);
                      return (
                        <td key={c.key} className="px-2 py-1 min-w-[220px]">
                          {off ? (
                            <div className="flex gap-1 items-center">
                              <input value={r.actionee_name || ''} onChange={(e) => setRow(i, { actionee_name: e.target.value, actionee_id: '' })}
                                placeholder="Off-roster name" className="flex-1 px-2 py-1 border border-slate-200 rounded"
                                data-testid={`actions-input-${cellId}-freetext`} />
                              <button type="button" onClick={() => { setOff(i, false); setRow(i, { actionee_name: '' }); }}
                                className="text-[10px] text-slate-500 underline" data-testid={`actions-tech-back-${i}`}>from list</button>
                            </div>
                          ) : (
                            <select value={r.actionee_id || ''} onChange={(e) => {
                              if (e.target.value === '__off__') { setOff(i, true); setRow(i, { actionee_id: '', actionee_name: '' }); return; }
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
                        className={'p-1 ' + (r.id ? 'text-slate-300 cursor-not-allowed' : 'text-slate-400 hover:text-rose-600')}
                        title={r.id ? 'Delete lands in v58.12.3' : 'Remove row'}
                        data-testid={`actions-remove-${i}`}><Trash2 size={14} /></button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {/* Row-level error surface — Forms.jsx blocks submit via
          actionsFieldErrors(); this span exists so tests can assert
          the visible message per row. */}
      {rows.map((r, i) => (r.status === 'Closed' && !r.date_closed) ? (
        <div key={`err-${i}`} data-testid={`actions-row-error-${i}`}
             className="text-xs font-semibold text-rose-600 inline-flex items-center gap-1">
          <AlertCircle size={11} /> Row {i + 1}: Status = Closed requires a Date closed.
        </div>
      ) : null)}
      {!readOnly && (
        <button type="button" onClick={addRow} className="inline-flex items-center gap-1 text-sm text-brand-blue hover:underline"
                data-testid="actions-add-row"><Plus size={14} /> Add row</button>
      )}
    </div>
  );
}
