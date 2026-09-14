/**
 * v58.13.132gh — Admin surface for byte-less file records.
 *
 * Post-incident (Stephen's 410 storm): after the aggressive
 * `.132gh` GridFS migration, most files serve normally. A residue of
 * `doc_files` rows survive but their bytes are gone forever — they
 * can only be resolved by an admin either reuploading the source
 * document or removing the record.
 *
 * This page renders that residue with:
 *   • A prominent count / banner at the top.
 *   • One row per orphan: filename, uploaded metadata, worker (if
 *     any), parent record kind, and TWO buttons — Reupload (opens
 *     a native file picker that POSTs to the correct
 *     `reupload_endpoint`) and Remove record (DELETE
 *     `/api/admin/missing-files/files/{id}`).
 *   • Refresh button that re-runs the backend scan.
 *
 * NOT a general-purpose file admin — deliberate. The page only
 * shows records the backend has flagged as byte-less. Everything
 * else stays in Document Library / Certifications.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import api, { apiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, RefreshCw, Upload, Trash2, AlertTriangle } from 'lucide-react';

const KIND_LABELS = {
  worker_certification: 'Worker certification',
  induction: 'Induction / competency',
  document_library: 'Document Library',
};

export default function AdminMissingFiles() {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const [busyId, setBusyId] = useState(null);
  const fileInputRef = useRef(null);
  const pendingRow = useRef(null);

  const fetchScan = useCallback(async () => {
    setState({ loading: true, data: null, error: null });
    try {
      const r = await api.get('/admin/missing-files/scan');
      setState({ loading: false, data: r.data, error: null });
    } catch (e) {
      setState({ loading: false, data: null, error: apiError(e) });
    }
  }, []);

  useEffect(() => { fetchScan(); }, [fetchScan]);

  const triggerReupload = (row) => {
    if (!row.reupload_endpoint) {
      toast.error('This record has no parent — remove it instead.');
      return;
    }
    pendingRow.current = row;
    fileInputRef.current?.click();
  };

  const onFilePicked = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const row = pendingRow.current;
    pendingRow.current = null;
    if (!file || !row) return;
    setBusyId(row.id);
    try {
      const fd = new FormData();
      // Endpoints in this codebase use `file` OR `files` — the
      // worker-cert / induction card upload uses `file`, so this
      // works for both parent_kind = worker_certification and
      // induction. See backend/worker_certifications.py:548 and
      // backend/workers_inductions.py:1293.
      fd.append('file', file, file.name);
      // reupload_endpoint already carries the `/api` prefix, so
      // strip it before handing to the axios instance (which
      // adds it back).
      const path = row.reupload_endpoint.replace(/^\/api/, '');
      await api.post(path, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast.success(`Reuploaded ${file.name}`);
      fetchScan();
    } catch (err) {
      toast.error(`Reupload failed: ${apiError(err)}`);
    } finally {
      setBusyId(null);
    }
  };

  const removeRecord = async (row) => {
    if (!window.confirm(
      `Permanently remove the metadata for "${row.filename}"?\n` +
      'This clears the stale record — reupload later if you find the ' +
      'original file.',
    )) return;
    setBusyId(row.id);
    try {
      await api.delete(`/admin/missing-files/files/${row.id}`);
      toast.success('Record removed');
      fetchScan();
    } catch (err) {
      toast.error(`Remove failed: ${apiError(err)}`);
    } finally {
      setBusyId(null);
    }
  };

  const { loading, data, error } = state;

  return (
    <div className="p-6 space-y-6" data-testid="admin-missing-files-page">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <AlertTriangle className="h-6 w-6 text-amber-500" />
            Files needing reupload
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            These records exist in the database but the underlying file
            bytes are gone (ephemeral storage was lost across a pod
            restart before <code>.132gh</code> swept everything into
            GridFS). Reupload the source document or remove the record.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={fetchScan}
          disabled={loading}
          data-testid="rescan-btn"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Rescan
        </Button>
      </div>

      {error && (
        <Card className="border-red-300 bg-red-50">
          <CardContent className="p-4 text-sm text-red-900">
            {error}
          </CardContent>
        </Card>
      )}

      {!loading && data && (
        <Card
          className={data.total > 0 ? 'border-amber-300 bg-amber-50' : 'border-emerald-200 bg-emerald-50'}
          data-testid="missing-files-summary"
        >
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              {data.total > 0 ? (
                <>
                  <Badge variant="destructive" data-testid="missing-count">
                    {data.total}
                  </Badge>
                  file{data.total === 1 ? '' : 's'} need attention
                </>
              ) : (
                <>All clear — no missing files.</>
              )}
            </CardTitle>
          </CardHeader>
          {data.total > 0 && (
            <CardContent className="pt-0 text-xs text-amber-900">
              {Object.entries(data.by_kind).map(([k, n]) => (
                <span key={k} className="mr-4">
                  {KIND_LABELS[k] || k}: <b>{n}</b>
                </span>
              ))}
            </CardContent>
          )}
        </Card>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Scanning…
        </div>
      )}

      {!loading && data && data.items?.length > 0 && (
        <div className="space-y-2" data-testid="missing-files-list">
          {data.items.map((row) => (
            <Card key={row.id} className="border-slate-200">
              <CardContent className="p-4 flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate" title={row.filename}>
                    {row.filename || '(no filename)'}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-1">
                    <span>
                      {KIND_LABELS[row.parent_kind] || row.parent_kind || 'Document Library'}
                    </span>
                    {row.parent_label && (
                      <span>· {row.parent_label}</span>
                    )}
                    {row.worker_name && (
                      <span>· Worker: {row.worker_name}</span>
                    )}
                    {row.seed_folder && (
                      <span>· Folder: {row.seed_folder}</span>
                    )}
                    {row.uploaded_at && (
                      <span>· Uploaded {row.uploaded_at.slice(0, 10)}</span>
                    )}
                    {row.uploaded_by_name && (
                      <span>· By {row.uploaded_by_name}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    variant="default"
                    size="sm"
                    disabled={busyId === row.id || !row.reupload_endpoint}
                    onClick={() => triggerReupload(row)}
                    data-testid={`reupload-btn-${row.id}`}
                  >
                    {busyId === row.id ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <Upload className="h-4 w-4 mr-1" />
                    )}
                    Reupload
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busyId === row.id}
                    onClick={() => removeRecord(row)}
                    data-testid={`remove-btn-${row.id}`}
                  >
                    <Trash2 className="h-4 w-4 mr-1" />
                    Remove
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={onFilePicked}
        data-testid="reupload-file-input"
      />
    </div>
  );
}
