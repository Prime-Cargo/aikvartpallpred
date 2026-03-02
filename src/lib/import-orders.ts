/**
 * Import orders from Astro WMS into Supabase order_history.
 * Extracted from src/scripts/import-orders.ts for use as both CLI and API.
 */

import { supabaseUpsert, supabaseDelete } from "./supabase";
import { ALLOWED_ARTICLES } from "../config/articles";

const ASTRO_API_URL = process.env.ASTRO_API_URL;
const ASTRO_API_KEY = process.env.ASTRO_API_KEY;
const DIVCODES = ["32825", "12941"];

interface AstroOrderLine {
  ordno: string;
  ordline: string;
  partno: string;
  partdsc1: string;
  partdsc2: string;
  reqquant: number;
  delquant: number;
  antall_kp: number;
  custnam1: string;
  order_regdate: string;
  deldate: string;
  pickdate: string;
  routeno: string;
  unit_type: string;
  linestat: number;
  ordstat: number;
  statdate: string;
  calcwght: number;
}

interface OrderHistoryRow {
  product_id: string;
  customer_id: string | null;
  quantity: number;
  order_date: string;
  delivery_date: string | null;
  unit_type: string | null;
}

function norm(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

const ALLOWED_NORMALIZED = new Set(
  [...ALLOWED_ARTICLES.keys()].map(norm)
);

async function fetchOrderLines(
  dateFrom: string,
  dateTo: string,
  divcode: string
): Promise<AstroOrderLine[]> {
  if (!ASTRO_API_URL || !ASTRO_API_KEY) {
    throw new Error("ASTRO_API_URL and ASTRO_API_KEY must be set");
  }

  const params = new URLSearchParams({ dateFrom, dateTo, divcode });
  const url = `${ASTRO_API_URL}/analytics/kvartpall/order-lines?${params}`;

  const res = await fetch(url, {
    headers: {
      "x-api-key": ASTRO_API_KEY,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(`Astro API ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  return Array.isArray(data) ? data : data.rows ?? data.data ?? [];
}

function mapToOrderHistory(line: AstroOrderLine): OrderHistoryRow | null {
  const productId = norm(line.partno);
  if (!ALLOWED_NORMALIZED.has(productId)) return null;

  const quantity = line.antall_kp > 0
    ? line.antall_kp
    : line.delquant > 0
      ? line.delquant
      : line.reqquant;

  if (quantity <= 0) return null;

  const orderDate = (line.order_regdate ?? line.statdate ?? "").trim().slice(0, 10);
  if (!orderDate || orderDate.length !== 10) return null;

  return {
    product_id: productId,
    customer_id: norm(line.custnam1 ?? "") || null,
    quantity,
    order_date: orderDate,
    delivery_date: (line.deldate ?? "").trim().slice(0, 10) || null,
    unit_type: norm(line.unit_type ?? "") || "kvartpall",
  };
}

function deduplicateOrders(rows: OrderHistoryRow[]): OrderHistoryRow[] {
  const seen = new Set<string>();
  const result: OrderHistoryRow[] = [];
  for (const row of rows) {
    const key = `${row.product_id}|${row.order_date}|${row.customer_id}|${row.quantity}|${row.unit_type}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(row);
    }
  }
  return result;
}

export interface ImportResult {
  from: string;
  to: string;
  fetched: number;
  matched: number;
  deduped: number;
  inserted: number;
}

/**
 * Import orders for a date range from Astro WMS into Supabase.
 * Deletes existing rows in the range, then inserts fresh.
 */
export async function importOrders(from: string, to: string): Promise<ImportResult> {
  let totalFetched = 0;
  const allRows: OrderHistoryRow[] = [];

  for (const divcode of DIVCODES) {
    const lines = await fetchOrderLines(from, to, divcode);
    totalFetched += lines.length;

    for (const line of lines) {
      const row = mapToOrderHistory(line);
      if (row) allRows.push(row);
    }

    await Bun.sleep(200);
  }

  const deduped = deduplicateOrders(allRows);

  if (deduped.length > 0) {
    await supabaseDelete("order_history", `order_date=gte.${from}&order_date=lte.${to}`);
    await supabaseUpsert("order_history", deduped, "id");
  }

  return {
    from,
    to,
    fetched: totalFetched,
    matched: allRows.length,
    deduped: deduped.length,
    inserted: deduped.length,
  };
}
