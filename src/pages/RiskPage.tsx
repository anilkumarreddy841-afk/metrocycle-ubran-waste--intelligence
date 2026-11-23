import { useEffect, useState } from 'react';
import { apiRequest } from '../api.ts';
import { PageHeader, RiskLabel } from '../components/StatusText.tsx';

interface RiskAssessmentRow {
  binId: number;
  binCode: string;
  location: string;
  zoneName: string;
  populationDensity: number;
  currentFillLevel: number;
  fillRatePerHour: number;
  estimatedOverflowHours: number | null;
  riskScore: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  isFallback: boolean;
  riskFactors: {
    fillComponent: number;
    rateComponent: number;
    overflowUrgencyComponent: number;
    collectionAgeComponent: number;
    densityComponent: number;
  };
}

export function RiskPage({ refreshTrigger }: { refreshTrigger: number }) {
  const [rows, setRows] = useState<RiskAssessmentRow[]>([]);
  const [filter, setFilter] = useState<'ALL' | 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'>('ALL');

  useEffect(() => {
    apiRequest<{ assessments: RiskAssessmentRow[] }>('/risk-assessment')
      .then((res) => setRows(res.assessments))
      .catch(() => {});
  }, [refreshTrigger]);

  const filtered = filter === 'ALL' ? rows : rows.filter((r) => r.riskLevel === filter);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Overflow Risk Assessment Matrix"
        subtitle="Composite 0–100 risk index combining current fill (40%), fill rate (20%), overflow urgency (22%), collection age (10%), and zone density (8%)."
        actions={
          <div className="flex items-center gap-1 p-1 bg-slate-200/70 dark:bg-slate-800 rounded-lg">
            {(['ALL', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setFilter(tab)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  filter === tab
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        {[
          { label: 'CRITICAL (76–100)', cnt: rows.filter((r) => r.riskLevel === 'CRITICAL').length, cls: 'text-red-700 dark:text-red-400' },
          { label: 'HIGH (51–75)', cnt: rows.filter((r) => r.riskLevel === 'HIGH').length, cls: 'text-orange-700 dark:text-orange-400' },
          { label: 'MEDIUM (31–50)', cnt: rows.filter((r) => r.riskLevel === 'MEDIUM').length, cls: 'text-amber-700 dark:text-amber-400' },
          { label: 'LOW (0–30)', cnt: rows.filter((r) => r.riskLevel === 'LOW').length, cls: 'text-emerald-700 dark:text-emerald-400' },
        ].map((box) => (
          <div
            key={box.label}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4"
          >
            <div className="text-xs text-slate-500 dark:text-slate-400">{box.label}</div>
            <div className={`mt-1 text-2xl font-semibold font-mono tabular-nums ${box.cls}`}>
              {box.cnt}
            </div>
          </div>
        ))}
      </div>

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-950/40">
                <th className="py-2.5 px-3 text-left font-medium">Bin &amp; Zone</th>
                <th className="py-2.5 px-3 text-right font-medium">Fill (40)</th>
                <th className="py-2.5 px-3 text-right font-medium">Rate (20)</th>
                <th className="py-2.5 px-3 text-right font-medium">Urgency (22)</th>
                <th className="py-2.5 px-3 text-right font-medium">Age (10)</th>
                <th className="py-2.5 px-3 text-right font-medium">Density (8)</th>
                <th className="py-2.5 px-3 text-left font-medium">Composite Risk</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filtered.map((r) => (
                <tr key={r.binId} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="py-2.5 px-3">
                    <div className="font-mono text-xs font-semibold">{r.binCode}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {r.location} · {r.zoneName}
                    </div>
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-xs tabular-nums">
                    {r.riskFactors.fillComponent}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-xs tabular-nums">
                    {r.riskFactors.rateComponent}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-xs tabular-nums">
                    {r.riskFactors.overflowUrgencyComponent}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-xs tabular-nums">
                    {r.riskFactors.collectionAgeComponent}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-xs tabular-nums">
                    {r.riskFactors.densityComponent}
                  </td>
                  <td className="py-2.5 px-3 whitespace-nowrap">
                    <RiskLabel level={r.riskLevel} score={r.riskScore} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
