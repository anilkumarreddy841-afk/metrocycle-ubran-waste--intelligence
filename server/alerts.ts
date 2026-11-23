import type { DatabaseSync } from 'node:sqlite';
import type { RiskLevel } from './types.ts';

function insertAlertIfNew(
  db: DatabaseSync,
  binId: number | null,
  alertType: string,
  message: string,
  severity: RiskLevel
): boolean {
  const existing = db
    .prepare(
      `SELECT id FROM alerts
       WHERE is_read = 0 AND alert_type = ? AND COALESCE(bin_id, -1) = COALESCE(?, -1)
       LIMIT 1`
    )
    .get(alertType, binId);

  if (existing) return false;

  db.prepare(
    `INSERT INTO alerts (bin_id, alert_type, message, severity, is_read, created_at)
     VALUES (?, ?, ?, ?, 0, ?)`
  ).run(binId, alertType, message, severity, new Date().toISOString());
  return true;
}

/**
 * Evaluates latest predictions, vehicles, and collection plans to generate
 * operational alerts for high/critical bins, imminent overflow, unavailable fleet,
 * and delayed collections.
 */
export function evaluateAndGenerateAlerts(db: DatabaseSync): number {
  let created = 0;

  // 1. Critical & High Risk Bins + Imminent Overflow
  const binRisks = db
    .prepare(
      `SELECT
        b.id as bin_id,
        b.bin_code,
        b.location,
        b.current_fill_level,
        p.risk_score,
        p.risk_level,
        p.estimated_overflow_hours
      FROM waste_bins b
      JOIN predictions p ON p.id = (
        SELECT p2.id FROM predictions p2
        WHERE p2.bin_id = b.id
        ORDER BY p2.prediction_date DESC, p2.id DESC
        LIMIT 1
      )`
    )
    .all() as Record<string, unknown>[];

  for (const row of binRisks) {
    const binId = Number(row.bin_id);
    const binCode = String(row.bin_code);
    const location = String(row.location);
    const fill = Number(row.current_fill_level);
    const riskLevel = String(row.risk_level) as RiskLevel;
    const riskScore = Number(row.risk_score);
    const overflowHrs =
      row.estimated_overflow_hours === null || row.estimated_overflow_hours === undefined
        ? null
        : Number(row.estimated_overflow_hours);

    if (riskLevel === 'CRITICAL') {
      if (
        insertAlertIfNew(
          db,
          binId,
          'CRITICAL_RISK',
          `Bin ${binCode} (${location}) reached CRITICAL risk (${riskScore}/100, ${fill}% full). Immediate dispatch required.`,
          'CRITICAL'
        )
      ) {
        created++;
      }
    } else if (riskLevel === 'HIGH') {
      if (
        insertAlertIfNew(
          db,
          binId,
          'HIGH_RISK',
          `Bin ${binCode} (${location}) entered HIGH overflow risk (${riskScore}/100, ${fill}% full).`,
          'HIGH'
        )
      ) {
        created++;
      }
    }

    if (overflowHrs !== null && overflowHrs <= 6) {
      if (
        insertAlertIfNew(
          db,
          binId,
          'OVERFLOW_APPROACHING',
          `Predicted overflow approaching for ${binCode} (${location}) in ~${overflowHrs.toFixed(1)} hours.`,
          overflowHrs <= 2 ? 'CRITICAL' : 'HIGH'
        )
      ) {
        created++;
      }
    }
  }

  // 2. Unavailable / Maintenance vehicles
  const unavailableVehicles = db
    .prepare(
      `SELECT id, vehicle_number, availability_status
       FROM vehicles
       WHERE availability_status IN ('Unavailable', 'Maintenance')`
    )
    .all() as Record<string, unknown>[];

  for (const v of unavailableVehicles) {
    const msg = `Fleet unit ${String(v.vehicle_number)} is ${String(v.availability_status)}. Capacity removed from active dispatch pool.`;
    const exists = db
      .prepare(
        `SELECT id FROM alerts WHERE is_read = 0 AND alert_type = 'VEHICLE_UNAVAILABLE' AND message = ? LIMIT 1`
      )
      .get(msg);
    if (!exists) {
      db.prepare(
        `INSERT INTO alerts (bin_id, alert_type, message, severity, is_read, created_at)
         VALUES (NULL, 'VEHICLE_UNAVAILABLE', ?, 'MEDIUM', 0, ?)`
      ).run(msg, new Date().toISOString());
      created++;
    }
  }

  // 3. Delayed scheduled collections
  const nowIso = new Date().toISOString();
  const delayedPlans = db
    .prepare(
      `SELECT cp.id, cp.bin_id, b.bin_code, b.location, cp.scheduled_time
       FROM collection_plans cp
       JOIN waste_bins b ON b.id = cp.bin_id
       WHERE cp.route_status = 'Scheduled' AND cp.scheduled_time < ?`
    )
    .all(nowIso) as Record<string, unknown>[];

  for (const p of delayedPlans) {
    db.prepare(`UPDATE collection_plans SET route_status = 'Delayed' WHERE id = ?`).run(
      Number(p.id)
    );
    if (
      insertAlertIfNew(
        db,
        Number(p.bin_id),
        'COLLECTION_DELAYED',
        `Scheduled collection for ${String(p.bin_code)} (${String(p.location)}) is delayed past scheduled window.`,
        'HIGH'
      )
    ) {
      created++;
    }
  }

  return created;
}
