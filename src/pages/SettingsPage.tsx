import React, { useEffect, useState } from 'react';
import { apiRequest } from '../api.ts';
import { PageHeader } from '../components/StatusText.tsx';
import type { AuthUser } from '../types.ts';

interface SettingsPageProps {
  user: AuthUser;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onSettingsSaved: (refreshIntervalSec: number) => void;
}

export function SettingsPage({
  user,
  darkMode,
  onToggleDarkMode,
  onSettingsSaved,
}: SettingsPageProps) {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const isAdmin = user.role === 'Administrator';

  useEffect(() => {
    apiRequest<{ settings: Record<string, string> }>('/settings')
      .then((res) => setSettings(res.settings))
      .catch(() => {});
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setNotice(null);
    try {
      const res = await apiRequest<{ settings: Record<string, string> }>('/settings', {
        method: 'PUT',
        body: JSON.stringify(settings),
      });
      setSettings(res.settings);
      onSettingsSaved(Number(res.settings.refresh_interval_seconds || 30));
      setNotice({ type: 'ok', text: 'System settings persisted to SQLite.' });
    } catch (err) {
      setNotice({ type: 'err', text: err instanceof Error ? err.message : 'Save failed' });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="System Configuration & Preferences"
        subtitle="Configure automatic refresh cadence, ML prediction model defaults, risk thresholds, and display theme."
      />

      {notice && (
        <div
          className={`p-3 rounded-md border text-sm ${
            notice.type === 'ok'
              ? 'border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300'
              : 'border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300'
          }`}
        >
          {notice.text}
        </div>
      )}

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">Interface Color Theme</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Switch between crisp civic light mode and low-glare dark mode.
          </p>
        </div>
        <button
          type="button"
          onClick={onToggleDarkMode}
          className="px-4 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 font-medium"
        >
          Active: {darkMode ? 'Dark Mode' : 'Light Mode'}
        </button>
      </div>

      <form
        onSubmit={handleSave}
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-4"
      >
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
          <h2 className="text-sm font-semibold">Operational &amp; ML Engine Parameters</h2>
          {!isAdmin && (
            <span className="text-xs text-slate-500">Read-only (Administrator required to edit)</span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium mb-1">Municipality / City Name</label>
            <input
              disabled={!isAdmin}
              value={settings.city_name || ''}
              onChange={(e) => setSettings({ ...settings, city_name: e.target.value })}
              className="w-full px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 disabled:opacity-60"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Auto-Refresh Interval (seconds)</label>
            <input
              type="number"
              min="10"
              max="300"
              disabled={!isAdmin}
              value={settings.refresh_interval_seconds || '30'}
              onChange={(e) => setSettings({ ...settings, refresh_interval_seconds: e.target.value })}
              className="w-full px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono disabled:opacity-60"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Default Prediction Model</label>
            <select
              disabled={!isAdmin}
              value={settings.default_model || 'Random Forest Regression'}
              onChange={(e) => setSettings({ ...settings, default_model: e.target.value })}
              className="w-full px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 disabled:opacity-60"
            >
              <option value="Random Forest Regression">Random Forest Regression</option>
              <option value="Linear Regression">Linear Regression</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Prediction Horizon (hours)</label>
            <input
              type="number"
              min="6"
              max="168"
              disabled={!isAdmin}
              value={settings.prediction_horizon_hours || '24'}
              onChange={(e) => setSettings({ ...settings, prediction_horizon_hours: e.target.value })}
              className="w-full px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono disabled:opacity-60"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Fuel Consumption (L/km)</label>
            <input
              type="number"
              step="0.01"
              min="0.1"
              disabled={!isAdmin}
              value={settings.fuel_consumption_l_per_km || '0.38'}
              onChange={(e) => setSettings({ ...settings, fuel_consumption_l_per_km: e.target.value })}
              className="w-full px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono disabled:opacity-60"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Simulated Telemetry Mode</label>
            <select
              disabled={!isAdmin}
              value={settings.simulation_enabled || 'true'}
              onChange={(e) => setSettings({ ...settings, simulation_enabled: e.target.value })}
              className="w-full px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 disabled:opacity-60"
            >
              <option value="true">Enabled (Simulated Readings Clearly Labelled)</option>
              <option value="false">Manual / CSV Readings Only</option>
            </select>
          </div>
        </div>

        {isAdmin && (
          <div className="pt-2">
            <button
              type="submit"
              className="px-4 py-2 text-sm rounded-md bg-teal-700 hover:bg-teal-800 text-white font-medium"
            >
              Save System Settings
            </button>
          </div>
        )}
      </form>
    </div>
  );
}
