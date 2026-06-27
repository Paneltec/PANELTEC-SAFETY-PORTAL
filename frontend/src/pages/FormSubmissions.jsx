// Forms Library — Submissions list page (per template).
// Route: /app/forms/templates/:templateId/submissions
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Camera, CheckCircle2, Circle, Download, FileText, Image as ImageIcon,
  Loader2, MapPin, Pencil, Search, Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../lib/api';
import { getUser } from '../lib/auth';
import { PageHeader } from '../components/capture/Ui';
import { SubmissionViewModal } from './Forms';

const CAT_BANNER = {
  incident:   { border: '#e69aa3', bg: '#fbe4e7', fg: '#7a1f33' },
  inspection: { border: '#c8bce0', bg: '#ece6f4', fg: '#4f3a8c' },
  toolbox:    { border: '#e6d995', bg: '#f7eed1', fg: '#5c4810' },
  near_miss:  { border: '#e6b88f', bg: '#f8d7c3', fg: '#7a3a10' },
  general:    { border: '#cbd5e1', bg: '#f1f5f9', fg: '#334155' },
};

const WRITE_ROLES = new Set(['admin', 'hseq_lead']);

function StatusPill({ status }) {
  if (status === 'complete') return (
    <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full bg-[#d8ecdd] text-[#1f7a3f] border border-[#b6dcbf]">
      <CheckCircle2 size={10} /> Complete
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full bg-[#f7eed1] text-[#8c6a1a] border border-[#e6d995]">
      <Circle size={10} /> Draft
    </span>
  );
}

function openPdfWindow() {
  // open the popup synchronously inside the user gesture
  return window.open('about:blank', 'paneltec-pdf',
    'popup=yes,width=900,height=1100,scrollbars=yes,resizable=yes,toolbar=no,location=no,menubar=no,status=no');
}

export default function FormSubmissions() {
  const { templateId } = useParams();
  const navigate = useNavigate();
  const user = getUser();
  const canDelete = WRITE_ROLES.has(user?.role);

  const [template, setTemplate] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [viewId, setViewId] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const [t, s] = await Promise.all([
        api.get(`/forms/templates/${templateId}`),
        api.get(`/forms/templates/${templateId}/submissions`),
      ]);
      setTemplate(t.data);
      setRows(s.data || []);
    } catch (e) { toast.error(apiError(e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [templateId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((r) => statusFilter === 'all' ? true : r.status === statusFilter)
      .filter((r) => !q || `${r.submitted_by_name || ''} ${r.template_name_snapshot || ''}`.toLowerCase().includes(q));
  }, [rows, search, statusFilter]);

  const palette = CAT_BANNER[template?.category] || CAT_BANNER.general;

  const openPdf = async (sub) => {
    const win = openPdfWindow();
    if (!win) { toast.error('Popup blocked — please allow popups'); return; }
    try {
      const { data } = await api.post('/forms/submissions/pdf-token', {
        submission_id: sub.id, action: 'view',
      });
      win.location.replace(`${process.env.REACT_APP_BACKEND_URL}${data.path}`);
      win.focus();
    } catch (e) {
      try { win.close(); } catch { /* ignore */ }
      toast.error(apiError(e));
    }
  };

  const removeSubmission = async (sub) => {
    if (!window.confirm('Delete this submission?')) return;
    try {
      await api.delete(`/forms/submissions/${sub.id}`);
      toast.success('Submission deleted');
      load();
    } catch (e) { toast.error(apiError(e)); }
  };

  const exportCsv = () => {
    if (!template || rows.length === 0) return;
    const headers = ['Submitted by', 'Submitted at', 'Status', 'Photos', 'Signature', 'GPS',
      ...(template.fields || []).filter((f) => !['photo', 'signature', 'gps'].includes(f.type))
        .map((f) => f.label)];
    const escape = (s) => {
      const v = String(s ?? '').replace(/"/g, '""');
      return /[",\n]/.test(v) ? `"${v}"` : v;
    };
    const lines = [headers.map(escape).join(',')];
    for (const r of rows) {
      const byId = Object.fromEntries((r.fields || []).map((f) => [f.id, f]));
      const dataCells = (template.fields || [])
        .filter((f) => !['photo', 'signature', 'gps'].includes(f.type))
        .map((f) => {
          const v = byId[f.id]?.value;
          return v == null ? '' : (Array.isArray(v) ? v.join('; ') : String(v));
        });
      lines.push([
        r.submitted_by_name || '',
        (r.submitted_at || '').slice(0, 19).replace('T', ' '),
        r.status || 'complete',
        r.photo_count || 0,
        r.has_signature ? 'Y' : 'N',
        r.has_gps ? 'Y' : 'N',
        ...dataCells,
      ].map(escape).join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(template.name || 'submissions').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-7xl mx-auto" data-testid="form-submissions-page">
      <button onClick={() => navigate('/app/forms')}
        data-testid="back-to-forms"
        className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-[#1e4a8c] mb-3">
        <ArrowLeft size={14} /> Back to Forms Library
      </button>
      <PageHeader crumb={`Compliance / Forms / ${template?.name || '…'}`}
        title={template ? `${template.name} submissions` : 'Submissions'}
        subtitle="Every fill-out captured against this template." />

      {template && (
        <div className="mb-5 rounded-2xl px-4 py-3 flex items-center gap-3 border"
          style={{ borderColor: palette.border, background: palette.bg }}
          data-testid="submissions-banner">
          <div className="rounded-xl p-2.5 bg-white/60"><FileText size={20} style={{ color: palette.fg }} /></div>
          <div className="flex-1">
            <div className="text-sm font-semibold" style={{ color: palette.fg }}>
              {template.name} · {(template.category || 'general').replace('_', ' ').toUpperCase()}
            </div>
            {template.description && <div className="text-xs mt-0.5" style={{ color: palette.fg, opacity: 0.85 }}>{template.description}</div>}
          </div>
          <span className="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full bg-white border" style={{ borderColor: palette.border, color: palette.fg }}>
            {rows.length} total
          </span>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex gap-1.5">
          {['all', 'complete', 'draft'].map((k) => (
            <button key={k} onClick={() => setStatusFilter(k)}
              data-testid={`status-filter-${k}`}
              className={`text-xs font-semibold uppercase tracking-wider px-3 py-1.5 rounded-full ${
                statusFilter === k ? 'bg-[#1e4a8c] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}>{k}</button>
          ))}
        </div>
        <div className="flex-1" />
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            data-testid="submissions-search" placeholder="Search by submitter…"
            className="pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg bg-white w-64" />
        </div>
        <button onClick={exportCsv} disabled={rows.length === 0} data-testid="submissions-export-csv"
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          <Download size={14} /> Export CSV
        </button>
      </div>

      {loading ? (
        <div className="text-sm text-slate-500 inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center" data-testid="submissions-empty">
          <FileText size={28} className="mx-auto text-slate-300 mb-2" />
          <div className="text-sm font-medium text-slate-700">No submissions yet</div>
          <div className="text-xs text-slate-500 mt-1">Fill out this form to create your first submission.</div>
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden" data-testid="submissions-table">
          {/* Desktop table */}
          <table className="hidden md:table w-full text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">Submitted by</th>
                <th className="text-left px-4 py-3 font-semibold">When</th>
                <th className="text-left px-4 py-3 font-semibold">Status</th>
                <th className="text-left px-4 py-3 font-semibold">Photos</th>
                <th className="text-left px-4 py-3 font-semibold">Signature</th>
                <th className="text-left px-4 py-3 font-semibold">GPS</th>
                <th className="text-right px-4 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50 transition-colors cursor-pointer"
                  onClick={() => setViewId(r.id)} data-testid={`submission-row-${r.id}`}>
                  <td className="px-4 py-3 font-medium text-slate-800">{r.submitted_by_name || '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{(r.submitted_at || '').slice(0, 16).replace('T', ' ')}</td>
                  <td className="px-4 py-3"><StatusPill status={r.status} /></td>
                  <td className="px-4 py-3 text-slate-700"><span className="inline-flex items-center gap-1"><ImageIcon size={12} className="text-slate-400" /> {r.photo_count || 0}</span></td>
                  <td className="px-4 py-3"><span className={`text-xs ${r.has_signature ? 'text-[#1f7a3f]' : 'text-slate-400'}`}>{r.has_signature ? '✓' : '×'}</span></td>
                  <td className="px-4 py-3"><span className={`text-xs ${r.has_gps ? 'text-[#1f7a3f]' : 'text-slate-400'}`}>{r.has_gps ? '✓' : '×'}</span></td>
                  <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="inline-flex gap-1">
                      <button onClick={() => setViewId(r.id)} data-testid={`view-${r.id}`}
                        className="px-2 py-1 text-xs rounded border border-slate-200 hover:bg-slate-100">View</button>
                      <button onClick={() => openPdf(r)} data-testid={`pdf-${r.id}`}
                        className="px-2 py-1 text-xs rounded border border-slate-200 hover:bg-slate-100 inline-flex items-center gap-1">
                        <FileText size={11} /> PDF
                      </button>
                      {canDelete && (
                        <button onClick={() => removeSubmission(r)} data-testid={`delete-sub-${r.id}`}
                          className="px-2 py-1 text-xs rounded bg-[#fbe4e7] text-[#7a1f33] hover:bg-[#f4c7cd]">
                          <Trash2 size={11} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {/* Mobile stack */}
          <div className="md:hidden divide-y divide-slate-100">
            {filtered.map((r) => (
              <div key={r.id} className="p-4 active:bg-slate-50" data-testid={`submission-card-${r.id}`}>
                <div className="flex items-center gap-2 mb-1">
                  <StatusPill status={r.status} />
                  <span className="text-[11px] text-slate-500 ml-auto">{(r.submitted_at || '').slice(0, 16).replace('T', ' ')}</span>
                </div>
                <div className="text-sm font-semibold text-slate-800">{r.submitted_by_name || '—'}</div>
                <div className="mt-1 flex items-center gap-3 text-[11px] text-slate-500">
                  <span className="inline-flex items-center gap-1"><ImageIcon size={11} /> {r.photo_count || 0}</span>
                  <span className="inline-flex items-center gap-1"><Pencil size={11} /> {r.has_signature ? 'Signed' : 'Unsigned'}</span>
                  <span className="inline-flex items-center gap-1"><MapPin size={11} /> {r.has_gps ? 'Geo' : 'No geo'}</span>
                </div>
                <div className="mt-2 flex gap-2">
                  <button onClick={() => setViewId(r.id)} className="flex-1 px-3 py-2 text-xs rounded-lg border border-slate-200 bg-white">View</button>
                  <button onClick={() => openPdf(r)} className="flex-1 px-3 py-2 text-xs rounded-lg bg-[#1e4a8c] text-white inline-flex items-center justify-center gap-1">
                    <FileText size={11} /> PDF
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {viewId && <SubmissionViewModal submissionId={viewId} onClose={() => setViewId(null)} />}
    </div>
  );
}
