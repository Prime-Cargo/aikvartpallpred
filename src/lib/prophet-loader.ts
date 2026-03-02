/**
 * Read pre-computed Prophet forecasts from Supabase.
 */

import { supabaseSelect } from "./supabase";

interface ProphetForecast {
  id: string;
  product_id: string;
  target_date: string;
  predicted_qty: number;
  yhat_lower: number;
  yhat_upper: number;
  model_version: string;
  created_at: string;
}

/**
 * Get the latest Prophet forecast for a product on a specific date.
 */
export async function getProphetForecast(
  productId: string,
  targetDate: string
): Promise<ProphetForecast | null> {
  const rows = await supabaseSelect<ProphetForecast>(
    "prophet_forecasts",
    `product_id=eq.${productId}&target_date=eq.${targetDate}&order=created_at.desc&limit=1`
  );
  return rows[0] ?? null;
}

/**
 * Get the next 7 days of Prophet forecasts for a product.
 */
export async function getProphetForecasts7d(
  productId: string
): Promise<ProphetForecast[]> {
  const today = new Date().toISOString().slice(0, 10);
  return supabaseSelect<ProphetForecast>(
    "prophet_forecasts",
    `product_id=eq.${productId}&target_date=gte.${today}&order=target_date.asc&limit=7`
  );
}
