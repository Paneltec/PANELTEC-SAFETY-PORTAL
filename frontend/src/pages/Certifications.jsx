// Global Certifications view — Settings → Certifications.
// Lists every cert across every worker in the org with status filter chips,
// search, CSV export, and the same Send Reminder action available in the
// Worker edit modal.
import React, { useEffect, useMemo, useState } from 'react';
import {
  Award, ClipboardList, Download, Loader2, Mail, Search, Trash2, X,
} from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../lib/api';
import { getUser } from '../lib/auth';
import { PageHeader } from '../components/capture/Ui';

const WRITE_ROLES = new Set(['admin', 'hseq_lead']);

const STATUS_FILTERS = [
  { key: 'all',           label: 'All',            cls: 'bg-slate-100 text-slate-700' },
  { key: 'expired',       label: 'Expired',        cls: 'bg-[#f7d8dc] text-[#a8324c]' },
  { key: 'expiring_soon', label: 'Expiring soon',  cls: 'bg-[#f7eed1] text-[#8c6a1a]' },
  { key: 'missing_file',  label: 'Missing file',   cls: 'bg-[#f7eed1] text-[#8c6a1a]' },
  { key: 'valid',         label: 'Valid',          cls: 'bg-[#d8ecdd] text-[#1f7a3f]' },
  { key: 'no_expiry',     label: 'No expiry',      cls: 'bg-[#d8e6f4] text-[#1e4a8c]' },
];

const STATUS_RANK = { expired: 0, expiring_soon: 1, missing_file: 2, valid: 3, no_expiry: 4 };

const STATUS_CHIP = {
  valid:         'bg-[#d8ecdd] text-[#1f7a3f] border-[#b6dcbf]',
  expiring_soon: 'bg-[#f7eed1] text-[#8c6a1a] border-[#e6d995]',
  expired:       'bg-[#f7d8dc] text-[#a8324c] border-[#e69aa3]',
  no_expiry:     'bg-[#d8e6f4] text-[#1e4a8c] border-[#b9d2ec]',
  missing_file:  'bg-[#f7eed1] text-[#8c6a1a] border-[#e6d995]',
};

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportCsv(rows) {
  const headers = ['worker', 'name', 'issuer', 'issue_date', 'expiry_date', 'status', 'seed_folder'];
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push([
      `${r.worker_first_name} ${r.worker_last_name}`.trim(),
      r.name, r.issuer || '', r.issue_date || '', r.expiry_date || '',
      r.status?.key || '', r.doc_seed_folder || '',
    ].map(csvCell).join(','));
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `certifications-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

export default function Certifications() {
  const user = getUser();
  const canEdit = WRITE_ROLES.has(user?.role);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [sendingId, setSendingId] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/workers/certifications/all');
      setRows(data || []);
    } catch (e) { toast.error(apiError(e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const counts = useMemo(() => {
    const c = { all: rows.length, expired: 0, expiring_soon: 0, missing_file: 0, valid: 0, no_expiry: 0 };
    for (const r of rows) {
      const k = r.status?.key;
      if (k && k in c) c[k]++;
    }
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const ranked = rows
      .filter((r) => filter === 'all' ? true : r.status?.key === filter)
      .filter((r) => {
        if (!q) return true;
        const blob = `${r.worker_first_name} ${r.worker_last_name} ${r.name} ${r.issuer || ''} ${r.doc_seed_folder || ''}`.toLowerCase();
        return blob.includes(q);
      });
    return ranked.sort((a, b) => {
      const ra = STATUS_RANK[a.status?.key] ?? 9;
      const rb = STATUS_RANK[b.status?.key] ?? 9;
      if (ra !== rb) return ra - rb;
      return (a.expiry_date || 'z').localeCompare(b.expiry_date || 'z');
    });
  }, [rows, filter, search]);

  const sendReminder = async (cert) => {
    setSendingId(cert.id);
    try {
      const { data } = await api.post(`/workers/certifications/${cert.id}/send-reminder`);
      const sms = (data.sms_to || []).length;
      const email = (data.email_to || []).length;
      toast.success(`Reminder sent · ${email} email${email === 1 ? '' : 's'}${sms ? ` + ${sms} SMS` : ''}`);
    } catch (e) { toast.error(apiError(e)); }
    finally { setSendingId(null); }
  };

  return (
    <div className="max-w-7xl mx-auto" data-testid="certifications-page">
      <PageHeader crumb="Settings / Certifications" title="Certifications"
        subtitle="Every certification across your crew, ranked by what needs attention." />

      {/* Butter banner */}
      <div className="mb-5 rounded-2xl border border-[#e6d995] bg-[#fffaeb] px-4 py-3 flex items-center gap-3"
        data-testid="cert-banner">
        <div className="rounded-xl bg-[#f7eed1] p-2.5"><ClipboardList size={20} className="text-[#8c6a1a]" /></div>
        <div className="flex-1">
          <div className="text-sm font-semibold text-[#5c4810]">Compliance attention queue</div>
          <div className="text-xs text-[#7a611a] mt-0.5">Expired, expiring-soon and missing-file certs are listed first.
            Use Send Reminder to nudge admins immediately, or wait for the daily auto-reminder.</div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5" data-testid="cert-filter-chips">
          {STATUS_FILTERS.map((f) => (
            <button key={f.key} onClick={() => setFilter(f.key)} data-testid={`filter-${f.key}`}
              className={`text-xs font-semibold uppercase tracking-wider px-3 py-1.5 rounded-full transition ${
                filter === f.key ? `${f.cls} ring-2 ring-offset-1 ring-[#1e4a8c]/30` : `${f.cls} opacity-70 hover:opacity-100`
              }`}>
              {f.label} <span className="ml-1 opacity-70">{counts[f.key] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search worker, cert or issuer…" data-testid="cert-search"
            className="pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg bg-white w-72" />
        </div>
        <button onClick={() => exportCsv(filtered)} disabled={filtered.length === 0}
          data-testid="cert-export-csv"
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          <Download size={14} /> Export CSV
        </button>
      </div>

      {loading ? (
        <div className="text-sm text-slate-500 inline-flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" /> Loading certifications…
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center" data-testid="cert-empty">
          <Award size={28} className="mx-auto text-slate-300 mb-2" />
          <div className="text-sm font-medium text-slate-700">
            {rows.length === 0 ? 'No certifications yet' : 'No matches for this filter'}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            {rows.length === 0
              ? 'Add them via Workers → individual Edit Worker → Certifications tab.'
              : 'Try a different filter or clear your search.'}
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-x-auto">
          <table className="w-full text-sm" data-testid="cert-table">
            <thead className="bg-slate-50 text-slate-500 text-[10px] uppercase tracking-wider">
              <tr>
                <th className="text-left px-3 py-3">Worker</th>
                <th className="text-left px-3 py-3">Certification</th>
                <th className="text-left px-3 py-3 hidden md:table-cell">Issuer</th>
                <th className="text-left px-3 py-3 hidden lg:table-cell">Issued</th>
                <th className="text-left px-3 py-3">Expiry</th>
                <th className="text-left px-3 py-3">Status</th>
                <th className="text-left px-3 py-3 hidden xl:table-cell">Seed folder</th>
                <th className="text-right px-3 py-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50" data-testid={`cert-row-${c.id}`}>
                  <td className="px-3 py-3 font-semibold text-slate-900">
                    {c.worker_first_name} {c.worker_last_name}
                  </td>
                  <td className="px-3 py-3">{c.name}</td>
                  <td className="px-3 py-3 text-slate-600 hidden md:table-cell">{c.issuer || '—'}</td>
                  <td className="px-3 py-3 text-slate-500 hidden lg:table-cell">{c.issue_date || '—'}</td>
                  <td className="px-3 py-3 text-slate-500">{c.expiry_date || '—'}</td>
                  <td className="px-3 py-3">
                    <span data-testid={`status-${c.status?.key}-${c.id}`}
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider border ${STATUS_CHIP[c.status?.key] || STATUS_CHIP.missing_file}`}>
                      {c.status?.label}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-xs text-slate-500 hidden xl:table-cell">{c.doc_seed_folder || '—'}</td>
                  <td className="px-3 py-3 text-right">
                    {canEdit && (
                      <button onClick={() => sendReminder(c)} disabled={sendingId === c.id}
                        data-testid={`send-reminder-${c.id}`}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#fbe4e7] text-[#7a1f33] text-xs font-semibold hover:bg-[#f4c7cd] disabled:opacity-60">
                        {sendingId === c.id ? <Loader2 size={11} className="animate-spin" /> : <Mail size={11} />}
                        Send reminder
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
