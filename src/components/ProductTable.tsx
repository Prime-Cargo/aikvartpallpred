import { useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ProductStatus } from "@/hooks/useProductStatus";

type ModelFilter = "all" | "prophet" | "ols" | "none";
type SortKey = "product_id" | "description" | "model_type" | "predicted_qty" | "model_version";
type SortDir = "asc" | "desc";

interface ProductTableProps {
  products: ProductStatus[];
  loading: boolean;
  selectedId: string | null;
  loadingId: string | null;
  onSelect: (productId: string) => void;
}

export function ProductTable({ products, loading, selectedId, loadingId, onSelect }: ProductTableProps) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ModelFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

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

  return (
    <div className="space-y-4">
      {/* Filters row */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <Input
          placeholder="Søk produkt-ID..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />

        <div className="flex gap-1.5">
          <FilterButton
            active={statusFilter === "all"}
            onClick={() => setStatusFilter("all")}
            label={`Alle (${counts.total})`}
          />
          <FilterButton
            active={statusFilter === "prophet"}
            onClick={() => setStatusFilter("prophet")}
            label={`Prophet (${counts.prophet})`}
            color="green"
          />
          <FilterButton
            active={statusFilter === "ols"}
            onClick={() => setStatusFilter("ols")}
            label={`OLS (${counts.ols})`}
            color="blue"
          />
          <FilterButton
            active={statusFilter === "none"}
            onClick={() => setStatusFilter("none")}
            label={`Ingen (${counts.none})`}
            color="gray"
          />
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Laster produktstatus…</p>
      ) : (
        <div className="rounded-md border border-border overflow-hidden">
          <div className="max-h-[60vh] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10">
                <TableRow className="bg-muted/60 hover:bg-muted/60">
                  <SortableHead width="w-[220px]" sortKey="product_id" currentKey={sortKey} dir={sortDir} onSort={handleSort}>Produkt</SortableHead>
                  <SortableHead width="w-[100px]" sortKey="description" currentKey={sortKey} dir={sortDir} onSort={handleSort}>Type</SortableHead>
                  <SortableHead width="w-[120px]" sortKey="model_type" currentKey={sortKey} dir={sortDir} onSort={handleSort}>Status</SortableHead>
                  <SortableHead width="w-[100px]" sortKey="predicted_qty" currentKey={sortKey} dir={sortDir} onSort={handleSort} align="right">Forslag</SortableHead>
                  <SortableHead width="w-[160px]" sortKey="model_version" currentKey={sortKey} dir={sortDir} onSort={handleSort}>Modell</SortableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                      {search || statusFilter !== "all" ? "Ingen treff" : "Ingen produkter"}
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((p, i) => {
                    const isLoading = loadingId === p.product_id;
                    return (
                      <TableRow
                        key={p.product_id}
                        data-state={selectedId === p.product_id ? "selected" : undefined}
                        className={`cursor-pointer transition-colors ${
                          selectedId === p.product_id
                            ? "bg-accent"
                            : i % 2 === 1
                              ? "bg-muted/20"
                              : ""
                        }`}
                        onClick={() => onSelect(p.product_id)}
                      >
                        <TableCell className="font-mono text-sm">{p.product_id}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{p.description}</TableCell>
                        <TableCell>
                          <StatusBadge type={p.model_type} />
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {isLoading ? (
                            <span className="text-muted-foreground animate-pulse">…</span>
                          ) : p.predicted_qty !== null ? (
                            p.predicted_qty
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground truncate max-w-[160px]">
                          {p.model_version ?? "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Viser {filtered.length} av {counts.total} produkter
        </p>
      )}
    </div>
  );
}

function StatusBadge({ type }: { type: "prophet" | "ols" | "none" }) {
  switch (type) {
    case "prophet":
      return <Badge className="bg-green-600 text-white hover:bg-green-700">Prophet</Badge>;
    case "ols":
      return <Badge className="bg-blue-600 text-white hover:bg-blue-700">OLS</Badge>;
    case "none":
      return <Badge variant="outline" className="text-muted-foreground">Ingen modell</Badge>;
  }
}

function SortableHead({
  children,
  sortKey,
  currentKey,
  dir,
  onSort,
  width,
  align,
}: {
  children: React.ReactNode;
  sortKey: SortKey;
  currentKey: SortKey | null;
  dir: SortDir;
  onSort: (key: SortKey) => void;
  width?: string;
  align?: "right";
}) {
  const active = currentKey === sortKey;
  const arrow = active ? (dir === "asc" ? " ▲" : " ▼") : "";
  return (
    <TableHead
      className={`${width ?? ""} ${align === "right" ? "text-right" : ""} cursor-pointer select-none hover:bg-muted/80 transition-colors`}
      onClick={() => onSort(sortKey)}
    >
      {children}
      <span className="text-xs ml-1 text-muted-foreground">{arrow}</span>
    </TableHead>
  );
}

function FilterButton({
  active,
  onClick,
  label,
  color,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  color?: "green" | "blue" | "gray";
}) {
  const colorClasses = active
    ? color === "green"
      ? "bg-green-600 text-white hover:bg-green-700"
      : color === "blue"
        ? "bg-blue-600 text-white hover:bg-blue-700"
        : color === "gray"
          ? "bg-gray-500 text-white hover:bg-gray-600"
          : ""
    : "";

  return (
    <Button
      variant={active && !color ? "default" : active ? "ghost" : "outline"}
      size="sm"
      onClick={onClick}
      className={`text-xs h-7 ${colorClasses}`}
    >
      {label}
    </Button>
  );
}
