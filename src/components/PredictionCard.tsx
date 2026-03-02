import { useState } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfidenceBadge } from "./ConfidenceBadge";

interface PredictionCardProps {
  productId: string;
  predictedQty: number;
  confidenceLow: number;
  confidenceHigh: number;
  modelVersion: string;
  featuresSnapshot?: Record<string, unknown> | null;
  onAccept?: (qty: number) => void;
  onDismiss?: () => void;
}

const FEATURE_LABELS: Record<string, string> = {
  day_of_week: "Ukedag",
  month: "Måned",
  week_of_year: "Uke",
  temperature: "Temperatur",
  is_holiday: "Helligdag",
  lag_7d_avg: "Snitt siste 7d",
  lag_30d_avg: "Snitt siste 30d",
  season: "Sesong",
};

function formatFeatureValue(name: string, value: unknown): string {
  if (name === "temperature" && typeof value === "number") return `${value}°C`;
  if (name === "is_holiday") return value ? "Ja" : "Nei";
  if (typeof value === "number") return String(Math.round(value * 100) / 100);
  return String(value ?? "–");
}

export function PredictionCard({
  productId,
  predictedQty,
  confidenceLow,
  confidenceHigh,
  modelVersion,
  featuresSnapshot,
  onAccept,
  onDismiss,
}: PredictionCardProps) {
  const [showDetails, setShowDetails] = useState(false);
  const [adjustedQty, setAdjustedQty] = useState(predictedQty);
  const [accepted, setAccepted] = useState(false);

  const featureNames: string[] =
    (featuresSnapshot?.feature_names as string[]) ?? [];
  const featureVector: number[] =
    (featuresSnapshot?.feature_vector as number[]) ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{productId}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Suggestion line */}
        <div className="flex items-baseline gap-3 flex-wrap">
          <span className="text-sm text-muted-foreground">Foreslått:</span>
          <span className="text-3xl font-bold">{predictedQty}</span>
          <span className="text-muted-foreground text-sm">
            ({confidenceLow}–{confidenceHigh})
          </span>
          <ConfidenceBadge modelVersion={modelVersion} />
        </div>

        {/* Expandable details */}
        <button
          type="button"
          className="text-sm text-primary hover:underline"
          onClick={() => setShowDetails((v) => !v)}
        >
          {showDetails ? "Skjul detaljer" : "Vis detaljer"}
        </button>

        {showDetails && featureNames.length > 0 && (
          <div className="rounded-md border p-3 text-sm space-y-1">
            <p className="font-medium mb-1">Modell: {modelVersion}</p>
            {featureNames.map((name, i) => (
              <div key={name} className="flex justify-between">
                <span className="text-muted-foreground">
                  {FEATURE_LABELS[name] ?? name}
                </span>
                <span>{formatFeatureValue(name, featureVector[i])}</span>
              </div>
            ))}
          </div>
        )}

        {showDetails && featureNames.length === 0 && (
          <div className="rounded-md border p-3 text-sm text-muted-foreground">
            Modell: {modelVersion} — ingen feature-detaljer tilgjengelig.
          </div>
        )}
      </CardContent>
      <CardFooter className="gap-3 flex-wrap">
        {!accepted ? (
          <>
            <Button onClick={() => { setAccepted(true); onAccept?.(adjustedQty); }}>
              Godta
            </Button>
            <Input
              type="number"
              min={0}
              className="w-24"
              value={adjustedQty}
              onChange={(e) => setAdjustedQty(Number(e.target.value))}
            />
            <Button variant="ghost" onClick={onDismiss}>
              Ignorer
            </Button>
          </>
        ) : (
          <span className="text-sm text-green-600 font-medium">
            Godtatt: {adjustedQty}
          </span>
        )}
      </CardFooter>
    </Card>
  );
}
