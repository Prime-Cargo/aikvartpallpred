/**
 * Retrain job — trains per-product OLS models and stores in Supabase.
 */

import { supabaseSelect, supabaseInsert, supabasePatch } from "./supabase";
import { olsFit } from "./regression";
import { gatherTrainingData, FEATURE_NAMES, type Normalization } from "./features";

export interface RetrainResult {
  models_trained: number;
  models_failed: number;
  total_products: number;
  details: { product_id: string; status: "ok" | "error"; message?: string; r2?: number }[];
}

interface TrainedModelRow {
  product_id: string;
  model_version: string;
  coefficients: { intercept: number; weights: number[] };
  feature_names: string[];
  normalization: Normalization;
  metrics: { r2: number; rmse: number; n_samples: number };
  training_range: { from: string; to: string; n_days: number };
  is_active: boolean;
}

export async function runRetrain(): Promise<RetrainResult> {
  // Get all distinct product_ids from orders
  const products = await supabaseSelect<{ product_id: string }>(
    "order_history",
    "select=product_id&order=product_id.asc"
  );

  const uniqueProducts = [...new Set(products.map((p) => p.product_id))];
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  const from = "2024-09-01"; // start of available data
  const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  // Get current max version number
  const existingModels = await supabaseSelect<{ model_version: string }>(
    "trained_models",
    "select=model_version&order=trained_at.desc&limit=1"
  );
  let versionNum = 1;
  const latestModel = existingModels[0];
  if (latestModel) {
    const match = latestModel.model_version.match(/^v(\d+)/);
    if (match?.[1]) versionNum = parseInt(match[1], 10) + 1;
  }

  const details: RetrainResult["details"] = [];

  for (const productId of uniqueProducts) {
    try {
      const data = await gatherTrainingData(productId, from, to);
      if (!data) {
        details.push({ product_id: productId, status: "error", message: "Insufficient data (<30 days)" });
        continue;
      }

      const result = olsFit(data.X, data.y);
      const modelVersion = `v${versionNum}-lr-${monthStr}`;

      // Deactivate existing active models for this product
      await supabasePatch<TrainedModelRow>(
        "trained_models",
        `product_id=eq.${productId}&is_active=eq.true`,
        { is_active: false } as Partial<TrainedModelRow>
      );

      // Insert new model
      await supabaseInsert<TrainedModelRow>("trained_models", {
        product_id: productId,
        model_version: modelVersion,
        coefficients: { intercept: result.intercept, weights: result.coefficients },
        feature_names: [...FEATURE_NAMES],
        normalization: data.normalization,
        metrics: { r2: result.r2, rmse: result.rmse, n_samples: data.X.length },
        training_range: data.dateRange,
        is_active: true,
      });

      details.push({
        product_id: productId,
        status: "ok",
        r2: Math.round(result.r2 * 1000) / 1000,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      details.push({ product_id: productId, status: "error", message });
    }
  }

  return {
    models_trained: details.filter((d) => d.status === "ok").length,
    models_failed: details.filter((d) => d.status === "error").length,
    total_products: uniqueProducts.length,
    details,
  };
}
