import { useState, useEffect } from "react";
import { ProductTable } from "./ProductTable";
import { DetailPanel } from "./DetailPanel";
import { useProductStatus } from "@/hooks/useProductStatus";

function tomorrow(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return dateToStr(d);
}

function loadCached(key: string, fallback: string): string {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}

/** Get Monday of the ISO week containing the given date */
function getMonday(dateStr: string): Date {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.getFullYear(), d.getMonth(), diff);
}

function getISOWeek(d: Date): number {
  const copy = new Date(d.getTime());
  copy.setDate(copy.getDate() + 3 - ((copy.getDay() + 6) % 7));
  const yearStart = new Date(copy.getFullYear(), 0, 4);
  return Math.round(((copy.getTime() - yearStart.getTime()) / 86400000 + yearStart.getDay() + 6) / 7);
}

function fmtShort(d: Date): string {
  return `${d.getDate()}.${d.getMonth() + 1}`;
}

function dateToStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isSameWeek(a: string, b: string): boolean {
  return dateToStr(getMonday(a)) === dateToStr(getMonday(b));
}

export function PredictionDashboard() {
  const [productId, setProductId] = useState<string | null>(
    () => loadCached("kp:selectedProduct", "") || null
  );
  const [targetDate, setTargetDate] = useState(
    () => loadCached("kp:targetDate", tomorrow())
  );

  const productStatus = useProductStatus(targetDate);

  // Persist selection to localStorage
  useEffect(() => {
    try {
      if (productId) localStorage.setItem("kp:selectedProduct", productId);
      localStorage.setItem("kp:targetDate", targetDate);
    } catch {}
  }, [productId, targetDate]);

  function handleSelect(id: string) {
    setProductId(id);
  }

  const selectedProduct = productStatus.data.find((p) => p.product_id === productId) ?? null;

  return (
    <div className="flex flex-col h-screen bg-background font-sans text-foreground">
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-3.5 border-b border-border bg-card shrink-0 relative z-10">
        <div className="flex items-center gap-3">
          <img src="./prediction.png" alt="" className="size-6" />
          <h1 className="text-base font-bold tracking-tight">Kvartpall Bestillingsforslag</h1>
        </div>
        <WeekSelector targetDate={targetDate} onChange={setTargetDate} />
      </div>

      {/* Main two-panel layout */}
      <div className="flex flex-1 min-h-0">
        {/* Left panel: product list */}
        <div className="w-[460px] min-w-[400px] border-r border-border flex flex-col bg-card">
          <div className="px-4 pt-4 pb-2">
            <h2 className="text-sm font-semibold text-foreground mb-3">Alle produkter</h2>
          </div>
          <ProductTable
            products={productStatus.data}
            loading={productStatus.loading}
            selectedId={productId}
            onSelect={handleSelect}
          />
        </div>

        {/* Right panel: detail */}
        <div className="flex-1 overflow-y-auto p-7 bg-background">
          {selectedProduct ? (
            <DetailPanel
              product={selectedProduct}
              targetDate={targetDate}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              Velg et produkt fra listen
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function WeekSelector({ targetDate, onChange }: { targetDate: string; onChange: (d: string) => void }) {
  // Compute everything from strings to avoid Date mutation bugs
  const mondayDate = getMonday(targetDate);
  const mondayStr = dateToStr(mondayDate);
  const sundayDate = new Date(mondayDate.getFullYear(), mondayDate.getMonth(), mondayDate.getDate() + 6);
  const sundayStr = dateToStr(sundayDate);
  const weekNum = getISOWeek(mondayDate);
  const todayStr = dateToStr(new Date());
  const isCurrentWeek = isSameWeek(targetDate, todayStr);

  function goToWeek(delta: number) {
    const [y, m, d] = mondayStr.split("-").map(Number);
    const fresh = new Date(y, m - 1, d + delta * 7);
    onChange(dateToStr(fresh));
  }

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => goToWeek(-1)}
        className="p-2 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer shrink-0"
        title="Forrige uke"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <button
        type="button"
        onClick={isCurrentWeek ? undefined : () => onChange(todayStr)}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-md border text-sm font-medium select-none shrink-0 ${
          isCurrentWeek
            ? "border-primary/40 bg-primary/5 text-primary"
            : "border-border bg-card text-foreground hover:border-primary/40 cursor-pointer"
        }`}
        title={isCurrentWeek ? "Denne uken" : "Gå til denne uken"}
      >
        {isCurrentWeek && <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />}
        <span className="font-semibold">Uke {weekNum}</span>
        <span className="text-muted-foreground text-xs font-mono">{fmtShort(mondayDate)}–{fmtShort(sundayDate)}</span>
      </button>
      <button
        type="button"
        onClick={() => goToWeek(1)}
        className="p-2 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer shrink-0"
        title="Neste uke"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
      </button>
    </div>
  );
}
