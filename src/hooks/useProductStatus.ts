import { useState, useEffect } from "react";

export interface ProductStatus {
  product_id: string;
  description: string;
  model_type: "prophet" | "ols" | "none";
  predicted_qty: number | null;
  confidence_low: number | null;
  confidence_high: number | null;
  model_version: string | null;
}

export function useProductStatus(targetDate: string) {
  const [data, setData] = useState<ProductStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!targetDate) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`/api/products/status?target_date=${targetDate}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json) => {
        if (!cancelled) setData(json);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [targetDate]);

  return { data, loading, error };
}
