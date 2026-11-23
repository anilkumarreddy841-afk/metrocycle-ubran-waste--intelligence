import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../api.ts';
import { ChartCanvas } from '../components/ChartCanvas.tsx';
import { LeafletMap } from '../components/LeafletMap.tsx';
import { PageHeader, RiskLabel } from '../components/StatusText.tsx';
import type { AlertItem, DashboardSummary, PageId, WasteBinItem } from '../types.ts';

interface DashboardPageProps {
  darkMode: boolean;
  refreshTrigger: number;
  onNavigate: (page: PageId) => void;
}

interface AnalyticsPayload extends DashboardSummary {
  dailyTrends: { day: string; collections_count: number; total_kg: number }[];
  zoneComparison: { zone_name: string; avg_fill_level: number; avg_risk_score: number; critical_bins: number }[];
}

export function DashboardPage({ darkMode, refreshTrigger, onNavigate }: DashboardPageProps) {
  const [data, setData] = useState<AnalyticsPayload | null>(null);
  const [bins, setBins] = useState<WasteBinItem[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [analyticsRes, binsRes, alertsRes] = await Promise.all([
          apiRequest<AnalyticsPayload>('/analytics'),
          apiRequest<{ bins: WasteBinItem[] }>('/bins'),
          apiRequest<{ alerts: AlertItem[] }>('/alerts'),
        ]);
        if (!cancelled) {
          setData(analyticsRes);
          setBins(binsRes.bins);
          setAlerts(alertsRes.alerts.slice(0, 6));
          setError('');
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load dashboard');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshTrigger]);

  const riskChartConfig = useMemo(() => {
    const dist = data?.riskDistribution || { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
    return {
      type: 'doughnut' as const,
      data: {
        labels: ['LOW (0–30)', 'MEDIUM (31–50)', 'HIGH (51–75)', 'CRITICAL (76–100)'],
        datasets: [
          {
            data: [dist.LOW, dist.MEDIUM, dist.HIGH, dist.CRITICAL],
            backgroundColor: ['#16a34a', '#d97706', '#ea580c', '#dc2626'],
            borderWidth: 0,
          },
        ],
      },
      options: {
        cutout: '64%',
        plugins: { legend: { position: 'bottom' as const } },
      },
    };
  }, [data]);

  const zoneChartConfig = useMemo(() => {
    const zones = data?.zoneComparison || [];
    return {
      type: 'bar' as const,
      data: {
        labels: zones.map((z) => z.zone_name.replace(' District', '').replace(' Sector', '')),
        datasets: [
          {
            label: 'Avg Fill (%)',
            data: zones.map((z) => Number(z.avg_fill_level)),
            backgroundColor: '#0f766e',
            borderRadius: 4,
          },
          {
            label: 'Avg Risk Score',
            data: zones.map((z) => Number(z.avg_risk_score)),
            backgroundColor: '#ea580c',
            borderRadius: 4,
          },
        ],
      },
      options: {
        scales: { y: { beginAtZero: true, max: 100 } },
      },
    };
  }, [data]);

  const trendChartConfig = useMemo(() => {
    const days = (data?.dailyTrends || []).slice(-14);
    return {
      type: 'line' as const,
      data: {
        labels: days.map((d) => d.day.slice(5)),
        datasets: [
          {
            label: 'Waste Collected (kg)',
            data: days.map((d) => Number(d.total_kg)),
            borderColor: '#0f766e',
            backgroundColor: 'rgba(15, 118, 110, 0.12)',
            fill: true,
            tension: 0.25,
          },
        ],
      },
      options: {
        scales: { y: { beginAtZero: true } },
      },
    };
  }, [data]);

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-64 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-24 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="p-4 rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-sm text-red-700 dark:text-red-300">
        {error}
      </div>
    );
  }

  const kpis = data!.kpis;
  const kpiCards = [
    { label: 'Total Waste Bins', value: kpis.totalBins, sub: 'Registered in SQLite', tone: 'text-slate-900 dark:text-slate-100' },
    { label: 'Normal Bins', value: kpis.normalBins, sub: 'Low & medium risk', tone: 'text-emerald-700 dark:text-emerald-400' },
    { label: 'High Risk Bins', value: kpis.highRiskBins, sub: 'Risk score 51–75', tone: 'text-orange-700 dark:text-orange-400' },
    { label: 'Critical Bins', value: kpis.criticalBins, sub: 'Risk score 76–100', tone: 'text-red-700 dark:text-red-400' },
    { label: 'Predicted Overflow Today', value: kpis.predictedOverflowToday, sub: 'ETA ≤ 24 hours', tone: 'text-red-700 dark:text-red-400' },
    { label: 'Available Vehicles', value: kpis.availableVehicles, sub: 'Ready for dispatch', tone: 'text-teal-700 dark:text-teal-400' },
    { label: 'Collections Completed', value: kpis.collectionsCompleted, sub: 'Confirmed pickups', tone: 'text-slate-900 dark:text-slate-100' },
    { label: 'Total Waste Collected', value: `${kpis.totalWasteCollectedKg.toLocaleString()} kg`, sub: 'Cumulative hauled', tone: 'text-slate-900 dark:text-slate-100' },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Smart City Waste Operations Dashboard"
        subtitle="Real-time operational overview from SQLite persistence. Simulated sensor telemetry is clearly labelled; manual and CSV/Excel updates recompute ML risk immediately."
        actions={
          <>
            <button
              type="button"
              onClick={() => onNavigate('planning')}
              className="px-4 py-2 rounded-md bg-teal-700 hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-700 text-white text-sm font-medium whitespace-nowrap"
            >
              Priority Schedule
            </button>
            <button
              type="button"
              onClick={() => onNavigate('assistant')}
              className="px-4 py-2 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 text-sm font-medium hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
            >
              Ask WasteGuard AI
            </button>
          </>
        }
      />

      {/* 8 Mandatory KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpiCards.map((card) => (
          <div
            key={card.label}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4"
          >
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">{card.label}</div>
            <div className={`mt-1.5 text-2xl font-semibold font-mono tabular-nums ${card.tone}`}>
              {card.value}
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{card.sub}</div>
          </div>
        ))}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">
            Risk Classification Distribution
          </h2>
          <ChartCanvas config={riskChartConfig} darkMode={darkMode} height={240} />
        </div>

        <div className="lg:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">
            Zone-Wise Fill vs. Risk Score
          </h2>
          <ChartCanvas config={zoneChartConfig} darkMode={darkMode} height={240} />
        </div>

        <div className="lg:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">
            14-Day Collection Volume (kg)
          </h2>
          <ChartCanvas config={trendChartConfig} darkMode={darkMode} height={240} />
        </div>
      </div>

      {/* Top 10 Priority Bins + Recent Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Top 10 Priority Collection Queue
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('planning')}
              className="text-xs font-medium text-teal-700 dark:text-teal-400 hover:underline"
            >
              Open Planner
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 bg-slate-50/60 dark:bg-slate-950/40">
                  <th className="py-2.5 px-3 text-left font-medium">Rank</th>
                  <th className="py-2.5 px-3 text-left font-medium">Bin</th>
                  <th className="py-2.5 px-3 text-left font-medium">Zone</th>
                  <th className="py-2.5 px-3 text-right font-medium">Fill</th>
                  <th className="py-2.5 px-3 text-right font-medium">Overflow ETA</th>
                  <th className="py-2.5 px-3 text-left font-medium">Risk</th>
                  <th className="py-2.5 px-3 text-right font-medium">Priority</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {data!.topPriorityBins.map((b) => (
                  <tr key={b.binId} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="py-2 px-3 font-mono text-xs tabular-nums text-slate-500">
                      #{b.urgencyRank}
                    </td>
                    <td className="py-2 px-3">
                      <div className="font-medium text-slate-900 dark:text-slate-100">{b.binCode}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-[180px]">
                        {b.location}
                      </div>
                    </td>
                    <td className="py-2 px-3 text-xs text-slate-600 dark:text-slate-300">
                      {b.zoneName}
                    </td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums text-xs">
                      {b.currentFillLevel}%
                    </td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums text-xs">
                      {b.estimatedOverflowHours !== null ? `${b.estimatedOverflowHours}h` : 'Stable'}
                    </td>
                    <td className="py-2 px-3">
                      <RiskLabel level={b.riskLevel} score={b.riskScore} />
                    </td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums text-xs font-semibold">
                      {b.priorityScore}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="lg:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg flex flex-col">
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Recent Operational Alerts
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('alerts')}
              className="text-xs font-medium text-teal-700 dark:text-teal-400 hover:underline"
            >
              View All
            </button>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800 flex-1 overflow-y-auto">
            {alerts.length === 0 ? (
              <div className="p-6 text-sm text-slate-500 dark:text-slate-400 text-center">
                No operational alerts recorded.
              </div>
            ) : (
              alerts.map((a) => (
                <div key={a.id} className="p-3.5 space-y-1">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <RiskLabel level={a.severity} />
                    <span className="font-mono text-slate-400">
                      {new Date(a.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                    {a.message}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Embedded GIS Map */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              City Bin Risk Distribution Map
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Green: Low · Amber: Medium · Orange: High · Red Halo: Critical Overflow Risk
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('map')}
            className="text-xs font-medium text-teal-700 dark:text-teal-400 hover:underline"
          >
            Expand Full GIS View
          </button>
        </div>
        <LeafletMap bins={bins} height="360px" />
      </div>
    </div>
  );
}
