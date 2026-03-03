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
import { ALLOWED_ARTICLES } from "./config/articles";
import { importOrders } from "./lib/import-orders";

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

    "/api/products/status": {
      async GET(req) {
        try {
          const url = new URL(req.url);
          const tomorrow = new Date();
          tomorrow.setDate(tomorrow.getDate() + 1);
          const targetDate = url.searchParams.get("target_date") ?? tomorrow.toISOString().slice(0, 10);

          // Compute Monday–Sunday of the week containing targetDate
          const ref = new Date(targetDate + "T00:00:00");
          const dayOfWeek = ref.getDay();
          const monday = new Date(ref);
          monday.setDate(ref.getDate() - ((dayOfWeek + 6) % 7));
          const sunday = new Date(monday);
          sunday.setDate(monday.getDate() + 6);
          const monStr = monday.toISOString().slice(0, 10);
          const sunStr = sunday.toISOString().slice(0, 10);

          // Batch-fetch all prophet forecasts for the week
          const prophetRows = await supabaseSelect<{
            product_id: string;
            predicted_qty: number;
            yhat_lower: number;
            yhat_upper: number;
            model_version: string;
          }>(
            "prophet_forecasts",
            `target_date=gte.${monStr}&target_date=lte.${sunStr}&select=product_id,predicted_qty,yhat_lower,yhat_upper,model_version&order=created_at.desc`
          );

          // Batch-fetch all active OLS models
          const olsRows = await supabaseSelect<{
            product_id: string;
            model_version: string;
          }>(
            "trained_models",
            `is_active=eq.true&select=product_id,model_version`
          );

          // Aggregate by product_id: sum predicted_qty across the week
          const prophetMap = new Map<string, { predicted_qty: number; yhat_lower: number; yhat_upper: number; model_version: string }>();
          for (const row of prophetRows) {
            const existing = prophetMap.get(row.product_id);
            if (existing) {
              existing.predicted_qty += row.predicted_qty;
              existing.yhat_lower += row.yhat_lower;
              existing.yhat_upper += row.yhat_upper;
            } else {
              prophetMap.set(row.product_id, {
                predicted_qty: row.predicted_qty,
                yhat_lower: row.yhat_lower,
                yhat_upper: row.yhat_upper,
                model_version: row.model_version,
              });
            }
          }

          const olsMap = new Map<string, typeof olsRows[0]>();
          for (const row of olsRows) {
            if (!olsMap.has(row.product_id)) olsMap.set(row.product_id, row);
          }

          // Build status for each product
          const products = [...ALLOWED_ARTICLES.entries()].map(([productId]) => {
            // Extract name from product_id key: "260501 KP140" → name "KP140"
            const spaceIdx = productId.indexOf(" ");
            const description = spaceIdx > 0 ? productId.slice(spaceIdx + 1) : productId;

            const prophet = prophetMap.get(productId);
            if (prophet) {
              return {
                product_id: productId,
                description,
                model_type: "prophet" as const,
                predicted_qty: Math.max(0, Math.round(prophet.predicted_qty)),
                confidence_low: Math.max(0, Math.round(prophet.yhat_lower)),
                confidence_high: Math.max(0, Math.round(prophet.yhat_upper)),
                model_version: prophet.model_version,
              };
            }

            const ols = olsMap.get(productId);
            if (ols) {
              return {
                product_id: productId,
                description,
                model_type: "ols" as const,
                predicted_qty: null,
                confidence_low: null,
                confidence_high: null,
                model_version: ols.model_version,
              };
            }

            return {
              product_id: productId,
              description,
              model_type: "none" as const,
              predicted_qty: null,
              confidence_low: null,
              confidence_high: null,
              model_version: null,
            };
          });

          return Response.json(products);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },

    "/api/products/:id/week": {
      async GET(req) {
        try {
          const { id: productId } = req.params;
          const url = new URL(req.url);
          const refDate = url.searchParams.get("date") ?? new Date().toISOString().slice(0, 10);

          // Compute Monday–Sunday of the week containing refDate
          const ref = new Date(refDate);
          const dayOfWeek = ref.getDay(); // 0=Sun, 1=Mon...
          const monday = new Date(ref);
          monday.setDate(ref.getDate() - ((dayOfWeek + 6) % 7));
          const sunday = new Date(monday);
          sunday.setDate(monday.getDate() + 6);

          const monStr = monday.toISOString().slice(0, 10);
          const sunStr = sunday.toISOString().slice(0, 10);

          // Fetch prophet forecasts for the week
          const forecasts = await supabaseSelect<{
            target_date: string;
            predicted_qty: number;
            yhat_lower: number;
            yhat_upper: number;
            model_version: string;
          }>(
            "prophet_forecasts",
            `product_id=eq.${encodeURIComponent(productId)}&target_date=gte.${monStr}&target_date=lte.${sunStr}&order=target_date.asc`
          );

          // Build day-by-day array
          const days: string[] = [];
          for (let d = new Date(monday); d <= sunday; d.setDate(d.getDate() + 1)) {
            days.push(d.toISOString().slice(0, 10));
          }

          const forecastMap = new Map(forecasts.map((f) => [f.target_date, f]));

          const week = days.map((date) => {
            const f = forecastMap.get(date);
            return {
              date,
              predicted_qty: f ? Math.max(0, Math.round(f.predicted_qty)) : null,
              confidence_low: f ? Math.max(0, Math.round(f.yhat_lower)) : null,
              confidence_high: f ? Math.max(0, Math.round(f.yhat_upper)) : null,
              model_version: f?.model_version ?? null,
            };
          });

          return Response.json({ product_id: productId, week_start: monStr, week_end: sunStr, days: week });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },

    "/api/products/:id/order-history": {
      async GET(req) {
        try {
          const { id: productId } = req.params;
          const url = new URL(req.url);
          const weeks = parseInt(url.searchParams.get("weeks") ?? "12", 10);

          // Fetch orders for the last N weeks
          const endDate = new Date();
          const startDate = new Date();
          startDate.setDate(startDate.getDate() - weeks * 7);

          const orders = await supabaseSelect<{
            order_date: string;
            quantity: number;
          }>(
            "order_history",
            `product_id=eq.${encodeURIComponent(productId)}&order_date=gte.${startDate.toISOString().slice(0, 10)}&order_date=lte.${endDate.toISOString().slice(0, 10)}&select=order_date,quantity&order=order_date.asc`
          );

          // Aggregate by ISO week
          const weekMap = new Map<string, { week_label: string; week_start: string; total_qty: number; order_count: number }>();

          for (const o of orders) {
            const d = new Date(o.order_date + "T00:00:00");
            // Get Monday of this week
            const day = d.getDay();
            const monday = new Date(d);
            monday.setDate(d.getDate() - ((day + 6) % 7));
            const monStr = monday.toISOString().slice(0, 10);

            // ISO week number
            const tmp = new Date(d);
            tmp.setDate(tmp.getDate() + 3 - ((tmp.getDay() + 6) % 7));
            const yearStart = new Date(tmp.getFullYear(), 0, 4);
            const weekNum = Math.round(((tmp.getTime() - yearStart.getTime()) / 86400000 + yearStart.getDay() + 6) / 7);

            const key = monStr;
            const existing = weekMap.get(key);
            if (existing) {
              existing.total_qty += o.quantity;
              existing.order_count += 1;
            } else {
              weekMap.set(key, {
                week_label: `u${weekNum}`,
                week_start: monStr,
                total_qty: o.quantity,
                order_count: 1,
              });
            }
          }

          // Sort by week_start and return
          const data = [...weekMap.values()].sort((a, b) => a.week_start.localeCompare(b.week_start));

          return Response.json({ product_id: productId, weeks: data });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return Response.json({ error: message }, { status: 500 });
        }
      },
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

    "/api/jobs/import-orders": {
      async POST(req) {
        try {
          const body = await req.json().catch(() => ({}));
          // Default: import yesterday's orders
          const yesterday = new Date();
          yesterday.setDate(yesterday.getDate() - 1);
          const from = body.from ?? yesterday.toISOString().slice(0, 10);
          const to = body.to ?? from;
          const result = await importOrders(from, to);
          return Response.json(result);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },

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
          const proc = Bun.spawn(["python3", "train_prophet.py", "--all"], {
            cwd: `${import.meta.dir}/../python`,
            stdout: "pipe",
            stderr: "pipe",
          });
          // Return immediately — let the process run in the background
          return Response.json({
            status: "started",
            message: "Prophet retraining started in background",
            pid: proc.pid,
          });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },

    "/api/jobs/retrain-baseline": {
      async POST(req) {
        try {
          const proc = Bun.spawn(["python3", "train_baseline.py"], {
            cwd: `${import.meta.dir}/../python`,
            stdout: "pipe",
            stderr: "pipe",
          });
          return Response.json({
            status: "started",
            message: "Baseline retraining started in background",
            pid: proc.pid,
          });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },

    "/api/jobs/evaluate-models": {
      async POST(req) {
        try {
          const proc = Bun.spawn(["python3", "evaluate.py"], {
            cwd: `${import.meta.dir}/../python`,
            stdout: "pipe",
            stderr: "pipe",
          });
          return Response.json({
            status: "started",
            message: "Model evaluation started in background",
            pid: proc.pid,
          });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },
  },

  development: process.env.NODE_ENV !== "production" && {
    hmr: true,
    console: false,
  },
});

console.log(`🚀 Server running at ${server.url}`);
