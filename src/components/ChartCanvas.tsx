import { useEffect, useRef } from 'react';
import Chart from 'chart.js/auto';
import type { ChartConfiguration } from 'chart.js';

interface ChartCanvasProps {
  config: ChartConfiguration;
  darkMode: boolean;
  height?: number;
  className?: string;
}

export function ChartCanvas({
  config,
  darkMode,
  height = 240,
  className = '',
}: ChartCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (chartRef.current) {
      chartRef.current.destroy();
      chartRef.current = null;
    }

    const textColor = darkMode ? '#94a3b8' : '#475569';
    const gridColor = darkMode ? 'rgba(148, 163, 184, 0.12)' : 'rgba(15, 23, 42, 0.08)';
    const existingOptions = (config.options ?? {}) as Record<string, unknown>;
    const existingPlugins = (existingOptions.plugins ?? {}) as Record<string, unknown>;
    const existingScales = (existingOptions.scales ?? {}) as Record<string, Record<string, unknown>>;

    const isRadial = config.type === 'doughnut' || config.type === 'pie';

    const themedConfig = {
      ...config,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 250 },
        ...existingOptions,
        plugins: {
          ...existingPlugins,
          legend: {
            labels: {
              color: textColor,
              font: { family: 'Public Sans, system-ui, sans-serif', size: 12 },
              boxWidth: 12,
              padding: 14,
            },
            ...((existingPlugins.legend as object) || {}),
          },
          tooltip: {
            backgroundColor: darkMode ? '#0f172a' : '#1e293b',
            titleColor: '#f8fafc',
            bodyColor: '#e2e8f0',
            borderColor: darkMode ? '#334155' : '#0f172a',
            borderWidth: 1,
            padding: 10,
            cornerRadius: 6,
            ...((existingPlugins.tooltip as object) || {}),
          },
        },
        ...(isRadial
          ? {}
          : {
              scales: {
                x: {
                  ticks: { color: textColor, font: { size: 11 } },
                  grid: { color: gridColor },
                  ...(existingScales.x || {}),
                },
                y: {
                  ticks: { color: textColor, font: { size: 11 } },
                  grid: { color: gridColor },
                  ...(existingScales.y || {}),
                },
              },
            }),
      },
    } as ChartConfiguration;

    chartRef.current = new Chart(canvas, themedConfig);

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
  }, [config, darkMode]);

  return (
    <div className={`relative w-full ${className}`} style={{ height }}>
      <canvas ref={canvasRef} />
    </div>
  );
}
