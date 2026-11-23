import type { DatabaseSync } from 'node:sqlite';
import { optimizeVehicleRoute, type GeoStop } from './route_optimizer.ts';

/**
 * Binary Min-Heap Priority Queue (mirroring Python heapq semantics with negated priority key)
 * so highest-urgency waste bins are popped first in O(log n).
 */
export class MinHeap<T> {
  private heap: { key: number; tieBreaker: number; item: T }[] = [];

  push(key: number, tieBreaker: number, item: T): void {
    this.heap.push({ key, tieBreaker, item });
    this.bubbleUp(this.heap.length - 1);
  }

  pop(): T | undefined {
    if (this.heap.length === 0) return undefined;
    const top = this.heap[0].item;
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.sinkDown(0);
    }
    return top;
  }

  get size(): number {
    return this.heap.length;
  }

  private isSmaller(a: { key: number; tieBreaker: number }, b: { key: number; tieBreaker: number }): boolean {
    if (a.key !== b.key) return a.key < b.key;
    return a.tieBreaker < b.tieBreaker;
  }

  private bubbleUp(idx: number): void {
    while (idx > 0) {
      const parent = Math.floor((idx - 1) / 2);
      if (this.isSmaller(this.heap[idx], this.heap[parent])) {
        [this.heap[idx], this.heap[parent]] = [this.heap[parent], this.heap[idx]];
        idx = parent;
      } else {
        break;
      }
    }
  }

  private sinkDown(idx: number): void {
    const n = this.heap.length;
    while (true) {
      let smallest = idx;
      const left = 2 * idx + 1;
      const right = 2 * idx + 2;
      if (left < n && this.isSmaller(this.heap[left], this.heap[smallest])) {
        smallest = left;
      }
      if (right < n && this.isSmaller(this.heap[right], this.heap[smallest])) {
        smallest = right;
      }
      if (smallest !== idx) {
        [this.heap[idx], this.heap[smallest]] = [this.heap[smallest], this.heap[idx]];
        idx = smallest;
      } else {
        break;
      }
    }
  }
}

export interface PriorityBinItem {
  binId: number;
  binCode: string;
  location: string;
  latitude: number;
  longitude: number;
  zoneId: number;
  zoneName: string;
  populationDensity: number;
  capacityLiters: number;
  currentFillLevel: number;
  estimatedWasteKg: number;
  lastCollectionDate: string;
  hoursSinceLastCollection: number;
  riskScore: number;
  riskLevel: string;
  estimatedOverflowHours: number | null;
  priorityScore: number;
  urgencyRank: number;
  hasActiveAssignment: boolean;
}

/**
 * Estimates waste mass in kg from bin capacity (L) and fill %.
 * Uses conservative urban mixed-waste bulk density of ~0.35 kg/L.
 */
export function estimateWasteMassKg(capacityLiters: number, fillPercentage: number): number {
  return Math.round(capacityLiters * (fillPercentage / 100) * 0.35 * 10) / 10;
}

export function buildPriorityQueue(db: DatabaseSync): PriorityBinItem[] {
  const rows = db
    .prepare(
      `SELECT
        b.id as bin_id,
        b.bin_code,
        b.location,
        b.latitude,
        b.longitude,
        b.zone_id,
        z.zone_name,
        z.population_density,
        b.capacity,
        b.current_fill_level,
        b.last_collection_date,
        COALESCE(p.risk_score, b.current_fill_level) as risk_score,
        COALESCE(p.risk_level, 'LOW') as risk_level,
        p.estimated_overflow_hours,
        EXISTS (
          SELECT 1 FROM collection_plans cp
          WHERE cp.bin_id = b.id AND cp.route_status IN ('Scheduled', 'In Progress')
        ) as has_active_assignment
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

  const maxDensity = Math.max(
    1,
    ...rows.map((r) => Number(r.population_density) || 1)
  );
  const nowMs = Date.now();
  const heap = new MinHeap<Omit<PriorityBinItem, 'urgencyRank'>>();

  for (const r of rows) {
    const riskScore = Number(r.risk_score) || 0;
    const popDensity = Number(r.population_density) || 0;
    const overflowHours =
      r.estimated_overflow_hours === null || r.estimated_overflow_hours === undefined
        ? null
        : Number(r.estimated_overflow_hours);
    const lastCollMs = new Date(String(r.last_collection_date)).getTime();
    const hoursSinceLastCollection = Number.isFinite(lastCollMs)
      ? Math.max(0, (nowMs - lastCollMs) / 3600000)
      : 24;

    // Priority formula combining risk_score (45%), population density (20%),
    // overflow urgency (25%), and time since last collection (10%)
    const riskComp = (riskScore / 100) * 45;
    const densityComp = (popDensity / maxDensity) * 20;
    const overflowComp =
      overflowHours === null
        ? 0
        : overflowHours <= 0
          ? 25
          : Math.min(25, (1 / Math.max(1, overflowHours / 6)) * 25);
    const ageComp = Math.min(10, (hoursSinceLastCollection / 96) * 10);

    const priorityScore = Math.round((riskComp + densityComp + overflowComp + ageComp) * 100) / 100;
    const fillLevel = Number(r.current_fill_level) || 0;
    const cap = Number(r.capacity) || 240;

    const item: Omit<PriorityBinItem, 'urgencyRank'> = {
      binId: Number(r.bin_id),
      binCode: String(r.bin_code),
      location: String(r.location),
      latitude: Number(r.latitude),
      longitude: Number(r.longitude),
      zoneId: Number(r.zone_id),
      zoneName: String(r.zone_name),
      populationDensity: popDensity,
      capacityLiters: cap,
      currentFillLevel: fillLevel,
      estimatedWasteKg: estimateWasteMassKg(cap, fillLevel),
      lastCollectionDate: String(r.last_collection_date),
      hoursSinceLastCollection: Math.round(hoursSinceLastCollection * 10) / 10,
      riskScore,
      riskLevel: String(r.risk_level),
      estimatedOverflowHours: overflowHours,
      priorityScore,
      hasActiveAssignment: Boolean(Number(r.has_active_assignment)),
    };

    // Negate priorityScore for MinHeap max-priority ordering
    heap.push(-priorityScore, item.binId, item);
  }

  const ordered: PriorityBinItem[] = [];
  let rank = 1;
  while (heap.size > 0) {
    const next = heap.pop()!;
    ordered.push({ ...next, urgencyRank: rank++ });
  }
  return ordered;
}

export interface ScheduleGenerationResult {
  createdPlans: number;
  skippedAlreadyAssigned: number;
  unassignedDueToCapacityOrFleet: number;
  vehicleSummaries: {
    vehicleId: number;
    vehicleNumber: string;
    assignedBins: number;
    plannedLoadKg: number;
    remainingCapacityKg: number;
    totalDistanceKm: number;
  }[];
}

export function generatePriorityCollectionSchedule(
  db: DatabaseSync,
  minRiskScore = 31
): ScheduleGenerationResult {
  const queue = buildPriorityQueue(db);

  // Only assign Available vehicles
  const vehicles = db
    .prepare(
      `SELECT id, vehicle_number, vehicle_type, capacity, current_load, availability_status, assigned_zone, depot_lat, depot_lng
       FROM vehicles
       WHERE availability_status = 'Available'`
    )
    .all() as Record<string, unknown>[];

  // Track already-planned active loads per vehicle so we never exceed capacity
  const activePlans = db
    .prepare(
      `SELECT cp.vehicle_id, b.capacity, b.current_fill_level
       FROM collection_plans cp
       JOIN waste_bins b ON b.id = cp.bin_id
       WHERE cp.route_status IN ('Scheduled', 'In Progress')`
    )
    .all() as Record<string, unknown>[];

  const vehicleLoadMap = new Map<number, number>();
  for (const v of vehicles) {
    vehicleLoadMap.set(Number(v.id), Number(v.current_load) || 0);
  }
  for (const p of activePlans) {
    const vid = Number(p.vehicle_id);
    if (vehicleLoadMap.has(vid)) {
      const kg = estimateWasteMassKg(Number(p.capacity), Number(p.current_fill_level));
      vehicleLoadMap.set(vid, (vehicleLoadMap.get(vid) || 0) + kg);
    }
  }

  let createdPlans = 0;
  let skippedAlreadyAssigned = 0;
  let unassignedDueToCapacityOrFleet = 0;
  const newlyAssignedByVehicle = new Map<number, PriorityBinItem[]>();

  const now = new Date();
  let slotOffsetMinutes = 20;

  for (const bin of queue) {
    // Only schedule bins meeting minimum risk or >= 45% fill
    if (bin.riskScore < minRiskScore && bin.currentFillLevel < 45) {
      continue;
    }

    if (bin.hasActiveAssignment) {
      skippedAlreadyAssigned++;
      continue;
    }

    // Find eligible available vehicle with sufficient remaining capacity
    // Prefer vehicle assigned to this bin's zone, then largest remaining capacity
    const candidates = vehicles
      .filter((v) => {
        const vid = Number(v.id);
        const cap = Number(v.capacity);
        const used = vehicleLoadMap.get(vid) ?? 0;
        return cap - used >= Math.max(10, bin.estimatedWasteKg);
      })
      .sort((a, b) => {
        const aZoneMatch = Number(a.assigned_zone) === bin.zoneId ? 1 : 0;
        const bZoneMatch = Number(b.assigned_zone) === bin.zoneId ? 1 : 0;
        if (aZoneMatch !== bZoneMatch) return bZoneMatch - aZoneMatch;
        const aRem = Number(a.capacity) - (vehicleLoadMap.get(Number(a.id)) ?? 0);
        const bRem = Number(b.capacity) - (vehicleLoadMap.get(Number(b.id)) ?? 0);
        return bRem - aRem;
      });

    if (candidates.length === 0) {
      unassignedDueToCapacityOrFleet++;
      continue;
    }

    const chosen = candidates[0];
    const vid = Number(chosen.id);
    vehicleLoadMap.set(vid, (vehicleLoadMap.get(vid) ?? 0) + bin.estimatedWasteKg);

    if (!newlyAssignedByVehicle.has(vid)) {
      newlyAssignedByVehicle.set(vid, []);
    }
    newlyAssignedByVehicle.get(vid)!.push(bin);
  }

  const insertStmt = db.prepare(
    `INSERT INTO collection_plans (vehicle_id, bin_id, priority, route_order, estimated_distance_km, scheduled_time, route_status)
     VALUES (?, ?, ?, ?, ?, ?, 'Scheduled')`
  );

  const vehicleSummaries: ScheduleGenerationResult['vehicleSummaries'] = [];

  for (const v of vehicles) {
    const vid = Number(v.id);
    const assigned = newlyAssignedByVehicle.get(vid) || [];
    if (assigned.length === 0) continue;

    // Fetch existing active stops for this vehicle to optimize entire vehicle route
    const stops: GeoStop[] = assigned.map((b) => ({
      binId: b.binId,
      binCode: b.binCode,
      location: b.location,
      latitude: b.latitude,
      longitude: b.longitude,
      priority: b.priorityScore,
      estimatedKg: b.estimatedWasteKg,
      riskLevel: b.riskLevel,
    }));

    const optimized = optimizeVehicleRoute(
      Number(v.depot_lat) || 12.9716,
      Number(v.depot_lng) || 77.5946,
      stops
    );

    for (const stop of optimized.orderedStops) {
      const scheduled = new Date(now.getTime() + slotOffsetMinutes * 60000).toISOString();
      slotOffsetMinutes += 15;
      insertStmt.run(
        vid,
        stop.binId,
        stop.priority,
        stop.routeOrder,
        stop.legDistanceKm,
        scheduled
      );
      createdPlans++;
    }

    const plannedLoad = vehicleLoadMap.get(vid) ?? 0;
    vehicleSummaries.push({
      vehicleId: vid,
      vehicleNumber: String(v.vehicle_number),
      assignedBins: optimized.orderedStops.length,
      plannedLoadKg: Math.round(plannedLoad * 10) / 10,
      remainingCapacityKg: Math.max(0, Math.round((Number(v.capacity) - plannedLoad) * 10) / 10),
      totalDistanceKm: optimized.totalDistanceKm,
    });
  }

  return {
    createdPlans,
    skippedAlreadyAssigned,
    unassignedDueToCapacityOrFleet,
    vehicleSummaries,
  };
}
