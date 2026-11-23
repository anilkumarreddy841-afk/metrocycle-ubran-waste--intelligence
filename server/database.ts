import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { evaluateAndGenerateAlerts } from './alerts.ts';
import { hashPassword } from './auth.ts';
import { runBinPrediction } from './prediction.ts';
import { generatePriorityCollectionSchedule } from './priority_queue.ts';
import { classifyBinStatus } from './risk_engine.ts';
import type { FillHistoryRecord } from './types.ts';

export const DB_PATH = path.resolve(
  process.cwd(),
  process.env.DATABASE_PATH || 'urban_waste_management.db'
);
export const BACKUP_DIR = path.resolve(process.cwd(), 'backups');

let dbInstance: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (!dbInstance) {
    dbInstance = new DatabaseSync(DB_PATH);
    initializeSchema(dbInstance);
    seedDatabaseIfEmpty(dbInstance);
  }
  return dbInstance;
}

export function closeDb(): void {
  if (dbInstance) {
    try {
      dbInstance.exec('PRAGMA wal_checkpoint(TRUNCATE);');
      dbInstance.close();
    } catch {
      // Ignore close errors
    }
    dbInstance = null;
  }
}

export function initializeSchema(db: DatabaseSync): void {
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('Administrator', 'Waste Management Officer', 'Collection Staff')),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS zones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      zone_name TEXT NOT NULL UNIQUE,
      population_density REAL NOT NULL CHECK(population_density > 0),
      area REAL NOT NULL CHECK(area > 0),
      description TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS waste_bins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bin_code TEXT NOT NULL UNIQUE,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      location TEXT NOT NULL,
      zone_id INTEGER NOT NULL REFERENCES zones(id) ON DELETE RESTRICT,
      capacity REAL NOT NULL CHECK(capacity > 0),
      waste_type TEXT NOT NULL,
      current_fill_level REAL NOT NULL CHECK(current_fill_level >= 0 AND current_fill_level <= 100),
      last_collection_date TEXT NOT NULL,
      status TEXT NOT NULL,
      reading_source TEXT NOT NULL DEFAULT 'simulated',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS fill_level_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bin_id INTEGER NOT NULL REFERENCES waste_bins(id) ON DELETE CASCADE,
      fill_percentage REAL NOT NULL CHECK(fill_percentage >= 0 AND fill_percentage <= 100),
      source TEXT NOT NULL DEFAULT 'simulated',
      recorded_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS predictions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bin_id INTEGER NOT NULL REFERENCES waste_bins(id) ON DELETE CASCADE,
      predicted_fill_level REAL NOT NULL,
      estimated_overflow_hours REAL,
      fill_rate_per_hour REAL NOT NULL DEFAULT 0,
      risk_score REAL NOT NULL,
      risk_level TEXT NOT NULL CHECK(risk_level IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
      model_name TEXT NOT NULL,
      confidence TEXT NOT NULL DEFAULT '',
      mae REAL,
      rmse REAL,
      lr_mae REAL,
      lr_rmse REAL,
      rf_mae REAL,
      rf_rmse REAL,
      is_fallback INTEGER NOT NULL DEFAULT 0,
      prediction_date TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS vehicles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vehicle_number TEXT NOT NULL UNIQUE,
      vehicle_type TEXT NOT NULL,
      capacity REAL NOT NULL CHECK(capacity > 0),
      current_load REAL NOT NULL DEFAULT 0 CHECK(current_load >= 0),
      availability_status TEXT NOT NULL CHECK(availability_status IN ('Available', 'On Route', 'Maintenance', 'Unavailable')),
      assigned_zone INTEGER REFERENCES zones(id) ON DELETE SET NULL,
      depot_lat REAL NOT NULL DEFAULT 12.9716,
      depot_lng REAL NOT NULL DEFAULT 77.5946
    );

    CREATE TABLE IF NOT EXISTS collection_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
      bin_id INTEGER NOT NULL REFERENCES waste_bins(id) ON DELETE CASCADE,
      priority REAL NOT NULL,
      route_order INTEGER NOT NULL DEFAULT 1,
      estimated_distance_km REAL NOT NULL DEFAULT 0,
      scheduled_time TEXT NOT NULL,
      route_status TEXT NOT NULL CHECK(route_status IN ('Scheduled', 'In Progress', 'Completed', 'Delayed', 'Cancelled'))
    );

    CREATE TABLE IF NOT EXISTS collection_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bin_id INTEGER NOT NULL REFERENCES waste_bins(id) ON DELETE CASCADE,
      vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
      collected_quantity REAL NOT NULL CHECK(collected_quantity >= 0),
      collection_status TEXT NOT NULL,
      collection_date TEXT NOT NULL,
      remarks TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bin_id INTEGER REFERENCES waste_bins(id) ON DELETE CASCADE,
      alert_type TEXT NOT NULL,
      message TEXT NOT NULL,
      severity TEXT NOT NULL CHECK(severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      setting_name TEXT NOT NULL UNIQUE,
      setting_value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      user_email TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      details TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_history_bin_time ON fill_level_history(bin_id, recorded_at);
    CREATE INDEX IF NOT EXISTS idx_predictions_bin_date ON predictions(bin_id, prediction_date);
    CREATE INDEX IF NOT EXISTS idx_plans_status ON collection_plans(route_status);
    CREATE INDEX IF NOT EXISTS idx_alerts_unread ON alerts(is_read, created_at);
  `);
}

export function getSystemSettingsMap(db: DatabaseSync): Record<string, string> {
  const rows = db
    .prepare(`SELECT setting_name, setting_value FROM system_settings`)
    .all() as { setting_name: string; setting_value: string }[];
  const map: Record<string, string> = {};
  for (const r of rows) {
    map[r.setting_name] = r.setting_value;
  }
  return map;
}

export function recomputePredictionForBin(db: DatabaseSync, binId: number) {
  const settings = getSystemSettingsMap(db);
  const horizonHours = Number(settings.prediction_horizon_hours || 24);
  const preferredModel =
    settings.default_model === 'Linear Regression'
      ? 'Linear Regression'
      : 'Random Forest Regression';

  const maxDensityRow = db
    .prepare(`SELECT MAX(population_density) as max_d FROM zones`)
    .get() as { max_d: number };
  const maxCityDensity = Number(maxDensityRow?.max_d || 18000);

  const bin = db
    .prepare(
      `SELECT b.*, z.population_density
       FROM waste_bins b
       JOIN zones z ON z.id = b.zone_id
       WHERE b.id = ?`
    )
    .get(binId) as Record<string, unknown> | undefined;

  if (!bin) return null;

  const history = db
    .prepare(
      `SELECT id, bin_id, fill_percentage, source, recorded_at
       FROM fill_level_history
       WHERE bin_id = ?
       ORDER BY recorded_at ASC`
    )
    .all(binId) as unknown as FillHistoryRecord[];

  const result = runBinPrediction({
    binId,
    currentFillLevel: Number(bin.current_fill_level),
    lastCollectionDate: String(bin.last_collection_date),
    zonePopulationDensity: Number(bin.population_density),
    maxCityDensity,
    history,
    horizonHours,
    preferredModel,
  });

  const nowIso = new Date().toISOString();
  db.prepare(
    `INSERT INTO predictions (
      bin_id, predicted_fill_level, estimated_overflow_hours, fill_rate_per_hour,
      risk_score, risk_level, model_name, confidence, mae, rmse,
      lr_mae, lr_rmse, rf_mae, rf_rmse, is_fallback, prediction_date
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    binId,
    result.predictedFillLevel,
    result.estimatedOverflowHours,
    result.fillRatePerHour,
    result.riskScore,
    result.riskLevel,
    result.modelName,
    result.confidence,
    result.mae,
    result.rmse,
    result.lrMetrics.mae,
    result.lrMetrics.rmse,
    result.rfMetrics.mae,
    result.rfMetrics.rmse,
    result.isFallback ? 1 : 0,
    nowIso
  );

  // Keep bin status synchronized
  const newStatus = classifyBinStatus(Number(bin.current_fill_level));
  db.prepare(`UPDATE waste_bins SET status = ? WHERE id = ?`).run(newStatus, binId);

  return result;
}

export function recomputeAllPredictions(db: DatabaseSync) {
  const bins = db.prepare(`SELECT id FROM waste_bins`).all() as { id: number }[];
  const results = [];
  for (const b of bins) {
    const res = recomputePredictionForBin(db, Number(b.id));
    if (res) results.push(res);
  }
  evaluateAndGenerateAlerts(db);
  return results;
}

export function seedDatabaseIfEmpty(db: DatabaseSync): void {
  const userCount = (db.prepare(`SELECT COUNT(*) as cnt FROM users`).get() as { cnt: number }).cnt;
  if (userCount > 0) return;

  const now = new Date();
  const isoAgo = (hoursAgo: number) =>
    new Date(now.getTime() - hoursAgo * 3600 * 1000).toISOString();

  // 1. Seed Users (salted scrypt hashes)
  const insertUser = db.prepare(
    `INSERT INTO users (full_name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)`
  );
  insertUser.run(
    'Dr. Maya Krishnan',
    'admin@metrocycle.gov',
    hashPassword('Admin@123'),
    'Administrator',
    isoAgo(720)
  );
  insertUser.run(
    'Arjun Deshmukh',
    'officer@metrocycle.gov',
    hashPassword('Officer@123'),
    'Waste Management Officer',
    isoAgo(540)
  );
  insertUser.run(
    'Rohan Kulkarni',
    'staff@metrocycle.gov',
    hashPassword('Staff@123'),
    'Collection Staff',
    isoAgo(360)
  );

  // 2. Seed System Settings
  const insertSetting = db.prepare(
    `INSERT INTO system_settings (setting_name, setting_value) VALUES (?, ?)`
  );
  const defaultSettings: [string, string][] = [
    ['refresh_interval_seconds', '30'],
    ['simulation_enabled', 'true'],
    ['high_risk_threshold', '51'],
    ['critical_risk_threshold', '76'],
    ['prediction_horizon_hours', '24'],
    ['fuel_consumption_l_per_km', '0.38'],
    ['default_model', 'Random Forest Regression'],
    ['city_name', 'MetroCycle Municipal District'],
  ];
  for (const [k, v] of defaultSettings) {
    insertSetting.run(k, v);
  }

  // 3. Seed Zones (6 distinct urban districts)
  const zonesSeed = [
    {
      name: 'Central Market District',
      density: 18400,
      area: 4.2,
      desc: 'High-footfall wholesale produce & retail bazaar with rapid organic waste generation.',
    },
    {
      name: 'Riverfront Commercial Hub',
      density: 14200,
      area: 5.8,
      desc: 'Dense hospitality, transit interchange, and mixed office towers along the river corridor.',
    },
    {
      name: 'Tech Park Corridor',
      density: 11600,
      area: 7.4,
      desc: 'Corporate campuses, cafeterias, and electronics R&D clusters.',
    },
    {
      name: 'Old Town Heritage Quarter',
      density: 15900,
      area: 3.6,
      desc: 'Narrow street grid with residential flats, street eateries, and high pedestrian load.',
    },
    {
      name: 'North Residential Sector',
      density: 8400,
      area: 9.1,
      desc: 'Mid-rise apartment blocks, neighborhood parks, and community schools.',
    },
    {
      name: 'Harbor Industrial Zone',
      density: 3600,
      area: 12.5,
      desc: 'Logistics depots, packaging warehouses, and municipal material recovery facilities.',
    },
  ];
  const insertZone = db.prepare(
    `INSERT INTO zones (zone_name, population_density, area, description) VALUES (?, ?, ?, ?)`
  );
  const zoneIds: number[] = [];
  for (const z of zonesSeed) {
    const info = insertZone.run(z.name, z.density, z.area, z.desc);
    zoneIds.push(Number(info.lastInsertRowid));
  }

  // 4. Seed 24 Realistic Waste Bins with coherent GPS grid around 12.9716, 77.5946
  const binsSeed: {
    code: string;
    lat: number;
    lng: number;
    loc: string;
    zoneIdx: number;
    cap: number;
    type: string;
    fill: number;
    lastCollHrs: number;
    ratePerHr: number;
    fewReadings?: boolean;
  }[] = [
    // Central Market District (high fill / critical)
    { code: 'BIN-CM-101', lat: 12.9762, lng: 77.5892, loc: 'Central Produce Gate A', zoneIdx: 0, cap: 660, type: 'Organic', fill: 93, lastCollHrs: 58, ratePerHr: 3.1 },
    { code: 'BIN-CM-102', lat: 12.9748, lng: 77.5914, loc: 'Spice Arcade North', zoneIdx: 0, cap: 660, type: 'General', fill: 86, lastCollHrs: 44, ratePerHr: 2.7 },
    { code: 'BIN-CM-103', lat: 12.9735, lng: 77.5876, loc: 'Wholesale Loading Bay 3', zoneIdx: 0, cap: 1100, type: 'Organic', fill: 78, lastCollHrs: 36, ratePerHr: 2.4 },
    { code: 'BIN-CM-104', lat: 12.9775, lng: 77.5928, loc: 'Market Metro Plaza', zoneIdx: 0, cap: 240, type: 'Recyclable', fill: 64, lastCollHrs: 28, ratePerHr: 1.9 },

    // Riverfront Commercial Hub
    { code: 'BIN-RC-201', lat: 12.9708, lng: 77.5985, loc: 'Riverfront Promenade Pier', zoneIdx: 1, cap: 660, type: 'General', fill: 91, lastCollHrs: 52, ratePerHr: 2.9 },
    { code: 'BIN-RC-202', lat: 12.9694, lng: 77.6012, loc: 'Transit Terminal Concourse', zoneIdx: 1, cap: 1100, type: 'Recyclable', fill: 74, lastCollHrs: 32, ratePerHr: 2.2 },
    { code: 'BIN-RC-203', lat: 12.9722, lng: 77.6031, loc: 'Civic Square Food Court', zoneIdx: 1, cap: 660, type: 'Organic', fill: 83, lastCollHrs: 40, ratePerHr: 2.6 },
    { code: 'BIN-RC-204', lat: 12.9681, lng: 77.5964, loc: 'Financial Tower East', zoneIdx: 1, cap: 360, type: 'Recyclable', fill: 41, lastCollHrs: 18, ratePerHr: 1.4 },

    // Tech Park Corridor
    { code: 'BIN-TP-301', lat: 12.9642, lng: 77.6115, loc: 'Innovation Campus Block B', zoneIdx: 2, cap: 660, type: 'E-Waste', fill: 54, lastCollHrs: 34, ratePerHr: 1.3 },
    { code: 'BIN-TP-302', lat: 12.9625, lng: 77.6148, loc: 'Cyber Commons Cafeteria', zoneIdx: 2, cap: 660, type: 'Organic', fill: 79, lastCollHrs: 38, ratePerHr: 2.3 },
    { code: 'BIN-TP-303', lat: 12.9658, lng: 77.6088, loc: 'East Gate Shuttle Stop', zoneIdx: 2, cap: 240, type: 'General', fill: 36, lastCollHrs: 20, ratePerHr: 1.2 },
    { code: 'BIN-TP-304', lat: 12.9610, lng: 77.6095, loc: 'R&D Lab Annex', zoneIdx: 2, cap: 240, type: 'Hazardous', fill: 28, lastCollHrs: 26, ratePerHr: 0.7 },

    // Old Town Heritage Quarter
    { code: 'BIN-OT-401', lat: 12.9792, lng: 77.5818, loc: 'Clocktower Bazaar Lane', zoneIdx: 3, cap: 360, type: 'General', fill: 89, lastCollHrs: 49, ratePerHr: 2.8 },
    { code: 'BIN-OT-402', lat: 12.9810, lng: 77.5844, loc: 'Artisan Quarter Junction', zoneIdx: 3, cap: 360, type: 'Organic', fill: 71, lastCollHrs: 31, ratePerHr: 2.0 },
    { code: 'BIN-OT-403', lat: 12.9784, lng: 77.5792, loc: 'Heritage School Corner', zoneIdx: 3, cap: 240, type: 'Recyclable', fill: 46, lastCollHrs: 22, ratePerHr: 1.5 },
    { code: 'BIN-OT-404', lat: 12.9825, lng: 77.5811, loc: 'West Bazaar Fountain', zoneIdx: 3, cap: 360, type: 'General', fill: 63, lastCollHrs: 29, ratePerHr: 1.8 },

    // North Residential Sector
    { code: 'BIN-NR-501', lat: 12.9875, lng: 77.5935, loc: 'Cedar Park Avenue', zoneIdx: 4, cap: 360, type: 'General', fill: 34, lastCollHrs: 16, ratePerHr: 1.1 },
    { code: 'BIN-NR-502', lat: 12.9891, lng: 77.5968, loc: 'Lakeside Apartments Gate', zoneIdx: 4, cap: 660, type: 'Organic', fill: 58, lastCollHrs: 26, ratePerHr: 1.6 },
    { code: 'BIN-NR-503', lat: 12.9854, lng: 77.5992, loc: 'Community Clinic Corner', zoneIdx: 4, cap: 240, type: 'Hazardous', fill: 19, lastCollHrs: 14, ratePerHr: 0.6 },
    { code: 'BIN-NR-504', lat: 12.9905, lng: 77.5912, loc: 'North Park Sports Complex', zoneIdx: 4, cap: 360, type: 'Recyclable', fill: 11, lastCollHrs: 6, ratePerHr: 0.9 },

    // Harbor Industrial Zone
    { code: 'BIN-HI-601', lat: 12.9562, lng: 77.5835, loc: 'Freight Depot Terminal 1', zoneIdx: 5, cap: 1100, type: 'General', fill: 68, lastCollHrs: 48, ratePerHr: 1.3 },
    { code: 'BIN-HI-602', lat: 12.9548, lng: 77.5872, loc: 'Packaging Hub South', zoneIdx: 5, cap: 1100, type: 'Recyclable', fill: 44, lastCollHrs: 36, ratePerHr: 1.0 },
    // Two newly installed bins with < 5 readings to exercise fallback estimate transparently
    { code: 'BIN-HI-603', lat: 12.9579, lng: 77.5904, loc: 'Cold Storage Dock 4 (New)', zoneIdx: 5, cap: 660, type: 'Organic', fill: 27, lastCollHrs: 12, ratePerHr: 1.5, fewReadings: true },
    { code: 'BIN-NR-505', lat: 12.9862, lng: 77.5889, loc: 'Oakridge Community Annex (New)', zoneIdx: 4, cap: 240, type: 'General', fill: 22, lastCollHrs: 10, ratePerHr: 1.2, fewReadings: true },
  ];

  const insertBin = db.prepare(
    `INSERT INTO waste_bins (
      bin_code, latitude, longitude, location, zone_id, capacity, waste_type,
      current_fill_level, last_collection_date, status, reading_source, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'simulated', ?)`
  );

  const insertHistory = db.prepare(
    `INSERT INTO fill_level_history (bin_id, fill_percentage, source, recorded_at) VALUES (?, ?, 'simulated', ?)`
  );

  const binIds: { id: number; cap: number; zoneIdx: number; fill: number }[] = [];

  for (let bIdx = 0; bIdx < binsSeed.length; bIdx++) {
    const b = binsSeed[bIdx];
    const zId = zoneIds[b.zoneIdx];
    const lastColl = isoAgo(b.lastCollHrs);
    const status = classifyBinStatus(b.fill);
    const info = insertBin.run(
      b.code,
      b.lat,
      b.lng,
      b.loc,
      zId,
      b.cap,
      b.type,
      b.fill,
      lastColl,
      status,
      isoAgo(480)
    );
    const binId = Number(info.lastInsertRowid);
    binIds.push({ id: binId, cap: b.cap, zoneIdx: b.zoneIdx, fill: b.fill });

    if (b.fewReadings) {
      // Only 2 readings so insufficient-history fallback activates cleanly
      insertHistory.run(binId, Math.max(5, Math.round(b.fill - b.ratePerHr * 6)), isoAgo(6));
      insertHistory.run(binId, b.fill, isoAgo(0.2));
    } else {
      // Generate 28 historical readings spanning 10 days with realistic sawtooth collection cycles
      const points = 28;
      const activeCycleHrs = Math.max(8, (b.fill - 6) / Math.max(0.5, b.ratePerHr));
      const cycleLen = Math.max(24, Math.round(90 / Math.max(0.5, b.ratePerHr)));
      for (let p = points - 1; p >= 0; p--) {
        const hrsAgo = p * 6;
        let simFill: number;
        if (hrsAgo <= activeCycleHrs) {
          const hrsInCycle = activeCycleHrs - hrsAgo;
          const jitter = Math.sin(p * 1.7 + bIdx) * 1.2;
          simFill = Math.max(
            4,
            Math.min(100, Math.round((6 + hrsInCycle * b.ratePerHr + jitter) * 10) / 10)
          );
          if (p === 0) simFill = b.fill;
        } else {
          const prevHrsAgo = hrsAgo - activeCycleHrs;
          const posInPrevCycle = cycleLen - (prevHrsAgo % cycleLen);
          const jitter = Math.cos(p * 1.3 + bIdx) * 1.4;
          simFill = Math.max(
            6,
            Math.min(95, Math.round((6 + posInPrevCycle * b.ratePerHr * 0.92 + jitter) * 10) / 10)
          );
        }
        insertHistory.run(binId, simFill, isoAgo(hrsAgo));
      }
    }
  }

  // 5. Seed 6 Municipal Collection Vehicles
  const insertVehicle = db.prepare(
    `INSERT INTO vehicles (
      vehicle_number, vehicle_type, capacity, current_load, availability_status, assigned_zone, depot_lat, depot_lng
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const vehiclesSeed: [string, string, number, number, string, number | null, number, number][] = [
    ['MC-TRK-01', 'Heavy Compactor Truck', 5500, 420, 'Available', zoneIds[0], 12.9740, 77.5900],
    ['MC-TRK-02', 'Heavy Compactor Truck', 5500, 310, 'Available', zoneIds[1], 12.9700, 77.5990],
    ['MC-EV-03', 'Electric Side Loader', 2600, 180, 'Available', zoneIds[2], 12.9640, 77.6080],
    ['MC-MINI-04', 'Narrow-Lane Mini Tipper', 1800, 120, 'Available', zoneIds[3], 12.9790, 77.5830],
    ['MC-TRK-05', 'Dual-Stream Compactor', 4500, 0, 'Maintenance', zoneIds[4], 12.9860, 77.5940],
    ['MC-HAZ-06', 'Hazmat & E-Waste Van', 1600, 90, 'Available', zoneIds[5], 12.9580, 77.5880],
  ];
  const vehicleIds: number[] = [];
  for (const v of vehiclesSeed) {
    const info = insertVehicle.run(...v);
    vehicleIds.push(Number(info.lastInsertRowid));
  }

  // 6. Seed 30-day Historical Collection Records for rich Daily/Weekly/Monthly Analytics
  const insertRecord = db.prepare(
    `INSERT INTO collection_records (
      bin_id, vehicle_id, collected_quantity, collection_status, collection_date, remarks
    ) VALUES (?, ?, ?, 'Completed', ?, ?)`
  );

  for (let dayOffset = 28; dayOffset >= 0; dayOffset--) {
    const pickupsToday = dayOffset === 0 ? 3 : 3 + (dayOffset % 3);
    for (let k = 0; k < pickupsToday; k++) {
      const binEntry = binIds[(dayOffset * 3 + k) % binIds.length];
      const vehId = vehicleIds[(dayOffset + k) % 4]; // Active fleet trucks
      const qty = Math.round((binEntry.cap * (0.55 + ((dayOffset + k) % 4) * 0.08) * 0.35) * 10) / 10;
      const dateIso = new Date(
        now.getTime() - dayOffset * 86400 * 1000 - (k + 1) * 2 * 3600 * 1000
      ).toISOString();
      insertRecord.run(
        binEntry.id,
        vehId,
        qty,
        dateIso,
        dayOffset === 0 ? 'Morning shift routine haul' : 'Scheduled municipal collection'
      );
    }
  }

  // 7. Run ML Prediction Engine, Risk Evaluation, Alerts, and Priority Queue Schedule
  recomputeAllPredictions(db);
  generatePriorityCollectionSchedule(db, 51);
  evaluateAndGenerateAlerts(db);
}

export function createDatabaseBackup(): { filename: string; path: string; sizeBytes: number; createdAt: string } {
  const db = getDb();
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
  db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `urban_waste_backup_${stamp}.db`;
  const destPath = path.join(BACKUP_DIR, filename);
  fs.copyFileSync(DB_PATH, destPath);
  const stat = fs.statSync(destPath);
  return {
    filename,
    path: destPath,
    sizeBytes: stat.size,
    createdAt: new Date().toISOString(),
  };
}

export function listDatabaseBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  const files = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith('.db'))
    .sort()
    .reverse();

  return files.map((filename) => {
    const full = path.join(BACKUP_DIR, filename);
    const stat = fs.statSync(full);
    return {
      filename,
      sizeBytes: stat.size,
      createdAt: stat.mtime.toISOString(),
    };
  });
}

export function restoreDatabaseBackup(filename: string): boolean {
  const safeName = path.basename(filename);
  const srcPath = path.join(BACKUP_DIR, safeName);
  if (!fs.existsSync(srcPath)) {
    throw new Error('Backup file not found');
  }
  const header = Buffer.alloc(16);
  const fd = fs.openSync(srcPath, 'r');
  fs.readSync(fd, header, 0, 16, 0);
  fs.closeSync(fd);
  if (!header.toString('utf8', 0, 15).startsWith('SQLite format 3')) {
    throw new Error('Invalid SQLite database backup file');
  }

  closeDb();
  // Remove WAL/SHM sidecars if present before restoring main DB
  for (const suffix of ['-wal', '-shm']) {
    if (fs.existsSync(DB_PATH + suffix)) {
      fs.unlinkSync(DB_PATH + suffix);
    }
  }
  fs.copyFileSync(srcPath, DB_PATH);
  getDb(); // Re-open and verify schema
  return true;
}
