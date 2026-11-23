import React, { useEffect, useMemo, useState } from 'react';
import { Activity, PlusCircle } from 'lucide-react';
import { apiRequest } from '../api.ts';
import { ChartCanvas } from '../components/ChartCanvas.tsx';
import { BinStatusLabel, PageHeader, SourceNotice } from '../components/StatusText.tsx';
import type { WasteBinItem } from '../types.ts';

interface MonitoringPageProps {
  darkMode: boolean;
  refreshTrigger: number;
  onDataChanged: () => void;
}

interface FillHistoryRow {
  id: number;
  bin_id: number;
  bin_code: string;
  location: string;
  zone_name: string;
  fill_percentage: number;
  source: string;
  recorded_at: string;
}

export function MonitoringPage({ darkMode, refreshTrigger, onDataChanged }: MonitoringPageProps) {
  const [bins, setBins] = useState<WasteBinItem[]>([]);
  const [history, setHistory] = useState<FillHistoryRow[]>([]);
  const [selectedBinId, setSelectedBinId] = useState<number | null>(null);
  const [binHistory, setBinHistory] = useState<FillHistoryRow[]>([]);
  const [manualFill, setManualFill] = useState('65');
  const [notice, setNotice] = useState('');

  const loadMonitoring = async () => {
    const [binsRes, histRes] = await Promise.all([
      apiRequest<{ bins: WasteBinItem[] }>('/bins'),
      apiRequest<{ history: FillHistoryRow[] }>('/fill-history?limit=80'),
    ]);
    setBins(binsRes.bins);
    setHistory(histRes.history);
    if (!selectedBinId && binsRes.bins.length > 0) {
      setSelectedBinId(binsRes.bins[0].id);
    }
  };

  useEffect(() => {
    loadMonitoring().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTrigger]);

  useEffect(() => {
    if (!selectedBinId) return;
    apiRequest<{ history: FillHistoryRow[] }>(`/fill-history?bin_id=${selectedBinId}&limit=40`)
      .then((res) => setBinHistory(res.history))
      .catch(() => {});
  }, [selectedBinId, refreshTrigger]);

  const handleLogManual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBinId) return;
    setNotice('');
    try {
      await apiRequest(`/bins/${selectedBinId}/readings`, {
        method: 'POST',
        body: JSON.stringify({
          fillPercentage: Number(manualFill),
          source: 'manual',
        }),
      });
      setNotice(`Logged manual fill reading (${manualFill}%) and triggered ML risk reassessment.`);
      await loadMonitoring();
      const res = await apiRequest<{ history: FillHistoryRow[] }>(`/fill-history?bin_id=${selectedBinId}&limit=40`);
      setBinHistory(res.history);
      onDataChanged();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Failed to log reading');
    }
  };

  const handleSimulateStep = async () => {
    setNotice('');
    try {
      const res = await apiRequest<{ updatedBins: number; alertsCreated: number }>('/bins/simulate-tick', {
        method: 'POST',
      });
      setNotice(
        `Simulated telemetry step recorded for ${res.updatedBins} bins (tagged as simulated; ${res.alertsCreated} new alert(s)).`
      );
      await loadMonitoring();
      onDataChanged();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Simulation step failed');
    }
  };

  const summary = useMemo(() => {
    const total = bins.length;
    const normal = bins.filter((b) => b.current_fill_level < 50).length;
    const highFill = bins.filter((b) => b.current_fill_level >= 50 && b.current_fill_level < 85).length;
    const critical = bins.filter((b) => b.current_fill_level >= 85).length;
    const recentlyCollected = bins.filter((b) => {
      const hrs = (Date.now() - new Date(b.last_collection_date).getTime()) / 3600000;
      return hrs <= 24;
    }).length;
    return { total, normal, highFill, critical, recentlyCollected };
  }, [bins]);

  const trendChartConfig = useMemo(() => {
    const chronological = [...binHistory].reverse();
    return {
      type: 'line' as const,
      data: {
        labels: chronological.map((r) =>
          new Date(r.recorded_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
        ),
        datasets: [
          {
            label: 'Fill Percentage (%)',
            data: chronological.map((r) => r.fill_percentage),
            borderColor: '#0f766e',
            backgroundColor: 'rgba(15, 118, 110, 0.14)',
            fill: true,
            tension: 0.2,
          },
        ],
      },
      options: {
        scales: { y: { beginAtZero: true, max: 100 } },
      },
    };
  }, [binHistory]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fill Level Monitoring"
        subtitle="Notice: No physical IoT hardware sensor is connected. All readings are clearly tagged as Manual Entry, CSV/Excel Import, or Simulated Reading."
        actions={
          <button
            type="button"
            onClick={handleSimulateStep}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-medium hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
          >
            <Activity className="w-4 h-4" />
            <span>Advance Simulated Readings</span>
          </button>
        }
      />

      {notice && (
        <div className="p-3 rounded-md border border-teal-300 dark:border-teal-800 bg-teal-50 dark:bg-teal-950/30 text-sm text-teal-800 dark:text-teal-300">
          {notice}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        {[
          { label: 'Total Registered Bins', value: summary.total },
          { label: 'Normal (<50%)', value: summary.normal },
          { label: 'High-Fill (50–84%)', value: summary.highFill },
          { label: 'Critical (≥85%)', value: summary.critical },
          { label: 'Collected (Last 24h)', value: summary.recentlyCollected },
        ].map((c) => (
          <div
            key={c.label}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4"
          >
            <div className="text-xs text-slate-500 dark:text-slate-400">{c.label}</div>
            <div className="mt-1 text-2xl font-semibold font-mono tabular-nums">{c.value}</div>
          </div>
        ))}
      </div>

      {/* Log Manual Reading + Per-bin History Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Record Manual Fill Reading
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Updates SQLite fill_level_history and immediately recalculates predictions &amp; alerts.
          </p>

          <form onSubmit={handleLogManual} className="mt-4 space-y-3">
            <div>
              <label className="block text-xs font-medium mb-1">Select Bin</label>
              <select
                value={selectedBinId ?? ''}
                onChange={(e) => setSelectedBinId(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              >
                {bins.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.bin_code} — {b.location} ({b.current_fill_level}%)
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Observed Fill Percentage (0–100%)</label>
              <input
                type="number"
                min="0"
                max="100"
                step="0.5"
                required
                value={manualFill}
                onChange={(e) => setManualFill(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono"
              />
            </div>
            <button
              type="submit"
              className="w-full inline-flex items-center justify-center gap-2 py-2 px-4 rounded-md bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium"
            >
              <PlusCircle className="w-4 h-4" />
              <span>Save Manual Reading</span>
            </button>
          </form>
        </div>

        <div className="lg:col-span-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Fill Level History Trend {selectedBinId ? `(${bins.find((b) => b.id === selectedBinId)?.bin_code || ''})` : ''}
            </h2>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {binHistory.length} historical reading(s)
            </span>
          </div>
          <ChartCanvas config={trendChartConfig} darkMode={darkMode} height={240} />
        </div>
      </div>

      {/* Live Bin Grid & Recent Reading Ledger */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Recent Fill-Level Readings Log
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-950/40">
                <th className="py-2.5 px-3 text-left font-medium">Timestamp</th>
                <th className="py-2.5 px-3 text-left font-medium">Bin Code</th>
                <th className="py-2.5 px-3 text-left font-medium">Location</th>
                <th className="py-2.5 px-3 text-left font-medium">Zone</th>
                <th className="py-2.5 px-3 text-right font-medium">Fill %</th>
                <th className="py-2.5 px-3 text-left font-medium">Status</th>
                <th className="py-2.5 px-3 text-left font-medium">Reading Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {history.slice(0, 35).map((h) => (
                <tr key={h.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="py-2 px-3 font-mono text-xs tabular-nums text-slate-500 whitespace-nowrap">
                    {new Date(h.recorded_at).toLocaleString()}
                  </td>
                  <td className="py-2 px-3 font-mono text-xs font-semibold">{h.bin_code}</td>
                  <td className="py-2 px-3 text-xs">{h.location}</td>
                  <td className="py-2 px-3 text-xs text-slate-500 dark:text-slate-400">{h.zone_name}</td>
                  <td className="py-2 px-3 text-right font-mono text-xs font-semibold tabular-nums">
                    {h.fill_percentage}%
                  </td>
                  <td className="py-2 px-3">
                    <BinStatusLabel
                      status={
                        h.fill_percentage < 15
                          ? 'Empty'
                          : h.fill_percentage < 50
                            ? 'Normal'
                            : h.fill_percentage < 75
                              ? 'Filling'
                              : h.fill_percentage < 90
                                ? 'Nearly Full'
                                : 'Overflowing'
                      }
                    />
                  </td>
                  <td className="py-2 px-3">
                    <SourceNotice source={h.source} />
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
