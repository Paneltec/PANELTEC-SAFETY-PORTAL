import React, { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { ArrowRight, Loader2 } from 'lucide-react';
import Logo from '../components/brand/Logo';
import { signup, safeNext } from '../lib/auth';
import { apiError } from '../lib/api';

export default function Signup() {
  const navigate = useNavigate();
  const location = useLocation();
  const nextPath = safeNext(location.search);
  const [form, setForm] = useState({ name: '', org_name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const update = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.name || !form.email || !form.password) { setError('Please fill in name, email and password.'); return; }
    if (form.password.length < 6) { setError('Password must be at least 6 characters.'); return; }
    setBusy(true);
    try {
      await signup(form);
      navigate(nextPath, { replace: true });
    } catch (err) {
      setError(apiError(err) || 'Could not create account.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-brand-bg px-5 py-10">
      <div className="w-full max-w-md">
        <Link to="/" className="inline-block mb-8"><Logo size="md" /></Link>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Start your 7-day free trial</h1>
        <p className="mt-2 text-sm text-slate-600">No credit card required. Cancel anytime.</p>

        <form onSubmit={submit} className="mt-6 space-y-4" data-testid="signup-form">
          {[
            ['name', 'Full name', 'Jordan Smith', 'text'],
            ['org_name', 'Organisation', 'Acme Civil Pty Ltd', 'text'],
            ['email', 'Work email', 'jordan@acme.com.au', 'email'],
            ['password', 'Password', 'At least 6 characters', 'password'],
          ].map(([key, label, ph, type]) => (
            <div key={key}>
              <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
              <input type={type} value={form[key]} onChange={update(key)} placeholder={ph} data-testid={`signup-${key}`}
                className="w-full px-3 py-2.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/30 focus:border-brand-blue" />
            </div>
          ))}
          {error && <div className="text-xs text-brand-red" data-testid="signup-error">{error}</div>}
          <button type="submit" disabled={busy} data-testid="signup-submit"
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-brand-blue text-white text-sm font-medium hover:bg-blue-600 transition-colors disabled:opacity-60">
            {busy ? <><Loader2 size={16} className="animate-spin" /> Creating workspace…</> : <>Create my workspace <ArrowRight size={16} /></>}
          </button>
        </form>
        <p className="mt-6 text-sm text-slate-600">
          Already have an account?{' '}
          <Link to="/" className="text-brand-blue font-medium hover:underline" data-testid="signup-to-login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
