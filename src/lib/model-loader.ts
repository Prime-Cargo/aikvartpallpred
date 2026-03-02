/**
 * Cached model loader — loads active model coefficients from Supabase
 * with a 5-minute in-memory cache per product.
 */

import { supabaseSelect } from "./supabase";
import type { Normalization } from "./features";

export interface ActiveModel {
  product_id: string;
  model_version: string;
  coefficients: { intercept: number; weights: number[] };
  normalization: Normalization;
  feature_names: string[];
  metrics: { r2: number; rmse: number; n_samples: number };
}

interface CacheEntry {
  model: ActiveModel | null;
  cachedAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const cache = new Map<string, CacheEntry>();

export async function getActiveModel(productId: string): Promise<ActiveModel | null> {
  const now = Date.now();
  const cached = cache.get(productId);
  if (cached && now - cached.cachedAt < CACHE_TTL_MS) {
    return cached.model;
  }

  const rows = await supabaseSelect<ActiveModel>(
    "trained_models",
    `product_id=eq.${productId}&is_active=eq.true&select=product_id,model_version,coefficients,normalization,feature_names,metrics&limit=1`
  );

  const model = rows[0] ?? null;
  cache.set(productId, { model, cachedAt: now });
  return model;
}

/** Clear cache (useful after retraining). */
export function clearModelCache(): void {
  cache.clear();
}
