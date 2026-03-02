import { supabaseSelect } from "../lib/supabase.ts";

const START_DATE = "2024-09-01";
const END_DATE = "2026-03-02";

interface WeatherRow {
  date: string;
  temp_avg: number | null;
  temp_min: number | null;
  temp_max: number | null;
  precipitation_mm: number | null;
  wind_speed: number | null;
  source: string;
}

function allDatesInRange(start: string, end: string): Set<string> {
  const dates = new Set<string>();
  const current = new Date(start);
  const endDate = new Date(end);
  while (current <= endDate) {
    dates.add(current.toISOString().slice(0, 10));
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

async function main() {
  console.log(`Validating weather data from ${START_DATE} to ${END_DATE}\n`);

  const rows = await supabaseSelect<WeatherRow>(
    "weather_data",
    `select=date,temp_avg,temp_min,temp_max,precipitation_mm,wind_speed,source&date=gte.${START_DATE}&date=lte.${END_DATE}&order=date.asc`
  );

  console.log(`Total rows: ${rows.length}`);

  // Group by source
  const bySrc = new Map<string, WeatherRow[]>();
  for (const r of rows) {
    if (!bySrc.has(r.source)) bySrc.set(r.source, []);
    bySrc.get(r.source)!.push(r);
  }
  for (const [src, srcRows] of bySrc) {
    console.log(`  ${src}: ${srcRows.length} rows`);
  }

  // Check coverage (use frost rows, fall back to forecast)
  const allDates = allDatesInRange(START_DATE, END_DATE);
  const coveredDates = new Set(rows.map((r) => r.date));
  const missingDates = [...allDates].filter((d) => !coveredDates.has(d)).sort();

  const totalDays = allDates.size;
  const coveredDays = coveredDates.size;
  const coverage = ((coveredDays / totalDays) * 100).toFixed(1);

  console.log(`\nDate coverage: ${coveredDays}/${totalDays} (${coverage}%)`);

  if (missingDates.length > 0) {
    console.log(`\nMissing dates (${missingDates.length}):`);
    // Show first 20 and last 5
    const show = missingDates.length <= 25 ? missingDates : [
      ...missingDates.slice(0, 20),
      `... (${missingDates.length - 25} more)`,
      ...missingDates.slice(-5),
    ];
    for (const d of show) console.log(`  ${d}`);
  } else {
    console.log("No gaps found!");
  }

  // Check for NULL critical values
  const nullChecks = [
    { field: "temp_avg", rows: rows.filter((r) => r.temp_avg === null) },
    { field: "precipitation_mm", rows: rows.filter((r) => r.precipitation_mm === null) },
  ];

  console.log("\nNULL value check:");
  for (const { field, rows: nullRows } of nullChecks) {
    if (nullRows.length > 0) {
      console.log(`  ${field}: ${nullRows.length} NULL values`);
      for (const r of nullRows.slice(0, 5)) {
        console.log(`    ${r.date} (${r.source})`);
      }
      if (nullRows.length > 5) console.log(`    ... and ${nullRows.length - 5} more`);
    } else {
      console.log(`  ${field}: OK`);
    }
  }

  // Reasonableness spot-checks
  console.log("\nSpot-check (temp ranges):");
  const outliers = rows.filter(
    (r) =>
      r.temp_avg !== null &&
      (r.temp_avg < -30 || r.temp_avg > 40)
  );
  if (outliers.length > 0) {
    console.log(`  WARNING: ${outliers.length} rows with extreme temps`);
    for (const r of outliers.slice(0, 5)) {
      console.log(`    ${r.date}: avg=${r.temp_avg}°C (${r.source})`);
    }
  } else {
    console.log("  All temperatures within reasonable range (-30 to 40°C)");
  }
}

main().catch(console.error);
