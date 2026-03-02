import { useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ProductStatus } from "@/hooks/useProductStatus";

interface ProductTableProps {
  products: ProductStatus[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (productId: string) => void;
}

export function ProductTable({ products, loading, selectedId, onSelect }: ProductTableProps) {
  const [filter, setFilter] = useState("");

  const filtered = useMemo(() => {
    if (!filter) return products;
    const q = filter.toLowerCase();
    return products.filter(
      (p) => p.product_id.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)
    );
  }, [products, filter]);

  const counts = useMemo(() => {
    let prophet = 0, ols = 0, none = 0;
    for (const p of products) {
      if (p.model_type === "prophet") prophet++;
      else if (p.model_type === "ols") ols++;
      else none++;
    }
    return { prophet, ols, none, total: products.length };
  }, [products]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <Input
          placeholder="Søk produkt-ID..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="max-w-sm"
        />
        <div className="flex gap-2 text-xs text-muted-foreground">
          <span>{counts.total} produkter</span>
          <span>·</span>
          <span className="text-green-600">{counts.prophet} Prophet</span>
          <span className="text-blue-600">{counts.ols} OLS</span>
          <span className="text-gray-400">{counts.none} ingen</span>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Laster produktstatus…</p>
      ) : (
        <div className="rounded-md border max-h-[60vh] overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[220px]">Produkt</TableHead>
                <TableHead className="w-[100px]">Type</TableHead>
                <TableHead className="w-[120px]">Status</TableHead>
                <TableHead className="w-[100px] text-right">Forslag</TableHead>
                <TableHead className="w-[160px]">Modell</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    {filter ? "Ingen treff" : "Ingen produkter"}
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((p) => (
                  <TableRow
                    key={p.product_id}
                    className={`cursor-pointer ${
                      selectedId === p.product_id
                        ? "bg-accent"
                        : "hover:bg-muted/50"
                    }`}
                    onClick={() => onSelect(p.product_id)}
                  >
                    <TableCell className="font-mono text-sm">{p.product_id}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{p.description}</TableCell>
                    <TableCell>
                      <StatusBadge type={p.model_type} />
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {p.predicted_qty !== null ? p.predicted_qty : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground truncate max-w-[160px]">
                      {p.model_version ?? "—"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ type }: { type: "prophet" | "ols" | "none" }) {
  switch (type) {
    case "prophet":
      return <Badge className="bg-green-600 text-white">Prophet</Badge>;
    case "ols":
      return <Badge className="bg-blue-600 text-white">OLS</Badge>;
    case "none":
      return <Badge variant="secondary">Ingen modell</Badge>;
  }
}
