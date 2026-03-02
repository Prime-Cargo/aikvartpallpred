import { useWeekForecast } from "@/hooks/useWeekForecast";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";

const DAY_NAMES = ["Søn", "Man", "Tir", "Ons", "Tor", "Fre", "Lør"];

function dayLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return DAY_NAMES[d.getDay()] ?? "";
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return `${d.getDate()}.${d.getMonth() + 1}`;
}

interface WeekForecastPanelProps {
  productId: string;
  targetDate: string;
}

export function WeekForecastPanel({ productId, targetDate }: WeekForecastPanelProps) {
  const { data, loading } = useWeekForecast(productId, targetDate);

  if (loading) {
    return (
      <Card>
        <CardContent className="py-6">
          <p className="text-sm text-muted-foreground animate-pulse">Laster ukeprognose…</p>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const today = new Date().toISOString().slice(0, 10);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold font-mono">{productId}</CardTitle>
          <span className="text-xs text-muted-foreground">
            Uke {getISOWeek(data.week_start)} · {formatDate(data.week_start)}–{formatDate(data.week_end)}
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-7 gap-2">
          {data.days.map((day) => {
            const isToday = day.date === today;
            const isTarget = day.date === targetDate;
            return (
              <div
                key={day.date}
                className={`rounded-lg border p-2 text-center transition-colors ${
                  isTarget
                    ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                    : isToday
                      ? "border-accent-foreground/20 bg-accent/50"
                      : "border-border"
                }`}
              >
                <div className="text-xs font-medium text-muted-foreground">{dayLabel(day.date)}</div>
                <div className="text-[10px] text-muted-foreground/70">{formatDate(day.date)}</div>
                <div className="mt-1.5 text-lg font-bold font-mono">
                  {day.predicted_qty !== null ? day.predicted_qty : "—"}
                </div>
                {day.predicted_qty !== null && day.confidence_low !== null && day.confidence_high !== null && (
                  <div className="text-[10px] text-muted-foreground">
                    {day.confidence_low}–{day.confidence_high}
                  </div>
                )}
                {day.predicted_qty !== null ? (
                  <Badge className="mt-1 bg-green-600 text-white text-[9px] px-1 py-0">Prophet</Badge>
                ) : (
                  <Badge variant="outline" className="mt-1 text-[9px] px-1 py-0 text-muted-foreground">—</Badge>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function getISOWeek(dateStr: string): number {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const yearStart = new Date(d.getFullYear(), 0, 4);
  return Math.round(((d.getTime() - yearStart.getTime()) / 86400000 + yearStart.getDay() + 6) / 7);
}
