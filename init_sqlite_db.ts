// Initialize SQLite database for MetroCycle Urban Waste Intelligence
import { getDb, closeDb } from "./server/database.ts";

function init() {
  try {
    const db = getDb();
    console.log("SQLite database initialized at", db.filename ?? "(in-memory)");
  } finally {
    closeDb();
    console.log("Database connection closed.");
  }
}

init();

