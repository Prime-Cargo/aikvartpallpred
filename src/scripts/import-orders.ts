/**
 * Import historical order data from Astro WMS into Supabase order_history.
 *
 * Usage: bun src/scripts/import-orders.ts [--from 2024-09-01] [--to 2026-03-02]
 *
 * Fetches KP order lines from Astro (divcodes 32825 + 12941),
 * filters to whitelisted articles, upserts into Supabase.
 */

import { supabaseUpsert, supabaseSelect } from "../lib/supabase";
import { ALLOWED_ARTICLES } from "../config/articles";

const ASTRO_API_URL = process.env.ASTRO_API_URL;
const ASTRO_API_KEY = process.env.ASTRO_API_KEY;
const DIVCODES = ["32825", "12941"];

if (!ASTRO_API_URL || !ASTRO_API_KEY) {
  console.error("ASTRO_API_URL and ASTRO_API_KEY must be set in .env");
  process.exit(1);
}

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

/** Normalize whitespace: trim + collapse multiple spaces to single space. */
function norm(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

/** Build the lookup set with normalized keys for matching. */
const ALLOWED_NORMALIZED = new Set(
  [...ALLOWED_ARTICLES.keys()].map(norm)
);

function parseArgs(): { from: string; to: string } {
  const args = process.argv.slice(2);
  let from = "2024-09-01";
  let to = new Date().toISOString().slice(0, 10);

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--from" && args[i + 1]) from = args[i + 1]!;
    if (args[i] === "--to" && args[i + 1]) to = args[i + 1]!;
  }
  return { from, to };
}

async function fetchOrderLines(
  dateFrom: string,
  dateTo: string,
  divcode: string
): Promise<AstroOrderLine[]> {
  const params = new URLSearchParams({
    dateFrom,
    dateTo,
    divcode,
  });

  const url = `${ASTRO_API_URL}/analytics/kvartpall/order-lines?${params}`;

  const res = await fetch(url, {
    headers: {
      "x-api-key": ASTRO_API_KEY!,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(`Astro API ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  return Array.isArray(data) ? data : data.rows ?? data.data ?? [];
}

function isAllowed(partno: string): boolean {
  return ALLOWED_NORMALIZED.has(norm(partno));
}

function mapToOrderHistory(line: AstroOrderLine): OrderHistoryRow | null {
  const productId = norm(line.partno);
  if (!isAllowed(productId)) return null;

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

async function main() {
  const { from, to } = parseArgs();
  console.log(`Importing orders from ${from} to ${to}`);
  console.log(`Divcodes: ${DIVCODES.join(", ")}`);
  console.log(`Whitelisted articles: ${ALLOWED_ARTICLES.size}\n`);

  const months = monthlyRanges(from, to);
  const allRows: OrderHistoryRow[] = [];
  let totalFetched = 0;

  for (const divcode of DIVCODES) {
    console.log(`--- Divcode ${divcode} ---`);

    for (const [monthFrom, monthTo] of months) {
      try {
        const lines = await fetchOrderLines(monthFrom, monthTo, divcode);
        totalFetched += lines.length;

        const mapped: OrderHistoryRow[] = [];
        for (const line of lines) {
          const row = mapToOrderHistory(line);
          if (row) mapped.push(row);
        }

        const pct = lines.length > 0 ? Math.round((mapped.length / lines.length) * 100) : 0;
        console.log(`  ${monthFrom} → ${monthTo}: ${lines.length} lines → ${mapped.length} matched (${pct}%)`);
        allRows.push(...mapped);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  ${monthFrom} → ${monthTo}: ERROR - ${msg}`);
      }

      await Bun.sleep(200);
    }
  }

  console.log(`\nTotal fetched: ${totalFetched}`);
  console.log(`After whitelist filter: ${allRows.length}`);

  if (allRows.length === 0) {
    console.log("No data to import.");
    return;
  }

  const deduped = deduplicateOrders(allRows);
  console.log(`After deduplication: ${deduped.length}`);

  console.log("\nUpserting to Supabase...");
  await supabaseUpsert("order_history", deduped, "id");
  console.log("Done!");

  await validate();
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

async function validate() {
  console.log("\n--- Validation ---");

  const earliest = await supabaseSelect<{ order_date: string }>(
    "order_history",
    "select=order_date&order=order_date.asc&limit=1"
  );
  const latest = await supabaseSelect<{ order_date: string }>(
    "order_history",
    "select=order_date&order=order_date.desc&limit=1"
  );

  const products = await supabaseSelect<{ product_id: string }>(
    "order_history",
    "select=product_id&order=product_id"
  );
  const uniqueProducts = new Set(products.map((p) => p.product_id));

  console.log(`  Date range: ${earliest[0]?.order_date ?? "?"} → ${latest[0]?.order_date ?? "?"}`);
  console.log(`  Unique products: ${uniqueProducts.size}`);
  console.log(`  Total rows: ${products.length}`);

  // Check for date gaps > 3 days
  const dates = await supabaseSelect<{ order_date: string }>(
    "order_history",
    "select=order_date&order=order_date.asc"
  );
  const uniqueDates = [...new Set(dates.map((d) => d.order_date))].sort();
  let gaps = 0;
  for (let i = 1; i < uniqueDates.length; i++) {
    const prev = new Date(uniqueDates[i - 1]!);
    const curr = new Date(uniqueDates[i]!);
    const diff = (curr.getTime() - prev.getTime()) / 86400000;
    if (diff > 3) {
      gaps++;
      if (gaps <= 5) console.log(`  Gap: ${uniqueDates[i - 1]} → ${uniqueDates[i]} (${diff} days)`);
    }
  }
  if (gaps > 5) console.log(`  ... and ${gaps - 5} more gaps`);
  if (gaps === 0) console.log(`  No date gaps > 3 days`);

  // Show top 10 products by order count
  const productCounts = new Map<string, number>();
  for (const p of products) {
    productCounts.set(p.product_id, (productCounts.get(p.product_id) ?? 0) + 1);
  }
  const top10 = [...productCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  console.log("\n  Top 10 products by order count:");
  for (const [pid, count] of top10) {
    console.log(`    ${pid}: ${count}`);
  }

  console.log("\n  Validation complete.");
}

function monthlyRanges(start: string, end: string): [string, string][] {
  const ranges: [string, string][] = [];
  let current = new Date(start);
  const endDate = new Date(end);

  while (current <= endDate) {
    const nextMonth = new Date(current.getFullYear(), current.getMonth() + 1, 1);
    const rangeEnd = nextMonth <= endDate ? new Date(nextMonth.getTime() - 86400000) : endDate;
    ranges.push([
      current.toISOString().slice(0, 10),
      rangeEnd.toISOString().slice(0, 10),
    ]);
    current = nextMonth;
  }
  return ranges;
}

main().catch(console.error);
