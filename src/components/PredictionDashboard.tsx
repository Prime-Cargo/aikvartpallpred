import { useState, useEffect } from "react";
import { ProductTable } from "./ProductTable";
import { WeekForecastPanel } from "./WeekForecastPanel";
import { PredictionCard } from "./PredictionCard";
import { AccuracyChart } from "./AccuracyChart";
import { usePrediction, useAccuracyHistory } from "@/hooks/usePrediction";
import { useProductStatus } from "@/hooks/useProductStatus";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";

function tomorrow(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function loadCached(key: string, fallback: string): string {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}

export function PredictionDashboard() {
  const [productId, setProductId] = useState<string | null>(
    () => loadCached("kp:selectedProduct", "") || null
  );
  const [targetDate, setTargetDate] = useState(
    () => loadCached("kp:targetDate", tomorrow())
  );
  const [dismissed, setDismissed] = useState(false);

  const productStatus = useProductStatus(targetDate);
  const prediction = usePrediction(productId, targetDate);
  const accuracy = useAccuracyHistory(productId);

  // Persist selection to localStorage
  useEffect(() => {
    try {
      if (productId) localStorage.setItem("kp:selectedProduct", productId);
      localStorage.setItem("kp:targetDate", targetDate);
    } catch {}
  }, [productId, targetDate]);

  function handleSelect(id: string) {
    setProductId(id);
    setDismissed(false);
  }

  return (
    <div className="space-y-6">
      {/* Top row: date picker + detail panel */}
      <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-6 items-start">
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-1.5">
              <Label htmlFor="target-date">Dato</Label>
              <Input
                id="target-date"
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        {/* Weekly forecast panel */}
        {productId && (
          <WeekForecastPanel productId={productId} targetDate={targetDate} />
        )}
      </div>

      {/* Prediction detail + accuracy side by side */}
      {productId && prediction.data && !dismissed && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <PredictionCard
            productId={productId}
            predictedQty={prediction.data.predicted_quantity}
            confidenceLow={prediction.data.confidence_low}
            confidenceHigh={prediction.data.confidence_high}
            modelVersion={prediction.data.model_version}
            featuresSnapshot={prediction.data.features_snapshot}
            onAccept={(qty) => {
              console.log("Accepted:", productId, qty);
            }}
            onDismiss={() => setDismissed(true)}
          />
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Treffsikkerhet</CardTitle>
            </CardHeader>
            <CardContent>
              <AccuracyChart data={accuracy.data} loading={accuracy.loading} />
            </CardContent>
          </Card>
        </div>
      )}

      {prediction.loading && (
        <p className="text-sm text-muted-foreground">Henter forslag…</p>
      )}
      {prediction.error && (
        <p className="text-sm text-destructive">Feil: {prediction.error}</p>
      )}

      {/* Product table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Alle produkter</CardTitle>
        </CardHeader>
        <CardContent>
          <ProductTable
            products={productStatus.data}
            loading={productStatus.loading}
            selectedId={productId}
            loadingId={prediction.loading ? productId : null}
            onSelect={handleSelect}
          />
        </CardContent>
      </Card>
    </div>
  );
}
