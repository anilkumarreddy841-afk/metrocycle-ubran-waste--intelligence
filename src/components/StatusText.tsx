import React from 'react';

export function RiskLabel({ level, score }: { level: string | null | undefined; score?: number | null }) {
  const norm = (level || 'LOW').toUpperCase();
  const colorMap: Record<string, string> = {
    CRITICAL: 'text-red-700 dark:text-red-400',
    HIGH: 'text-orange-700 dark:text-orange-400',
    MEDIUM: 'text-amber-700 dark:text-amber-400',
    LOW: 'text-emerald-700 dark:text-emerald-400',
  };
  const cls = colorMap[norm] || colorMap.LOW;

  return (
    <span className={`font-mono text-xs font-semibold tabular-nums ${cls}`}>
      {norm}
      {score !== null && score !== undefined ? ` (${score})` : ''}
    </span>
  );
}

export function BinStatusLabel({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    Overflowing: 'text-red-700 dark:text-red-400',
    'Nearly Full': 'text-orange-700 dark:text-orange-400',
    Filling: 'text-amber-700 dark:text-amber-400',
    Normal: 'text-emerald-700 dark:text-emerald-400',
    Empty: 'text-slate-600 dark:text-slate-400',
  };
  return (
    <span className={`text-xs font-medium ${colorMap[status] || 'text-slate-600 dark:text-slate-300'}`}>
      {status}
    </span>
  );
}

export function SourceNotice({ source }: { source?: string }) {
  const label =
    source === 'manual'
      ? 'Manual Entry'
      : source === 'csv_import'
        ? 'CSV/Excel Import'
        : 'Simulated Reading';
  return <span className="text-xs text-slate-500 dark:text-slate-400">{label}</span>;
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between border-b border-slate-200 dark:border-slate-800 pb-4 mb-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400 max-w-3xl">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
