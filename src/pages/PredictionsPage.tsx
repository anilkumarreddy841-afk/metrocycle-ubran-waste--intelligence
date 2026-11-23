import { useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { apiRequest } from '../api.ts';
import { ChartCanvas } from '../components/ChartCanvas.tsx';
import { PageHeader, RiskLabel } from '../components/StatusText.tsx';
import type { WasteBinItem } from '../types.ts';

interface PredictionsPageProps {
  darkMode: boolean;
  refreshTrigger: number;
  onDataChanged: () => void;
}

interface ModelComparison {
  evaluatedBinsCount: number;
  fallbackBinsCount: number;
  linearRegression: { avgMae: number | null; avgRmse: number | null };
  randomForest: { avgMae: number | null; avgRmse: number | null };
}

export function PredictionsPage({ darkMode, refreshTrigger, onDataChanged }: PredictionsPageProps) {
  const [predictions, setPredictions] = useState<(WasteBinItem & { bin_id: number; history_count: number })[]>([]);
  const [comparison, setComparison] = useState<ModelComparison | null>(null);
  const [selectedModel, setSelectedModel] = useState<'Random Forest Regression' | 'Linear Regression'>(
    'Random Forest Regression'
  );
  const [horizonHours, setHorizonHours] = useState(24);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState('');

  const loadPredictions = async () => {
    const res = await apiRequest<{
      predictions: (WasteBinItem & { bin_id: number; history_count: number })[];
      modelComparison: ModelComparison;
    }>('/predictions');
    setPredictions(res.predictions);
    setComparison(res.modelComparison);
  };

  useEffect(() => {
    loadPredictions().catch(() => {});
  }, [refreshTrigger]);

  const handleRecompute = async () => {
    setRunning(true);
    setNotice('');
    try {
      const res = await apiRequest<{ recomputed: number }>('/predictions/recompute', {
        method: 'POST',
        body: JSON.stringify({ preferredModel: selectedModel, horizonHours }),
      });
      setNotice(`Recomputed ML forecasts for ${res.recomputed} bins using ${selectedModel} (+${horizonHours}h horizon).`);
      await loadPredictions();
      onDataChanged();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Prediction recompute failed');
    } finally {
      setRunning(false);
    }
  };

  const currentVsPredictedConfig = useMemo(() => {
    const top10 = predictions.slice(0, 10);
    return {
      type: 'bar' as const,
      data: {
        labels: top10.map((b) => b.bin_code),
        datasets: [
          {
            label: 'Current Fill (%)',
            data: top10.map((b) => b.current_fill_level),
            backgroundColor: '#64748b',
            borderRadius: 4,
          },
          {
            label: `Predicted Fill (+${horizonHours}h %)`,
            data: top10.map((b) => b.predicted_fill_level ?? b.current_fill_level),
            backgroundColor: '#0f766e',
            borderRadius: 4,
          },
        ],
      },
      options: {
        scales: { y: { beginAtZero: true, max: 100 } },
      },
    };
  }, [predictions, horizonHours]);

  const modelPerfConfig = useMemo(() => {
    const lr = comparison?.linearRegression;
    const rf = comparison?.randomForest;
    return {
      type: 'bar' as const,
      data: {
        labels: ['Mean Absolute Error (MAE %)', 'Root Mean Squared Error (RMSE %)'],
        datasets: [
          {
            label: 'Linear Regression (80/20 Held-Out)',
            data: [lr?.avgMae ?? 0, lr?.avgRmse ?? 0],
            backgroundColor: '#d97706',
            borderRadius: 4,
          },
          {
            label: 'Random Forest Regression (80/20 Held-Out)',
            data: [rf?.avgMae ?? 0, rf?.avgRmse ?? 0],
            backgroundColor: '#0f766e',
            borderRadius: 4,
          },
        ],
      },
      options: {
        scales: { y: { beginAtZero: true } },
      },
    };
  }, [comparison]);

  const overflowTrendConfig = useMemo(() => {
    const withEta = predictions
      .filter((p) => p.estimated_overflow_hours !== null)
      .sort((a, b) => Number(a.estimated_overflow_hours) - Number(b.estimated_overflow_hours))
      .slice(0, 12);
    return {
      type: 'line' as const,
      data: {
        labels: withEta.map((b) => b.bin_code),
        datasets: [
          {
            label: 'Estimated Hours Until Overflow',
            data: withEta.map((b) => Number(b.estimated_overflow_hours)),
            borderColor: '#dc2626',
            backgroundColor: 'rgba(220, 38, 38, 0.12)',
            fill: true,
            tension: 0.25,
          },
        ],
      },
      options: {
        scales: { y: { beginAtZero: true } },
      },
    };
  }, [predictions]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI-Based Overflow Prediction Engine"
        subtitle="Compares Linear Regression (OLS) and Random Forest Regression (15-tree ensemble) evaluated on chronological 80/20 held-out splits. Bins with <5 readings use a clearly labelled heuristic fallback."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedModel}
              onChange={(e) =>
                setSelectedModel(e.target.value as 'Random Forest Regression' | 'Linear Regression')
              }
              className="px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
            >
              <option value="Random Forest Regression">Random Forest Regression</option>
              <option value="Linear Regression">Linear Regression</option>
            </select>
            <select
              value={horizonHours}
              onChange={(e) => setHorizonHours(Number(e.target.value))}
              className="px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
            >
              <option value={12}>+12h Horizon</option>
              <option value={24}>+24h Horizon</option>
              <option value={48}>+48h Horizon</option>
            </select>
            <button
              type="button"
              onClick={handleRecompute}
              disabled={running}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium disabled:opacity-50 whitespace-nowrap"
            >
              <RefreshCw className={`w-4 h-4 ${running ? 'animate-spin' : ''}`} />
              <span>{running ? 'Training...' : 'Run ML Forecast'}</span>
            </button>
          </div>
        }
      />

      {notice && (
        <div className="p-3 rounded-md border border-teal-300 dark:border-teal-800 bg-teal-50 dark:bg-teal-950/30 text-sm text-teal-800 dark:text-teal-300">
          {notice}
        </div>
      )}

      {/* Model Comparison Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">ML-Evaluated Bins (≥5 Readings)</div>
          <div className="mt-1 text-2xl font-semibold font-mono tabular-nums">
            {comparison?.evaluatedBinsCount ?? 0}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Held-out 20% test split verified
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Fallback Estimate Bins (&lt;5 Readings)</div>
          <div className="mt-1 text-2xl font-semibold font-mono tabular-nums text-amber-700 dark:text-amber-400">
            {comparison?.fallbackBinsCount ?? 0}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Excluded from accuracy claims
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Linear Regression (Held-Out)</div>
          <div className="mt-1 text-xl font-semibold font-mono tabular-nums">
            MAE {comparison?.linearRegression.avgMae ?? '-'}% · RMSE {comparison?.linearRegression.avgRmse ?? '-'}%
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">OLS temporal fill-rate model</div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Random Forest (Held-Out)</div>
          <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-teal-700 dark:text-teal-400">
            MAE {comparison?.randomForest.avgMae ?? '-'}% · RMSE {comparison?.randomForest.avgRmse ?? '-'}%
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">15 bagged CART trees</div>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
          <h2 className="text-sm font-semibold mb-3">Current vs. Predicted Fill Level</h2>
          <ChartCanvas config={currentVsPredictedConfig} darkMode={darkMode} height={240} />
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
          <h2 className="text-sm font-semibold mb-3">Model Error Comparison (MAE &amp; RMSE)</h2>
          <ChartCanvas config={modelPerfConfig} darkMode={darkMode} height={240} />
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
          <h2 className="text-sm font-semibold mb-3">Soonest Overflow Time Horizon</h2>
          <ChartCanvas config={overflowTrendConfig} darkMode={darkMode} height={240} />
        </div>
      </div>

      {/* Per-Bin Predictions Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-sm font-semibold">Per-Bin Forecast &amp; Error Diagnostics</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-950/40">
                <th className="py-2.5 px-3 text-left font-medium">Bin</th>
                <th className="py-2.5 px-3 text-right font-medium">Readings</th>
                <th className="py-2.5 px-3 text-right font-medium">Current</th>
                <th className="py-2.5 px-3 text-right font-medium">Fill Rate</th>
                <th className="py-2.5 px-3 text-right font-medium">Predicted</th>
                <th className="py-2.5 px-3 text-right font-medium">Overflow ETA</th>
                <th className="py-2.5 px-3 text-left font-medium">Risk</th>
                <th className="py-2.5 px-3 text-left font-medium">Model &amp; Uncertainty</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {predictions.map((p) => (
                <tr key={p.bin_id || p.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="py-2.5 px-3">
                    <div className="font-mono text-xs font-semibold">{p.bin_code}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">{p.zone_name}</div>
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-xs tabular-nums">
                    {p.history_count}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-xs tabular-nums">
                    {p.current_fill_level}%
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-xs tabular-nums">
                    {p.fill_rate_per_hour ?? 0}%/h
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-xs font-semibold tabular-nums">
                    {p.predicted_fill_level ?? '-'}%
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-xs tabular-nums">
                    {p.estimated_overflow_hours !== null && p.estimated_overflow_hours !== undefined
                      ? `${Number(p.estimated_overflow_hours).toFixed(1)}h`
                      : 'Stable / Non-Increasing'}
                  </td>
                  <td className="py-2.5 px-3">
                    <RiskLabel level={p.risk_level} score={p.risk_score} />
                  </td>
                  <td className="py-2.5 px-3 text-xs">
                    <div className={p.is_fallback ? 'text-amber-700 dark:text-amber-400 font-medium' : 'text-slate-800 dark:text-slate-200'}>
                      {p.model_name}
                    </div>
                    <div className="text-slate-500 dark:text-slate-400">{p.confidence}</div>
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
