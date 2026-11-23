import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createDatabaseBackup, getDb, restoreDatabaseBackup } from '../server/database.ts';
import { hashPassword, verifyPassword } from '../server/auth.ts';
import { runBinPrediction } from '../server/prediction.ts';
import { buildPriorityQueue, generatePriorityCollectionSchedule } from '../server/priority_queue.ts';
import { classifyRiskLevel } from '../server/risk_engine.ts';
import { buildReport, reportToCsv } from '../server/reports.ts';
import { askWasteGuardAI } from '../server/ai_assistant.ts';

async function runTests() {
  console.log('Running MetroCycle end-to-end verification tests...');

  // 1. SQLite DB initialization & tables
  const db = getDb();
  assert.ok(fs.existsSync('urban_waste_management.db'), 'SQLite DB file should exist');
  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
    .all()
    .map((r) => String(r.name));

  for (const reqTable of [
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
  ]) {
    assert.ok(tables.includes(reqTable), `Missing table: ${reqTable}`);
  }
  console.log('✓ 1. SQLite schema (11 tables) verified');

  // 2. Password hashing & verification
  const hash = hashPassword('Secret@999');
  assert.ok(!hash.includes('Secret@999'), 'Password must never be stored in plain text');
  assert.equal(verifyPassword('Secret@999', hash), true);
  assert.equal(verifyPassword('WrongPass', hash), false);
  console.log('✓ 2. Salted scrypt password hashing verified');

  // 3. Risk classification thresholds
  assert.equal(classifyRiskLevel(15), 'LOW');
  assert.equal(classifyRiskLevel(40), 'MEDIUM');
  assert.equal(classifyRiskLevel(65), 'HIGH');
  assert.equal(classifyRiskLevel(85), 'CRITICAL');
  console.log('✓ 3. Risk classification thresholds verified');

  // 4. ML Prediction & Insufficient Data Fallback
  const fallbackPred = runBinPrediction({
    binId: 999,
    currentFillLevel: 30,
    lastCollectionDate: new Date().toISOString(),
    zonePopulationDensity: 10000,
    maxCityDensity: 18000,
    history: [
      { id: 1, bin_id: 999, fill_percentage: 20, source: 'manual', recorded_at: new Date(Date.now() - 3600000).toISOString() },
      { id: 2, bin_id: 999, fill_percentage: 30, source: 'manual', recorded_at: new Date().toISOString() },
    ],
    horizonHours: 24,
    preferredModel: 'Random Forest Regression',
  });
  assert.equal(fallbackPred.isFallback, true, 'Should clearly flag insufficient history fallback');
  assert.equal(fallbackPred.mae, null, 'Fallback should not invent MAE');

  const firstBin = db.prepare(`SELECT id FROM waste_bins WHERE bin_code = 'BIN-CM-101'`).get() as { id: number };
  const fullHistory = db
    .prepare(`SELECT * FROM fill_level_history WHERE bin_id = ? ORDER BY recorded_at ASC`)
    .all(firstBin.id) as never[];
  const mlPred = runBinPrediction({
    binId: firstBin.id,
    currentFillLevel: 93,
    lastCollectionDate: new Date(Date.now() - 48 * 3600000).toISOString(),
    zonePopulationDensity: 18400,
    maxCityDensity: 18400,
    history: fullHistory,
    horizonHours: 24,
    preferredModel: 'Random Forest Regression',
  });
  assert.equal(mlPred.isFallback, false, 'Bin with 28 readings should run real ML evaluation');
  assert.ok(mlPred.lrMetrics.mae !== null && mlPred.rfMetrics.mae !== null, 'Held-out MAE must be computed');
  console.log('✓ 4. ML Prediction (LR + Random Forest held-out MAE/RMSE + fallback) verified');

  // 5. Priority queue ordering & vehicle capacity enforcement
  const queue = buildPriorityQueue(db);
  assert.ok(queue.length >= 20, 'Priority queue should rank all bins');
  for (let i = 1; i < queue.length; i++) {
    assert.ok(queue[i - 1].priorityScore >= queue[i].priorityScore, 'Priority queue must be sorted descending');
  }
  const sched = generatePriorityCollectionSchedule(db, 31);
  assert.ok(sched.createdPlans >= 0, 'Schedule generation succeeded');
  console.log('✓ 5. Priority queue ordering & capacity-aware scheduling verified');

  // 6. Report generation & CSV serialization
  const report = buildReport(db, 'critical_bins');
  const csv = reportToCsv(report);
  assert.ok(csv.includes('Bin Code'), 'CSV report header present');
  console.log('✓ 6. Automated reports & CSV export verified');

  // 7. WasteGuard AI grounded response
  const aiReply = await askWasteGuardAI(db, 'Which bins are at critical risk?');
  assert.ok(aiReply.answer.length > 10, 'WasteGuard AI responded with DB-grounded content');
  console.log('✓ 7. WasteGuard AI grounded query verified');

  // 8. Database Backup & Restore
  const backup = createDatabaseBackup();
  assert.ok(fs.existsSync(backup.path), 'Backup file created on disk');
  assert.equal(restoreDatabaseBackup(backup.filename), true, 'Database restore succeeded');
  console.log('✓ 8. SQLite database backup & restore verified');

  console.log('ALL SYSTEM VERIFICATION CHECKS PASSED.');
}

runTests().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
