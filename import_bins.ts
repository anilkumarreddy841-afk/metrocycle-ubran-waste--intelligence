// import_bins.ts – Load sample_bins.csv into SQLite DB
import fs from 'node:fs';
import path from 'node:path';
import { getDb } from './server/database.ts';

// Paths
const csvPath = path.resolve(process.cwd(), 'data', 'sample_bins.csv');
const db = getDb();

function initZonesAndBins() {
  const raw = fs.readFileSync(csvPath, 'utf-8').trim();
  const lines = raw.split(/\r?\n/);
  const header = lines.shift();
  if (!header) return;
  const cols = header.split(',');

  const zoneInsert = db.prepare(
    `INSERT OR IGNORE INTO zones (zone_name, population_density, area, description) VALUES (?, 0, 0, '')`
  );
  const binInsert = db.prepare(
    `INSERT OR IGNORE INTO waste_bins (
      bin_code, location, latitude, longitude, zone_id, capacity, waste_type, current_fill_level,
      last_collection_date, status, reading_source, created_at
    ) VALUES (
      ?, ?, ?, ?, (SELECT id FROM zones WHERE zone_name = ?), ?, ?, ?, datetime('now'), 'ACTIVE', 'imported', datetime('now')
    )`
  );

  for (const line of lines) {
    if (!line) continue;
    const [bin_code, location, latitude, longitude, zone_name, capacity, waste_type, current_fill_level] = line.split(',');
    // Ensure zone exists
    zoneInsert.run(zone_name);
    // Insert bin
    binInsert.run(
      bin_code,
      location,
      Number(latitude),
      Number(longitude),
      zone_name,
      Number(capacity),
      waste_type,
      Number(current_fill_level)
    );
  }
}

function main() {
  try {
    initZonesAndBins();
    console.log('✅ Sample data imported into SQLite database.');
  } catch (err) {
    console.error('❌ Error importing data:', err);
  }
}

main();

