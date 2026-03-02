import { serve } from "bun";
import index from "./index.html";
import {
  logPrediction,
  getPrediction,
  getOutcomeForPrediction,
  listPredictions,
} from "./lib/predictions";
import { runMatchOutcomes, runAccuracyReport, runCheckDrift } from "./lib/jobs";
import { getActiveModel, clearModelCache } from "./lib/model-loader";
import { buildFeatureVector } from "./lib/features";
import { olsPredict } from "./lib/regression";
import { runRetrain } from "./lib/training";
import { supabaseSelect } from "./lib/supabase";
import { getProphetForecast } from "./lib/prophet-loader";

const server = serve({
  routes: {
    // Serve index.html for all unmatched routes.
    "/*": index,

    "/api/hello": {
      async GET(req) {
        return Response.json({
          message: "Hello, world!",
          method: "GET",
        });
      },
      async PUT(req) {
        return Response.json({
          message: "Hello, world!",
          method: "PUT",
        });
      },
    },

    "/api/hello/:name": async (req) => {
      const name = req.params.name;
      return Response.json({
        message: `Hello, ${name}!`,
      });
    },

    "/api/predict": {
      async GET() {
        return Response.json({
          endpoint: "POST /api/predict",
          description: "Create a new prediction",
          body: {
            product_id: "string (required)",
            target_date: "YYYY-MM-DD (required)",
            customer_id: "string (optional)",
            features: "object (optional)",
          },
        });
      },
      async POST(req) {
        try {
          const body = await req.json();
          const { product_id, customer_id, target_date, features } = body;

          if (!product_id || !target_date) {
            return Response.json(
              { error: "product_id and target_date are required" },
              { status: 400 }
            );
          }

          // Three-tier fallback: Prophet -> OLS -> historical average
          let predictedQty: number;
          let modelVersion: string;
          let confidence_low: number;
          let confidence_high: number;
          let featuresSnapshot: Record<string, unknown> | null = features ?? null;

          // Tier 1: Prophet (pre-computed forecasts with real confidence intervals)
          const prophetForecast = await getProphetForecast(product_id, target_date);
          if (prophetForecast) {
            predictedQty = Math.max(0, Math.round(prophetForecast.predicted_qty));
            modelVersion = prophetForecast.model_version;
            confidence_low = Math.max(0, Math.round(prophetForecast.yhat_lower));
            confidence_high = Math.max(0, Math.round(prophetForecast.yhat_upper));
          } else {
            // Tier 2: OLS model
            const model = await getActiveModel(product_id);
            if (model) {
              const featureVector = await buildFeatureVector(
                product_id,
                target_date,
                model.normalization
              );
              const raw = olsPredict(featureVector, model.coefficients.weights, model.coefficients.intercept);
              predictedQty = Math.max(0, Math.round(raw));
              modelVersion = model.model_version;
              confidence_low = Math.round(predictedQty * 0.8);
              confidence_high = Math.round(predictedQty * 1.2);
              featuresSnapshot = {
                ...featuresSnapshot,
                feature_vector: featureVector,
                feature_names: model.feature_names,
              };
            } else {
              // Tier 3: Historical average fallback
              const thirtyDaysAgo = new Date();
              thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
              const recentOrders = await supabaseSelect<{ quantity: number }>(
                "order_history",
                `product_id=eq.${product_id}&order_date=gte.${thirtyDaysAgo.toISOString().slice(0, 10)}&select=quantity`
              );
              if (recentOrders.length > 0) {
                const total = recentOrders.reduce((sum, o) => sum + o.quantity, 0);
                predictedQty = Math.round(total / 30);
              } else {
                predictedQty = 0;
              }
              modelVersion = "v0-fallback-avg";
              confidence_low = Math.round(predictedQty * 0.8);
              confidence_high = Math.round(predictedQty * 1.2);
            }
          }

          const prediction = await logPrediction({
            product_id,
            customer_id: customer_id ?? null,
            target_date,
            predicted_qty: predictedQty,
            confidence_low,
            confidence_high,
            model_version: modelVersion,
            features_snapshot: featuresSnapshot,
          });

          return Response.json({
            prediction_id: prediction.id,
            predicted_quantity: prediction.predicted_qty,
            confidence_low: prediction.confidence_low,
            confidence_high: prediction.confidence_high,
            model_version: prediction.model_version,
          });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },

    "/api/predictions": {
      async GET(req) {
        try {
          const url = new URL(req.url);
          const product_id = url.searchParams.get("product_id") ?? undefined;
          const from = url.searchParams.get("from") ?? undefined;
          const to = url.searchParams.get("to") ?? undefined;
          const limit = url.searchParams.get("limit");

          const predictions = await listPredictions({
            product_id,
            from,
            to,
            limit: limit ? parseInt(limit, 10) : undefined,
          });

          return Response.json(predictions);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },

    "/api/predictions/:id": {
      async GET(req) {
        try {
          const { id } = req.params;
          const prediction = await getPrediction(id);
          if (!prediction) {
            return Response.json({ error: "Not found" }, { status: 404 });
          }
          const outcome = await getOutcomeForPrediction(id);
          return Response.json({ ...prediction, outcome });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },

    // --- Job endpoints (called by n8n) ---

    "/api/jobs/match-outcomes": {
      async POST(req) {
        try {
          const body = await req.json().catch(() => ({}));
          const result = await runMatchOutcomes(body.target_date);
          return Response.json(result);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },

    "/api/jobs/accuracy-report": {
      async POST(req) {
        try {
          const body = await req.json().catch(() => ({}));
          const report = await runAccuracyReport(body.days ?? 7);
          return Response.json(report);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },

    "/api/jobs/check-drift": {
      async POST(req) {
        try {
          const body = await req.json().catch(() => ({}));
          const result = await runCheckDrift(body.days ?? 7, body.threshold ?? 25);
          return Response.json(result);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },

    "/api/jobs/retrain": {
      async POST(req) {
        try {
          const result = await runRetrain();
          clearModelCache();
          return Response.json(result);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },

    "/api/jobs/retrain-prophet": {
      async POST(req) {
        try {
          const result = await Bun.$`cd ${import.meta.dir}/../python && python train_prophet.py --all`.json();
          return Response.json(result);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },

    "/api/jobs/retrain-baseline": {
      async POST(req) {
        try {
          const result = await Bun.$`cd ${import.meta.dir}/../python && python train_baseline.py`.json();
          return Response.json(result);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },

    "/api/jobs/evaluate-models": {
      async POST(req) {
        try {
          const result = await Bun.$`cd ${import.meta.dir}/../python && python evaluate.py`.json();
          return Response.json(result);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },
  },

  development: process.env.NODE_ENV !== "production" && {
    // Enable browser hot reloading in development
    hmr: true,

    // Echo console logs from the browser to the server
    console: true,
  },
});

console.log(`🚀 Server running at ${server.url}`);
