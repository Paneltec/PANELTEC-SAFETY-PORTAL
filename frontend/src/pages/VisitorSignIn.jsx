// v58.13.106 — Public visitor sign-in form.
// Wired to the site QR flow: scan → /scan/site/:token/visitor.
// No auth. Persists visitor_id in localStorage keyed by site so a
// repeat visit shows the "Sign out" button.
import React, { useEffect, useState } from 'react';
import { useParams, Navigate } from 'react-router-dom';
import axios from 'axios';
import QRCode from 'qrcode';

const BACKEND = process.env.REACT_APP_BACKEND_URL;
const api = axios.create({ baseURL: `${BACKEND}/api` });

const PURPOSES = ['Contractor', 'Delivery', 'Client', 'Other'];
const LS_KEY = (token) => `paneltec.visitor.${token}`;

export default function VisitorSignIn() {
  const { token } = useParams();
  const [siteInfo, setSiteInfo] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [existing, setExisting] = useState(() => {
    try { return JSON.parse(localStorage.getItem(LS_KEY(token)) || 'null'); }
    catch { return null; }
  });
  const [signOutQrDataUrl, setSignOutQrDataUrl] = useState('');
  const [form, setForm] = useState({
    // v58.13.132lh — Removed `visiting_person` and `vehicle_rego`
    // to match the mobile visitor-form field removal shipped as
    // `.132lg`. Site QR-flow now captures name / company / phone /
    // purpose / induction only.
    name: '', company: '', phone: '', purpose: PURPOSES[0],
    induction_acknowledged: false,
  });

  useEffect(() => {
    let alive = true;
    // v58.13.132hw — Was hitting non-existent `/public/site/{token}/form`
    // which 404'd → visitor saw "This QR code is no longer valid."
    // even for perfectly good QRs. The existing anonymous resolver at
    // `/scan/site/{token}` (sites_qr.py::resolve_site_scan, no auth
    // dependency) returns the same shape VisitorSignIn needs
    // (site.{name,address}, active_swms, signon_questions).
    api.get(`/scan/site/${token}`)
      .then((r) => { if (alive) setSiteInfo(r.data); })
      .catch((e) => { if (alive) setError(e?.response?.data?.detail || 'This QR code is no longer valid.'); });
    return () => { alive = false; };
  }, [token]);

  // Generate the "Sign out" QR whenever we have a live visitor_id.
  useEffect(() => {
    if (!existing?.visitor_id) { setSignOutQrDataUrl(''); return; }
    const url = `${window.location.origin}/scan/site/${token}/visitor?signout=${existing.visitor_id}`;
    QRCode.toDataURL(url, { width: 220, margin: 1 }).then(setSignOutQrDataUrl).catch(() => {});
  }, [existing, token]);

  // Handle deep-link `?signout=<id>` (scanning the receipt QR on exit).
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const soId = p.get('signout');
    if (soId) {
      handleSignOut(soId);
      // Strip the query so a refresh doesn't loop.
      window.history.replaceState({}, '', window.location.pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name.trim()) return setError('Please enter your name.');
    if (!form.induction_acknowledged) return setError('You must acknowledge the safety induction.');
    setBusy(true); setError('');
    try {
      const { data } = await api.post(`/public/visitor/site/${token}/signin`, form);
      const rec = { visitor_id: data.visitor_id, site_name: data.site_name, signed_in_at: data.signed_in_at, name: form.name };
      localStorage.setItem(LS_KEY(token), JSON.stringify(rec));
      setExisting(rec);
    } catch (err) {
      setError(err?.response?.data?.detail || 'Could not sign you in. Please try again.');
    } finally { setBusy(false); }
  }

  async function handleSignOut(visitorId) {
    setBusy(true); setError('');
    try {
      await api.post(`/public/visitor/${visitorId}/sign-out?token=${encodeURIComponent(token)}`);
      localStorage.removeItem(LS_KEY(token));
      setExisting(null);
    } catch (err) {
      setError(err?.response?.data?.detail || 'Could not sign you out.');
    } finally { setBusy(false); }
  }

  if (error && !siteInfo) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl border border-rose-200 p-6 shadow-sm" data-testid="visitor-form-error">
          <div className="font-bold text-rose-700">Sign-in not available</div>
          <div className="text-sm text-slate-600 mt-2">{error}</div>
        </div>
      </div>
    );
  }
  if (!siteInfo) return <div className="min-h-screen bg-slate-50 flex items-center justify-center text-slate-500">Loading…</div>;

  // Receipt view (already signed in).
  if (existing?.visitor_id) {
    const when = new Date(existing.signed_in_at).toLocaleString();
    return (
      <div className="min-h-screen bg-emerald-50 p-4 flex flex-col items-center" data-testid="visitor-receipt">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-emerald-200 p-6 mt-8">
          <div className="text-xs uppercase tracking-wider text-emerald-700 font-semibold">Signed in</div>
          <h1 className="text-2xl font-bold mt-1 text-slate-900" data-testid="visitor-receipt-name">Thanks {existing.name}</h1>
          <p className="text-sm text-slate-600 mt-1">
            You're signed in at <b>{siteInfo.site.name}</b> at {when}.
          </p>
          {siteInfo.site.address && <p className="text-xs text-slate-500 mt-1">{siteInfo.site.address}</p>}
          {signOutQrDataUrl && (
            <div className="mt-6 flex flex-col items-center gap-2">
              <img src={signOutQrDataUrl} alt="Sign out QR" className="rounded-lg border border-slate-200" data-testid="visitor-signout-qr" />
              <div className="text-[11px] text-slate-500 text-center">Scan again on exit to sign out, or tap below.</div>
            </div>
          )}
          <button onClick={() => handleSignOut(existing.visitor_id)} disabled={busy}
            className="mt-6 w-full py-3 rounded-xl bg-rose-600 text-white text-base font-semibold hover:bg-rose-700 disabled:opacity-50"
            data-testid="visitor-signout-btn">
            {busy ? 'Signing out…' : 'Sign out'}
          </button>
          {error && <div className="text-sm text-rose-700 mt-3" data-testid="visitor-error">{error}</div>}
        </div>
      </div>
    );
  }

  // Sign-in form.
  return (
    <div className="min-h-screen bg-slate-50 p-4 flex flex-col items-center">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-slate-200 p-6 mt-4" data-testid="visitor-form">
        <div className="text-xs uppercase tracking-wider text-brand-blue font-semibold">Visitor sign-in</div>
        <h1 className="text-2xl font-bold mt-1 text-slate-900" data-testid="visitor-form-site-name">Welcome to {siteInfo.site.name}</h1>
        {siteInfo.site.address && <p className="text-xs text-slate-500 mt-1">{siteInfo.site.address}</p>}
        {siteInfo.org_display_name && <p className="text-[11px] text-slate-400 mt-1">{siteInfo.org_display_name}</p>}
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <Field label="Full name *" testid="visitor-name">
            <input required autoFocus autoComplete="name" value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base"
              data-testid="visitor-name-input" />
          </Field>
          <Field label="Company" testid="visitor-company">
            <input value={form.company} autoComplete="organization"
              onChange={(e) => setForm({ ...form, company: e.target.value })}
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base"
              data-testid="visitor-company-input" />
          </Field>
          <Field label="Phone" testid="visitor-phone">
            <input type="tel" value={form.phone} autoComplete="tel" inputMode="tel"
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base"
              data-testid="visitor-phone-input" />
          </Field>
          <Field label="Purpose of visit" testid="visitor-purpose">
            <select value={form.purpose}
              onChange={(e) => setForm({ ...form, purpose: e.target.value })}
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base bg-white"
              data-testid="visitor-purpose-select">
              {PURPOSES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
          {/* v58.13.132lh — Removed "Who are you visiting?" + "Vehicle rego"
              fields to match mobile `.132lg`. Site sign-in stays focused
              on the compliance-critical inputs (name, company, phone,
              purpose, induction acknowledgement). */}
          <label className={`flex items-start gap-3 rounded-lg px-3 py-3 border cursor-pointer ${form.induction_acknowledged ? 'bg-emerald-50 border-emerald-300 text-emerald-900' : 'bg-amber-50 border-amber-300 text-amber-900'}`}>
            <input type="checkbox" checked={form.induction_acknowledged}
              onChange={(e) => setForm({ ...form, induction_acknowledged: e.target.checked })}
              className="mt-1 h-5 w-5 accent-emerald-600 shrink-0"
              data-testid="visitor-induction-check" />
            <span className="text-sm font-medium leading-snug">
              I acknowledge the site safety induction and agree to follow all posted safety instructions while on site.
            </span>
          </label>
          {error && <div className="text-sm text-rose-700" data-testid="visitor-error">{error}</div>}
          <button type="submit" disabled={busy || !form.induction_acknowledged}
            className="w-full py-3 rounded-xl bg-emerald-600 text-white text-base font-semibold hover:bg-emerald-700 disabled:opacity-50"
            data-testid="visitor-submit-btn">
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}

function Field({ label, testid, children }) {
  return (
    <label className="block" data-testid={`${testid}-field`}>
      <span className="block text-xs font-semibold text-slate-700 mb-1">{label}</span>
      {children}
    </label>
  );
}
