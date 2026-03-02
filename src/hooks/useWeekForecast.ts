import { useState, useEffect } from "react";

export interface DayForecast {
  date: string;
  predicted_qty: number | null;
  confidence_low: number | null;
  confidence_high: number | null;
  model_version: string | null;
}

export interface WeekForecast {
  product_id: string;
  week_start: string;
  week_end: string;
  days: DayForecast[];
}

export function useWeekForecast(productId: string | null, refDate: string) {
  const [data, setData] = useState<WeekForecast | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!productId) {
      setData(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    fetch(`/api/products/${encodeURIComponent(productId)}/week?date=${refDate}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json) => {
        if (!cancelled) setData(json);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [productId, refDate]);

  return { data, loading };
}
