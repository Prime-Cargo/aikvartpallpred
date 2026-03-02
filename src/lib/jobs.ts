/**
 * Job functions — reusable logic for match-outcomes, accuracy-report, check-drift.
 * Called by both CLI scripts and API endpoints.
 */

import { supabaseSelect } from "./supabase";
import { logOutcome, getPredictionsForDate, getOutcomesInRange } from "./predictions";

// --- Match Outcomes ---

interface OrderRow {
  product_id: string;
  customer_id: string | null;
  quantity: number;
}

export interface MatchResult {
  target_date: string;
  total_predictions: number;
  matched: number;
  unmatched: number;
}

export async function runMatchOutcomes(targetDate?: string): Promise<MatchResult> {
  const date = targetDate ?? yesterday();

  const predictions = await getPredictionsForDate(date);
  if (predictions.length === 0) {
    return { target_date: date, total_predictions: 0, matched: 0, unmatched: 0 };
  }

  const actuals = await supabaseSelect<OrderRow>(
    "order_history",
    `order_date=eq.${date}&select=product_id,customer_id,quantity`
  );

  const actualByProduct = new Map<string, number>();
  for (const row of actuals) {
    actualByProduct.set(row.product_id, (actualByProduct.get(row.product_id) ?? 0) + row.quantity);
  }

  let matched = 0;
  let unmatched = 0;

  for (const pred of predictions) {
    const actualQty = actualByProduct.get(pred.product_id);
    if (actualQty === undefined) {
      unmatched++;
      continue;
    }
    await logOutcome(pred.id!, actualQty, pred.predicted_qty);
    matched++;
  }

  return { target_date: date, total_predictions: predictions.length, matched, unmatched };
}

// --- Accuracy Report ---

export interface ProductMetrics {
  product_id: string;
  count: number;
  mape: number;
  bias: number;
}

export interface AccuracyReport {
  period: { from: string; to: string; days: number };
  total_outcomes: number;
  mape: number;
  bias: number;
  by_product: ProductMetrics[];
  worst_predictions: {
    prediction_id: string;
    product_id: string;
    error: number;
    error_percent: number;
    actual_qty: number;
  }[];
  drift_alert: boolean;
}

const DRIFT_THRESHOLD = 25;

export async function runAccuracyReport(days = 7): Promise<AccuracyReport> {
  const from = daysAgo(days);
  const to = new Date().toISOString();

  const outcomes = await getOutcomesInRange(from, to);

  if (outcomes.length === 0) {
    return {
      period: { from, to, days },
      total_outcomes: 0,
      mape: 0,
      bias: 0,
      by_product: [],
      worst_predictions: [],
      drift_alert: false,
    };
  }

  const withPercent = outcomes.filter((o) => o.error_percent !== null);

  const mape =
    withPercent.length > 0
      ? withPercent.reduce((sum, o) => sum + Math.abs(o.error_percent!), 0) / withPercent.length
      : 0;

  const bias = outcomes.reduce((sum, o) => sum + o.error, 0) / outcomes.length;

  const byProductMap = new Map<string, { errors: number[]; absPercents: number[] }>();
  for (const o of outcomes) {
    const pid = o.product_id ?? "unknown";
    if (!byProductMap.has(pid)) byProductMap.set(pid, { errors: [], absPercents: [] });
    const bucket = byProductMap.get(pid)!;
    bucket.errors.push(o.error);
    if (o.error_percent !== null) bucket.absPercents.push(Math.abs(o.error_percent));
  }

  const byProduct: ProductMetrics[] = [...byProductMap.entries()]
    .map(([product_id, { errors, absPercents }]) => ({
      product_id,
      count: errors.length,
      mape: absPercents.length > 0 ? absPercents.reduce((a, b) => a + b, 0) / absPercents.length : 0,
      bias: errors.reduce((a, b) => a + b, 0) / errors.length,
    }))
    .sort((a, b) => b.mape - a.mape);

  const worst = [...withPercent]
    .sort((a, b) => Math.abs(b.error_percent!) - Math.abs(a.error_percent!))
    .slice(0, 5)
    .map((o) => ({
      prediction_id: o.prediction_id,
      product_id: o.product_id ?? "unknown",
      error: o.error,
      error_percent: Math.round(o.error_percent! * 100) / 100,
      actual_qty: o.actual_qty,
    }));

  const driftAlert = mape > DRIFT_THRESHOLD;

  return {
    period: { from, to, days },
    total_outcomes: outcomes.length,
    mape: Math.round(mape * 100) / 100,
    bias: Math.round(bias * 100) / 100,
    by_product: byProduct,
    worst_predictions: worst,
    drift_alert: driftAlert,
  };
}

// --- Drift Check ---

export interface DriftResult {
  status: "ok" | "drift";
  mape: number;
  threshold: number;
  days: number;
  total_outcomes: number;
  message: string;
}

export async function runCheckDrift(days = 7, threshold = 25): Promise<DriftResult> {
  const from = daysAgo(days);
  const to = new Date().toISOString();

  const outcomes = await getOutcomesInRange(from, to);

  if (outcomes.length === 0) {
    return {
      status: "ok",
      mape: 0,
      threshold,
      days,
      total_outcomes: 0,
      message: "No outcomes in period — nothing to check.",
    };
  }

  const withPercent = outcomes.filter((o) => o.error_percent !== null);
  const mape =
    withPercent.length > 0
      ? withPercent.reduce((sum, o) => sum + Math.abs(o.error_percent!), 0) / withPercent.length
      : 0;

  const roundedMape = Math.round(mape * 100) / 100;
  const isDrift = roundedMape > threshold;

  return {
    status: isDrift ? "drift" : "ok",
    mape: roundedMape,
    threshold,
    days,
    total_outcomes: outcomes.length,
    message: isDrift
      ? `DRIFT DETECTED: ${days}-day MAPE is ${roundedMape}% (threshold: ${threshold}%)`
      : `OK: ${days}-day MAPE is ${roundedMape}% (threshold: ${threshold}%)`,
  };
}

// --- Helpers ---

function yesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}
