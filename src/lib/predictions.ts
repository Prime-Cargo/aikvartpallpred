import { supabaseInsert, supabaseSelect } from "./supabase";

// --- Types ---

export interface Prediction {
  id?: string;
  product_id: string;
  customer_id?: string | null;
  target_date: string; // YYYY-MM-DD
  predicted_qty: number;
  confidence_low?: number | null;
  confidence_high?: number | null;
  model_version: string;
  features_snapshot?: Record<string, unknown> | null;
  created_at?: string;
}

export interface PredictionOutcome {
  id?: string;
  prediction_id: string;
  actual_qty: number;
  error: number;
  error_percent: number | null;
  matched_at?: string;
}

// --- Helpers ---

export async function logPrediction(data: Omit<Prediction, "id" | "created_at">): Promise<Prediction> {
  return supabaseInsert<Prediction>("predictions", data);
}

export async function logOutcome(predictionId: string, actualQty: number, predictedQty: number): Promise<PredictionOutcome> {
  const error = actualQty - predictedQty;
  const errorPercent = actualQty !== 0 ? (error / actualQty) * 100 : null;

  return supabaseInsert<PredictionOutcome>("prediction_outcomes", {
    prediction_id: predictionId,
    actual_qty: actualQty,
    error,
    error_percent: errorPercent,
  });
}

export async function getPrediction(id: string): Promise<Prediction | null> {
  const rows = await supabaseSelect<Prediction>("predictions", `id=eq.${id}`);
  return rows[0] ?? null;
}

export async function listPredictions(filters?: {
  product_id?: string;
  from?: string;
  to?: string;
  limit?: number;
}): Promise<Prediction[]> {
  const parts: string[] = ["order=created_at.desc"];
  if (filters?.product_id) parts.push(`product_id=eq.${filters.product_id}`);
  if (filters?.from) parts.push(`target_date=gte.${filters.from}`);
  if (filters?.to) parts.push(`target_date=lte.${filters.to}`);
  parts.push(`limit=${filters?.limit ?? 50}`);
  return supabaseSelect<Prediction>("predictions", parts.join("&"));
}

export async function getOutcomeForPrediction(predictionId: string): Promise<PredictionOutcome | null> {
  const rows = await supabaseSelect<PredictionOutcome>(
    "prediction_outcomes",
    `prediction_id=eq.${predictionId}`
  );
  return rows[0] ?? null;
}

export async function getOutcomesInRange(from: string, to: string): Promise<(PredictionOutcome & { predicted_qty?: number; product_id?: string })[]> {
  // Join outcomes with predictions via PostgREST embedded resource
  const query = `matched_at=gte.${from}&matched_at=lte.${to}&select=*,predictions(predicted_qty,product_id)&order=matched_at.desc`;
  const rows = await supabaseSelect<PredictionOutcome & { predictions: { predicted_qty: number; product_id: string } }>(
    "prediction_outcomes",
    query
  );
  return rows.map((r) => ({
    ...r,
    predicted_qty: r.predictions?.predicted_qty,
    product_id: r.predictions?.product_id,
  }));
}

export async function getPredictionsForDate(targetDate: string): Promise<Prediction[]> {
  return supabaseSelect<Prediction>("predictions", `target_date=eq.${targetDate}&order=created_at.desc`);
}
