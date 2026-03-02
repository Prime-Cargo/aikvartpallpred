import { useState, useEffect } from "react";
import { ProductTable } from "./ProductTable";
import { DetailPanel } from "./DetailPanel";
import { useProductStatus } from "@/hooks/useProductStatus";

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
      <div className="flex items-center justify-between px-6 py-3.5 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-3">
          <img src="./prediction.png" alt="" className="size-6" />
          <h1 className="text-base font-bold tracking-tight">Kvartpall Bestillingsforslag</h1>
        </div>
        <div className="flex items-center gap-3">
          <label htmlFor="target-date" className="text-xs font-medium text-muted-foreground">
            Dato
          </label>
          <input
            id="target-date"
            type="date"
            value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)}
            className="border border-border rounded-md px-2.5 py-1.5 text-sm bg-card font-sans"
          />
        </div>
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
