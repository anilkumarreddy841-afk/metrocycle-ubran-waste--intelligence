import type { DatabaseSync } from 'node:sqlite';
import { buildPriorityQueue, estimateWasteMassKg } from './priority_queue.ts';
import { optimizeVehicleRoute, type GeoStop } from './route_optimizer.ts';

export interface SmartRecommendation {
  id: string;
  category: 'Dispatch' | 'Capacity' | 'Frequency' | 'Fleet' | 'Zone';
  classification: 'AI Analytical Recommendation';
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  title: string;
  rationale: string;
  suggestedAction: string;
}

export function getDashboardSummary(db: DatabaseSync) {
  const bins = db
    .prepare(
      `SELECT
        b.*,
        z.zone_name,
        z.population_density,
        p.predicted_fill_level,
        p.estimated_overflow_hours,
        p.fill_rate_per_hour,
        p.risk_score,
        p.risk_level,
        p.model_name,
        p.confidence,
        p.mae,
        p.rmse,
        p.lr_mae,
        p.lr_rmse,
        p.rf_mae,
        p.rf_rmse,
        p.is_fallback,
        p.prediction_date
      FROM waste_bins b
      JOIN zones z ON z.id = b.zone_id
      LEFT JOIN predictions p ON p.id = (
        SELECT p2.id FROM predictions p2
        WHERE p2.bin_id = b.id
        ORDER BY p2.prediction_date DESC, p2.id DESC
        LIMIT 1
      )`
    )
    .all() as Record<string, unknown>[];

  const totalBins = bins.length;
  let normalBins = 0;
  let highRiskBins = 0;
  let criticalBins = 0;
  let predictedOverflowToday = 0;

  const riskCounts = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };

  for (const b of bins) {
    const level = String(b.risk_level || 'LOW') as keyof typeof riskCounts;
    if (level in riskCounts) riskCounts[level]++;
    if (level === 'LOW' || level === 'MEDIUM') normalBins++;
    if (level === 'HIGH') highRiskBins++;
    if (level === 'CRITICAL') criticalBins++;
    const ov = b.estimated_overflow_hours;
    if (ov !== null && ov !== undefined && Number(ov) <= 24) {
      predictedOverflowToday++;
    }
  }

  const availableVehiclesRow = db
    .prepare(`SELECT COUNT(*) as cnt FROM vehicles WHERE availability_status = 'Available'`)
    .get() as { cnt: number };

  const collectionsRow = db
    .prepare(
      `SELECT COUNT(*) as cnt, COALESCE(SUM(collected_quantity), 0) as total_kg
       FROM collection_records
       WHERE collection_status = 'Completed'`
    )
    .get() as { cnt: number; total_kg: number };

  const unreadAlertsRow = db
    .prepare(`SELECT COUNT(*) as cnt FROM alerts WHERE is_read = 0`)
    .get() as { cnt: number };

  const priorityQueue = buildPriorityQueue(db).slice(0, 10);

  return {
    kpis: {
      totalBins,
      normalBins,
      highRiskBins,
      criticalBins,
      predictedOverflowToday,
      availableVehicles: Number(availableVehiclesRow?.cnt ?? 0),
      collectionsCompleted: Number(collectionsRow?.cnt ?? 0),
      totalWasteCollectedKg: Math.round(Number(collectionsRow?.total_kg ?? 0) * 10) / 10,
      unreadAlerts: Number(unreadAlertsRow?.cnt ?? 0),
    },
    riskDistribution: riskCounts,
    topPriorityBins: priorityQueue,
  };
}

export function getFullAnalytics(db: DatabaseSync) {
  const summary = getDashboardSummary(db);

  // Daily collection statistics (last 14 days)
  const dailyTrends = db
    .prepare(
      `SELECT
        substr(collection_date, 1, 10) as day,
        COUNT(*) as collections_count,
        ROUND(SUM(collected_quantity), 1) as total_kg
      FROM collection_records
      WHERE collection_status = 'Completed'
      GROUP BY substr(collection_date, 1, 10)
      ORDER BY day ASC
      LIMIT 30`
    )
    .all() as Record<string, unknown>[];

  // Weekly collection trends (group by ISO week / 7-day buckets)
  const weeklyTrends = db
    .prepare(
      `SELECT
        strftime('%Y-W%W', collection_date) as week_label,
        COUNT(*) as collections_count,
        ROUND(SUM(collected_quantity), 1) as total_kg
      FROM collection_records
      WHERE collection_status = 'Completed'
      GROUP BY strftime('%Y-W%W', collection_date)
      ORDER BY week_label ASC`
    )
    .all() as Record<string, unknown>[];

  // Monthly waste generation
  const monthlyTrends = db
    .prepare(
      `SELECT
        strftime('%Y-%m', collection_date) as month_label,
        COUNT(*) as collections_count,
        ROUND(SUM(collected_quantity), 1) as total_kg
      FROM collection_records
      WHERE collection_status = 'Completed'
      GROUP BY strftime('%Y-%m', collection_date)
      ORDER BY month_label ASC`
    )
    .all() as Record<string, unknown>[];

  // Zone-wise comparison
  const zoneComparison = db
    .prepare(
      `SELECT
        z.id,
        z.zone_name,
        z.population_density,
        z.area,
        COUNT(DISTINCT b.id) as bin_count,
        ROUND(AVG(b.current_fill_level), 1) as avg_fill_level,
        ROUND(AVG(COALESCE(p.risk_score, b.current_fill_level)), 1) as avg_risk_score,
        SUM(CASE WHEN COALESCE(p.risk_level, 'LOW') = 'CRITICAL' THEN 1 ELSE 0 END) as critical_bins,
        SUM(CASE WHEN b.current_fill_level >= 90 THEN 1 ELSE 0 END) as overflowing_bins,
        ROUND(COALESCE((
          SELECT SUM(cr.collected_quantity)
          FROM collection_records cr
          JOIN waste_bins b2 ON b2.id = cr.bin_id
          WHERE b2.zone_id = z.id
        ), 0), 1) as total_collected_kg
      FROM zones z
      LEFT JOIN waste_bins b ON b.zone_id = z.id
      LEFT JOIN predictions p ON p.id = (
        SELECT p2.id FROM predictions p2
        WHERE p2.bin_id = b.id
        ORDER BY p2.prediction_date DESC, p2.id DESC
        LIMIT 1
      )
      GROUP BY z.id
      ORDER BY avg_risk_score DESC`
    )
    .all() as Record<string, unknown>[];

  // Vehicle utilization & fuel savings from route optimization
  const vehicles = db
    .prepare(
      `SELECT v.*, z.zone_name as assigned_zone_name
       FROM vehicles v
       LEFT JOIN zones z ON z.id = v.assigned_zone`
    )
    .all() as Record<string, unknown>[];

  const fuelSetting = db
    .prepare(`SELECT setting_value FROM system_settings WHERE setting_name = 'fuel_consumption_l_per_km'`)
    .get() as { setting_value: string } | undefined;
  const fuelPerKm = Number(fuelSetting?.setting_value || 0.38);

  let totalBaselineKm = 0;
  let totalOptimizedKm = 0;

  const vehicleUtilization = vehicles.map((v) => {
    const vid = Number(v.id);
    const activeStopsRows = db
      .prepare(
        `SELECT cp.priority, b.id as bin_id, b.bin_code, b.location, b.latitude, b.longitude, b.capacity, b.current_fill_level, COALESCE(p.risk_level, 'LOW') as risk_level
         FROM collection_plans cp
         JOIN waste_bins b ON b.id = cp.bin_id
         LEFT JOIN predictions p ON p.id = (
           SELECT p2.id FROM predictions p2 WHERE p2.bin_id = b.id ORDER BY p2.prediction_date DESC, p2.id DESC LIMIT 1
         )
         WHERE cp.vehicle_id = ? AND cp.route_status IN ('Scheduled', 'In Progress')
         ORDER BY cp.route_order ASC`
      )
      .all(vid) as Record<string, unknown>[];

    const stops: GeoStop[] = activeStopsRows.map((r) => ({
      binId: Number(r.bin_id),
      binCode: String(r.bin_code),
      location: String(r.location),
      latitude: Number(r.latitude),
      longitude: Number(r.longitude),
      priority: Number(r.priority),
      estimatedKg: estimateWasteMassKg(Number(r.capacity), Number(r.current_fill_level)),
      riskLevel: String(r.risk_level),
    }));

    const opt = optimizeVehicleRoute(
      Number(v.depot_lat) || 12.9716,
      Number(v.depot_lng) || 77.5946,
      stops
    );
    totalBaselineKm += opt.baselineDistanceKm;
    totalOptimizedKm += opt.totalDistanceKm;

    const perfRow = db
      .prepare(
        `SELECT COUNT(*) as trips, COALESCE(SUM(collected_quantity), 0) as kg
         FROM collection_records WHERE vehicle_id = ?`
      )
      .get(vid) as { trips: number; kg: number };

    const capacity = Number(v.capacity) || 1;
    const currentLoad = Number(v.current_load) || 0;
    const plannedLoad = stops.reduce((acc, s) => acc + s.estimatedKg, 0);

    return {
      id: vid,
      vehicleNumber: String(v.vehicle_number),
      vehicleType: String(v.vehicle_type),
      availabilityStatus: String(v.availability_status),
      assignedZoneName: v.assigned_zone_name ? String(v.assigned_zone_name) : 'City-Wide Pool',
      capacityKg: capacity,
      currentLoadKg: currentLoad,
      plannedLoadKg: Math.round(plannedLoad * 10) / 10,
      utilizationPct: Math.min(100, Math.round(((currentLoad + plannedLoad) / capacity) * 1000) / 10),
      completedCollections: Number(perfRow?.trips ?? 0),
      totalHauledKg: Math.round(Number(perfRow?.kg ?? 0) * 10) / 10,
      activeRouteStops: stops.length,
      optimizedDistanceKm: opt.totalDistanceKm,
    };
  });

  const distanceSavedKm = Math.max(0, Math.round((totalBaselineKm - totalOptimizedKm) * 100) / 100);
  const estimatedFuelSavedLiters = Math.round(distanceSavedKm * fuelPerKm * 100) / 100;

  // Overflow incident & efficiency metrics
  const overflowIncidentsRow = db
    .prepare(
      `SELECT COUNT(*) as cnt FROM fill_level_history WHERE fill_percentage >= 90`
    )
    .get() as { cnt: number };

  const plansStatusRows = db
    .prepare(
      `SELECT route_status, COUNT(*) as cnt FROM collection_plans GROUP BY route_status`
    )
    .all() as { route_status: string; cnt: number }[];

  const totalPlans = plansStatusRows.reduce((a, b) => a + Number(b.cnt), 0);
  const completedPlans = plansStatusRows
    .filter((r) => r.route_status === 'Completed')
    .reduce((a, b) => a + Number(b.cnt), 0);
  const delayedPlans = plansStatusRows
    .filter((r) => r.route_status === 'Delayed')
    .reduce((a, b) => a + Number(b.cnt), 0);

  const collectionEfficiencyPct =
    totalPlans > 0
      ? Math.round(((totalPlans - delayedPlans) / totalPlans) * 1000) / 10
      : 100;

  // Smart Recommendations derived strictly from live database state
  const recommendations = generateSmartRecommendations(db, summary, zoneComparison, vehicles);

  return {
    ...summary,
    dailyTrends,
    weeklyTrends,
    monthlyTrends,
    zoneComparison,
    vehicleUtilization,
    efficiency: {
      overflowReadingEvents: Number(overflowIncidentsRow?.cnt ?? 0),
      totalPlans,
      completedPlans,
      delayedPlans,
      collectionEfficiencyPct,
      totalBaselineKm: Math.round(totalBaselineKm * 100) / 100,
      totalOptimizedKm: Math.round(totalOptimizedKm * 100) / 100,
      distanceSavedKm,
      estimatedFuelSavedLiters,
    },
    recommendations,
  };
}

function generateSmartRecommendations(
  db: DatabaseSync,
  summary: ReturnType<typeof getDashboardSummary>,
  zoneComparison: Record<string, unknown>[],
  vehicles: Record<string, unknown>[]
): SmartRecommendation[] {
  const recs: SmartRecommendation[] = [];

  if (summary.kpis.criticalBins > 0) {
    const topCritical = summary.topPriorityBins
      .filter((b) => b.riskLevel === 'CRITICAL')
      .slice(0, 3)
      .map((b) => b.binCode)
      .join(', ');
    recs.push({
      id: 'rec-critical-first',
      category: 'Dispatch',
      classification: 'AI Analytical Recommendation',
      priority: 'CRITICAL',
      title: `Prioritize ${summary.kpis.criticalBins} critical-risk bins immediately`,
      rationale: `Highest urgency bins (${topCritical || 'see priority queue'}) exceed the 76/100 risk threshold.`,
      suggestedAction: 'Run Priority Schedule Generation and dispatch available fleet units to critical stops first.',
    });
  }

  const denseHotZone = zoneComparison.find(
    (z) => Number(z.population_density) >= 12000 && Number(z.avg_risk_score) >= 50
  );
  if (denseHotZone) {
    recs.push({
      id: `rec-zone-freq-${denseHotZone.id}`,
      category: 'Frequency',
      classification: 'AI Analytical Recommendation',
      priority: 'HIGH',
      title: `Increase collection frequency in ${String(denseHotZone.zone_name)}`,
      rationale: `Population density (${Number(denseHotZone.population_density).toLocaleString()} /km²) combined with ${Number(denseHotZone.avg_risk_score)} avg risk drives rapid fill spikes.`,
      suggestedAction: 'Shift from 48-hour cadence to twice-daily pickups for high-fill commercial nodes in this zone.',
    });
  }

  const repeatOverflowZone = zoneComparison.find((z) => Number(z.overflowing_bins) > 0);
  if (repeatOverflowZone) {
    recs.push({
      id: `rec-overflow-${repeatOverflowZone.id}`,
      category: 'Capacity',
      classification: 'AI Analytical Recommendation',
      priority: 'HIGH',
      title: `Address active overflow exposure in ${String(repeatOverflowZone.zone_name)}`,
      rationale: `${Number(repeatOverflowZone.overflowing_bins)} bin(s) currently sit at ≥90% fill capacity.`,
      suggestedAction: 'Deploy supplemental compactor capacity or upgrade high-load bins from 240L to 660L.',
    });
  }

  const unavailableCount = vehicles.filter(
    (v) => v.availability_status === 'Maintenance' || v.availability_status === 'Unavailable'
  ).length;
  if (unavailableCount > 0 && summary.kpis.availableVehicles > 0) {
    recs.push({
      id: 'rec-fleet-reassign',
      category: 'Fleet',
      classification: 'AI Analytical Recommendation',
      priority: 'MEDIUM',
      title: `Reassign routes to cover ${unavailableCount} unavailable vehicle(s)`,
      rationale: `${summary.kpis.availableVehicles} vehicles remain available to absorb high-priority bins.`,
      suggestedAction: 'Rebalance zone assignments for Available vehicles in Vehicle Management before next dispatch window.',
    });
  }

  const unassignedCount = db
    .prepare(
      `SELECT COUNT(*) as cnt FROM waste_bins b
       JOIN predictions p ON p.id = (SELECT p2.id FROM predictions p2 WHERE p2.bin_id = b.id ORDER BY p2.id DESC LIMIT 1)
       WHERE p.risk_score >= 51
       AND NOT EXISTS (SELECT 1 FROM collection_plans cp WHERE cp.bin_id = b.id AND cp.route_status IN ('Scheduled', 'In Progress'))`
    )
    .get() as { cnt: number };

  if (Number(unassignedCount?.cnt ?? 0) > 0) {
    recs.push({
      id: 'rec-unscheduled-high',
      category: 'Dispatch',
      classification: 'AI Analytical Recommendation',
      priority: 'HIGH',
      title: `${Number(unassignedCount.cnt)} high/critical bin(s) lack an active collection plan`,
      rationale: 'Unassigned high-risk bins risk spilling over prior to the next scheduled cycle.',
      suggestedAction: 'Trigger Priority Collection Planning to auto-assign bins within remaining vehicle capacity.',
    });
  }

  return recs;
}
