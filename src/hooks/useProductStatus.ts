import { useState, useEffect, useCallback, useRef } from "react";

export interface ProductStatus {
  product_id: string;
  description: string;
  model_type: "prophet" | "ols" | "none";
  predicted_qty: number | null;
  confidence_low: number | null;
  confidence_high: number | null;
  model_version: string | null;
}

const POLL_INTERVAL = 15_000; // 15 seconds

export function useProductStatus(targetDate: string) {
  const [data, setData] = useState<ProductStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMounted = useRef(true);

  const fetchStatus = useCallback(async (showLoading: boolean) => {
    if (!targetDate) return;
    if (showLoading) setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/products/status?target_date=${targetDate}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (isMounted.current) setData(json);
    } catch (err: any) {
      if (isMounted.current) setError(err.message);
    } finally {
      if (isMounted.current && showLoading) setLoading(false);
    }
  }, [targetDate]);

  // Initial fetch (with loading spinner)
  useEffect(() => {
    isMounted.current = true;
    fetchStatus(true);
    return () => { isMounted.current = false; };
  }, [fetchStatus]);

  // Polling (silent refresh, no loading spinner)
  useEffect(() => {
    const id = setInterval(() => fetchStatus(false), POLL_INTERVAL);
    return () => clearInterval(id);
  }, [fetchStatus]);

  return { data, loading, error, refetch: () => fetchStatus(false) };
}
