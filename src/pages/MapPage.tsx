import { useEffect, useState } from 'react';
import { apiRequest } from '../api.ts';
import { LeafletMap } from '../components/LeafletMap.tsx';
import { BinStatusLabel, PageHeader, RiskLabel, SourceNotice } from '../components/StatusText.tsx';
import type { WasteBinItem, ZoneItem } from '../types.ts';

export function MapPage({ refreshTrigger }: { refreshTrigger: number }) {
  const [bins, setBins] = useState<WasteBinItem[]>([]);
  const [zones, setZones] = useState<ZoneItem[]>([]);
  const [zoneFilter, setZoneFilter] = useState('');
  const [riskFilter, setRiskFilter] = useState('');
  const [highlightCritical, setHighlightCritical] = useState(true);
  const [selectedBin, setSelectedBin] = useState<WasteBinItem | null>(null);

  useEffect(() => {
    Promise.all([
      apiRequest<{ bins: WasteBinItem[] }>('/bins'),
      apiRequest<{ zones: ZoneItem[] }>('/zones'),
    ])
      .then(([bRes, zRes]) => {
        setBins(bRes.bins);
        setZones(zRes.zones);
      })
      .catch(() => {});
  }, [refreshTrigger]);

  const filteredBins = bins.filter((b) => {
    if (zoneFilter && String(b.zone_id) !== zoneFilter) return false;
    if (riskFilter && (b.risk_level || 'LOW') !== riskFilter) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Interactive Urban GIS Map"
        subtitle="OpenStreetMap geospatial layer showing GPS bin positions, risk-coded markers, critical overflow halos, and zone filtering."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={zoneFilter}
              onChange={(e) => setZoneFilter(e.target.value)}
              className="px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
            >
              <option value="">All Zones ({bins.length})</option>
              {zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.zone_name}
                </option>
              ))}
            </select>
            <select
              value={riskFilter}
              onChange={(e) => setRiskFilter(e.target.value)}
              className="px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
            >
              <option value="">All Risk Levels</option>
              {['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <label className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 cursor-pointer">
              <input
                type="checkbox"
                checked={highlightCritical}
                onChange={(e) => setHighlightCritical(e.target.checked)}
                className="accent-red-600"
              />
              <span>Highlight Critical</span>
            </label>
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-9 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-3">
          <LeafletMap
            bins={filteredBins}
            height="540px"
            highlightCritical={highlightCritical}
            onSelectBin={(b) => setSelectedBin(b)}
          />
        </div>

        <div className="lg:col-span-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4 space-y-4">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 border-b border-slate-100 dark:border-slate-800 pb-2">
            Selected Bin Telemetry
          </h2>

          {selectedBin ? (
            <div className="space-y-3 text-xs">
              <div>
                <div className="font-mono text-base font-bold text-slate-900 dark:text-slate-100">
                  {selectedBin.bin_code}
                </div>
                <div className="text-slate-600 dark:text-slate-400">{selectedBin.location}</div>
                <div className="text-slate-500 mt-0.5">{selectedBin.zone_name}</div>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <div>
                  <div className="text-slate-500">Current Fill</div>
                  <div className="font-mono font-semibold text-sm tabular-nums">
                    {selectedBin.current_fill_level}%
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">Predicted Fill</div>
                  <div className="font-mono font-semibold text-sm tabular-nums">
                    {selectedBin.predicted_fill_level ?? '-'}%
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">Status</div>
                  <div className="mt-0.5">
                    <BinStatusLabel status={selectedBin.status} />
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">Risk</div>
                  <div className="mt-0.5">
                    <RiskLabel level={selectedBin.risk_level} score={selectedBin.risk_score} />
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">Overflow ETA</div>
                  <div className="font-mono font-semibold tabular-nums">
                    {selectedBin.estimated_overflow_hours !== null
                      ? `${Number(selectedBin.estimated_overflow_hours).toFixed(1)}h`
                      : 'Stable'}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">Capacity</div>
                  <div className="font-mono font-semibold tabular-nums">{selectedBin.capacity} L</div>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-1">
                <div className="text-slate-500">
                  GPS:{' '}
                  <span className="font-mono tabular-nums">
                    {selectedBin.latitude.toFixed(5)}, {selectedBin.longitude.toFixed(5)}
                  </span>
                </div>
                <div className="text-slate-500">
                  Source: <SourceNotice source={selectedBin.reading_source} />
                </div>
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Click any marker on the OpenStreetMap canvas to inspect live fill level, ML prediction,
              GPS coordinates, and overflow ETA.
            </p>
          )}

          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-1.5 text-xs">
            <div className="font-semibold text-slate-700 dark:text-slate-300">Map Legend</div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-red-600 inline-block" />
              <span>CRITICAL Risk (76–100)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-orange-600 inline-block" />
              <span>HIGH Risk (51–75)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-amber-600 inline-block" />
              <span>MEDIUM Risk (31–50)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-emerald-600 inline-block" />
              <span>LOW Risk (0–30)</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
