import { useEffect, useState } from 'react';
import { BellRing, CheckCheck } from 'lucide-react';
import { apiRequest } from '../api.ts';
import { PageHeader, RiskLabel } from '../components/StatusText.tsx';
import type { AlertItem } from '../types.ts';

export function AlertsPage({
  refreshTrigger,
  onDataChanged,
}: {
  refreshTrigger: number;
  onDataChanged: () => void;
}) {
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [filter, setFilter] = useState<'ALL' | 'UNREAD'>('ALL');
  const [severityFilter, setSeverityFilter] = useState('ALL');

  const loadAlerts = async () => {
    const res = await apiRequest<{ alerts: AlertItem[] }>('/alerts');
    setAlerts(res.alerts);
  };

  useEffect(() => {
    loadAlerts().catch(() => {});
  }, [refreshTrigger]);

  const handleToggleRead = async (a: AlertItem) => {
    await apiRequest(`/alerts/${a.id}/read`, {
      method: 'PATCH',
      body: JSON.stringify({ isRead: !a.is_read }),
    });
    await loadAlerts();
    onDataChanged();
  };

  const handleMarkAllRead = async () => {
    await apiRequest('/alerts/mark-all-read', { method: 'POST' });
    await loadAlerts();
    onDataChanged();
  };

  const handleEvaluateNow = async () => {
    await apiRequest('/alerts/evaluate', { method: 'POST' });
    await loadAlerts();
    onDataChanged();
  };

  const visible = alerts.filter((a) => {
    if (filter === 'UNREAD' && a.is_read) return false;
    if (severityFilter !== 'ALL' && a.severity !== severityFilter) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Intelligent Alerts & Notifications"
        subtitle="Monitors high/critical overflow thresholds, approaching spill windows, vehicle unavailability, and delayed schedules."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleEvaluateNow}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-medium hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
            >
              <BellRing className="w-4 h-4" />
              <span>Run Alert Check</span>
            </button>
            <button
              type="button"
              onClick={handleMarkAllRead}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium whitespace-nowrap"
            >
              <CheckCheck className="w-4 h-4" />
              <span>Mark All Read</span>
            </button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 bg-slate-200/70 dark:bg-slate-800 rounded-lg">
          {(['ALL', 'UNREAD'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setFilter(tab)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                filter === tab
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              {tab === 'ALL' ? `All (${alerts.length})` : `Unread (${alerts.filter((a) => !a.is_read).length})`}
            </button>
          ))}
        </div>

        <select
          value={severityFilter}
          onChange={(e) => setSeverityFilter(e.target.value)}
          className="px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
        >
          <option value="ALL">All Severities</option>
          {['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg divide-y divide-slate-100 dark:divide-slate-800">
        {visible.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            No alerts match the selected filter.
          </div>
        ) : (
          visible.map((a) => (
            <div
              key={a.id}
              className={`p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                a.is_read ? 'opacity-65' : ''
              }`}
            >
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <RiskLabel level={a.severity} />
                  <span className="text-slate-400">·</span>
                  <span className="font-mono text-slate-600 dark:text-slate-300">{a.alert_type}</span>
                  <span className="text-slate-400">·</span>
                  <span className="font-mono text-slate-500">
                    {new Date(a.created_at).toLocaleString()}
                  </span>
                  {!a.is_read && (
                    <span className="font-semibold text-teal-700 dark:text-teal-400">Unread</span>
                  )}
                </div>
                <p className="text-sm text-slate-800 dark:text-slate-200">{a.message}</p>
              </div>

              <button
                type="button"
                onClick={() => handleToggleRead(a)}
                className="px-3 py-1.5 text-xs rounded-md border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0 self-start sm:self-center"
              >
                {a.is_read ? 'Mark Unread' : 'Mark Read'}
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
