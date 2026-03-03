import { useState, useEffect } from "react";
import { useWeekForecast } from "@/hooks/useWeekForecast";
import { usePrediction, useAccuracyHistory } from "@/hooks/usePrediction";
import { useOrderHistory } from "@/hooks/useOrderHistory";
import type { ProductStatus } from "@/hooks/useProductStatus";

const DAY_NAMES = ["Søn", "Man", "Tir", "Ons", "Tor", "Fre", "Lør"];

function dayLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return DAY_NAMES[d.getDay()] ?? "";
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return `${d.getDate()}.${d.getMonth() + 1}`;
}

function getISOWeek(dateStr: string): number {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const yearStart = new Date(d.getFullYear(), 0, 4);
  return Math.round(((d.getTime() - yearStart.getTime()) / 86400000 + yearStart.getDay() + 6) / 7);
}

interface DetailPanelProps {
  product: ProductStatus;
  targetDate: string;
}

export function DetailPanel({ product, targetDate }: DetailPanelProps) {
  const week = useWeekForecast(product.product_id, targetDate);
  const prediction = usePrediction(product.product_id, targetDate);
  const accuracy = useAccuracyHistory(product.product_id);
  const orderHistory = useOrderHistory(product.product_id, 12);
  const [orderQty, setOrderQty] = useState(product.predicted_qty ?? 0);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    setOrderQty(prediction.data?.predicted_quantity ?? product.predicted_qty ?? 0);
    setAccepted(false);
  }, [product.product_id, prediction.data?.predicted_quantity]);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="flex flex-col gap-5 animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-xl font-bold font-mono text-foreground">
              {product.product_id.split(/\s+/)[0]}
            </h2>
            <span className="text-base font-medium text-muted-foreground">{product.description}</span>
            <ModelBadge type={product.model_type} />
          </div>
          {product.model_version && (
            <div className="text-[11px] text-muted-foreground/70 mt-1">{product.model_version}</div>
          )}
        </div>
        {week.data && (
          <div className="text-xs text-muted-foreground bg-muted/50 px-2.5 py-1 rounded-md">
            Uke {getISOWeek(week.data.week_start)} · {formatDate(week.data.week_start)}–{formatDate(week.data.week_end)}
          </div>
        )}
      </div>

      {/* Week forecast */}
      <div>
        <SectionLabel>Ukesoversikt</SectionLabel>
        {week.loading ? (
          <div className="flex gap-1.5">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="flex-1 rounded-lg p-2.5 bg-muted/40 border border-border min-w-[64px]">
                <div className="flex flex-col items-center gap-1.5">
                  <div className="w-8 h-3 bg-muted animate-pulse rounded" />
                  <div className="w-6 h-2.5 bg-muted animate-pulse rounded" />
                  <div className="w-8 h-6 bg-muted animate-pulse rounded mt-1" />
                </div>
              </div>
            ))}
          </div>
        ) : week.data ? (
          <div className="flex gap-1.5">
            {week.data.days.map((day) => {
              const isToday = day.date === today;
              return (
                <div
                  key={day.date}
                  className={`flex-1 rounded-lg p-2.5 text-center min-w-[64px] ${
                    isToday
                      ? "bg-primary/5 border-2 border-primary/60"
                      : "bg-muted/40 border border-border"
                  }`}
                >
                  <div className="text-xs font-semibold text-muted-foreground">{dayLabel(day.date)}</div>
                  <div className="text-[11px] text-muted-foreground/60 mb-1.5">{formatDate(day.date)}</div>
                  <div className="text-[22px] font-bold font-mono text-foreground leading-none">
                    {day.predicted_qty ?? "—"}
                  </div>
                  {day.confidence_low != null && day.confidence_high != null && (
                    <div className="text-[10px] text-muted-foreground/60 mt-1">
                      {day.confidence_low}–{day.confidence_high}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground py-4">Ingen ukedata tilgjengelig</div>
        )}
      </div>

      {/* Prediction + Accuracy side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Prediction suggestion */}
        <div className="bg-muted/40 rounded-xl p-5 border border-border">
          <SectionLabel>Bestillingsforslag</SectionLabel>
          {prediction.loading ? (
            <div className="space-y-3 py-1">
              <div className="flex items-center gap-3">
                <div className="w-16 h-10 bg-muted animate-pulse rounded" />
                <div className="space-y-1.5">
                  <div className="w-14 h-3 bg-muted animate-pulse rounded" />
                  <div className="w-20 h-3 bg-muted animate-pulse rounded" />
                </div>
              </div>
              <div className="flex gap-2 mt-2">
                <div className="w-16 h-8 bg-muted animate-pulse rounded-md" />
                <div className="w-12 h-8 bg-muted animate-pulse rounded-md" />
                <div className="w-16 h-8 bg-muted animate-pulse rounded-md" />
              </div>
            </div>
          ) : prediction.error ? (
            <div className="text-sm text-destructive py-4">Feil: {prediction.error}</div>
          ) : prediction.data ? (
            <>
              <div className="flex items-center gap-3 mb-1">
                <span className="text-4xl font-extrabold font-mono text-foreground leading-none">
                  {prediction.data.predicted_quantity}
                </span>
                <div>
                  <div className="text-[11px] text-muted-foreground">
                    ({prediction.data.confidence_low}–{prediction.data.confidence_high})
                  </div>
                  <ConfidenceDot modelVersion={prediction.data.model_version} />
                </div>
              </div>
              <div className="flex items-center gap-2 mt-4">
                {!accepted ? (
                  <>
                    <button
                      onClick={() => {
                        setAccepted(true);
                        console.log("Accepted:", product.product_id, orderQty);
                      }}
                      className="bg-green-700 hover:bg-green-800 text-white border-none rounded-md px-5 py-2 text-[13px] font-semibold cursor-pointer transition-colors"
                    >
                      Godta
                    </button>
                    <input
                      type="number"
                      value={orderQty}
                      onChange={(e) => setOrderQty(parseInt(e.target.value) || 0)}
                      className="w-[52px] px-2 py-[7px] border border-border rounded-md text-sm font-mono text-center bg-card"
                    />
                    <button
                      className="bg-transparent border border-border hover:border-primary hover:text-primary rounded-md px-4 py-2 text-[13px] text-muted-foreground cursor-pointer transition-colors"
                    >
                      Ignorer
                    </button>
                  </>
                ) : (
                  <span className="text-sm text-green-700 font-medium">
                    Godtatt: {orderQty}
                  </span>
                )}
              </div>
            </>
          ) : (
            <div className="text-sm text-muted-foreground py-4">
              {product.predicted_qty != null ? (
                <span className="text-4xl font-extrabold font-mono text-foreground">{product.predicted_qty}</span>
              ) : (
                "Ingen forslag tilgjengelig"
              )}
            </div>
          )}
        </div>

        {/* Accuracy */}
        <div className="bg-muted/40 rounded-xl p-5 border border-border">
          <SectionLabel>Treffsikkerhet</SectionLabel>
          <AccuracyMiniChart data={accuracy.data} loading={accuracy.loading} />
        </div>
      </div>

      {/* Sales history */}
      <div className="bg-muted/40 rounded-xl p-5 border border-border">
        <SectionLabel>Historisk forbruk</SectionLabel>
        <SalesHistoryChart data={orderHistory.data} loading={orderHistory.loading} />
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2.5">
      {children}
    </div>
  );
}

function ModelBadge({ type }: { type: "prophet" | "ols" | "none" }) {
  switch (type) {
    case "prophet":
      return (
        <span className="inline-block text-[11px] font-semibold px-2 py-0.5 rounded bg-green-700 text-white">
          Prophet
        </span>
      );
    case "ols":
      return (
        <span className="inline-block text-[11px] font-semibold px-2 py-0.5 rounded bg-blue-700/80 text-white">
          OLS
        </span>
      );
    case "none":
      return (
        <span className="text-xs text-muted-foreground">Ingen modell</span>
      );
  }
}

function ConfidenceDot({ modelVersion }: { modelVersion: string }) {
  const isFallback = modelVersion.includes("fallback");
  const color = isFallback ? "bg-red-500" : "bg-green-600";
  const label = isFallback ? "Lav tillit" : "Høy tillit";
  const textColor = isFallback ? "text-red-600" : "text-green-700";

  return (
    <div className="flex items-center gap-1 mt-0.5">
      <div className={`w-1.5 h-1.5 rounded-full ${color}`} />
      <span className={`text-[11px] font-medium ${textColor}`}>{label}</span>
    </div>
  );
}

function SalesHistoryChart({ data, loading }: { data: { week_label: string; total_qty: number; order_count: number }[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="flex gap-2 items-end h-[120px]">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="flex-1 flex flex-col items-center justify-end h-full">
            <div className="w-full bg-muted animate-pulse rounded-t-sm" style={{ height: 20 + Math.random() * 60 }} />
            <div className="w-6 h-2 bg-muted animate-pulse rounded mt-1.5" />
          </div>
        ))}
      </div>
    );
  }

  if (data.length === 0) {
    return <div className="text-sm text-muted-foreground py-4">Ingen salgshistorikk tilgjengelig</div>;
  }

  const maxQty = Math.max(...data.map((d) => d.total_qty), 1);

  return (
    <div>
      <div className="flex gap-2 items-end h-[120px]">
        {data.map((w, i) => (
          <div key={i} className="flex-1 flex flex-col items-center justify-end h-full group">
            <div className="relative w-full flex justify-center">
              <div className="absolute -top-5 hidden group-hover:block text-[10px] font-mono text-foreground bg-card border border-border rounded px-1.5 py-0.5 shadow-sm whitespace-nowrap z-10">
                {w.total_qty} stk
              </div>
              <div
                className="w-full max-w-[28px] bg-primary/70 hover:bg-primary rounded-t-sm transition-colors cursor-default"
                style={{ height: Math.max(4, (w.total_qty / maxQty) * 100) }}
              />
            </div>
            <div className="text-[10px] text-muted-foreground mt-1.5 font-medium">{w.week_label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AccuracyMiniChart({ data, loading }: { data: { date: string; predicted: number; actual: number | null }[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="flex gap-3 items-end h-[60px]">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex-1 text-center">
            <div className="flex gap-[3px] justify-center items-end h-[50px]">
              <div className="w-3.5 bg-muted animate-pulse rounded-t-sm" style={{ height: 10 + Math.random() * 36 }} />
              <div className="w-3.5 bg-muted animate-pulse rounded-t-sm" style={{ height: 10 + Math.random() * 36 }} />
            </div>
            <div className="w-8 h-2 bg-muted animate-pulse rounded mx-auto mt-1" />
          </div>
        ))}
      </div>
    );
  }

  const hasData = data.length > 0 && data.some((d) => d.actual !== null);

  if (!hasData) {
    return <div className="text-sm text-muted-foreground py-4">Ingen historikk ennå</div>;
  }

  const maxVal = Math.max(...data.map((d) => Math.max(d.predicted, d.actual ?? 0)), 1);

  return (
    <div>
      <div className="flex gap-4 mb-2">
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <div className="w-2.5 h-2.5 rounded-sm bg-primary" /> Foreslått
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <div className="w-2.5 h-2.5 rounded-sm bg-green-700" /> Faktisk
        </div>
      </div>
      <div className="flex gap-3 items-end h-[60px]">
        {data.map((h, i) => (
          <div key={i} className="flex-1 text-center">
            <div className="flex gap-[3px] justify-center items-end h-[50px]">
              <div
                className="w-3.5 bg-primary rounded-t-sm"
                style={{ height: Math.max(4, (h.predicted / maxVal) * 46) }}
              />
              <div
                className="w-3.5 bg-green-700 rounded-t-sm"
                style={{ height: Math.max(4, ((h.actual ?? 0) / maxVal) * 46) }}
              />
            </div>
            <div className="text-[10px] text-muted-foreground mt-1">{h.date.slice(5)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
