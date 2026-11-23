import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { apiRequest } from '../api.ts';
import { LeafletMap, type RouteOverlay } from '../components/LeafletMap.tsx';
import { PageHeader, RiskLabel } from '../components/StatusText.tsx';
import type { WasteBinItem } from '../types.ts';

interface OptimizedRouteItem {
  vehicleId: number;
  vehicleNumber: string;
  vehicleType: string;
  availabilityStatus: string;
  assignedZoneName: string;
  capacityKg: number;
  currentLoadKg: number;
  plannedLoadKg: number;
  depot: { lat: number; lng: number };
  orderedStops: {
    binId: number;
    binCode: string;
    location: string;
    latitude: number;
    longitude: number;
    routeOrder: number;
    legDistanceKm: number;
    estimatedKg: number;
    riskLevel: string;
  }[];
  totalDistanceKm: number;
  baselineDistanceKm: number;
  distanceSavedKm: number;
  estimatedTravelMinutes: number;
  coordinates: [number, number][];
  travelTimeNote: string;
}

const ROUTE_COLORS = ['#0f766e', '#2563eb', '#d97706', '#dc2626', '#7c3aed', '#0891b2'];

export function RouteOptimizationPage({ refreshTrigger }: { refreshTrigger: number }) {
  const [routes, setRoutes] = useState<OptimizedRouteItem[]>([]);
  const [bins, setBins] = useState<WasteBinItem[]>([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string>('ALL');
  const [loading, setLoading] = useState(true);

  const loadRoutes = async () => {
    setLoading(true);
    try {
      const [rRes, bRes] = await Promise.all([
        apiRequest<{ routes: OptimizedRouteItem[] }>('/routes/optimize'),
        apiRequest<{ bins: WasteBinItem[] }>('/bins'),
      ]);
      setRoutes(rRes.routes);
      setBins(bRes.bins);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRoutes().catch(() => {});
  }, [refreshTrigger]);

  const activeRoutes = routes.filter((r) =>
    selectedVehicleId === 'ALL' ? r.orderedStops.length > 0 : String(r.vehicleId) === selectedVehicleId
  );

  const overlays: RouteOverlay[] = activeRoutes.map((r, idx) => ({
    vehicleId: r.vehicleId,
    vehicleNumber: r.vehicleNumber,
    color: ROUTE_COLORS[idx % ROUTE_COLORS.length],
    coordinates: r.coordinates,
    depot: r.depot,
    orderedStops: r.orderedStops,
  }));

  const totalDist = activeRoutes.reduce((a, b) => a + b.totalDistanceKm, 0);
  const totalSaved = activeRoutes.reduce((a, b) => a + b.distanceSavedKm, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Smart Collection Route Optimization"
        subtitle="Nearest Neighbor + 2-opt edge-swap routing minimizes travel distance within vehicle capacity. Travel times are distance-based estimates (24 km/h urban average; no fabricated live traffic)."
        actions={
          <div className="flex items-center gap-2">
            <select
              value={selectedVehicleId}
              onChange={(e) => setSelectedVehicleId(e.target.value)}
              className="px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
            >
              <option value="ALL">All Active Vehicle Routes</option>
              {routes.map((r) => (
                <option key={r.vehicleId} value={r.vehicleId}>
                  {r.vehicleNumber} ({r.orderedStops.length} stops)
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={loadRoutes}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium whitespace-nowrap"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              <span>Re-Optimize Routes</span>
            </button>
          </div>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Active Dispatched Routes</div>
          <div className="mt-1 text-2xl font-semibold font-mono tabular-nums">{activeRoutes.length}</div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Optimized Route Distance</div>
          <div className="mt-1 text-2xl font-semibold font-mono tabular-nums">
            {totalDist.toFixed(2)} km
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Distance Saved vs. Unordered</div>
          <div className="mt-1 text-2xl font-semibold font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
            {totalSaved.toFixed(2)} km
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
        <LeafletMap bins={bins} routes={overlays} height="420px" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {activeRoutes.length === 0 ? (
          <div className="lg:col-span-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-8 text-center text-sm text-slate-500">
            No active stops assigned for the selected filter. Generate a Priority Collection Schedule first.
          </div>
        ) : (
          activeRoutes.map((r, idx) => (
            <div
              key={r.vehicleId}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-3"
            >
              <div className="flex items-start justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span
                      className="w-3 h-3 rounded-sm inline-block"
                      style={{ backgroundColor: ROUTE_COLORS[idx % ROUTE_COLORS.length] }}
                    />
                    <span className="font-mono text-sm font-bold">{r.vehicleNumber}</span>
                    <span className="text-xs text-slate-500">· {r.assignedZoneName}</span>
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Load: {r.currentLoadKg + r.plannedLoadKg} / {r.capacityKg} kg · Est. Time:{' '}
                    {r.estimatedTravelMinutes} min (24 km/h avg)
                  </div>
                </div>
                <div className="text-right font-mono text-xs tabular-nums">
                  <div className="font-semibold">{r.totalDistanceKm} km</div>
                  <div className="text-emerald-700 dark:text-emerald-400">
                    -{r.distanceSavedKm} km saved
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                {r.orderedStops.map((s) => (
                  <div
                    key={s.binId}
                    className="flex items-center justify-between text-xs py-1.5 border-b border-slate-100 dark:border-slate-800/70 last:border-0"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="font-mono font-semibold text-slate-500 w-6">
                        #{s.routeOrder}
                      </span>
                      <div className="min-w-0">
                        <div className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                          {s.binCode}
                        </div>
                        <div className="text-slate-500 dark:text-slate-400 truncate">{s.location}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <RiskLabel level={s.riskLevel} />
                      <span className="font-mono text-slate-500 tabular-nums">
                        +{s.legDistanceKm} km
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
