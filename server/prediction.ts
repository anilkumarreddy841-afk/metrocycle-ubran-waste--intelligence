import type { FillHistoryRecord, PredictionRecord } from './types.ts';
import { computeOverflowRisk } from './risk_engine.ts';

export interface BinPredictionInput {
  binId: number;
  currentFillLevel: number;
  lastCollectionDate: string;
  zonePopulationDensity: number;
  maxCityDensity: number;
  history: FillHistoryRecord[];
  horizonHours: number;
  preferredModel: 'Random Forest Regression' | 'Linear Regression';
}

export interface ModelMetrics {
  mae: number | null;
  rmse: number | null;
  trainSamples: number;
  testSamples: number;
}

export interface PredictionOutput {
  binId: number;
  predictedFillLevel: number;
  lrPredictedFillLevel: number;
  rfPredictedFillLevel: number;
  estimatedOverflowHours: number | null;
  fillRatePerHour: number;
  riskScore: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  modelName: string;
  confidence: string;
  mae: number | null;
  rmse: number | null;
  lrMetrics: ModelMetrics;
  rfMetrics: ModelMetrics;
  isFallback: boolean;
  riskFactors: {
    fillComponent: number;
    rateComponent: number;
    overflowUrgencyComponent: number;
    collectionAgeComponent: number;
    densityComponent: number;
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function computeErrors(actuals: number[], preds: number[]): { mae: number; rmse: number } {
  if (actuals.length === 0) return { mae: 0, rmse: 0 };
  let sumAbs = 0;
  let sumSq = 0;
  for (let i = 0; i < actuals.length; i++) {
    const err = actuals[i] - preds[i];
    sumAbs += Math.abs(err);
    sumSq += err * err;
  }
  const mae = Math.round((sumAbs / actuals.length) * 100) / 100;
  const rmse = Math.round(Math.sqrt(sumSq / actuals.length) * 100) / 100;
  return { mae, rmse };
}

/**
 * Simple Ordinary Least Squares Linear Regression: y = intercept + slope * x
 * Uses weighted recency or pure OLS over hours elapsed in recent cycle.
 */
function fitLinearRegression(xs: number[], ys: number[]): { slope: number; intercept: number } {
  const n = xs.length;
  if (n < 2) return { slope: 0, intercept: ys[0] ?? 0 };
  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i++) {
    sumX += xs[i];
    sumY += ys[i];
  }
  const meanX = sumX / n;
  const meanY = sumY / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    num += dx * (ys[i] - meanY);
    den += dx * dx;
  }
  const slope = den > 1e-9 ? num / den : 0;
  const intercept = meanY - slope * meanX;
  return { slope, intercept };
}

/**
 * Lightweight CART Decision Tree Regressor for Random Forest Ensemble
 */
interface TreeNode {
  isLeaf: boolean;
  value?: number;
  featureIdx?: number;
  threshold?: number;
  left?: TreeNode;
  right?: TreeNode;
}

function buildRegressionTree(
  X: number[][],
  y: number[],
  depth: number,
  maxDepth: number,
  minSamplesSplit: number,
  featureSubsetSize: number,
  seedState: { s: number }
): TreeNode {
  const mean = y.reduce((a, b) => a + b, 0) / Math.max(1, y.length);
  if (depth >= maxDepth || y.length < minSamplesSplit) {
    return { isLeaf: true, value: mean };
  }

  // Check if all y values are effectively identical
  let minY = y[0];
  let maxY = y[0];
  for (let i = 1; i < y.length; i++) {
    if (y[i] < minY) minY = y[i];
    if (y[i] > maxY) maxY = y[i];
  }
  if (maxY - minY < 1e-4) {
    return { isLeaf: true, value: mean };
  }

  const numFeatures = X[0].length;
  const indices = Array.from({ length: numFeatures }, (_, i) => i);
  // Deterministic PRNG shuffle for feature subspacing
  for (let i = indices.length - 1; i > 0; i--) {
    seedState.s = (seedState.s * 1664525 + 1013904223) >>> 0;
    const j = seedState.s % (i + 1);
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  const selectedFeatures = indices.slice(0, Math.min(featureSubsetSize, numFeatures));

  let bestFeature = -1;
  let bestThreshold = 0;
  let bestScore = Infinity;
  let bestLeftIdx: number[] = [];
  let bestRightIdx: number[] = [];

  for (const fIdx of selectedFeatures) {
    const vals = Array.from(new Set(X.map((row) => row[fIdx]))).sort((a, b) => a - b);
    if (vals.length < 2) continue;

    for (let v = 0; v < vals.length - 1; v++) {
      const thresh = (vals[v] + vals[v + 1]) / 2;
      const leftIdx: number[] = [];
      const rightIdx: number[] = [];
      for (let i = 0; i < X.length; i++) {
        if (X[i][fIdx] <= thresh) leftIdx.push(i);
        else rightIdx.push(i);
      }
      if (leftIdx.length === 0 || rightIdx.length === 0) continue;

      let leftMean = 0;
      for (const i of leftIdx) leftMean += y[i];
      leftMean /= leftIdx.length;

      let rightMean = 0;
      for (const i of rightIdx) rightMean += y[i];
      rightMean /= rightIdx.length;

      let sse = 0;
      for (const i of leftIdx) sse += (y[i] - leftMean) ** 2;
      for (const i of rightIdx) sse += (y[i] - rightMean) ** 2;

      if (sse < bestScore) {
        bestScore = sse;
        bestFeature = fIdx;
        bestThreshold = thresh;
        bestLeftIdx = leftIdx;
        bestRightIdx = rightIdx;
      }
    }
  }

  if (bestFeature === -1) {
    return { isLeaf: true, value: mean };
  }

  return {
    isLeaf: false,
    featureIdx: bestFeature,
    threshold: bestThreshold,
    left: buildRegressionTree(
      bestLeftIdx.map((i) => X[i]),
      bestLeftIdx.map((i) => y[i]),
      depth + 1,
      maxDepth,
      minSamplesSplit,
      featureSubsetSize,
      seedState
    ),
    right: buildRegressionTree(
      bestRightIdx.map((i) => X[i]),
      bestRightIdx.map((i) => y[i]),
      depth + 1,
      maxDepth,
      minSamplesSplit,
      featureSubsetSize,
      seedState
    ),
  };
}

function predictTree(node: TreeNode, row: number[]): number {
  if (node.isLeaf || node.featureIdx === undefined || node.threshold === undefined) {
    return node.value ?? 0;
  }
  if (row[node.featureIdx] <= node.threshold) {
    return node.left ? predictTree(node.left, row) : (node.value ?? 0);
  }
  return node.right ? predictTree(node.right, row) : (node.value ?? 0);
}

class RandomForestRegressor {
  private trees: TreeNode[] = [];

  fit(X: number[][], y: number[], nEstimators = 15, maxDepth = 4, seed = 42): void {
    this.trees = [];
    if (X.length === 0) return;
    const seedState = { s: seed };
    const featureSubset = Math.max(1, Math.ceil(Math.sqrt(X[0].length)));

    for (let t = 0; t < nEstimators; t++) {
      const sampleX: number[][] = [];
      const sampleY: number[] = [];
      for (let i = 0; i < X.length; i++) {
        seedState.s = (seedState.s * 1664525 + 1013904223) >>> 0;
        const idx = seedState.s % X.length;
        sampleX.push(X[idx]);
        sampleY.push(y[idx]);
      }
      this.trees.push(buildRegressionTree(sampleX, sampleY, 0, maxDepth, 2, featureSubset, seedState));
    }
  }

  predict(row: number[]): number {
    if (this.trees.length === 0) return 0;
    let sum = 0;
    for (const tree of this.trees) {
      sum += predictTree(tree, row);
    }
    return sum / this.trees.length;
  }
}

/**
 * Extracts active accumulation cycle segments from history.
 * When a bin is collected, fill drops sharply (e.g., drop > 25%); we segment cycles
 * so fill rate reflects accumulation rather than collection resets.
 */
function buildCycleSamples(history: FillHistoryRecord[], zoneDensity: number) {
  const sorted = [...history].sort(
    (a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime()
  );

  // Build consecutive step pairs (t_prev -> t_curr) ignoring collection drops (> 20% decrease)
  const stepPairs: {
    tHours: number;
    dtHours: number;
    prevFill: number;
    currFill: number;
    deltaFill: number;
    hourlyRate: number;
    hourSin: number;
    hourCos: number;
    density: number;
  }[] = [];

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const dtMs = new Date(curr.recorded_at).getTime() - new Date(prev.recorded_at).getTime();
    const dtHours = dtMs / (1000 * 60 * 60);
    if (dtHours <= 0.01) continue;

    const deltaFill = curr.fill_percentage - prev.fill_percentage;
    // Skip collection reset transitions where fill drops dramatically
    if (deltaFill < -20) continue;

    const currDate = new Date(curr.recorded_at);
    const hour = currDate.getUTCHours();
    const hourlyRate = deltaFill / dtHours;

    stepPairs.push({
      tHours: dtHours,
      dtHours,
      prevFill: prev.fill_percentage,
      currFill: curr.fill_percentage,
      deltaFill,
      hourlyRate,
      hourSin: Math.sin((2 * Math.PI * hour) / 24),
      hourCos: Math.cos((2 * Math.PI * hour) / 24),
      density: zoneDensity,
    });
  }

  // Also extract only the most recent monotonic accumulation cycle for linear trend
  let cycleStartIdx = 0;
  for (let i = sorted.length - 1; i > 0; i--) {
    if (sorted[i].fill_percentage - sorted[i - 1].fill_percentage < -20) {
      cycleStartIdx = i;
      break;
    }
  }
  const latestCycle = sorted.slice(cycleStartIdx);

  return { sorted, stepPairs, latestCycle };
}

export function runBinPrediction(input: BinPredictionInput): PredictionOutput {
  const nowMs = Date.now();
  const lastCollMs = new Date(input.lastCollectionDate).getTime();
  const hoursSinceLastCollection = Number.isFinite(lastCollMs)
    ? Math.max(0, (nowMs - lastCollMs) / (1000 * 60 * 60))
    : 24;

  const { stepPairs, latestCycle } = buildCycleSamples(input.history, input.zonePopulationDensity);

  // Insufficient historical data -> clearly labelled fallback estimate (no fake ML accuracy!)
  if (input.history.length < 5 || stepPairs.length < 4) {
    // Simple conservative heuristic fallback based on any available delta or density-scaled baseline
    let fallbackRate = 1.2 + (input.zonePopulationDensity / Math.max(1, input.maxCityDensity)) * 1.3;
    if (latestCycle.length >= 2) {
      const first = latestCycle[0];
      const last = latestCycle[latestCycle.length - 1];
      const dt = (new Date(last.recorded_at).getTime() - new Date(first.recorded_at).getTime()) / 3600000;
      if (dt > 0.25 && last.fill_percentage >= first.fill_percentage) {
        fallbackRate = (last.fill_percentage - first.fill_percentage) / dt;
      }
    }
    fallbackRate = Math.round(clamp(fallbackRate, 0, 15) * 100) / 100;
    const predictedFill = Math.round(
      clamp(input.currentFillLevel + fallbackRate * input.horizonHours, 0, 100) * 10
    ) / 10;

    let overflowHours: number | null = null;
    if (input.currentFillLevel >= 100) {
      overflowHours = 0;
    } else if (fallbackRate > 0.05) {
      overflowHours = Math.round(((100 - input.currentFillLevel) / fallbackRate) * 10) / 10;
    }

    const risk = computeOverflowRisk({
      currentFillLevel: input.currentFillLevel,
      fillRatePerHour: fallbackRate,
      estimatedOverflowHours: overflowHours,
      hoursSinceLastCollection,
      zonePopulationDensity: input.zonePopulationDensity,
      maxCityDensity: input.maxCityDensity,
    });

    return {
      binId: input.binId,
      predictedFillLevel: predictedFill,
      lrPredictedFillLevel: predictedFill,
      rfPredictedFillLevel: predictedFill,
      estimatedOverflowHours: overflowHours,
      fillRatePerHour: fallbackRate,
      riskScore: risk.riskScore,
      riskLevel: risk.riskLevel,
      modelName: 'Heuristic Fallback (Insufficient History)',
      confidence: 'Low — Fallback Estimate (<5 historical readings)',
      mae: null,
      rmse: null,
      lrMetrics: { mae: null, rmse: null, trainSamples: input.history.length, testSamples: 0 },
      rfMetrics: { mae: null, rmse: null, trainSamples: input.history.length, testSamples: 0 },
      isFallback: true,
      riskFactors: risk.factors,
    };
  }

  // Chronological 80/20 held-out split on stepPairs to test actual out-of-sample MAE & RMSE
  const splitIdx = Math.max(2, Math.floor(stepPairs.length * 0.8));
  const trainPairs = stepPairs.slice(0, splitIdx);
  const testPairs = stepPairs.slice(splitIdx);

  // 1. Linear Regression evaluation: predict next fill = prevFill + slope * dt
  // Fit OLS on latest cycle for slope, and on trainPairs (dtHours -> deltaFill)
  const trainXs = trainPairs.map((p) => p.dtHours);
  const trainDeltaYs = trainPairs.map((p) => p.deltaFill);
  const { slope: lrStepRate } = fitLinearRegression(trainXs, trainDeltaYs);

  // Also compute trend on latest monotonic cycle if >= 2 points
  let cycleSlope = lrStepRate;
  if (latestCycle.length >= 2) {
    const t0 = new Date(latestCycle[0].recorded_at).getTime();
    const xs = latestCycle.map((r) => (new Date(r.recorded_at).getTime() - t0) / 3600000);
    const ys = latestCycle.map((r) => r.fill_percentage);
    const fit = fitLinearRegression(xs, ys);
    cycleSlope = fit.slope;
  }

  // Evaluate LR on held-out test set
  const lrTestActuals = testPairs.map((p) => p.currFill);
  const lrTestPreds = testPairs.map((p) => clamp(p.prevFill + lrStepRate * p.dtHours, 0, 100));
  const lrEval = computeErrors(lrTestActuals, lrTestPreds);

  // 2. Random Forest Regression evaluation: predict hourly fill rate given [prevFill, dtHours, hourSin, hourCos, density]
  const makeFeatures = (p: (typeof stepPairs)[number]) => [
    p.prevFill,
    p.dtHours,
    p.hourSin,
    p.hourCos,
    p.density,
  ];
  const rfTrainX = trainPairs.map(makeFeatures);
  const rfTrainY = trainPairs.map((p) => p.hourlyRate);

  const rf = new RandomForestRegressor();
  rf.fit(rfTrainX, rfTrainY, 15, 4, input.binId * 97 + 13);

  const rfTestPreds = testPairs.map((p) => {
    const predRate = rf.predict(makeFeatures(p));
    return clamp(p.prevFill + predRate * p.dtHours, 0, 100);
  });
  const rfEval = computeErrors(lrTestActuals, rfTestPreds);

  // Refit full-history RF & LR on all stepPairs for forward forecasting
  const fullRf = new RandomForestRegressor();
  fullRf.fit(
    stepPairs.map(makeFeatures),
    stepPairs.map((p) => p.hourlyRate),
    15,
    4,
    input.binId * 97 + 13
  );

  const fullLr = fitLinearRegression(
    stepPairs.map((p) => p.dtHours),
    stepPairs.map((p) => p.deltaFill)
  );

  const nowDate = new Date();
  const futureHour = (nowDate.getUTCHours() + Math.round(input.horizonHours / 2)) % 24;
  const forwardFeatures = [
    input.currentFillLevel,
    Math.min(12, input.horizonHours),
    Math.sin((2 * Math.PI * futureHour) / 24),
    Math.cos((2 * Math.PI * futureHour) / 24),
    input.zonePopulationDensity,
  ];

  const rfPredictedRate = fullRf.predict(forwardFeatures);
  const lrPredictedRate = latestCycle.length >= 2 ? (cycleSlope + fullLr.slope) / 2 : fullLr.slope;

  const lrPredFill = Math.round(
    clamp(input.currentFillLevel + lrPredictedRate * input.horizonHours, 0, 100) * 10
  ) / 10;
  const rfPredFill = Math.round(
    clamp(input.currentFillLevel + rfPredictedRate * input.horizonHours, 0, 100) * 10
  ) / 10;

  const useRf = input.preferredModel === 'Random Forest Regression';
  const activeRate = Math.round((useRf ? rfPredictedRate : lrPredictedRate) * 100) / 100;
  const activePredFill = useRf ? rfPredFill : lrPredFill;
  const activeEval = useRf ? rfEval : lrEval;

  // Safe handling of zero or negative fill rates
  let estimatedOverflowHours: number | null = null;
  if (input.currentFillLevel >= 100) {
    estimatedOverflowHours = 0;
  } else if (activeRate > 0.05) {
    estimatedOverflowHours =
      Math.round(((100 - input.currentFillLevel) / activeRate) * 10) / 10;
  } else {
    estimatedOverflowHours = null; // Stable / non-increasing
  }

  const confidenceLabel =
    activeEval.rmse <= 4
      ? `High (±${activeEval.rmse}% RMSE on ${testPairs.length} held-out samples)`
      : activeEval.rmse <= 9
        ? `Moderate (±${activeEval.rmse}% RMSE on ${testPairs.length} held-out samples)`
        : `Low (±${activeEval.rmse}% RMSE on ${testPairs.length} held-out samples)`;

  const risk = computeOverflowRisk({
    currentFillLevel: input.currentFillLevel,
    fillRatePerHour: activeRate,
    estimatedOverflowHours,
    hoursSinceLastCollection,
    zonePopulationDensity: input.zonePopulationDensity,
    maxCityDensity: input.maxCityDensity,
  });

  return {
    binId: input.binId,
    predictedFillLevel: activePredFill,
    lrPredictedFillLevel: lrPredFill,
    rfPredictedFillLevel: rfPredFill,
    estimatedOverflowHours,
    fillRatePerHour: activeRate,
    riskScore: risk.riskScore,
    riskLevel: risk.riskLevel,
    modelName: input.preferredModel,
    confidence: confidenceLabel,
    mae: activeEval.mae,
    rmse: activeEval.rmse,
    lrMetrics: {
      mae: lrEval.mae,
      rmse: lrEval.rmse,
      trainSamples: trainPairs.length,
      testSamples: testPairs.length,
    },
    rfMetrics: {
      mae: rfEval.mae,
      rmse: rfEval.rmse,
      trainSamples: trainPairs.length,
      testSamples: testPairs.length,
    },
    isFallback: false,
    riskFactors: risk.factors,
  };
}

export function formatPredictionSummary(pred: PredictionRecord) {
  return {
    ...pred,
    is_fallback: Boolean(pred.is_fallback),
  };
}
