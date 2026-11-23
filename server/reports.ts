import type { DatabaseSync } from 'node:sqlite';
import { getFullAnalytics } from './analytics.ts';

export type ReportType =
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'critical_bins'
  | 'zone_wise'
  | 'vehicle_performance';

export interface GeneratedReport {
  reportType: ReportType;
  title: string;
  generatedAt: string;
  summary: Record<string, string | number>;
  columns: { key: string; label: string }[];
  rows: Record<string, string | number | null>[];
}

export function buildReport(db: DatabaseSync, reportType: ReportType): GeneratedReport {
  const analytics = getFullAnalytics(db);
  const generatedAt = new Date().toISOString();

  switch (reportType) {
    case 'daily': {
      const todayRows = db
        .prepare(
          `SELECT
            cr.id,
            b.bin_code,
            b.location,
            z.zone_name,
            v.vehicle_number,
            cr.collected_quantity,
            cr.collection_status,
            cr.collection_date,
            cr.remarks
          FROM collection_records cr
          JOIN waste_bins b ON b.id = cr.bin_id
          JOIN zones z ON z.id = b.zone_id
          JOIN vehicles v ON v.id = cr.vehicle_id
          ORDER BY cr.collection_date DESC
          LIMIT 50`
        )
        .all() as Record<string, string | number | null>[];

      return {
        reportType,
        title: 'Daily Waste Collection Operations Report',
        generatedAt,
        summary: {
          TotalBins: analytics.kpis.totalBins,
          CriticalBins: analytics.kpis.criticalBins,
          CollectionsLogged: analytics.kpis.collectionsCompleted,
          TotalWasteCollectedKg: analytics.kpis.totalWasteCollectedKg,
        },
        columns: [
          { key: 'bin_code', label: 'Bin Code' },
          { key: 'location', label: 'Location' },
          { key: 'zone_name', label: 'Zone' },
          { key: 'vehicle_number', label: 'Vehicle' },
          { key: 'collected_quantity', label: 'Collected (kg)' },
          { key: 'collection_status', label: 'Status' },
          { key: 'collection_date', label: 'Collection Time' },
        ],
        rows: todayRows,
      };
    }

    case 'weekly': {
      return {
        reportType,
        title: 'Weekly Waste Collection Trends Report',
        generatedAt,
        summary: {
          WeeksTracked: analytics.weeklyTrends.length,
          CollectionEfficiencyPct: analytics.efficiency.collectionEfficiencyPct,
          EstimatedFuelSavedLiters: analytics.efficiency.estimatedFuelSavedLiters,
        },
        columns: [
          { key: 'week_label', label: 'Week' },
          { key: 'collections_count', label: 'Completed Collections' },
          { key: 'total_kg', label: 'Total Collected (kg)' },
        ],
        rows: analytics.weeklyTrends as Record<string, string | number | null>[],
      };
    }

    case 'monthly': {
      return {
        reportType,
        title: 'Monthly Urban Waste Generation Report',
        generatedAt,
        summary: {
          MonthsTracked: analytics.monthlyTrends.length,
          TotalCollectedKg: analytics.kpis.totalWasteCollectedKg,
          OverflowEventsRecorded: analytics.efficiency.overflowReadingEvents,
        },
        columns: [
          { key: 'month_label', label: 'Month' },
          { key: 'collections_count', label: 'Completed Collections' },
          { key: 'total_kg', label: 'Total Collected (kg)' },
        ],
        rows: analytics.monthlyTrends as Record<string, string | number | null>[],
      };
    }

    case 'critical_bins': {
      const criticalRows = db
        .prepare(
          `SELECT
            b.bin_code,
            b.location,
            z.zone_name,
            b.waste_type,
            b.current_fill_level,
            p.predicted_fill_level,
            p.estimated_overflow_hours,
            p.risk_score,
            p.risk_level,
            p.model_name
          FROM waste_bins b
          JOIN zones z ON z.id = b.zone_id
          JOIN predictions p ON p.id = (
            SELECT p2.id FROM predictions p2 WHERE p2.bin_id = b.id ORDER BY p2.id DESC LIMIT 1
          )
          WHERE p.risk_level IN ('HIGH', 'CRITICAL')
          ORDER BY p.risk_score DESC`
        )
        .all() as Record<string, string | number | null>[];

      return {
        reportType,
        title: 'High & Critical Risk Bins Assessment Report',
        generatedAt,
        summary: {
          CriticalCount: analytics.kpis.criticalBins,
          HighRiskCount: analytics.kpis.highRiskBins,
          PredictedOverflowWithin24h: analytics.kpis.predictedOverflowToday,
        },
        columns: [
          { key: 'bin_code', label: 'Bin Code' },
          { key: 'location', label: 'Location' },
          { key: 'zone_name', label: 'Zone' },
          { key: 'waste_type', label: 'Waste Type' },
          { key: 'current_fill_level', label: 'Current Fill (%)' },
          { key: 'predicted_fill_level', label: 'Predicted Fill (%)' },
          { key: 'estimated_overflow_hours', label: 'Overflow ETA (h)' },
          { key: 'risk_score', label: 'Risk Score' },
          { key: 'risk_level', label: 'Risk Level' },
        ],
        rows: criticalRows,
      };
    }

    case 'zone_wise': {
      return {
        reportType,
        title: 'Zone-Wise Waste Distribution & Risk Report',
        generatedAt,
        summary: {
          TotalZones: analytics.zoneComparison.length,
          TotalBins: analytics.kpis.totalBins,
        },
        columns: [
          { key: 'zone_name', label: 'Zone Name' },
          { key: 'population_density', label: 'Density (/km²)' },
          { key: 'bin_count', label: 'Bins' },
          { key: 'avg_fill_level', label: 'Avg Fill (%)' },
          { key: 'avg_risk_score', label: 'Avg Risk Score' },
          { key: 'critical_bins', label: 'Critical Bins' },
          { key: 'total_collected_kg', label: 'Total Collected (kg)' },
        ],
        rows: analytics.zoneComparison as Record<string, string | number | null>[],
      };
    }

    case 'vehicle_performance': {
      return {
        reportType,
        title: 'Fleet Utilization & Vehicle Performance Report',
        generatedAt,
        summary: {
          TotalVehicles: analytics.vehicleUtilization.length,
          AvailableVehicles: analytics.kpis.availableVehicles,
          DistanceSavedKm: analytics.efficiency.distanceSavedKm,
          FuelSavedLiters: analytics.efficiency.estimatedFuelSavedLiters,
        },
        columns: [
          { key: 'vehicleNumber', label: 'Vehicle Number' },
          { key: 'vehicleType', label: 'Type' },
          { key: 'availabilityStatus', label: 'Status' },
          { key: 'assignedZoneName', label: 'Assigned Zone' },
          { key: 'capacityKg', label: 'Capacity (kg)' },
          { key: 'utilizationPct', label: 'Utilization (%)' },
          { key: 'completedCollections', label: 'Completed Pickups' },
          { key: 'totalHauledKg', label: 'Total Hauled (kg)' },
        ],
        rows: analytics.vehicleUtilization as unknown as Record<string, string | number | null>[],
      };
    }
  }
}

export function reportToCsv(report: GeneratedReport): string {
  const escapeCell = (val: unknown) => {
    if (val === null || val === undefined) return '';
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const header = report.columns.map((c) => escapeCell(c.label)).join(',');
  const lines = report.rows.map((row) =>
    report.columns.map((c) => escapeCell(row[c.key])).join(',')
  );
  return [header, ...lines].join('\n');
}
