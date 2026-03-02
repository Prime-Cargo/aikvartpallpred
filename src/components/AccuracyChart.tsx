import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import type { AccuracyPoint } from "@/hooks/usePrediction";

interface AccuracyChartProps {
  data: AccuracyPoint[];
  loading: boolean;
}

export function AccuracyChart({ data, loading }: AccuracyChartProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center h-[200px] text-muted-foreground text-sm">
        Laster historikk…
      </div>
    );
  }

  const hasData = data.some((d) => d.actual !== null);

  if (!hasData) {
    return (
      <div className="flex items-center justify-center h-[200px] text-muted-foreground text-sm">
        Ingen historikk ennå
      </div>
    );
  }

  return (
    <div>
      <h3 className="text-sm font-medium mb-2">
        Forrige forslag vs. faktisk
      </h3>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data}>
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11 }}
            tickFormatter={(v: string) => v.slice(5)}
          />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip />
          <Legend />
          <Bar dataKey="predicted" name="Foreslått" fill="#3b82f6" />
          <Bar dataKey="actual" name="Faktisk" fill="#6b7280" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
