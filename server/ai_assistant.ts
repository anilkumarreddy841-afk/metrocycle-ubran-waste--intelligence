import { GoogleGenAI } from '@google/genai';
import type { DatabaseSync } from 'node:sqlite';
import { getFullAnalytics } from './analytics.ts';
import { buildPriorityQueue } from './priority_queue.ts';

export interface AssistantReply {
  answer: string;
  mode: 'gemini' | 'local_database_fallback';
  modelUsed: string;
  groundedFacts: {
    criticalBinsCount: number;
    highRiskBinsCount: number;
    availableVehiclesCount: number;
    overflowTodayCount: number;
  };
}

function buildDatabaseSnapshot(db: DatabaseSync) {
  const analytics = getFullAnalytics(db);
  const queue = buildPriorityQueue(db);

  const criticalBins = queue.filter((b) => b.riskLevel === 'CRITICAL');
  const highRiskBins = queue.filter((b) => b.riskLevel === 'HIGH');
  const overflowToday = queue.filter(
    (b) => b.estimatedOverflowHours !== null && b.estimatedOverflowHours <= 24
  );

  const availableVehicles = db
    .prepare(
      `SELECT v.vehicle_number, v.vehicle_type, v.capacity, v.current_load, z.zone_name
       FROM vehicles v
       LEFT JOIN zones z ON z.id = v.assigned_zone
       WHERE v.availability_status = 'Available'`
    )
    .all() as Record<string, unknown>[];

  const todayPrefix = new Date().toISOString().slice(0, 10);
  const todayCollections = db
    .prepare(
      `SELECT COUNT(*) as count, COALESCE(SUM(collected_quantity), 0) as total_kg
       FROM collection_records
       WHERE collection_status = 'Completed' AND substr(collection_date, 1, 10) = ?`
    )
    .get(todayPrefix) as { count: number; total_kg: number };

  const recentCollections = db
    .prepare(
      `SELECT COUNT(*) as count, COALESCE(SUM(collected_quantity), 0) as total_kg
       FROM collection_records WHERE collection_status = 'Completed'`
    )
    .get() as { count: number; total_kg: number };

  const unreadAlerts = db
    .prepare(
      `SELECT alert_type, severity, message, created_at
       FROM alerts WHERE is_read = 0 ORDER BY created_at DESC LIMIT 8`
    )
    .all() as Record<string, unknown>[];

  return {
    analytics,
    queue,
    criticalBins,
    highRiskBins,
    overflowToday,
    availableVehicles,
    todayCollections,
    recentCollections,
    unreadAlerts,
  };
}

function answerLocallyFromDatabase(question: string, snap: ReturnType<typeof buildDatabaseSnapshot>): string {
  const q = question.toLowerCase();

  if (q.includes('critical')) {
    if (snap.criticalBins.length === 0) {
      return 'There are currently 0 bins classified at CRITICAL risk in the database.';
    }
    const list = snap.criticalBins
      .map(
        (b) =>
          `- ${b.binCode} (${b.location}, ${b.zoneName}): Risk ${b.riskScore}/100, Fill ${b.currentFillLevel}%, Overflow ETA ${b.estimatedOverflowHours !== null ? `${b.estimatedOverflowHours}h` : 'Stable'}`
      )
      .join('\n');
    return `Currently ${snap.criticalBins.length} bin(s) are at CRITICAL risk:\n${list}`;
  }

  if (q.includes('zone') && (q.includes('immediate') || q.includes('urgent') || q.includes('need') || q.includes('worst'))) {
    const sortedZones = [...snap.analytics.zoneComparison].sort(
      (a, b) => Number(b.avg_risk_score) - Number(a.avg_risk_score)
    );
    const top = sortedZones[0];
    if (!top) return 'No zones found in the database.';
    const details = sortedZones
      .slice(0, 3)
      .map(
        (z) =>
          `- ${String(z.zone_name)}: Avg Risk ${z.avg_risk_score}/100, Avg Fill ${z.avg_fill_level}%, Critical Bins: ${z.critical_bins}`
      )
      .join('\n');
    return `${String(top.zone_name)} requires the most immediate attention (Avg Risk ${top.avg_risk_score}/100, ${top.critical_bins} critical bins).\n\nTop zones by risk:\n${details}`;
  }

  if (q.includes('vehicle') || q.includes('truck') || q.includes('fleet')) {
    if (snap.availableVehicles.length === 0) {
      return 'No vehicles are currently marked Available in the fleet database.';
    }
    const list = snap.availableVehicles
      .map(
        (v) =>
          `- ${String(v.vehicle_number)} (${String(v.vehicle_type)}): Remaining capacity ${Math.round(Number(v.capacity) - Number(v.current_load))} kg of ${v.capacity} kg · Assigned zone: ${v.zone_name ? String(v.zone_name) : 'City-Wide'}`
      )
      .join('\n');
    return `${snap.availableVehicles.length} vehicle(s) are currently Available for dispatch:\n${list}`;
  }

  if (q.includes('overflow') || q.includes('today')) {
    if (q.includes('performance') || q.includes('summary') || q.includes('summarize')) {
      const tCnt = Number(snap.todayCollections?.count ?? 0);
      const tKg = Math.round(Number(snap.todayCollections?.total_kg ?? 0) * 10) / 10;
      return (
        `Today's Waste Collection Summary:\n` +
        `- Collections logged today: ${tCnt} pickups (${tKg} kg collected)\n` +
        `- Overall completed collections in ledger: ${snap.recentCollections.count} pickups (${Math.round(snap.recentCollections.total_kg)} kg total)\n` +
        `- Active Critical Bins: ${snap.criticalBins.length} · High Risk Bins: ${snap.highRiskBins.length}\n` +
        `- Collection Efficiency: ${snap.analytics.efficiency.collectionEfficiencyPct}% · Distance Saved via Routing: ${snap.analytics.efficiency.distanceSavedKm} km`
      );
    }

    const list = snap.overflowToday
      .slice(0, 8)
      .map(
        (b) =>
          `- ${b.binCode} (${b.location}): ${b.currentFillLevel}% full, est. overflow in ${b.estimatedOverflowHours}h`
      )
      .join('\n');
    return `${snap.overflowToday.length} bin(s) are predicted to overflow within the next 24 hours.${list ? `\n${list}` : ''}`;
  }

  if (q.includes('priority') || q.includes('highest') || q.includes('schedule') || q.includes('list')) {
    const top = snap.queue
      .slice(0, 8)
      .map(
        (b) =>
          `${b.urgencyRank}. ${b.binCode} (${b.zoneName}) — Priority ${b.priorityScore}, Risk ${b.riskLevel} (${b.riskScore}), Fill ${b.currentFillLevel}%${b.hasActiveAssignment ? ' [Assigned]' : ' [Unassigned]'}`
      )
      .join('\n');
    return `Top Priority Collection Queue (ordered by composite urgency):\n${top}`;
  }

  return (
    `Operational Snapshot from SQLite Database:\n` +
    `- Total Bins: ${snap.analytics.kpis.totalBins} (${snap.criticalBins.length} Critical, ${snap.highRiskBins.length} High Risk)\n` +
    `- Predicted Overflow <= 24h: ${snap.overflowToday.length} bin(s)\n` +
    `- Available Vehicles: ${snap.availableVehicles.length}\n` +
    `- Top Priority Bin: ${snap.queue[0] ? `${snap.queue[0].binCode} in ${snap.queue[0].zoneName} (Risk ${snap.queue[0].riskScore}/100)` : 'None'}\n` +
    `- Unread Alerts: ${snap.unreadAlerts.length}`
  );
}

export async function askWasteGuardAI(
  db: DatabaseSync,
  userMessage: string
): Promise<AssistantReply> {
  const snap = buildDatabaseSnapshot(db);
  const groundedFacts = {
    criticalBinsCount: snap.criticalBins.length,
    highRiskBinsCount: snap.highRiskBins.length,
    availableVehiclesCount: snap.availableVehicles.length,
    overflowTodayCount: snap.overflowToday.length,
  };

  const apiKey = process.env.GEMINI_API_KEY;
  const hasValidKey = Boolean(apiKey && apiKey.trim() !== '' && apiKey !== 'MY_GEMINI_API_KEY');

  if (!hasValidKey) {
    return {
      answer: answerLocallyFromDatabase(userMessage, snap),
      mode: 'local_database_fallback',
      modelUsed: 'SQLite Grounded Query Engine (No GEMINI_API_KEY configured)',
      groundedFacts,
    };
  }

  try {
    const ai = new GoogleGenAI({
      apiKey: apiKey!,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const contextPayload = {
      kpis: snap.analytics.kpis,
      efficiency: snap.analytics.efficiency,
      topPriorityQueue: snap.queue.slice(0, 12).map((b) => ({
        rank: b.urgencyRank,
        binCode: b.binCode,
        location: b.location,
        zone: b.zoneName,
        fillPct: b.currentFillLevel,
        riskScore: b.riskScore,
        riskLevel: b.riskLevel,
        overflowHours: b.estimatedOverflowHours,
        priorityScore: b.priorityScore,
        hasActiveAssignment: b.hasActiveAssignment,
      })),
      zoneComparison: snap.analytics.zoneComparison,
      availableVehicles: snap.availableVehicles,
      todayCollections: snap.todayCollections,
      unreadAlerts: snap.unreadAlerts,
    };

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: `Live Municipal SQLite Database Context:\n${JSON.stringify(contextPayload, null, 2)}\n\nOperator Question: ${userMessage}`,
      config: {
        systemInstruction:
          'You are WasteGuard AI, a municipal urban waste operations analyst. Answer strictly using the provided SQLite database snapshot. NEVER invent bin codes, vehicle numbers, zones, or metrics not present in the context. Clearly distinguish analytical recommendations from confirmed database facts. Keep responses concise, structured, and directly actionable.',
      },
    });

    const text = response.text?.trim();
    if (!text) {
      throw new Error('Empty response from Gemini model');
    }

    return {
      answer: text,
      mode: 'gemini',
      modelUsed: 'gemini-4-hydrogen',
      groundedFacts,
    };
  } catch (err) {
    // Graceful fallback to local DB responder while noting Gemini fallback
    const fallback = answerLocallyFromDatabase(userMessage, snap);
    const errMsg = err instanceof Error ? err.message : 'Upstream AI service unavailable';
    return {
      answer: `${fallback}\n\n[Note: Live Gemini request could not complete (${errMsg}); answered directly from SQLite operational records.]`,
      mode: 'local_database_fallback',
      modelUsed: 'SQLite Grounded Fallback',
      groundedFacts,
    };
  }
}
