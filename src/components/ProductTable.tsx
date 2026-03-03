import { useState, useEffect, useMemo } from "react";
import type { ProductStatus } from "@/hooks/useProductStatus";

type ModelFilter = "all" | "prophet" | "ols" | "none";
type SortKey = "product_id" | "description" | "model_type" | "predicted_qty";
type SortDir = "asc" | "desc";

function loadCached<T>(key: string, fallback: T): T {
  try {
    const val = localStorage.getItem(key);
    return val != null ? JSON.parse(val) : fallback;
  } catch { return fallback; }
}

interface ProductTableProps {
  products: ProductStatus[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (productId: string) => void;
}

export function ProductTable({ products, loading, selectedId, onSelect }: ProductTableProps) {
  const [search, setSearch] = useState(() => loadCached<string>("kp:search", ""));
  const [statusFilter, setStatusFilter] = useState<ModelFilter>(() => loadCached<ModelFilter>("kp:filter", "all"));
  const [sortKey, setSortKey] = useState<SortKey | null>(() => loadCached<SortKey | null>("kp:sortKey", null));
  const [sortDir, setSortDir] = useState<SortDir>(() => loadCached<SortDir>("kp:sortDir", "asc"));

  useEffect(() => {
    try {
      localStorage.setItem("kp:search", JSON.stringify(search));
      localStorage.setItem("kp:filter", JSON.stringify(statusFilter));
      localStorage.setItem("kp:sortKey", JSON.stringify(sortKey));
      localStorage.setItem("kp:sortDir", JSON.stringify(sortDir));
    } catch {}
  }, [search, statusFilter, sortKey, sortDir]);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const counts = useMemo(() => {
    let prophet = 0, ols = 0, none = 0;
    for (const p of products) {
      if (p.model_type === "prophet") prophet++;
      else if (p.model_type === "ols") ols++;
      else none++;
    }
    return { prophet, ols, none, total: products.length };
  }, [products]);

  const filtered = useMemo(() => {
    let result = products;

    if (statusFilter !== "all") {
      result = result.filter((p) => p.model_type === statusFilter);
    }

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (p) => p.product_id.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)
      );
    }

    if (sortKey) {
      result = [...result].sort((a, b) => {
        const av = a[sortKey];
        const bv = b[sortKey];
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        const cmp = typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv));
        return sortDir === "asc" ? cmp : -cmp;
      });
    }

    return result;
  }, [products, search, statusFilter, sortKey, sortDir]);

  const filters: { key: ModelFilter; label: string; count: number }[] = [
    { key: "all", label: "Alle", count: counts.total },
    { key: "prophet", label: "Prophet", count: counts.prophet },
    { key: "ols", label: "OLS", count: counts.ols },
    { key: "none", label: "Ingen", count: counts.none },
  ];

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Search + Filters */}
      <div className="px-4 pb-3">
        <input
          type="text"
          placeholder="Søk produkt-ID eller navn..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-card font-sans outline-none focus:border-primary transition-colors"
        />
        <div className="flex gap-1.5 mt-2.5">
          {filters.map((f) => (
            <button
              key={f.key}
              onClick={() => setStatusFilter(f.key)}
              className={`px-3 py-1 rounded-md text-xs font-semibold cursor-pointer transition-all font-sans ${
                statusFilter === f.key
                  ? "bg-primary text-primary-foreground border-none"
                  : "bg-transparent text-muted-foreground border border-border hover:border-primary/40"
              }`}
            >
              {f.label} ({f.count})
            </button>
          ))}
        </div>
      </div>

      {/* Column headers */}
      <div
        className="grid gap-2 px-3.5 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider border-b border-border select-none"
        style={{ gridTemplateColumns: "90px 1fr 90px 80px 50px" }}
      >
        <SortHeader sortKey="product_id" currentKey={sortKey} dir={sortDir} onSort={handleSort}>
          ID
        </SortHeader>
        <SortHeader sortKey="description" currentKey={sortKey} dir={sortDir} onSort={handleSort}>
          Produkt
        </SortHeader>
        <SortHeader sortKey="model_type" currentKey={sortKey} dir={sortDir} onSort={handleSort}>
          Modell
        </SortHeader>
        <SortHeader sortKey="description" currentKey={sortKey} dir={sortDir} onSort={handleSort} align="right">
          Type
        </SortHeader>
        <SortHeader sortKey="predicted_qty" currentKey={sortKey} dir={sortDir} onSort={handleSort} align="right">
          Uke ∑
        </SortHeader>
      </div>

      {/* Product list */}
      {loading ? (
        <div className="flex-1 overflow-hidden px-1">
          {Array.from({ length: 10 }).map((_, i) => (
            <div
              key={i}
              className="grid gap-2 items-center px-3.5 py-3 border-b border-border/40"
              style={{ gridTemplateColumns: "90px 1fr 90px 80px 50px" }}
            >
              <div className="w-16 h-3.5 bg-muted animate-pulse rounded" />
              <div className="w-20 h-3.5 bg-muted animate-pulse rounded" />
              <div className="w-14 h-5 bg-muted animate-pulse rounded" />
              <div className="w-16 h-3.5 bg-muted animate-pulse rounded ml-auto" />
              <div className="w-6 h-3.5 bg-muted animate-pulse rounded ml-auto" />
            </div>
          ))}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {filtered.map((p) => {
            const isSelected = p.product_id === selectedId;
            const numericId = p.product_id.split(/\s+/)[0] ?? p.product_id;
            return (
              <div
                key={p.product_id}
                onClick={() => onSelect(p.product_id)}
                className={`grid gap-2 items-center px-3.5 py-2.5 cursor-pointer border-b border-border/60 transition-all text-[13px] ${
                  isSelected
                    ? "bg-accent border-l-[3px] border-l-primary"
                    : "border-l-[3px] border-l-transparent hover:bg-muted/40"
                }`}
                style={{ gridTemplateColumns: "90px 1fr 90px 80px 50px" }}
              >
                <span className="font-mono text-xs text-muted-foreground">{numericId}</span>
                <span className="font-medium text-foreground truncate">{p.description}</span>
                <ModelBadge type={p.model_type} />
                <span className="font-mono text-xs text-muted-foreground text-right">kvartpall</span>
                <span className={`font-mono text-[13px] font-semibold text-right ${
                  p.predicted_qty != null ? "text-foreground" : "text-border"
                }`}>
                  {p.predicted_qty != null ? p.predicted_qty : "–"}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Footer count */}
      <div className="px-3.5 py-2.5 border-t border-border text-[11px] text-muted-foreground shrink-0">
        {filtered.length} produkter
      </div>
    </div>
  );
}

function ModelBadge({ type }: { type: "prophet" | "ols" | "none" }) {
  switch (type) {
    case "prophet":
      return (
        <span className="inline-block text-[11px] font-semibold px-2 py-0.5 rounded bg-green-700 text-white tracking-wide">
          Prophet
        </span>
      );
    case "ols":
      return (
        <span className="inline-block text-[11px] font-semibold px-2 py-0.5 rounded bg-blue-700/80 text-white tracking-wide">
          OLS
        </span>
      );
    case "none":
      return (
        <span className="text-xs text-muted-foreground">Ingen modell</span>
      );
  }
}

function SortHeader({
  children,
  sortKey,
  currentKey,
  dir,
  onSort,
  align,
}: {
  children: React.ReactNode;
  sortKey: SortKey;
  currentKey: SortKey | null;
  dir: SortDir;
  onSort: (key: SortKey) => void;
  align?: "right";
}) {
  const active = currentKey === sortKey;
  const arrow = active ? (dir === "asc" ? " ▲" : " ▼") : "";
  return (
    <span
      className={`cursor-pointer hover:text-foreground transition-colors ${align === "right" ? "text-right" : ""}`}
      onClick={() => onSort(sortKey)}
    >
      {children}
      {arrow && <span className="ml-0.5 text-muted-foreground">{arrow}</span>}
    </span>
  );
}
