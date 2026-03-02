import { cn } from "@/lib/utils";

interface ConfidenceBadgeProps {
  modelVersion: string;
  r2?: number;
}

export function ConfidenceBadge({ modelVersion, r2 }: ConfidenceBadgeProps) {
  const isFallback = modelVersion.includes("fallback");

  let level: "high" | "medium" | "low";
  let label: string;
  let dotColor: string;

  if (isFallback || (r2 !== undefined && r2 < 0.2)) {
    level = "low";
    label = "Lav tillit";
    dotColor = "bg-red-500";
  } else if (r2 !== undefined && r2 < 0.5) {
    level = "medium";
    label = "Middels tillit";
    dotColor = "bg-yellow-500";
  } else {
    level = "high";
    label = "Høy tillit";
    dotColor = "bg-green-500";
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <span className={cn("size-2 rounded-full", dotColor)} />
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}
