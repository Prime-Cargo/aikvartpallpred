import { useState } from "react";
import { ProductSearch } from "./ProductSearch";
import { PredictionCard } from "./PredictionCard";
import { AccuracyChart } from "./AccuracyChart";
import { usePrediction, useAccuracyHistory } from "@/hooks/usePrediction";

function tomorrow(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function PredictionDashboard() {
  const [productId, setProductId] = useState<string | null>(null);
  const [targetDate, setTargetDate] = useState(tomorrow);
  const [dismissed, setDismissed] = useState(false);

  const prediction = usePrediction(productId, targetDate);
  const accuracy = useAccuracyHistory(productId);

  function handleSelect(id: string) {
    setProductId(id);
    setDismissed(false);
  }

  return (
    <div className="w-full max-w-4xl space-y-6">
      <h1 className="text-2xl font-bold">Kvartpall Bestillingsforslag</h1>

      {/* Controls row */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-end">
        <div className="space-y-1">
          <label className="text-sm text-muted-foreground" htmlFor="target-date">
            Dato
          </label>
          <input
            id="target-date"
            type="date"
            className="h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
            value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)}
          />
        </div>
        <div className="flex-1 space-y-1">
          <label className="text-sm text-muted-foreground">Produkt</label>
          <ProductSearch onSelect={handleSelect} />
        </div>
      </div>

      {/* Loading / Error */}
      {prediction.loading && (
        <p className="text-sm text-muted-foreground">Henter forslag…</p>
      )}
      {prediction.error && (
        <p className="text-sm text-red-600">Feil: {prediction.error}</p>
      )}

      {/* Results */}
      {prediction.data && !dismissed && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <PredictionCard
            productId={productId!}
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
          <AccuracyChart data={accuracy.data} loading={accuracy.loading} />
        </div>
      )}
    </div>
  );
}
