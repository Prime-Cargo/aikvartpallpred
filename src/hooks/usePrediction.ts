import { useState, useEffect, useCallback } from "react";

interface PredictionResponse {
  prediction_id: string;
  predicted_quantity: number;
  confidence_low: number;
  confidence_high: number;
  model_version: string;
  features_snapshot?: Record<string, unknown> | null;
}

interface PredictionResult {
  data: PredictionResponse | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function usePrediction(
  productId: string | null,
  targetDate: string
): PredictionResult {
  const [data, setData] = useState<PredictionResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch_ = useCallback(async () => {
    if (!productId || !targetDate) {
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/predict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_id: productId,
          target_date: targetDate,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const json = await res.json();

      // Fetch the full prediction to get features_snapshot
      const detailRes = await fetch(`/api/predictions/${json.prediction_id}`);
      if (detailRes.ok) {
        const detail = await detailRes.json();
        json.features_snapshot = detail.features_snapshot;
      }

      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [productId, targetDate]);

  useEffect(() => {
    fetch_();
  }, [fetch_]);

  return { data, loading, error, refetch: fetch_ };
}

export interface AccuracyPoint {
  date: string;
  predicted: number;
  actual: number | null;
}

interface AccuracyResult {
  data: AccuracyPoint[];
  loading: boolean;
}

export function useAccuracyHistory(
  productId: string | null,
  limit = 10
): AccuracyResult {
  const [data, setData] = useState<AccuracyPoint[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!productId) {
      setData([]);
      return;
    }

    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/predictions?product_id=${encodeURIComponent(productId)}&limit=${limit}`
        );
        if (!res.ok) {
          setData([]);
          return;
        }
        const predictions = await res.json();

        const points: AccuracyPoint[] = await Promise.all(
          predictions.map(async (p: any) => {
            const detailRes = await fetch(`/api/predictions/${p.id}`);
            const detail = detailRes.ok ? await detailRes.json() : null;
            return {
              date: p.target_date,
              predicted: p.predicted_qty,
              actual: detail?.outcome?.actual_qty ?? null,
            };
          })
        );

        if (!cancelled) {
          setData(points.reverse());
        }
      } catch {
        if (!cancelled) setData([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [productId, limit]);

  return { data, loading };
}
