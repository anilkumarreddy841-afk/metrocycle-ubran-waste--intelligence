import React, { useState } from 'react';
import { Lock, Mail, Moon, Sun } from 'lucide-react';
import { apiRequest, setStoredToken } from '../api.ts';
import type { AuthUser } from '../types.ts';

interface LoginPageProps {
  onLoginSuccess: (user: AuthUser) => void;
  darkMode: boolean;
  onToggleDarkMode: () => void;
}

const DEMO_ACCOUNTS = [
  { role: 'Administrator', email: 'admin@metrocycle.gov', pass: 'Admin@123' },
  { role: 'Waste Management Officer', email: 'officer@metrocycle.gov', pass: 'Officer@123' },
  { role: 'Collection Staff', email: 'staff@metrocycle.gov', pass: 'Staff@123' },
];

export function LoginPage({ onLoginSuccess, darkMode, onToggleDarkMode }: LoginPageProps) {
  const [email, setEmail] = useState('admin@metrocycle.gov');
  const [password, setPassword] = useState('Admin@123');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await apiRequest<{ token: string; user: AuthUser }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      setStoredToken(res.token);
      onLoginSuccess(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col justify-between p-6">
      <div className="flex items-center justify-between max-w-5xl w-full mx-auto">
        <span className="font-display text-xl font-bold tracking-tight">MetroCycle</span>
        <button
          type="button"
          onClick={onToggleDarkMode}
          className="p-2 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800"
          aria-label="Toggle theme"
        >
          {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
      </div>

      <div className="max-w-4xl w-full mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch my-8">
        <div className="lg:col-span-6 flex flex-col justify-center space-y-4">
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Urban Waste Overflow Risk &amp; Collection Planning
          </h1>
          <p className="text-sm sm:text-base text-slate-600 dark:text-slate-400 leading-relaxed">
            Sign in to monitor municipal bin capacity, run Linear Regression and Random Forest
            overflow forecasts, dispatch priority collection schedules, and optimize fleet routes
            with SQLite persistence.
          </p>
          <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-2">
            <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              Demo Role Credentials (Click to Populate)
            </div>
            <div className="grid grid-cols-1 gap-2">
              {DEMO_ACCOUNTS.map((acc) => (
                <button
                  key={acc.email}
                  type="button"
                  onClick={() => {
                    setEmail(acc.email);
                    setPassword(acc.pass);
                    setError('');
                  }}
                  className="text-left px-3 py-2 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-teal-600 dark:hover:border-teal-500 transition-colors"
                >
                  <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    {acc.role}
                  </div>
                  <div className="text-xs font-mono text-slate-500 dark:text-slate-400">
                    {acc.email} · {acc.pass}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="lg:col-span-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6 sm:p-8 flex flex-col justify-center">
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
            Operator Sign In
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Role-based session authentication backed by SQLite
          </p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            {error && (
              <div className="p-3 rounded-md border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 text-sm text-red-700 dark:text-red-300">
                {error}
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Municipal Email
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 rounded-md bg-teal-700 hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-700 text-white text-sm font-medium transition-colors disabled:opacity-50"
            >
              {loading ? 'Authenticating...' : 'Sign In to Command Center'}
            </button>
          </form>
        </div>
      </div>

      <div className="max-w-5xl w-full mx-auto text-xs text-slate-500 dark:text-slate-400 flex flex-wrap justify-between gap-2 border-t border-slate-200 dark:border-slate-800 pt-4">
        <span>MetroCycle Municipal Waste Management System</span>
        <span>Demo telemetry readings are simulated unless logged manually</span>
      </div>
    </div>
  );
}
