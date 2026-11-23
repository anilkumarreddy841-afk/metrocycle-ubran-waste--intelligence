import { useEffect, useMemo, useState } from 'react';
import { Download, FileSpreadsheet, FileText } from 'lucide-react';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { apiRequest, downloadAuthorizedFile } from '../api.ts';
import { ChartCanvas } from '../components/ChartCanvas.tsx';
import { PageHeader, RiskLabel } from '../components/StatusText.tsx';

interface AnalyticsData {
  dailyTrends: { day: string; collections_count: number; total_kg: number }[];
  weeklyTrends: { week_label: string; collections_count: number; total_kg: number }[];
  monthlyTrends: { month_label: string; collections_count: number; total_kg: number }[];
  zoneComparison: {
    id: number;
    zone_name: string;
    avg_fill_level: number;
    avg_risk_score: number;
    total_collected_kg: number;
  }[];
  vehicleUtilization: {
    id: number;
    vehicleNumber: string;
    vehicleType: string;
    utilizationPct: number;
    completedCollections: number;
    totalHauledKg: number;
  }[];
  efficiency: {
    overflowReadingEvents: number;
    collectionEfficiencyPct: number;
    distanceSavedKm: number;
    estimatedFuelSavedLiters: number;
  };
  recommendations: {
    id: string;
    category: string;
    classification: string;
    priority: string;
    title: string;
    rationale: string;
    suggestedAction: string;
  }[];
}

interface ReportPayload {
  reportType: string;
  title: string;
  generatedAt: string;
  summary: Record<string, string | number>;
  columns: { key: string; label: string }[];
  rows: Record<string, string | number | null>[];
}

const REPORT_TYPES = [
  { id: 'daily', label: 'Daily Report' },
  { id: 'weekly', label: 'Weekly Report' },
  { id: 'monthly', label: 'Monthly Report' },
  { id: 'critical_bins', label: 'Critical Bins Report' },
  { id: 'zone_wise', label: 'Zone-Wise Report' },
  { id: 'vehicle_performance', label: 'Vehicle Performance Report' },
];

export function AnalyticsReportsPage({
  darkMode,
  refreshTrigger,
}: {
  darkMode: boolean;
  refreshTrigger: number;
}) {
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [reportType, setReportType] = useState('daily');
  const [report, setReport] = useState<ReportPayload | null>(null);

  useEffect(() => {
    apiRequest<AnalyticsData>('/analytics').then(setAnalytics).catch(() => {});
  }, [refreshTrigger]);

  useEffect(() => {
    apiRequest<ReportPayload>(`/reports/${reportType}`).then(setReport).catch(() => {});
  }, [reportType, refreshTrigger]);

  const weeklyChartConfig = useMemo(() => {
    const weeks = analytics?.weeklyTrends || [];
    return {
      type: 'bar' as const,
      data: {
        labels: weeks.map((w) => w.week_label),
        datasets: [
          {
            label: 'Weekly Waste Collected (kg)',
            data: weeks.map((w) => Number(w.total_kg)),
            backgroundColor: '#0f766e',
            borderRadius: 4,
          },
        ],
      },
      options: { scales: { y: { beginAtZero: true } } },
    };
  }, [analytics]);

  const monthlyChartConfig = useMemo(() => {
    const months = analytics?.monthlyTrends || [];
    return {
      type: 'line' as const,
      data: {
        labels: months.map((m) => m.month_label),
        datasets: [
          {
            label: 'Monthly Waste Generation (kg)',
            data: months.map((m) => Number(m.total_kg)),
            borderColor: '#2563eb',
            backgroundColor: 'rgba(37, 99, 235, 0.12)',
            fill: true,
            tension: 0.2,
          },
        ],
      },
      options: { scales: { y: { beginAtZero: true } } },
    };
  }, [analytics]);

  const vehicleChartConfig = useMemo(() => {
    const vehicles = analytics?.vehicleUtilization || [];
    return {
      type: 'bar' as const,
      data: {
        labels: vehicles.map((v) => v.vehicleNumber),
        datasets: [
          {
            label: 'Payload Utilization (%)',
            data: vehicles.map((v) => v.utilizationPct),
            backgroundColor: '#d97706',
            borderRadius: 4,
          },
        ],
      },
      options: { scales: { y: { beginAtZero: true, max: 100 } } },
    };
  }, [analytics]);

  const handleExportCsv = () => {
    downloadAuthorizedFile(`/reports/${reportType}?format=csv`, `metrocycle_${reportType}_report.csv`);
  };

  const handleExportExcel = () => {
    if (!report) return;
    const sheetRows = report.rows.map((r) => {
      const obj: Record<string, unknown> = {};
      for (const col of report.columns) {
        obj[col.label] = r[col.key] ?? '';
      }
      return obj;
    });
    const ws = XLSX.utils.json_to_sheet(sheetRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Report');
    XLSX.writeFile(wb, `metrocycle_${report.reportType}_report.xlsx`);
  };

  const handleExportPdf = () => {
    if (!report) return;
    const doc = new jsPDF({ orientation: 'landscape' });
    doc.setFontSize(14);
    doc.text(report.title, 14, 16);
    doc.setFontSize(9);
    doc.text(`Generated: ${new Date(report.generatedAt).toLocaleString()}`, 14, 22);

    autoTable(doc, {
      startY: 28,
      head: [report.columns.map((c) => c.label)],
      body: report.rows.map((r) => report.columns.map((c) => String(r[c.key] ?? ''))),
      styles: { fontSize: 8 },
    });
    doc.save(`metrocycle_${report.reportType}_report.pdf`);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Advanced Analytics, Recommendations & Reports"
        subtitle="Historical collection trends, fleet efficiency, fuel savings from route optimization, and multi-format CSV/Excel/PDF reporting."
      />

      {/* Efficiency KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Collection Efficiency</div>
          <div className="mt-1 text-2xl font-semibold font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
            {analytics?.efficiency.collectionEfficiencyPct ?? 100}%
          </div>
          <div className="mt-1 text-xs text-slate-500">On-time vs delayed schedules</div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Overflow Readings (≥90%)</div>
          <div className="mt-1 text-2xl font-semibold font-mono tabular-nums text-red-700 dark:text-red-400">
            {analytics?.efficiency.overflowReadingEvents ?? 0}
          </div>
          <div className="mt-1 text-xs text-slate-500">Historical incident count</div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Route Distance Saved</div>
          <div className="mt-1 text-2xl font-semibold font-mono tabular-nums">
            {analytics?.efficiency.distanceSavedKm ?? 0} km
          </div>
          <div className="mt-1 text-xs text-slate-500">2-opt vs unordered priority</div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Estimated Fuel Savings</div>
          <div className="mt-1 text-2xl font-semibold font-mono tabular-nums text-teal-700 dark:text-teal-400">
            {analytics?.efficiency.estimatedFuelSavedLiters ?? 0} L
          </div>
          <div className="mt-1 text-xs text-slate-500">Based on 0.38 L/km diesel rate</div>
        </div>
      </div>

      {/* Analytics Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
          <h2 className="text-sm font-semibold mb-3">Weekly Collection Trends</h2>
          <ChartCanvas config={weeklyChartConfig} darkMode={darkMode} height={230} />
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
          <h2 className="text-sm font-semibold mb-3">Monthly Waste Generation</h2>
          <ChartCanvas config={monthlyChartConfig} darkMode={darkMode} height={230} />
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
          <h2 className="text-sm font-semibold mb-3">Vehicle Capacity Utilization</h2>
          <ChartCanvas config={vehicleChartConfig} darkMode={darkMode} height={230} />
        </div>
      </div>

      {/* Smart Recommendations (Distinctly Labelled as AI/Analytical Recommendations) */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
          <h2 className="text-sm font-semibold">Smart Operational Recommendations</h2>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Advisory analytical insights — separate from confirmed dispatch actions
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {(analytics?.recommendations || []).map((rec) => (
            <div
              key={rec.id}
              className="p-4 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 space-y-1.5"
            >
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-mono text-teal-700 dark:text-teal-400 font-medium">
                  {rec.classification} · {rec.category}
                </span>
                <RiskLabel level={rec.priority} />
              </div>
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {rec.title}
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400">{rec.rationale}</p>
              <p className="text-xs text-slate-800 dark:text-slate-200 pt-1">
                Suggested Action: {rec.suggestedAction}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Automated Report Builder & Multi-Format Export */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={reportType}
              onChange={(e) => setReportType(e.target.value)}
              className="px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 font-medium"
            >
              {REPORT_TYPES.map((rt) => (
                <option key={rt.id} value={rt.id}>
                  {rt.label}
                </option>
              ))}
            </select>
            {report && (
              <span className="text-xs text-slate-500 font-mono">
                {report.rows.length} row(s) · {new Date(report.generatedAt).toLocaleTimeString()}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleExportCsv}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>
            <button
              type="button"
              onClick={handleExportExcel}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Export Excel</span>
            </button>
            <button
              type="button"
              onClick={handleExportPdf}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md bg-teal-700 hover:bg-teal-800 text-white"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Export PDF</span>
            </button>
          </div>
        </div>

        {report && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-950/40">
                  {report.columns.map((c) => (
                    <th key={c.key} className="py-2.5 px-3 text-left font-medium whitespace-nowrap">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {report.rows.slice(0, 40).map((row, idx) => (
                  <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    {report.columns.map((c) => (
                      <td key={c.key} className="py-2 px-3 text-xs font-mono tabular-nums whitespace-nowrap">
                        {String(row[c.key] ?? '—')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
