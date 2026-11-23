import type { BinStatus, RiskLevel } from './types.ts';

export function classifyBinStatus(fillLevel: number): BinStatus {
  if (fillLevel < 15) return 'Empty';
  if (fillLevel < 50) return 'Normal';
  if (fillLevel < 75) return 'Filling';
  if (fillLevel < 90) return 'Nearly Full';
  return 'Overflowing';
}

export function classifyRiskLevel(riskScore: number): RiskLevel {
  if (riskScore <= 30) return 'LOW';
  if (riskScore <= 50) return 'MEDIUM';
  if (riskScore <= 75) return 'HIGH';
  return 'CRITICAL';
}

export interface RiskInput {
  currentFillLevel: number;
  fillRatePerHour: number;
  estimatedOverflowHours: number | null;
  hoursSinceLastCollection: number;
  zonePopulationDensity: number;
  maxCityDensity: number;
}

export interface RiskBreakdown {
  riskScore: number;
  riskLevel: RiskLevel;
  factors: {
    fillComponent: number;
    rateComponent: number;
    overflowUrgencyComponent: number;
    collectionAgeComponent: number;
    densityComponent: number;
  };
}

/**
 * Computes a deterministic 0-100 Overflow Risk Score using 5 weighted operational inputs:
 * - Current fill level (35%)
 * - Historical/predicted fill rate (20%)
 * - Predicted overflow time urgency (25%)
 * - Time since last collection (10%)
 * - Zone population density (10%)
 */
export function computeOverflowRisk(input: RiskInput): RiskBreakdown {
  const fillNorm = Math.max(0, Math.min(100, input.currentFillLevel)) / 100;
  const fillComponent = fillNorm * 40;

  // Normalize fill rate: 0%/hr -> 0, >= 3.2%/hr -> 1.0
  const safeRate = Math.max(0, input.fillRatePerHour);
  const rateNorm = Math.min(1, safeRate / 3.2);
  const rateComponent = rateNorm * 20;

  // Overflow urgency: <= 0h -> 1.0, 6h -> 0.85, 12h -> 0.65, 24h -> 0.40, 72h+ -> 0.05, null (non-increasing) -> 0
  let urgencyNorm = 0;
  if (input.currentFillLevel >= 95) {
    urgencyNorm = 1;
  } else if (input.estimatedOverflowHours !== null) {
    if (input.estimatedOverflowHours <= 0) {
      urgencyNorm = 1;
    } else if (input.estimatedOverflowHours <= 72) {
      urgencyNorm = Math.exp(-input.estimatedOverflowHours / 20);
    } else {
      urgencyNorm = 0.04;
    }
  }
  const overflowUrgencyComponent = urgencyNorm * 22;

  // Time since last collection: 0h -> 0, >= 72h -> 1.0
  const ageNorm = Math.min(1, Math.max(0, input.hoursSinceLastCollection) / 72);
  const collectionAgeComponent = ageNorm * 10;

  // Zone population density relative to city maximum
  const maxD = Math.max(1, input.maxCityDensity);
  const densityNorm = Math.min(1, Math.max(0, input.zonePopulationDensity) / maxD);
  const densityComponent = densityNorm * 8;

  const rawScore =
    fillComponent +
    rateComponent +
    overflowUrgencyComponent +
    collectionAgeComponent +
    densityComponent;

  const riskScore = Math.round(Math.max(0, Math.min(100, rawScore)) * 10) / 10;
  return {
    riskScore,
    riskLevel: classifyRiskLevel(riskScore),
    factors: {
      fillComponent: Math.round(fillComponent * 10) / 10,
      rateComponent: Math.round(rateComponent * 10) / 10,
      overflowUrgencyComponent: Math.round(overflowUrgencyComponent * 10) / 10,
      collectionAgeComponent: Math.round(collectionAgeComponent * 10) / 10,
      densityComponent: Math.round(densityComponent * 10) / 10,
    },
  };
}
