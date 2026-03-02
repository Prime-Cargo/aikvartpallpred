/**
 * Import historical order data from Astro WMS into Supabase order_history.
 *
 * Usage: bun src/scripts/import-orders.ts [--from 2024-09-01] [--to 2026-03-02] [--divcode 32825]
 *
 * Fetches KP order lines from Astro, maps to order_history schema, upserts into Supabase.
 */

import { supabaseUpsert, supabaseSelect } from "../lib/supabase";

const ASTRO_API_URL = process.env.ASTRO_API_URL;
const ASTRO_API_KEY = process.env.ASTRO_API_KEY;

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
  unit_type: string; // "kvartpall" or "full_pall"
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

function parseArgs(): { from: string; to: string; divcode: string } {
  const args = process.argv.slice(2);
  let from = "2024-09-01";
  let to = new Date().toISOString().slice(0, 10);
  let divcode = "32825";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--from" && args[i + 1]) from = args[i + 1]!;
    if (args[i] === "--to" && args[i + 1]) to = args[i + 1]!;
    if (args[i] === "--divcode" && args[i + 1]) divcode = args[i + 1]!;
  }
  return { from, to, divcode };
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
    linestat: "25", // closed/delivered lines only
  });

  const url = `${ASTRO_API_URL}/analytics/kvartpall/order-lines?${params}`;
  console.log(`Fetching: ${url}`);

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
  // Handle both array response and { data: [...] } wrapper
  return Array.isArray(data) ? data : data.data ?? data.rows ?? [];
}

function mapToOrderHistory(line: AstroOrderLine): OrderHistoryRow {
  return {
    product_id: line.partno.trim(),
    customer_id: line.custnam1?.trim() || null,
    quantity: line.antall_kp > 0 ? line.antall_kp : line.delquant > 0 ? line.delquant : line.reqquant,
    order_date: line.order_regdate?.slice(0, 10) ?? line.statdate?.slice(0, 10),
    delivery_date: line.deldate?.slice(0, 10) || null,
    unit_type: line.unit_type || null,
  };
}

async function main() {
  const { from, to, divcode } = parseArgs();
  console.log(`Importing orders from ${from} to ${to} (divcode: ${divcode})\n`);

  // Fetch in monthly chunks to avoid timeouts
  const months = monthlyRanges(from, to);
  const allRows: OrderHistoryRow[] = [];

  for (const [monthFrom, monthTo] of months) {
    try {
      const lines = await fetchOrderLines(monthFrom, monthTo, divcode);
      console.log(`  ${monthFrom} → ${monthTo}: ${lines.length} lines`);

      const mapped = lines.map(mapToOrderHistory).filter((r) => r.quantity > 0 && r.order_date);
      allRows.push(...mapped);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ${monthFrom} → ${monthTo}: ERROR - ${msg}`);
    }

    await Bun.sleep(200); // avoid hammering the API
  }

  console.log(`\nTotal rows to import: ${allRows.length}`);

  if (allRows.length === 0) {
    console.log("No data to import.");
    return;
  }

  // Deduplicate: aggregate by (product_id, order_date, customer_id, unit_type)
  const deduped = deduplicateOrders(allRows);
  console.log(`After deduplication: ${deduped.length} rows`);

  console.log("Upserting to Supabase...");
  await supabaseUpsert("order_history", deduped, "id");
  console.log("Done!");

  // Validate
  await validate();
}

function deduplicateOrders(rows: OrderHistoryRow[]): OrderHistoryRow[] {
  // Each order line is a unique record, so we just filter obvious dupes
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

  const total = await supabaseSelect<{ count: number }>(
    "order_history",
    "select=id&limit=1&order=id"
  );

  // Check for date range
  const earliest = await supabaseSelect<{ order_date: string }>(
    "order_history",
    "select=order_date&order=order_date.asc&limit=1"
  );
  const latest = await supabaseSelect<{ order_date: string }>(
    "order_history",
    "select=order_date&order=order_date.desc&limit=1"
  );

  // Count distinct products
  const products = await supabaseSelect<{ product_id: string }>(
    "order_history",
    "select=product_id&order=product_id"
  );
  const uniqueProducts = new Set(products.map((p) => p.product_id));

  console.log(`  Date range: ${earliest[0]?.order_date ?? "?"} → ${latest[0]?.order_date ?? "?"}`);
  console.log(`  Unique products: ${uniqueProducts.size}`);

  // Check for missing dates (gaps > 3 days)
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

  console.log("  Validation complete.");
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
