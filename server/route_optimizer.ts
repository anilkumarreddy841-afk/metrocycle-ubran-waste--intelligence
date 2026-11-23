export interface GeoStop {
  binId: number;
  binCode: string;
  location: string;
  latitude: number;
  longitude: number;
  priority: number;
  estimatedKg: number;
  riskLevel: string;
}

export interface OptimizedRouteResult {
  orderedStops: (GeoStop & { routeOrder: number; legDistanceKm: number })[];
  totalDistanceKm: number;
  baselineDistanceKm: number;
  distanceSavedKm: number;
  estimatedTravelMinutes: number;
}

const EARTH_RADIUS_KM = 6371;
// Conservative municipal waste truck average speed in urban streets (distance-based estimate, not live traffic)
const AVG_URBAN_TRUCK_KMH = 24;

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

function routePathDistance(
  depotLat: number,
  depotLng: number,
  stops: GeoStop[]
): number {
  if (stops.length === 0) return 0;
  let total = haversineKm(depotLat, depotLng, stops[0].latitude, stops[0].longitude);
  for (let i = 1; i < stops.length; i++) {
    total += haversineKm(
      stops[i - 1].latitude,
      stops[i - 1].longitude,
      stops[i].latitude,
      stops[i].longitude
    );
  }
  total += haversineKm(
    stops[stops.length - 1].latitude,
    stops[stops.length - 1].longitude,
    depotLat,
    depotLng
  );
  return total;
}

/**
 * Optimizes visit order for a vehicle's assigned bins using Nearest Neighbor
 * initialization followed by 2-opt edge-swap refinement.
 */
export function optimizeVehicleRoute(
  depotLat: number,
  depotLng: number,
  stops: GeoStop[]
): OptimizedRouteResult {
  if (stops.length === 0) {
    return {
      orderedStops: [],
      totalDistanceKm: 0,
      baselineDistanceKm: 0,
      distanceSavedKm: 0,
      estimatedTravelMinutes: 0,
    };
  }

  // Unoptimized baseline: priority-only FIFO order
  const baselineDist = routePathDistance(depotLat, depotLng, stops);

  // Nearest-neighbor construction starting from depot
  const remaining = [...stops];
  const nnOrder: GeoStop[] = [];
  let curLat = depotLat;
  let curLng = depotLng;

  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversineKm(curLat, curLng, remaining[i].latitude, remaining[i].longitude);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    const chosen = remaining.splice(bestIdx, 1)[0];
    nnOrder.push(chosen);
    curLat = chosen.latitude;
    curLng = chosen.longitude;
  }

  // 2-opt local search
  let improved = true;
  let bestRoute = nnOrder;
  let bestDist = routePathDistance(depotLat, depotLng, bestRoute);

  let iterations = 0;
  while (improved && iterations < 100) {
    improved = false;
    iterations++;
    for (let i = 0; i < bestRoute.length - 1; i++) {
      for (let k = i + 1; k < bestRoute.length; k++) {
        const candidate = [
          ...bestRoute.slice(0, i),
          ...bestRoute.slice(i, k + 1).reverse(),
          ...bestRoute.slice(k + 1),
        ];
        const candDist = routePathDistance(depotLat, depotLng, candidate);
        if (candDist + 1e-4 < bestDist) {
          bestRoute = candidate;
          bestDist = candDist;
          improved = true;
        }
      }
    }
  }

  // Compute leg distances
  const orderedStops = bestRoute.map((stop, idx) => {
    const prevLat = idx === 0 ? depotLat : bestRoute[idx - 1].latitude;
    const prevLng = idx === 0 ? depotLng : bestRoute[idx - 1].longitude;
    const leg = haversineKm(prevLat, prevLng, stop.latitude, stop.longitude);
    return {
      ...stop,
      routeOrder: idx + 1,
      legDistanceKm: Math.round(leg * 100) / 100,
    };
  });

  const roundedTotal = Math.round(bestDist * 100) / 100;
  const roundedBase = Math.round(baselineDist * 100) / 100;
  const saved = Math.max(0, Math.round((roundedBase - roundedTotal) * 100) / 100);
  // 4 mins avg stop dwell time + distance / 24 km/h
  const travelMinutes = Math.round((roundedTotal / AVG_URBAN_TRUCK_KMH) * 60 + orderedStops.length * 4);

  return {
    orderedStops,
    totalDistanceKm: roundedTotal,
    baselineDistanceKm: roundedBase,
    distanceSavedKm: saved,
    estimatedTravelMinutes: travelMinutes,
  };
}
