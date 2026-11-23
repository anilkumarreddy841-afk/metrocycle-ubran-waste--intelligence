import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { evaluateAndGenerateAlerts } from './alerts.ts';
import { askWasteGuardAI } from './ai_assistant.ts';
import { getDashboardSummary, getFullAnalytics } from './analytics.ts';
import {
  clearSessionCookie,
  createAuthMiddleware,
  hashPassword,
  logAudit,
  rateLimit,
  requireRole,
  setSessionCookie,
  signSessionToken,
  verifyPassword,
} from './auth.ts';
import {
  BACKUP_DIR,
  createDatabaseBackup,
  DB_PATH,
  getSystemSettingsMap,
  listDatabaseBackups,
  recomputeAllPredictions,
  recomputePredictionForBin,
  restoreDatabaseBackup,
} from './database.ts';
import { runBinPrediction } from './prediction.ts';
import {
  buildPriorityQueue,
  estimateWasteMassKg,
  generatePriorityCollectionSchedule,
} from './priority_queue.ts';
import { buildReport, reportToCsv, type ReportType } from './reports.ts';
import { classifyBinStatus } from './risk_engine.ts';
import { optimizeVehicleRoute, type GeoStop } from './route_optimizer.ts';
import type { FillHistoryRecord, ReadingSource, UserRole, VehicleStatus } from './types.ts';

function isValidNumber(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
}

export function createApiRouter(getDb: () => DatabaseSync) {
  const router = express.Router();
  const requireAuth = (req: express.Request, res: express.Response, next: express.NextFunction) =>
    createAuthMiddleware(getDb())(req, res, next);

  router.get('/health', (_req, res) => {
    try {
      const db = getDb();
      const row = db.prepare(`SELECT COUNT(*) as bins FROM waste_bins`).get() as { bins: number };
      res.json({ status: 'ok', database: 'sqlite', binsCount: row.bins, timestamp: new Date().toISOString() });
    } catch (err) {
      res.status(500).json({ status: 'error', message: err instanceof Error ? err.message : 'DB error' });
    }
  });

  // ─────────────────────────────────────────────────────────────
  // AUTHENTICATION & PROFILE
  // ─────────────────────────────────────────────────────────────
  router.post('/auth/login', rateLimit(25, 60_000), (req, res) => {
    const db = getDb();
    const { email, password } = req.body as { email?: string; password?: string };
    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required.' });
      return;
    }

    const user = db
      .prepare(`SELECT id, full_name, email, password_hash, role, created_at FROM users WHERE lower(email) = lower(?)`)
      .get(email.trim()) as
      | { id: number; full_name: string; email: string; password_hash: string; role: UserRole; created_at: string }
      | undefined;

    if (!user || !verifyPassword(password, user.password_hash)) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    const token = signSessionToken({
      userId: user.id,
      email: user.email,
      fullName: user.full_name,
      role: user.role,
    });
    setSessionCookie(res, token, req);
    logAudit(
      db,
      { userId: user.id, email: user.email, fullName: user.full_name, role: user.role, exp: 0 },
      'LOGIN',
      'user',
      user.id,
      'User signed in'
    );

    res.json({
      token,
      user: {
        id: user.id,
        fullName: user.full_name,
        email: user.email,
        role: user.role,
        createdAt: user.created_at,
      },
    });
  });

  router.post('/auth/logout', (req, res) => {
    clearSessionCookie(res, req);
    res.json({ ok: true });
  });

  router.get('/auth/me', requireAuth, (req, res) => {
    const db = getDb();
    const user = db
      .prepare(`SELECT id, full_name, email, role, created_at FROM users WHERE id = ?`)
      .get(req.user!.userId) as Record<string, unknown> | undefined;
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json({
      id: user.id,
      fullName: user.full_name,
      email: user.email,
      role: user.role,
      createdAt: user.created_at,
    });
  });

  router.put('/auth/profile', requireAuth, (req, res) => {
    const db = getDb();
    const { fullName, email } = req.body as { fullName?: string; email?: string };
    if (!fullName?.trim() || !email?.trim()) {
      res.status(400).json({ error: 'Full name and email are required.' });
      return;
    }
    try {
      db.prepare(`UPDATE users SET full_name = ?, email = ? WHERE id = ?`).run(
        fullName.trim(),
        email.trim().toLowerCase(),
        req.user!.userId
      );
      logAudit(db, req.user, 'UPDATE_PROFILE', 'user', req.user!.userId, `Updated profile for ${email}`);
      res.json({ id: req.user!.userId, fullName: fullName.trim(), email: email.trim().toLowerCase(), role: req.user!.role });
    } catch {
      res.status(409).json({ error: 'Email address is already in use.' });
    }
  });

  router.post('/auth/change-password', requireAuth, (req, res) => {
    const db = getDb();
    const { currentPassword, newPassword } = req.body as { currentPassword?: string; newPassword?: string };
    if (!currentPassword || !newPassword || newPassword.length < 6) {
      res.status(400).json({ error: 'Current password and a new password (min 6 chars) are required.' });
      return;
    }
    const row = db
      .prepare(`SELECT password_hash FROM users WHERE id = ?`)
      .get(req.user!.userId) as { password_hash: string } | undefined;
    if (!row || !verifyPassword(currentPassword, row.password_hash)) {
      res.status(400).json({ error: 'Current password is incorrect.' });
      return;
    }
    db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(
      hashPassword(newPassword),
      req.user!.userId
    );
    logAudit(db, req.user, 'CHANGE_PASSWORD', 'user', req.user!.userId, 'Password updated');
    res.json({ ok: true });
  });

  // ─────────────────────────────────────────────────────────────
  // USER MANAGEMENT (Administrator only)
  // ─────────────────────────────────────────────────────────────
  router.get('/users', requireAuth, requireRole(['Administrator']), (_req, res) => {
    const db = getDb();
    const users = db
      .prepare(`SELECT id, full_name, email, role, created_at FROM users ORDER BY id ASC`)
      .all();
    res.json({ users });
  });

  router.post('/users', requireAuth, requireRole(['Administrator']), (req, res) => {
    const db = getDb();
    const { fullName, email, password, role } = req.body as {
      fullName?: string;
      email?: string;
      password?: string;
      role?: UserRole;
    };
    const validRoles: UserRole[] = ['Administrator', 'Waste Management Officer', 'Collection Staff'];
    if (!fullName?.trim() || !email?.trim() || !password || password.length < 6 || !role || !validRoles.includes(role)) {
      res.status(400).json({ error: 'Valid full name, email, password (min 6 chars), and role are required.' });
      return;
    }
    try {
      const info = db
        .prepare(`INSERT INTO users (full_name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)`)
        .run(fullName.trim(), email.trim().toLowerCase(), hashPassword(password), role, new Date().toISOString());
      logAudit(db, req.user, 'CREATE_USER', 'user', String(info.lastInsertRowid), `Created ${role} ${email}`);
      res.status(201).json({ id: Number(info.lastInsertRowid), full_name: fullName.trim(), email: email.trim().toLowerCase(), role });
    } catch {
      res.status(409).json({ error: 'A user with this email already exists.' });
    }
  });

  router.put('/users/:id', requireAuth, requireRole(['Administrator']), (req, res) => {
    const db = getDb();
    const id = Number(req.params.id);
    const { fullName, role, password } = req.body as { fullName?: string; role?: UserRole; password?: string };
    const existing = db.prepare(`SELECT id, email FROM users WHERE id = ?`).get(id) as { id: number; email: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    if (fullName?.trim()) {
      db.prepare(`UPDATE users SET full_name = ? WHERE id = ?`).run(fullName.trim(), id);
    }
    if (role && ['Administrator', 'Waste Management Officer', 'Collection Staff'].includes(role)) {
      db.prepare(`UPDATE users SET role = ? WHERE id = ?`).run(role, id);
    }
    if (password && password.length >= 6) {
      db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(hashPassword(password), id);
    }
    logAudit(db, req.user, 'UPDATE_USER', 'user', id, `Updated user ${existing.email}`);
    res.json({ ok: true });
  });

  router.delete('/users/:id', requireAuth, requireRole(['Administrator']), (req, res) => {
    const db = getDb();
    const id = Number(req.params.id);
    if (id === req.user!.userId) {
      res.status(400).json({ error: 'You cannot delete your own active administrator account.' });
      return;
    }
    const info = db.prepare(`DELETE FROM users WHERE id = ?`).run(id);
    if (info.changes === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    logAudit(db, req.user, 'DELETE_USER', 'user', id, 'Deleted user account');
    res.json({ ok: true });
  });

  // ─────────────────────────────────────────────────────────────
  // ZONES
  // ─────────────────────────────────────────────────────────────
  router.get('/zones', requireAuth, (_req, res) => {
    const db = getDb();
    const zones = db
      .prepare(
        `SELECT
          z.*,
          COUNT(b.id) as bin_count,
          ROUND(COALESCE(AVG(b.current_fill_level), 0), 1) as avg_fill_level,
          ROUND(COALESCE(AVG(COALESCE(p.risk_score, b.current_fill_level)), 0), 1) as avg_risk_score
        FROM zones z
        LEFT JOIN waste_bins b ON b.zone_id = z.id
        LEFT JOIN predictions p ON p.id = (
          SELECT p2.id FROM predictions p2 WHERE p2.bin_id = b.id ORDER BY p2.id DESC LIMIT 1
        )
        GROUP BY z.id
        ORDER BY z.zone_name ASC`
      )
      .all();
    res.json({ zones });
  });

  router.post('/zones', requireAuth, requireRole(['Administrator', 'Waste Management Officer']), (req, res) => {
    const db = getDb();
    const { zoneName, populationDensity, area, description } = req.body as {
      zoneName?: string;
      populationDensity?: number;
      area?: number;
      description?: string;
    };
    if (!zoneName?.trim() || !isValidNumber(Number(populationDensity), 1, 500000) || !isValidNumber(Number(area), 0.1, 10000)) {
      res.status(400).json({ error: 'Valid zone name, population density (>0), and area (>0) are required.' });
      return;
    }
    try {
      const info = db
        .prepare(`INSERT INTO zones (zone_name, population_density, area, description) VALUES (?, ?, ?, ?)`)
        .run(zoneName.trim(), Number(populationDensity), Number(area), (description || '').trim());
      recomputeAllPredictions(db);
      logAudit(db, req.user, 'CREATE_ZONE', 'zone', String(info.lastInsertRowid), `Added zone ${zoneName}`);
      res.status(201).json({ id: Number(info.lastInsertRowid) });
    } catch {
      res.status(409).json({ error: 'Zone name already exists.' });
    }
  });

  router.put('/zones/:id', requireAuth, requireRole(['Administrator', 'Waste Management Officer']), (req, res) => {
    const db = getDb();
    const id = Number(req.params.id);
    const { zoneName, populationDensity, area, description } = req.body as {
      zoneName?: string;
      populationDensity?: number;
      area?: number;
      description?: string;
    };
    if (!zoneName?.trim() || !isValidNumber(Number(populationDensity), 1, 500000) || !isValidNumber(Number(area), 0.1, 10000)) {
      res.status(400).json({ error: 'Invalid zone parameters.' });
      return;
    }
    try {
      const info = db
        .prepare(`UPDATE zones SET zone_name = ?, population_density = ?, area = ?, description = ? WHERE id = ?`)
        .run(zoneName.trim(), Number(populationDensity), Number(area), (description || '').trim(), id);
      if (info.changes === 0) {
        res.status(404).json({ error: 'Zone not found' });
        return;
      }
      recomputeAllPredictions(db);
      logAudit(db, req.user, 'UPDATE_ZONE', 'zone', id, `Updated zone ${zoneName}`);
      res.json({ ok: true });
    } catch {
      res.status(409).json({ error: 'Zone name conflict.' });
    }
  });

  router.delete('/zones/:id', requireAuth, requireRole(['Administrator', 'Waste Management Officer']), (req, res) => {
    const db = getDb();
    const id = Number(req.params.id);
    const refs = db.prepare(`SELECT COUNT(*) as cnt FROM waste_bins WHERE zone_id = ?`).get(id) as { cnt: number };
    if (refs.cnt > 0) {
      res.status(409).json({ error: `Cannot delete zone: ${refs.cnt} waste bin(s) are currently assigned to it.` });
      return;
    }
    const info = db.prepare(`DELETE FROM zones WHERE id = ?`).run(id);
    if (info.changes === 0) {
      res.status(404).json({ error: 'Zone not found' });
      return;
    }
    logAudit(db, req.user, 'DELETE_ZONE', 'zone', id, 'Deleted zone');
    res.json({ ok: true });
  });

  // ─────────────────────────────────────────────────────────────
  // WASTE BINS & FILL LEVEL MONITORING
  // ─────────────────────────────────────────────────────────────
  router.get('/bins', requireAuth, (req, res) => {
    const db = getDb();
    const search = String(req.query.search || '').trim().toLowerCase();
    const zoneId = req.query.zone_id ? Number(req.query.zone_id) : null;
    const status = String(req.query.status || '').trim();
    const riskLevel = String(req.query.risk_level || '').trim();

    let sql = `
      SELECT
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
        p.prediction_date,
        (SELECT COUNT(*) FROM fill_level_history h WHERE h.bin_id = b.id) as reading_count
      FROM waste_bins b
      JOIN zones z ON z.id = b.zone_id
      LEFT JOIN predictions p ON p.id = (
        SELECT p2.id FROM predictions p2
        WHERE p2.bin_id = b.id
        ORDER BY p2.prediction_date DESC, p2.id DESC
        LIMIT 1
      )
      WHERE 1=1
    `;
    const params: unknown[] = [];

    if (zoneId) {
      sql += ` AND b.zone_id = ?`;
      params.push(zoneId);
    }
    if (status) {
      sql += ` AND b.status = ?`;
      params.push(status);
    }
    if (riskLevel) {
      sql += ` AND COALESCE(p.risk_level, 'LOW') = ?`;
      params.push(riskLevel);
    }
    if (search) {
      sql += ` AND (lower(b.bin_code) LIKE ? OR lower(b.location) LIKE ? OR lower(z.zone_name) LIKE ? OR lower(b.waste_type) LIKE ?)`;
      const pat = `%${search}%`;
      params.push(pat, pat, pat, pat);
    }

    sql += ` ORDER BY COALESCE(p.risk_score, b.current_fill_level) DESC, b.id ASC`;
    const bins = db.prepare(sql).all(...params);
    res.json({ bins });
  });

  router.get('/bins/:id', requireAuth, (req, res) => {
    const db = getDb();
    const id = Number(req.params.id);
    const bin = db
      .prepare(
        `SELECT b.*, z.zone_name, z.population_density
         FROM waste_bins b
         JOIN zones z ON z.id = b.zone_id
         WHERE b.id = ?`
      )
      .get(id) as Record<string, unknown> | undefined;

    if (!bin) {
      res.status(404).json({ error: 'Bin not found' });
      return;
    }

    const history = db
      .prepare(`SELECT * FROM fill_level_history WHERE bin_id = ? ORDER BY recorded_at ASC`)
      .all(id) as unknown as FillHistoryRecord[];

    const latestPrediction = db
      .prepare(`SELECT * FROM predictions WHERE bin_id = ? ORDER BY prediction_date DESC, id DESC LIMIT 1`)
      .get(id);

    const collections = db
      .prepare(
        `SELECT cr.*, v.vehicle_number
         FROM collection_records cr
         JOIN vehicles v ON v.id = cr.vehicle_id
         WHERE cr.bin_id = ?
         ORDER BY cr.collection_date DESC
         LIMIT 20`
      )
      .all(id);

    const settings = getSystemSettingsMap(db);
    const maxD = Number(
      (db.prepare(`SELECT MAX(population_density) as m FROM zones`).get() as { m: number })?.m || 18000
    );
    const analysis = runBinPrediction({
      binId: id,
      currentFillLevel: Number(bin.current_fill_level),
      lastCollectionDate: String(bin.last_collection_date),
      zonePopulationDensity: Number(bin.population_density),
      maxCityDensity: maxD,
      history,
      horizonHours: Number(settings.prediction_horizon_hours || 24),
      preferredModel:
        settings.default_model === 'Linear Regression' ? 'Linear Regression' : 'Random Forest Regression',
    });

    res.json({ bin, history, latestPrediction, analysis, collections });
  });

  router.post('/bins', requireAuth, requireRole(['Administrator', 'Waste Management Officer']), (req, res) => {
    const db = getDb();
    const {
      binCode,
      latitude,
      longitude,
      location,
      zoneId,
      capacity,
      wasteType,
      currentFillLevel,
      readingSource,
    } = req.body as Record<string, unknown>;

    const code = String(binCode || '').trim().toUpperCase();
    const lat = Number(latitude);
    const lng = Number(longitude);
    const cap = Number(capacity);
    const fill = Number(currentFillLevel ?? 0);
    const zId = Number(zoneId);
    const source: ReadingSource =
      readingSource === 'simulated' ? 'simulated' : readingSource === 'csv_import' ? 'csv_import' : 'manual';

    if (
      !code ||
      !String(location || '').trim() ||
      !isValidNumber(lat, -90, 90) ||
      !isValidNumber(lng, -180, 180) ||
      !isValidNumber(cap, 10, 50000) ||
      !isValidNumber(fill, 0, 100) ||
      !zId
    ) {
      res.status(400).json({ error: 'Invalid bin data. Check bin code, GPS coordinates, capacity, zone, and fill (0-100%).' });
      return;
    }

    const zone = db.prepare(`SELECT id FROM zones WHERE id = ?`).get(zId);
    if (!zone) {
      res.status(400).json({ error: 'Selected zone does not exist.' });
      return;
    }

    const nowIso = new Date().toISOString();
    const status = classifyBinStatus(fill);
    try {
      const info = db
        .prepare(
          `INSERT INTO waste_bins (
            bin_code, latitude, longitude, location, zone_id, capacity, waste_type,
            current_fill_level, last_collection_date, status, reading_source, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          code,
          lat,
          lng,
          String(location).trim(),
          zId,
          cap,
          String(wasteType || 'General').trim(),
          fill,
          nowIso,
          status,
          source,
          nowIso
        );
      const binId = Number(info.lastInsertRowid);
      db.prepare(`INSERT INTO fill_level_history (bin_id, fill_percentage, source, recorded_at) VALUES (?, ?, ?, ?)`).run(
        binId,
        fill,
        source,
        nowIso
      );

      recomputePredictionForBin(db, binId);
      evaluateAndGenerateAlerts(db);
      logAudit(db, req.user, 'CREATE_BIN', 'waste_bin', binId, `Registered bin ${code}`);

      res.status(201).json({ id: binId, bin_code: code });
    } catch {
      res.status(409).json({ error: `Duplicate bin ID "${code}". Bin codes must be unique.` });
    }
  });

  router.put('/bins/:id', requireAuth, requireRole(['Administrator', 'Waste Management Officer']), (req, res) => {
    const db = getDb();
    const id = Number(req.params.id);
    const {
      binCode,
      latitude,
      longitude,
      location,
      zoneId,
      capacity,
      wasteType,
      currentFillLevel,
    } = req.body as Record<string, unknown>;

    const existing = db.prepare(`SELECT * FROM waste_bins WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Bin not found' });
      return;
    }

    const code = String(binCode ?? existing.bin_code).trim().toUpperCase();
    const lat = latitude !== undefined ? Number(latitude) : Number(existing.latitude);
    const lng = longitude !== undefined ? Number(longitude) : Number(existing.longitude);
    const loc = String(location ?? existing.location).trim();
    const zId = zoneId !== undefined ? Number(zoneId) : Number(existing.zone_id);
    const cap = capacity !== undefined ? Number(capacity) : Number(existing.capacity);
    const fill = currentFillLevel !== undefined ? Number(currentFillLevel) : Number(existing.current_fill_level);
    const wType = String(wasteType ?? existing.waste_type).trim();

    if (
      !code ||
      !loc ||
      !isValidNumber(lat, -90, 90) ||
      !isValidNumber(lng, -180, 180) ||
      !isValidNumber(cap, 10, 50000) ||
      !isValidNumber(fill, 0, 100)
    ) {
      res.status(400).json({ error: 'Invalid bin parameters.' });
      return;
    }

    try {
      const status = classifyBinStatus(fill);
      db.prepare(
        `UPDATE waste_bins
         SET bin_code = ?, latitude = ?, longitude = ?, location = ?, zone_id = ?, capacity = ?, waste_type = ?, current_fill_level = ?, status = ?
         WHERE id = ?`
      ).run(code, lat, lng, loc, zId, cap, wType, fill, status, id);

      if (currentFillLevel !== undefined && Number(currentFillLevel) !== Number(existing.current_fill_level)) {
        db.prepare(`INSERT INTO fill_level_history (bin_id, fill_percentage, source, recorded_at) VALUES (?, ?, 'manual', ?)`).run(
          id,
          fill,
          new Date().toISOString()
        );
      }

      recomputePredictionForBin(db, id);
      evaluateAndGenerateAlerts(db);
      logAudit(db, req.user, 'UPDATE_BIN', 'waste_bin', id, `Updated bin ${code}`);
      res.json({ ok: true });
    } catch {
      res.status(409).json({ error: `Duplicate bin code "${code}".` });
    }
  });

  router.delete('/bins/:id', requireAuth, requireRole(['Administrator', 'Waste Management Officer']), (req, res) => {
    const db = getDb();
    const id = Number(req.params.id);
    const info = db.prepare(`DELETE FROM waste_bins WHERE id = ?`).run(id);
    if (info.changes === 0) {
      res.status(404).json({ error: 'Bin not found' });
      return;
    }
    logAudit(db, req.user, 'DELETE_BIN', 'waste_bin', id, 'Deleted waste bin');
    res.json({ ok: true });
  });

  router.post('/bins/:id/readings', requireAuth, (req, res) => {
    const db = getDb();
    const id = Number(req.params.id);
    const { fillPercentage, source, recordedAt } = req.body as {
      fillPercentage?: number;
      source?: ReadingSource;
      recordedAt?: string;
    };
    const fill = Number(fillPercentage);
    if (!isValidNumber(fill, 0, 100)) {
      res.status(400).json({ error: 'Fill percentage must be between 0 and 100.' });
      return;
    }
    const existing = db.prepare(`SELECT id, bin_code FROM waste_bins WHERE id = ?`).get(id) as
      | { id: number; bin_code: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Bin not found' });
      return;
    }

    const src: ReadingSource = source === 'simulated' ? 'simulated' : source === 'csv_import' ? 'csv_import' : 'manual';
    const ts = recordedAt && !Number.isNaN(Date.parse(recordedAt)) ? new Date(recordedAt).toISOString() : new Date().toISOString();
    const status = classifyBinStatus(fill);

    db.prepare(`INSERT INTO fill_level_history (bin_id, fill_percentage, source, recorded_at) VALUES (?, ?, ?, ?)`).run(
      id,
      fill,
      src,
      ts
    );
    db.prepare(`UPDATE waste_bins SET current_fill_level = ?, status = ?, reading_source = ? WHERE id = ?`).run(
      fill,
      status,
      src,
      id
    );

    const prediction = recomputePredictionForBin(db, id);
    const newAlerts = evaluateAndGenerateAlerts(db);
    logAudit(db, req.user, 'RECORD_FILL_READING', 'waste_bin', id, `Logged ${fill}% (${src}) for ${existing.bin_code}`);

    res.status(201).json({ ok: true, prediction, newAlerts });
  });

  router.post('/bins/import', requireAuth, requireRole(['Administrator', 'Waste Management Officer']), (req, res) => {
    const db = getDb();
    const { rows } = req.body as { rows?: Record<string, unknown>[] };
    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(400).json({ error: 'Provide an array of parsed CSV/Excel rows.' });
      return;
    }

    const zones = db.prepare(`SELECT id, zone_name FROM zones`).all() as { id: number; zone_name: string }[];
    const defaultZoneId = zones[0]?.id;
    if (!defaultZoneId) {
      res.status(400).json({ error: 'Create at least one zone before importing bins.' });
      return;
    }

    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    const touchedIds: number[] = [];
    const nowIso = new Date().toISOString();

    for (const raw of rows) {
      const code = String(raw.bin_code || raw.binCode || raw['Bin ID'] || '').trim().toUpperCase();
      const fill = Number(raw.fill_percentage ?? raw.current_fill_level ?? raw.fill ?? 0);
      if (!code || !isValidNumber(fill, 0, 100)) {
        skipped++;
        continue;
      }

      const existing = db.prepare(`SELECT id FROM waste_bins WHERE bin_code = ?`).get(code) as { id: number } | undefined;
      if (existing) {
        db.prepare(`UPDATE waste_bins SET current_fill_level = ?, status = ?, reading_source = 'csv_import' WHERE id = ?`).run(
          fill,
          classifyBinStatus(fill),
          existing.id
        );
        db.prepare(`INSERT INTO fill_level_history (bin_id, fill_percentage, source, recorded_at) VALUES (?, ?, 'csv_import', ?)`).run(
          existing.id,
          fill,
          nowIso
        );
        touchedIds.push(existing.id);
        updated++;
      } else {
        const lat = Number(raw.latitude ?? 12.9716);
        const lng = Number(raw.longitude ?? 77.5946);
        const cap = Number(raw.capacity ?? 240);
        const loc = String(raw.location || `Imported Location (${code})`).trim();
        const wType = String(raw.waste_type || raw.wasteType || 'General').trim();
        const zoneName = String(raw.zone_name || raw.zone || '').trim().toLowerCase();
        const matchedZone = zones.find((z) => z.zone_name.toLowerCase() === zoneName)?.id ?? defaultZoneId;

        if (!isValidNumber(lat, -90, 90) || !isValidNumber(lng, -180, 180) || !isValidNumber(cap, 10, 50000)) {
          skipped++;
          continue;
        }

        const info = db
          .prepare(
            `INSERT INTO waste_bins (
              bin_code, latitude, longitude, location, zone_id, capacity, waste_type,
              current_fill_level, last_collection_date, status, reading_source, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'csv_import', ?)`
          )
          .run(code, lat, lng, loc, matchedZone, cap, wType, fill, nowIso, classifyBinStatus(fill), nowIso);
        const binId = Number(info.lastInsertRowid);
        db.prepare(`INSERT INTO fill_level_history (bin_id, fill_percentage, source, recorded_at) VALUES (?, ?, 'csv_import', ?)`).run(
          binId,
          fill,
          nowIso
        );
        touchedIds.push(binId);
        inserted++;
      }
    }

    for (const id of touchedIds) {
      recomputePredictionForBin(db, id);
    }
    evaluateAndGenerateAlerts(db);
    logAudit(db, req.user, 'IMPORT_CSV_EXCEL', 'waste_bin', 'batch', `Imported ${inserted} new, ${updated} updated, ${skipped} skipped`);

    res.json({ inserted, updated, skipped });
  });

  router.post('/bins/simulate-tick', requireAuth, (req, res) => {
    const db = getDb();
    const bins = db
      .prepare(
        `SELECT b.id, b.current_fill_level, z.population_density
         FROM waste_bins b
         JOIN zones z ON z.id = b.zone_id`
      )
      .all() as { id: number; current_fill_level: number; population_density: number }[];

    const nowIso = new Date().toISOString();
    let updated = 0;

    for (const b of bins) {
      // Advance simulated fill modestly (0.5% - 2.8%) proportional to zone density
      const densityFactor = Math.min(2.2, Math.max(0.6, b.population_density / 10000));
      const delta = Math.round((0.6 + ((b.id * 7 + Date.now()) % 13) * 0.14 * densityFactor) * 10) / 10;
      const nextFill = Math.min(100, Math.round((b.current_fill_level + delta) * 10) / 10);

      if (nextFill !== b.current_fill_level) {
        db.prepare(
          `UPDATE waste_bins SET current_fill_level = ?, status = ?, reading_source = 'simulated' WHERE id = ?`
        ).run(nextFill, classifyBinStatus(nextFill), b.id);
        db.prepare(
          `INSERT INTO fill_level_history (bin_id, fill_percentage, source, recorded_at) VALUES (?, ?, 'simulated', ?)`
        ).run(b.id, nextFill, nowIso);
        updated++;
      }
    }

    recomputeAllPredictions(db);
    const alertsCreated = evaluateAndGenerateAlerts(db);
    res.json({ updatedBins: updated, alertsCreated, source: 'simulated', timestamp: nowIso });
  });

  router.get('/fill-history', requireAuth, (req, res) => {
    const db = getDb();
    const binId = req.query.bin_id ? Number(req.query.bin_id) : null;
    const limit = Math.min(300, Number(req.query.limit || 100));

    let sql = `
      SELECT h.*, b.bin_code, b.location, z.zone_name
      FROM fill_level_history h
      JOIN waste_bins b ON b.id = h.bin_id
      JOIN zones z ON z.id = b.zone_id
    `;
    const params: unknown[] = [];
    if (binId) {
      sql += ` WHERE h.bin_id = ?`;
      params.push(binId);
    }
    sql += ` ORDER BY h.recorded_at DESC, h.id DESC LIMIT ?`;
    params.push(limit);

    const history = db.prepare(sql).all(...params);
    res.json({ history });
  });

  // ─────────────────────────────────────────────────────────────
  // AI PREDICTIONS & RISK ASSESSMENT
  // ─────────────────────────────────────────────────────────────
  router.get('/predictions', requireAuth, (_req, res) => {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT
          b.id as bin_id,
          b.bin_code,
          b.location,
          b.waste_type,
          b.capacity,
          b.current_fill_level,
          b.last_collection_date,
          b.status,
          b.reading_source,
          z.zone_name,
          z.population_density,
          p.*,
          (SELECT COUNT(*) FROM fill_level_history h WHERE h.bin_id = b.id) as history_count
        FROM waste_bins b
        JOIN zones z ON z.id = b.zone_id
        LEFT JOIN predictions p ON p.id = (
          SELECT p2.id FROM predictions p2 WHERE p2.bin_id = b.id ORDER BY p2.prediction_date DESC, p2.id DESC LIMIT 1
        )
        ORDER BY COALESCE(p.risk_score, 0) DESC`
      )
      .all() as Record<string, unknown>[];

    const mlRows = rows.filter((r) => !r.is_fallback && r.lr_mae !== null && r.rf_mae !== null);
    const avg = (vals: number[]) =>
      vals.length > 0 ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100 : null;

    const modelComparison = {
      evaluatedBinsCount: mlRows.length,
      fallbackBinsCount: rows.filter((r) => Boolean(r.is_fallback)).length,
      linearRegression: {
        avgMae: avg(mlRows.map((r) => Number(r.lr_mae))),
        avgRmse: avg(mlRows.map((r) => Number(r.lr_rmse))),
      },
      randomForest: {
        avgMae: avg(mlRows.map((r) => Number(r.rf_mae))),
        avgRmse: avg(mlRows.map((r) => Number(r.rf_rmse))),
      },
    };

    res.json({ predictions: rows, modelComparison });
  });

  router.post('/predictions/recompute', requireAuth, (req, res) => {
    const db = getDb();
    const { preferredModel, horizonHours } = req.body as {
      preferredModel?: 'Random Forest Regression' | 'Linear Regression';
      horizonHours?: number;
    };
    if (preferredModel && ['Random Forest Regression', 'Linear Regression'].includes(preferredModel)) {
      db.prepare(
        `INSERT INTO system_settings (setting_name, setting_value) VALUES ('default_model', ?)
         ON CONFLICT(setting_name) DO UPDATE SET setting_value = excluded.setting_value`
      ).run(preferredModel);
    }
    if (horizonHours && isValidNumber(Number(horizonHours), 1, 168)) {
      db.prepare(
        `INSERT INTO system_settings (setting_name, setting_value) VALUES ('prediction_horizon_hours', ?)
         ON CONFLICT(setting_name) DO UPDATE SET setting_value = excluded.setting_value`
      ).run(String(horizonHours));
    }

    const results = recomputeAllPredictions(db);
    logAudit(db, req.user, 'RECOMPUTE_PREDICTIONS', 'prediction', 'all', `Recomputed ${results.length} predictions`);
    res.json({ recomputed: results.length, results });
  });

  router.get('/risk-assessment', requireAuth, (_req, res) => {
    const db = getDb();
    const bins = db
      .prepare(
        `SELECT b.*, z.zone_name, z.population_density
         FROM waste_bins b JOIN zones z ON z.id = b.zone_id`
      )
      .all() as Record<string, unknown>[];

    const settings = getSystemSettingsMap(db);
    const maxD = Math.max(1, ...bins.map((b) => Number(b.population_density) || 1));

    const assessments = bins.map((b) => {
      const history = db
        .prepare(`SELECT * FROM fill_level_history WHERE bin_id = ? ORDER BY recorded_at ASC`)
        .all(Number(b.id)) as unknown as FillHistoryRecord[];

      const pred = runBinPrediction({
        binId: Number(b.id),
        currentFillLevel: Number(b.current_fill_level),
        lastCollectionDate: String(b.last_collection_date),
        zonePopulationDensity: Number(b.population_density),
        maxCityDensity: maxD,
        history,
        horizonHours: Number(settings.prediction_horizon_hours || 24),
        preferredModel:
          settings.default_model === 'Linear Regression' ? 'Linear Regression' : 'Random Forest Regression',
      });

      return {
        binCode: String(b.bin_code),
        location: String(b.location),
        zoneName: String(b.zone_name),
        populationDensity: Number(b.population_density),
        currentFillLevel: Number(b.current_fill_level),
        lastCollectionDate: String(b.last_collection_date),
        ...pred,
      };
    });

    assessments.sort((a, b) => b.riskScore - a.riskScore);
    res.json({ assessments });
  });

  // ─────────────────────────────────────────────────────────────
  // PRIORITY QUEUE & COLLECTION PLANNING
  // ─────────────────────────────────────────────────────────────
  router.get('/priority-queue', requireAuth, (_req, res) => {
    const db = getDb();
    const queue = buildPriorityQueue(db);
    res.json({ queue });
  });

  router.get('/collection-plans', requireAuth, (_req, res) => {
    const db = getDb();
    const plans = db
      .prepare(
        `SELECT
          cp.*,
          v.vehicle_number,
          v.vehicle_type,
          v.capacity as vehicle_capacity,
          v.current_load as vehicle_current_load,
          v.availability_status,
          b.bin_code,
          b.location,
          b.current_fill_level,
          b.capacity as bin_capacity,
          z.zone_name,
          COALESCE(p.risk_score, b.current_fill_level) as risk_score,
          COALESCE(p.risk_level, 'LOW') as risk_level
        FROM collection_plans cp
        JOIN vehicles v ON v.id = cp.vehicle_id
        JOIN waste_bins b ON b.id = cp.bin_id
        JOIN zones z ON z.id = b.zone_id
        LEFT JOIN predictions p ON p.id = (
          SELECT p2.id FROM predictions p2 WHERE p2.bin_id = b.id ORDER BY p2.id DESC LIMIT 1
        )
        ORDER BY
          CASE cp.route_status WHEN 'In Progress' THEN 1 WHEN 'Delayed' THEN 2 WHEN 'Scheduled' THEN 3 ELSE 4 END,
          cp.priority DESC,
          cp.route_order ASC`
      )
      .all();
    res.json({ plans });
  });

  router.post('/collection-plans/generate', requireAuth, requireRole(['Administrator', 'Waste Management Officer']), (req, res) => {
    const db = getDb();
    const minRisk = Number((req.body as { minRiskScore?: number })?.minRiskScore ?? 31);
    const result = generatePriorityCollectionSchedule(db, minRisk);
    logAudit(
      db,
      req.user,
      'GENERATE_PRIORITY_SCHEDULE',
      'collection_plan',
      'batch',
      `Created ${result.createdPlans} plans (skipped ${result.skippedAlreadyAssigned} existing)`
    );
    res.json(result);
  });

  router.post('/collection-plans', requireAuth, requireRole(['Administrator', 'Waste Management Officer']), (req, res) => {
    const db = getDb();
    const { vehicleId, binId, scheduledTime } = req.body as {
      vehicleId?: number;
      binId?: number;
      scheduledTime?: string;
    };
    const vId = Number(vehicleId);
    const bId = Number(binId);
    if (!vId || !bId) {
      res.status(400).json({ error: 'Vehicle and bin IDs are required.' });
      return;
    }

    const vehicle = db.prepare(`SELECT * FROM vehicles WHERE id = ?`).get(vId) as Record<string, unknown> | undefined;
    const bin = db.prepare(`SELECT * FROM waste_bins WHERE id = ?`).get(bId) as Record<string, unknown> | undefined;
    if (!vehicle || !bin) {
      res.status(404).json({ error: 'Vehicle or bin not found.' });
      return;
    }

    if (vehicle.availability_status !== 'Available') {
      res.status(400).json({
        error: `Vehicle ${String(vehicle.vehicle_number)} is currently ${String(vehicle.availability_status)} and cannot accept new assignments.`,
      });
      return;
    }

    const dup = db
      .prepare(`SELECT id FROM collection_plans WHERE bin_id = ? AND route_status IN ('Scheduled', 'In Progress')`)
      .get(bId);
    if (dup) {
      res.status(409).json({ error: `Bin ${String(bin.bin_code)} already has an active scheduled collection.` });
      return;
    }

    // Check remaining capacity including already scheduled stops for this vehicle
    const activeStops = db
      .prepare(
        `SELECT b.capacity, b.current_fill_level
         FROM collection_plans cp
         JOIN waste_bins b ON b.id = cp.bin_id
         WHERE cp.vehicle_id = ? AND cp.route_status IN ('Scheduled', 'In Progress')`
      )
      .all(vId) as { capacity: number; current_fill_level: number }[];

    const plannedKg = activeStops.reduce(
      (sum, s) => sum + estimateWasteMassKg(Number(s.capacity), Number(s.current_fill_level)),
      0
    );
    const newStopKg = estimateWasteMassKg(Number(bin.capacity), Number(bin.current_fill_level));
    const remainingCap = Number(vehicle.capacity) - Number(vehicle.current_load) - plannedKg;

    if (newStopKg > remainingCap) {
      res.status(400).json({
        error: `Insufficient vehicle capacity: bin requires ~${newStopKg} kg, but ${String(vehicle.vehicle_number)} only has ${Math.max(0, Math.round(remainingCap))} kg remaining.`,
      });
      return;
    }

    const queue = buildPriorityQueue(db);
    const priorityItem = queue.find((q) => q.binId === bId);
    const priority = priorityItem?.priorityScore ?? Number(bin.current_fill_level);
    const sched = scheduledTime && !Number.isNaN(Date.parse(scheduledTime))
      ? new Date(scheduledTime).toISOString()
      : new Date(Date.now() + 30 * 60000).toISOString();

    const info = db
      .prepare(
        `INSERT INTO collection_plans (vehicle_id, bin_id, priority, route_order, estimated_distance_km, scheduled_time, route_status)
         VALUES (?, ?, ?, ?, 0, ?, 'Scheduled')`
      )
      .run(vId, bId, priority, activeStops.length + 1, sched);

    logAudit(db, req.user, 'ASSIGN_COLLECTION', 'collection_plan', String(info.lastInsertRowid), `Assigned ${String(bin.bin_code)} to ${String(vehicle.vehicle_number)}`);
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });

  router.patch('/collection-plans/:id/status', requireAuth, (req, res) => {
    const db = getDb();
    const id = Number(req.params.id);
    const { routeStatus, remarks } = req.body as { routeStatus?: string; remarks?: string };
    const valid = ['Scheduled', 'In Progress', 'Completed', 'Delayed', 'Cancelled'];
    if (!routeStatus || !valid.includes(routeStatus)) {
      res.status(400).json({ error: 'Invalid collection status.' });
      return;
    }

    const plan = db
      .prepare(
        `SELECT cp.*, b.capacity as bin_capacity, b.current_fill_level, b.bin_code, v.vehicle_number
         FROM collection_plans cp
         JOIN waste_bins b ON b.id = cp.bin_id
         JOIN vehicles v ON v.id = cp.vehicle_id
         WHERE cp.id = ?`
      )
      .get(id) as Record<string, unknown> | undefined;

    if (!plan) {
      res.status(404).json({ error: 'Collection plan not found' });
      return;
    }

    db.prepare(`UPDATE collection_plans SET route_status = ? WHERE id = ?`).run(routeStatus, id);

    if (routeStatus === 'Completed' && plan.route_status !== 'Completed') {
      const nowIso = new Date().toISOString();
      const collectedKg = estimateWasteMassKg(Number(plan.bin_capacity), Number(plan.current_fill_level));
      const binId = Number(plan.bin_id);
      const vehicleId = Number(plan.vehicle_id);

      // Log collection record
      db.prepare(
        `INSERT INTO collection_records (bin_id, vehicle_id, collected_quantity, collection_status, collection_date, remarks)
         VALUES (?, ?, ?, 'Completed', ?, ?)`
      ).run(binId, vehicleId, collectedKg, nowIso, (remarks || `Collected via ${String(plan.vehicle_number)}`).trim());

      // Reset bin fill level to 4% (post-empty residual) and record history
      db.prepare(
        `UPDATE waste_bins SET current_fill_level = 4, last_collection_date = ?, status = 'Empty', reading_source = 'manual' WHERE id = ?`
      ).run(nowIso, binId);
      db.prepare(
        `INSERT INTO fill_level_history (bin_id, fill_percentage, source, recorded_at) VALUES (?, 4, 'manual', ?)`
      ).run(binId, nowIso);

      // Update vehicle load (bounded by vehicle capacity)
      db.prepare(
        `UPDATE vehicles SET current_load = MIN(capacity, current_load + ?) WHERE id = ?`
      ).run(collectedKg, vehicleId);

      // Mark bin-specific critical/high/overflow alerts as read
      db.prepare(`UPDATE alerts SET is_read = 1 WHERE bin_id = ?`).run(binId);

      recomputePredictionForBin(db, binId);
      logAudit(db, req.user, 'COMPLETE_COLLECTION', 'collection_plan', id, `Collected ${collectedKg} kg from ${String(plan.bin_code)}`);
    } else {
      logAudit(db, req.user, 'UPDATE_COLLECTION_STATUS', 'collection_plan', id, `Set status to ${routeStatus}`);
    }

    res.json({ ok: true });
  });

  router.delete('/collection-plans/:id', requireAuth, requireRole(['Administrator', 'Waste Management Officer']), (req, res) => {
    const db = getDb();
    const id = Number(req.params.id);
    const info = db.prepare(`DELETE FROM collection_plans WHERE id = ?`).run(id);
    if (info.changes === 0) {
      res.status(404).json({ error: 'Collection plan not found' });
      return;
    }
    logAudit(db, req.user, 'DELETE_COLLECTION_PLAN', 'collection_plan', id, 'Removed collection plan');
    res.json({ ok: true });
  });

  router.get('/collection-records', requireAuth, (_req, res) => {
    const db = getDb();
    const records = db
      .prepare(
        `SELECT cr.*, b.bin_code, b.location, z.zone_name, v.vehicle_number
         FROM collection_records cr
         JOIN waste_bins b ON b.id = cr.bin_id
         JOIN zones z ON z.id = b.zone_id
         JOIN vehicles v ON v.id = cr.vehicle_id
         ORDER BY cr.collection_date DESC
         LIMIT 150`
      )
      .all();
    res.json({ records });
  });

  // ─────────────────────────────────────────────────────────────
  // VEHICLES & ROUTE OPTIMIZATION
  // ─────────────────────────────────────────────────────────────
  router.get('/vehicles', requireAuth, (_req, res) => {
    const db = getDb();
    const vehicles = db
      .prepare(
        `SELECT
          v.*,
          z.zone_name as assigned_zone_name,
          (SELECT COUNT(*) FROM collection_plans cp WHERE cp.vehicle_id = v.id AND cp.route_status IN ('Scheduled', 'In Progress')) as active_stops,
          (SELECT COUNT(*) FROM collection_records cr WHERE cr.vehicle_id = v.id) as completed_trips
        FROM vehicles v
        LEFT JOIN zones z ON z.id = v.assigned_zone
        ORDER BY v.id ASC`
      )
      .all();
    res.json({ vehicles });
  });

  router.post('/vehicles', requireAuth, requireRole(['Administrator', 'Waste Management Officer']), (req, res) => {
    const db = getDb();
    const {
      vehicleNumber,
      vehicleType,
      capacity,
      currentLoad,
      availabilityStatus,
      assignedZone,
      depotLat,
      depotLng,
    } = req.body as Record<string, unknown>;

    const num = String(vehicleNumber || '').trim().toUpperCase();
    const cap = Number(capacity);
    const load = Number(currentLoad ?? 0);
    const status = String(availabilityStatus || 'Available') as VehicleStatus;

    if (!num || !String(vehicleType || '').trim() || !isValidNumber(cap, 100, 50000) || !isValidNumber(load, 0, cap)) {
      res.status(400).json({ error: 'Valid vehicle number, type, capacity, and current load (<= capacity) are required.' });
      return;
    }

    try {
      const info = db
        .prepare(
          `INSERT INTO vehicles (
            vehicle_number, vehicle_type, capacity, current_load, availability_status, assigned_zone, depot_lat, depot_lng
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          num,
          String(vehicleType).trim(),
          cap,
          load,
          status,
          assignedZone ? Number(assignedZone) : null,
          Number(depotLat ?? 12.9716),
          Number(depotLng ?? 77.5946)
        );
      evaluateAndGenerateAlerts(db);
      logAudit(db, req.user, 'CREATE_VEHICLE', 'vehicle', String(info.lastInsertRowid), `Added vehicle ${num}`);
      res.status(201).json({ id: Number(info.lastInsertRowid) });
    } catch {
      res.status(409).json({ error: `Vehicle number "${num}" already exists.` });
    }
  });

  router.put('/vehicles/:id', requireAuth, requireRole(['Administrator', 'Waste Management Officer']), (req, res) => {
    const db = getDb();
    const id = Number(req.params.id);
    const existing = db.prepare(`SELECT * FROM vehicles WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Vehicle not found' });
      return;
    }

    const {
      vehicleNumber,
      vehicleType,
      capacity,
      currentLoad,
      availabilityStatus,
      assignedZone,
    } = req.body as Record<string, unknown>;

    const num = String(vehicleNumber ?? existing.vehicle_number).trim().toUpperCase();
    const vType = String(vehicleType ?? existing.vehicle_type).trim();
    const cap = capacity !== undefined ? Number(capacity) : Number(existing.capacity);
    const load = currentLoad !== undefined ? Number(currentLoad) : Number(existing.current_load);
    const status = String(availabilityStatus ?? existing.availability_status);
    const zId = assignedZone === null || assignedZone === '' ? null : assignedZone !== undefined ? Number(assignedZone) : (existing.assigned_zone as number | null);

    if (!num || !vType || !isValidNumber(cap, 100, 50000) || !isValidNumber(load, 0, cap)) {
      res.status(400).json({ error: 'Invalid vehicle parameters or current load exceeds capacity.' });
      return;
    }

    db.prepare(
      `UPDATE vehicles
       SET vehicle_number = ?, vehicle_type = ?, capacity = ?, current_load = ?, availability_status = ?, assigned_zone = ?
       WHERE id = ?`
    ).run(num, vType, cap, load, status, zId, id);

    evaluateAndGenerateAlerts(db);
    logAudit(db, req.user, 'UPDATE_VEHICLE', 'vehicle', id, `Updated vehicle ${num} (${status})`);
    res.json({ ok: true });
  });

  router.delete('/vehicles/:id', requireAuth, requireRole(['Administrator', 'Waste Management Officer']), (req, res) => {
    const db = getDb();
    const id = Number(req.params.id);
    const refs = db.prepare(`SELECT COUNT(*) as cnt FROM collection_records WHERE vehicle_id = ?`).get(id) as { cnt: number };
    if (refs.cnt > 0) {
      res.status(409).json({
        error: `Cannot delete vehicle with ${refs.cnt} historical collection record(s). Mark it Unavailable or Maintenance instead.`,
      });
      return;
    }
    const info = db.prepare(`DELETE FROM vehicles WHERE id = ?`).run(id);
    if (info.changes === 0) {
      res.status(404).json({ error: 'Vehicle not found' });
      return;
    }
    logAudit(db, req.user, 'DELETE_VEHICLE', 'vehicle', id, 'Deleted vehicle');
    res.json({ ok: true });
  });

  router.get('/routes/optimize', requireAuth, (req, res) => {
    const db = getDb();
    const vehicleIdFilter = req.query.vehicle_id ? Number(req.query.vehicle_id) : null;

    const vehicles = (
      vehicleIdFilter
        ? db.prepare(`SELECT v.*, z.zone_name FROM vehicles v LEFT JOIN zones z ON z.id = v.assigned_zone WHERE v.id = ?`).all(vehicleIdFilter)
        : db.prepare(`SELECT v.*, z.zone_name FROM vehicles v LEFT JOIN zones z ON z.id = v.assigned_zone ORDER BY v.id ASC`).all()
    ) as Record<string, unknown>[];

    const routes = vehicles.map((v) => {
      const vid = Number(v.id);
      const depotLat = Number(v.depot_lat) || 12.9716;
      const depotLng = Number(v.depot_lng) || 77.5946;

      const activeStopsRows = db
        .prepare(
          `SELECT cp.id as plan_id, cp.priority, cp.route_status, b.id as bin_id, b.bin_code, b.location, b.latitude, b.longitude, b.capacity, b.current_fill_level, COALESCE(p.risk_level, 'LOW') as risk_level
           FROM collection_plans cp
           JOIN waste_bins b ON b.id = cp.bin_id
           LEFT JOIN predictions p ON p.id = (
             SELECT p2.id FROM predictions p2 WHERE p2.bin_id = b.id ORDER BY p2.id DESC LIMIT 1
           )
           WHERE cp.vehicle_id = ? AND cp.route_status IN ('Scheduled', 'In Progress', 'Delayed')`
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

      const optimized = optimizeVehicleRoute(depotLat, depotLng, stops);
      // Persist updated route_order & leg distance
      for (const stop of optimized.orderedStops) {
        db.prepare(
          `UPDATE collection_plans SET route_order = ?, estimated_distance_km = ?
           WHERE vehicle_id = ? AND bin_id = ? AND route_status IN ('Scheduled', 'In Progress', 'Delayed')`
        ).run(stop.routeOrder, stop.legDistanceKm, vid, stop.binId);
      }

      const coordinates: [number, number][] =
        optimized.orderedStops.length > 0
          ? [
              [depotLat, depotLng],
              ...optimized.orderedStops.map((s): [number, number] => [s.latitude, s.longitude]),
              [depotLat, depotLng],
            ]
          : [];

      const plannedKg = optimized.orderedStops.reduce((a, b) => a + b.estimatedKg, 0);

      return {
        vehicleId: vid,
        vehicleNumber: String(v.vehicle_number),
        vehicleType: String(v.vehicle_type),
        availabilityStatus: String(v.availability_status),
        assignedZoneName: v.zone_name ? String(v.zone_name) : 'City-Wide',
        capacityKg: Number(v.capacity),
        currentLoadKg: Number(v.current_load),
        plannedLoadKg: Math.round(plannedKg * 10) / 10,
        depot: { lat: depotLat, lng: depotLng },
        ...optimized,
        coordinates,
        travelTimeNote: 'Distance-based estimate at 24 km/h urban average (no live traffic feed)',
      };
    });

    res.json({ routes });
  });

  // ─────────────────────────────────────────────────────────────
  // ALERTS
  // ─────────────────────────────────────────────────────────────
  router.get('/alerts', requireAuth, (req, res) => {
    const db = getDb();
    const unreadOnly = req.query.unread === 'true';
    const alerts = db
      .prepare(
        `SELECT a.*, b.bin_code, b.location
         FROM alerts a
         LEFT JOIN waste_bins b ON b.id = a.bin_id
         ${unreadOnly ? 'WHERE a.is_read = 0' : ''}
         ORDER BY a.is_read ASC, a.created_at DESC
         LIMIT 150`
      )
      .all();
    res.json({ alerts });
  });

  router.patch('/alerts/:id/read', requireAuth, (req, res) => {
    const db = getDb();
    const id = Number(req.params.id);
    const { isRead } = req.body as { isRead?: boolean };
    const val = isRead === false ? 0 : 1;
    db.prepare(`UPDATE alerts SET is_read = ? WHERE id = ?`).run(val, id);
    res.json({ ok: true });
  });

  router.post('/alerts/mark-all-read', requireAuth, (_req, res) => {
    const db = getDb();
    db.prepare(`UPDATE alerts SET is_read = 1 WHERE is_read = 0`).run();
    res.json({ ok: true });
  });

  router.post('/alerts/evaluate', requireAuth, (_req, res) => {
    const db = getDb();
    const created = evaluateAndGenerateAlerts(db);
    res.json({ created });
  });

  // ─────────────────────────────────────────────────────────────
  // DASHBOARD, ANALYTICS & REPORTS
  // ─────────────────────────────────────────────────────────────
  router.get('/dashboard', requireAuth, (_req, res) => {
    const db = getDb();
    res.json(getDashboardSummary(db));
  });

  router.get('/analytics', requireAuth, (_req, res) => {
    const db = getDb();
    res.json(getFullAnalytics(db));
  });

  router.get('/reports/:type', requireAuth, (req, res) => {
    const db = getDb();
    const type = req.params.type as ReportType;
    const validTypes: ReportType[] = [
      'daily',
      'weekly',
      'monthly',
      'critical_bins',
      'zone_wise',
      'vehicle_performance',
    ];
    if (!validTypes.includes(type)) {
      res.status(400).json({ error: 'Unknown report type' });
      return;
    }
    const report = buildReport(db, type);
    if (req.query.format === 'csv') {
      const csv = reportToCsv(report);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="metrocycle_${type}_report.csv"`);
      res.send(csv);
      return;
    }
    res.json(report);
  });

  // ─────────────────────────────────────────────────────────────
  // WASTEGUARD AI ASSISTANT
  // ─────────────────────────────────────────────────────────────
  router.post('/ai/chat', requireAuth, rateLimit(20, 60_000), async (req, res) => {
    const db = getDb();
    const { message } = req.body as { message?: string };
    if (!message?.trim()) {
      res.status(400).json({ error: 'Prompt message cannot be empty.' });
      return;
    }
    const reply = await askWasteGuardAI(db, message.trim());
    res.json(reply);
  });

  // ─────────────────────────────────────────────────────────────
  // SYSTEM SETTINGS, AUDIT LOGS & DATABASE MANAGEMENT
  // ─────────────────────────────────────────────────────────────
  router.get('/settings', requireAuth, (_req, res) => {
    const db = getDb();
    const settings = getSystemSettingsMap(db);
    res.json({ settings });
  });

  router.put('/settings', requireAuth, requireRole(['Administrator']), (req, res) => {
    const db = getDb();
    const updates = req.body as Record<string, string | number | boolean>;
    const stmt = db.prepare(
      `INSERT INTO system_settings (setting_name, setting_value) VALUES (?, ?)
       ON CONFLICT(setting_name) DO UPDATE SET setting_value = excluded.setting_value`
    );
    for (const [k, v] of Object.entries(updates)) {
      if (k.trim()) {
        stmt.run(k.trim(), String(v));
      }
    }
    logAudit(db, req.user, 'UPDATE_SETTINGS', 'system_settings', 'all', `Updated keys: ${Object.keys(updates).join(', ')}`);
    res.json({ settings: getSystemSettingsMap(db) });
  });

  router.get('/audit-logs', requireAuth, requireRole(['Administrator', 'Waste Management Officer']), (_req, res) => {
    const db = getDb();
    const logs = db.prepare(`SELECT * FROM audit_logs ORDER BY id DESC LIMIT 200`).all();
    res.json({ logs });
  });

  router.get('/database/status', requireAuth, (_req, res) => {
    const db = getDb();
    const tables = [
      'users',
      'waste_bins',
      'zones',
      'fill_level_history',
      'predictions',
      'collection_records',
      'vehicles',
      'collection_plans',
      'alerts',
      'system_settings',
      'audit_logs',
    ];
    const tableCounts = tables.map((name) => {
      const row = db.prepare(`SELECT COUNT(*) as cnt FROM ${name}`).get() as { cnt: number };
      return { table: name, count: Number(row.cnt) };
    });

    const dbStat = fs.existsSync(DB_PATH) ? fs.statSync(DB_PATH) : null;
    const backups = listDatabaseBackups();

    res.json({
      databaseFile: path.basename(DB_PATH),
      sizeBytes: dbStat?.size ?? 0,
      lastModified: dbStat?.mtime.toISOString() ?? null,
      tableCounts,
      backups,
    });
  });

  router.post('/database/backup', requireAuth, requireRole(['Administrator']), (req, res) => {
    const db = getDb();
    const backup = createDatabaseBackup();
    logAudit(db, req.user, 'DATABASE_BACKUP', 'database', backup.filename, `Created backup (${backup.sizeBytes} bytes)`);
    res.status(201).json({ backup });
  });

  router.get('/database/backups/:filename/download', requireAuth, requireRole(['Administrator']), (req, res) => {
    const safeName = path.basename(String(req.params.filename));
    const fullPath = path.join(BACKUP_DIR, safeName);
    if (!fs.existsSync(fullPath)) {
      res.status(404).json({ error: 'Backup file not found' });
      return;
    }
    res.download(fullPath, safeName);
  });

  router.post('/database/restore', requireAuth, requireRole(['Administrator']), (req, res) => {
    const { filename } = req.body as { filename?: string };
    if (!filename) {
      res.status(400).json({ error: 'Backup filename is required.' });
      return;
    }
    try {
      restoreDatabaseBackup(filename);
      const db = getDb();
      logAudit(db, req.user, 'DATABASE_RESTORE', 'database', filename, `Restored SQLite database from ${filename}`);
      res.json({ ok: true, restoredFrom: filename });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Restore failed' });
    }
  });

  return router;
}
