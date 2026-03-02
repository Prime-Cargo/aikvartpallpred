import { frostGet } from "../lib/frost.ts";
import { supabaseUpsert } from "../lib/supabase.ts";

const STATION_ID = process.env.FROST_STATION_ID;
if (!STATION_ID) {
  console.error("FROST_STATION_ID not set in .env. Run find-stations.ts first.");
  process.exit(1);
}

const START_DATE = "2024-09-01";
const END_DATE = "2026-03-02";

const ELEMENTS = [
  "mean(air_temperature P1D)",
  "min(air_temperature P1D)",
  "max(air_temperature P1D)",
  "sum(precipitation_amount P1D)",
  "mean(wind_speed P1D)",
].join(",");

interface FrostObservation {
  sourceId: string;
  referenceTime: string;
  observations: {
    elementId: string;
    value: number;
    unit: string;
  }[];
}

interface FrostObsResponse {
  data: FrostObservation[];
}

interface WeatherRow {
  location: string;
  date: string;
  temp_avg: number | null;
  temp_min: number | null;
  temp_max: number | null;
  precipitation_mm: number | null;
  wind_speed: number | null;
  source: string;
  station_id: string;
}

function monthlyRanges(start: string, end: string): [string, string][] {
  const ranges: [string, string][] = [];
  let current = new Date(start);
  const endDate = new Date(end);

  while (current <= endDate) {
    // End of month + 1 day (Frost API range is exclusive on the end)
    const nextMonth = new Date(current.getFullYear(), current.getMonth() + 1, 1);
    const rangeEnd = nextMonth <= endDate ? nextMonth : new Date(endDate.getTime() + 86400000);
    ranges.push([
      current.toISOString().slice(0, 10),
      rangeEnd.toISOString().slice(0, 10),
    ]);
    current = nextMonth;
  }
  return ranges;
}

async function main() {
  const ranges = monthlyRanges(START_DATE, END_DATE);
  console.log(`Backfilling ${STATION_ID} from ${START_DATE} to ${END_DATE}`);
  console.log(`${ranges.length} monthly batches\n`);

  const allRows: WeatherRow[] = [];

  for (const [from, to] of ranges) {
    console.log(`Fetching ${from} → ${to}...`);

    try {
      const res = await frostGet<FrostObsResponse>(
        "/observations/v0.jsonld",
        {
          sources: STATION_ID,
          referencetime: `${from}/${to}`,
          elements: ELEMENTS,
          timeresolutions: "P1D",
        }
      );

      // Group observations by date
      const byDate = new Map<string, Partial<WeatherRow>>();

      for (const obs of res.data) {
        const date = obs.referenceTime.slice(0, 10);
        if (!byDate.has(date)) {
          byDate.set(date, { date, location: "vestby", source: "frost", station_id: STATION_ID });
        }
        const row = byDate.get(date)!;

        for (const o of obs.observations) {
          // Only take first value per element (avoid duplicates from multiple sensors)
          switch (o.elementId) {
            case "mean(air_temperature P1D)":
              row.temp_avg ??= o.value;
              break;
            case "min(air_temperature P1D)":
              row.temp_min ??= o.value;
              break;
            case "max(air_temperature P1D)":
              row.temp_max ??= o.value;
              break;
            case "sum(precipitation_amount P1D)":
              row.precipitation_mm ??= o.value;
              break;
            case "mean(wind_speed P1D)":
              row.wind_speed ??= o.value;
              break;
          }
        }
      }

      const rows = [...byDate.values()] as WeatherRow[];
      allRows.push(...rows);
      console.log(`  → ${rows.length} days`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("404") || msg.includes("No data")) {
        console.log(`  → No data for this period`);
      } else {
        throw e;
      }
    }

    // Small delay to avoid rate limiting
    await Bun.sleep(200);
  }

  console.log(`\nTotal: ${allRows.length} days collected`);

  if (allRows.length === 0) {
    console.log("No data to insert.");
    return;
  }

  console.log("Upserting to Supabase...");
  await supabaseUpsert("weather_data", allRows, "date,location,source");
  console.log("Done!");
}

main().catch(console.error);
