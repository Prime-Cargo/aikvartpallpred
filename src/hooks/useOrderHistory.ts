import { useState, useEffect } from "react";

export interface WeeklySales {
  week_label: string;
  week_start: string;
  total_qty: number;
  order_count: number;
}

interface OrderHistoryResult {
  data: WeeklySales[];
  loading: boolean;
}

export function useOrderHistory(productId: string | null, weeks = 12): OrderHistoryResult {
  const [data, setData] = useState<WeeklySales[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!productId) {
      setData([]);
      return;
    }

    let cancelled = false;
    setLoading(true);

    fetch(`/api/products/${encodeURIComponent(productId)}/order-history?weeks=${weeks}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json) => {
        if (!cancelled) setData(json.weeks ?? []);
      })
      .catch(() => {
        if (!cancelled) setData([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [productId, weeks]);

  return { data, loading };
}
