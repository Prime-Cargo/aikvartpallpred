import { useState } from "react";
import { ProductTable } from "./ProductTable";
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

export function PredictionDashboard() {
  const [productId, setProductId] = useState<string | null>(null);
  const [targetDate, setTargetDate] = useState(tomorrow);
  const [dismissed, setDismissed] = useState(false);

  const productStatus = useProductStatus(targetDate);
  const prediction = usePrediction(productId, targetDate);
  const accuracy = useAccuracyHistory(productId);

  function handleSelect(id: string) {
    setProductId(id);
    setDismissed(false);
  }

  return (
    <div className="space-y-6">
      {/* Date picker */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-end gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="target-date">Dato</Label>
              <Input
                id="target-date"
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

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
            onSelect={handleSelect}
          />
        </CardContent>
      </Card>

      {/* Loading / Error */}
      {prediction.loading && (
        <p className="text-sm text-muted-foreground">Henter forslag…</p>
      )}
      {prediction.error && (
        <p className="text-sm text-destructive">Feil: {prediction.error}</p>
      )}

      {/* Detail panel */}
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
    </div>
  );
}
