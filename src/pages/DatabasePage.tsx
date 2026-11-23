import { useEffect, useState } from 'react';
import { Database, Download, RotateCcw } from 'lucide-react';
import { apiRequest, downloadAuthorizedFile } from '../api.ts';
import { PageHeader } from '../components/StatusText.tsx';
import type { AuthUser } from '../types.ts';

interface DatabaseStatus {
  databaseFile: string;
  sizeBytes: number;
  lastModified: string | null;
  tableCounts: { table: string; count: number }[];
  backups: { filename: string; sizeBytes: number; createdAt: string }[];
}

interface AuditLogRow {
  id: number;
  user_email: string;
  action: string;
  entity_type: string;
  entity_id: string;
  details: string;
  created_at: string;
}

export function DatabasePage({
  user,
  onDataChanged,
}: {
  user: AuthUser;
  onDataChanged: () => void;
}) {
  const [status, setStatus] = useState<DatabaseStatus | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLogRow[]>([]);
  const [notice, setNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const isAdmin = user.role === 'Administrator';
  const canViewAudit = isAdmin || user.role === 'Waste Management Officer';

  const loadStatus = async () => {
    const dbRes = await apiRequest<DatabaseStatus>('/database/status');
    setStatus(dbRes);
    if (canViewAudit) {
      const logRes = await apiRequest<{ logs: AuditLogRow[] }>('/audit-logs');
      setAuditLogs(logRes.logs);
    }
  };

  useEffect(() => {
    loadStatus().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleBackup = async () => {
    setNotice(null);
    try {
      const res = await apiRequest<{ backup: { filename: string; sizeBytes: number } }>(
        '/database/backup',
        { method: 'POST' }
      );
      setNotice({
        type: 'ok',
        text: `Created SQLite backup ${res.backup.filename} (${Math.round(res.backup.sizeBytes / 1024)} KB).`,
      });
      await loadStatus();
    } catch (err) {
      setNotice({ type: 'err', text: err instanceof Error ? err.message : 'Backup failed' });
    }
  };

  const handleRestore = async (filename: string) => {
    setNotice(null);
    try {
      await apiRequest('/database/restore', {
        method: 'POST',
        body: JSON.stringify({ filename }),
      });
      setNotice({ type: 'ok', text: `Restored urban_waste_management.db from ${filename}.` });
      await loadStatus();
      onDataChanged();
    } catch (err) {
      setNotice({ type: 'err', text: err instanceof Error ? err.message : 'Restore failed' });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="SQLite Database Management & Audit Trail"
        subtitle="Inspect live SQLite table row counts, create point-in-time .db backups, restore snapshots, and review security audit logs."
        actions={
          isAdmin && (
            <button
              type="button"
              onClick={handleBackup}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium whitespace-nowrap"
            >
              <Database className="w-4 h-4" />
              <span>Create SQLite Backup</span>
            </button>
          )
        }
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

      {status && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div>
                <h2 className="text-sm font-semibold">{status.databaseFile}</h2>
                <div className="text-xs font-mono text-slate-500">
                  Size: {(status.sizeBytes / 1024).toFixed(1)} KB
                </div>
              </div>
              <span className="text-xs font-mono text-emerald-700 dark:text-emerald-400">
                WAL Active
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              {status.tableCounts.map((t) => (
                <div
                  key={t.table}
                  className="flex items-center justify-between px-3 py-2 rounded bg-slate-50 dark:bg-slate-950/50 border border-slate-100 dark:border-slate-800"
                >
                  <span className="font-mono text-slate-700 dark:text-slate-300">{t.table}</span>
                  <span className="font-mono font-semibold tabular-nums">{t.count}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800">
              <h2 className="text-sm font-semibold">Saved Database Backups</h2>
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {status.backups.length === 0 ? (
                <div className="p-6 text-sm text-slate-500 text-center">
                  No backups created yet. Click &ldquo;Create SQLite Backup&rdquo; to snapshot the database.
                </div>
              ) : (
                status.backups.map((b) => (
                  <div key={b.filename} className="px-4 py-3 flex items-center justify-between gap-3 text-xs">
                    <div>
                      <div className="font-mono font-semibold">{b.filename}</div>
                      <div className="text-slate-500">
                        {(b.sizeBytes / 1024).toFixed(1)} KB · {new Date(b.createdAt).toLocaleString()}
                      </div>
                    </div>
                    {isAdmin && (
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() =>
                            downloadAuthorizedFile(
                              `/database/backups/${encodeURIComponent(b.filename)}/download`,
                              b.filename
                            )
                          }
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Download</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRestore(b.filename)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-amber-600 hover:bg-amber-700 text-white"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>Restore</span>
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {canViewAudit && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800">
            <h2 className="text-sm font-semibold">Operational &amp; Security Audit Logs</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 bg-slate-50 dark:bg-slate-950/40">
                  <th className="py-2 px-3 text-left font-medium">Timestamp</th>
                  <th className="py-2 px-3 text-left font-medium">Actor</th>
                  <th className="py-2 px-3 text-left font-medium">Action</th>
                  <th className="py-2 px-3 text-left font-medium">Entity</th>
                  <th className="py-2 px-3 text-left font-medium">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {auditLogs.slice(0, 40).map((l) => (
                  <tr key={l.id}>
                    <td className="py-2 px-3 font-mono text-xs text-slate-500 whitespace-nowrap">
                      {new Date(l.created_at).toLocaleString()}
                    </td>
                    <td className="py-2 px-3 font-mono text-xs">{l.user_email}</td>
                    <td className="py-2 px-3 font-mono text-xs font-semibold">{l.action}</td>
                    <td className="py-2 px-3 font-mono text-xs text-slate-500">
                      {l.entity_type}:{l.entity_id}
                    </td>
                    <td className="py-2 px-3 text-xs">{l.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
