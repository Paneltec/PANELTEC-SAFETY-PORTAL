// Public renewal page — no auth required. Lives at /renew/:token.
import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Check, Loader2, UploadCloud } from 'lucide-react';
import axios from 'axios';
import Logo from '../components/brand/Logo';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function PublicRenewal() {
  const { token } = useParams();
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState('');
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const refs = useRef([]);

  useEffect(() => {
    axios.get(`${API}/public/renewals/${token}`)
      .then((r) => { setMeta(r.data); setFiles(new Array(r.data.doc_types_requested.length).fill(null)); })
      .catch((e) => setError(e?.response?.data?.detail || 'Link is invalid or has expired.'));
  }, [token]);

  const submit = async () => {
    if (files.some((f) => !f)) { setError('Please attach a file for each requested document.'); return; }
    setBusy(true); setError('');
    const fd = new FormData();
    files.forEach((f) => fd.append('files', f));
    try {
      await axios.post(`${API}/public/renewals/${token}/submit`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setDone(true);
    } catch (e) { setError(e?.response?.data?.detail || 'Upload failed.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-brand-bg flex items-center justify-center px-5 py-10">
      <div className="w-full max-w-xl">
        <div className="mb-6"><Logo size="md" /></div>
        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-card-lg">
          {done ? (
            <div className="text-center py-6" data-testid="renewal-done">
              <div className="inline-flex w-14 h-14 rounded-full bg-brand-green-mint items-center justify-center mb-4"><Check className="text-emerald-700" size={28} /></div>
              <h1 className="font-display text-2xl font-semibold">Thanks — uploaded successfully</h1>
              <p className="mt-2 text-sm text-slate-600">Your documents have been received and are pending review by the Paneltec Civil HSE team.</p>
            </div>
          ) : error && !meta ? (
            <div className="text-center py-4" data-testid="renewal-error">
              <h1 className="font-display text-2xl font-semibold">Link unavailable</h1>
              <p className="mt-2 text-sm text-slate-600">{error}</p>
            </div>
          ) : !meta ? <div className="text-sm text-slate-500">Loading…</div>
          : (
            <div data-testid="renewal-public-form">
              <div className="text-[11px] tracking-[0.18em] uppercase font-semibold text-brand-blue mb-2">Document renewal</div>
              <h1 className="font-display text-2xl font-semibold">Hi {meta.contractor_name}</h1>
              <p className="mt-2 text-sm text-slate-600">Please upload renewed copies of the documents below. This link is single-use and expires on <strong>{meta.expires_at?.slice(0, 10)}</strong>.</p>

              <div className="mt-6 space-y-3">
                {meta.doc_types_requested.map((t, i) => (
                  <div key={i} className="rounded-xl border border-slate-200 p-3 flex items-center gap-3" data-testid={`renewal-slot-${i}`}>
                    <div className="flex-1">
                      <div className="text-sm font-medium capitalize">{String(t).replace(/_/g, ' ')}</div>
                      {files[i] && <div className="text-xs text-emerald-700 mt-0.5">{files[i].name}</div>}
                    </div>
                    <input ref={(el) => (refs.current[i] = el)} type="file" accept=".pdf,image/*" className="hidden"
                      onChange={(e) => { const arr = [...files]; arr[i] = e.target.files?.[0] || null; setFiles(arr); }} />
                    <button onClick={() => refs.current[i]?.click()} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-300 text-sm hover:bg-slate-50">
                      <UploadCloud size={14} /> {files[i] ? 'Replace' : 'Choose file'}
                    </button>
                  </div>
                ))}
              </div>

              {error && <div className="mt-4 text-sm text-brand-red">{error}</div>}

              <button onClick={submit} disabled={busy} data-testid="renewal-submit-public"
                className="mt-6 w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-brand-blue text-white text-sm font-medium hover:bg-blue-600 disabled:opacity-60">
                {busy ? <><Loader2 size={16} className="animate-spin" /> Uploading…</> : 'Submit documents'}
              </button>
              <p className="mt-3 text-xs text-slate-500 text-center">Powered by Paneltec Civil. Your submission is secure and audit-logged.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
