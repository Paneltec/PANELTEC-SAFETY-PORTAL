import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import Logo from '../components/brand/Logo';
import { signIn } from '../lib/auth';

export default function Signup() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', org: '', email: '', password: '' });
  const [error, setError] = useState('');

  const update = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = (e) => {
    e.preventDefault();
    if (!form.name || !form.email || !form.password) {
      setError('Please fill in name, email and password.');
      return;
    }
    // MOCKED: no real signup
    signIn(form);
    navigate('/app/dashboard');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-brand-bg px-5 py-10">
      <div className="w-full max-w-md">
        <Link to="/" className="inline-block mb-8"><Logo size="md" /></Link>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Start your 7-day free trial</h1>
        <p className="mt-2 text-sm text-slate-600">No credit card required. Cancel anytime.</p>

        <form onSubmit={submit} className="mt-6 space-y-4" data-testid="signup-form">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Full name</label>
            <input
              value={form.name}
              onChange={update('name')}
              placeholder="Jordan Smith"
              data-testid="signup-name"
              className="w-full px-3 py-2.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/30 focus:border-brand-blue"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Organisation</label>
            <input
              value={form.org}
              onChange={update('org')}
              placeholder="Acme Civil Pty Ltd"
              data-testid="signup-org"
              className="w-full px-3 py-2.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/30 focus:border-brand-blue"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Work email</label>
            <input
              type="email"
              value={form.email}
              onChange={update('email')}
              placeholder="jordan@acme.com.au"
              data-testid="signup-email"
              className="w-full px-3 py-2.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/30 focus:border-brand-blue"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
            <input
              type="password"
              value={form.password}
              onChange={update('password')}
              placeholder="At least 8 characters"
              data-testid="signup-password"
              className="w-full px-3 py-2.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/30 focus:border-brand-blue"
            />
          </div>
          {error && <div className="text-xs text-brand-red" data-testid="signup-error">{error}</div>}
          <button
            type="submit"
            data-testid="signup-submit"
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-brand-blue text-white text-sm font-medium hover:bg-blue-600 transition-colors"
          >
            Create my workspace <ArrowRight size={16} />
          </button>
        </form>

        <p className="mt-6 text-sm text-slate-600">
          Already have an account?{' '}
          <Link to="/login" className="text-brand-blue font-medium hover:underline" data-testid="signup-to-login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
