import { fetchForecast, type ForecastTimestep } from "../lib/met.ts";
import { supabaseUpsert } from "../lib/supabase.ts";

// Vestby coordinates
const LAT = 59.6;
const LON = 10.7;

interface WeatherRow {
  location: string;
  date: string;
  temp_avg: number | null;
  temp_min: number | null;
  temp_max: number | null;
  precipitation_mm: number | null;
  wind_speed: number | null;
  weather_symbol: string | null;
  source: string;
  station_id: string;
}

function groupByDate(timeseries: ForecastTimestep[]) {
  const groups = new Map<string, ForecastTimestep[]>();
  for (const ts of timeseries) {
    const date = ts.time.slice(0, 10);
    if (!groups.has(date)) groups.set(date, []);
    groups.get(date)!.push(ts);
  }
  return groups;
}

function summarizeDay(date: string, steps: ForecastTimestep[]): WeatherRow {
  const temps = steps.map((s) => s.data.instant.details.air_temperature);
  const winds = steps.map((s) => s.data.instant.details.wind_speed);

  const tempMin = Math.min(...temps);
  const tempMax = Math.max(...temps);
  const tempAvg = temps.reduce((a, b) => a + b, 0) / temps.length;
  const windAvg = winds.reduce((a, b) => a + b, 0) / winds.length;

  // Sum precipitation from next_1_hours (preferred) or next_6_hours
  let precipTotal = 0;
  for (const s of steps) {
    if (s.data.next_1_hours) {
      precipTotal += s.data.next_1_hours.details.precipitation_amount;
    }
  }
  // If no next_1_hours data, try next_6_hours (avoid double-counting)
  if (precipTotal === 0) {
    const seen = new Set<string>();
    for (const s of steps) {
      if (s.data.next_6_hours && !seen.has(s.time)) {
        precipTotal += s.data.next_6_hours.details.precipitation_amount;
        seen.add(s.time);
      }
    }
  }

  // Pick the most common weather symbol around midday
  const middayStep = steps.find((s) => {
    const hour = new Date(s.time).getUTCHours();
    return hour >= 11 && hour <= 13;
  });
  const symbol =
    middayStep?.data.next_1_hours?.summary.symbol_code ??
    middayStep?.data.next_6_hours?.summary.symbol_code ??
    null;

  return {
    location: "vestby",
    date,
    temp_avg: Math.round(tempAvg * 10) / 10,
    temp_min: Math.round(tempMin * 10) / 10,
    temp_max: Math.round(tempMax * 10) / 10,
    precipitation_mm: Math.round(precipTotal * 10) / 10,
    wind_speed: Math.round(windAvg * 10) / 10,
    weather_symbol: symbol,
    source: "forecast",
    station_id: `forecast_${LAT}_${LON}`,
  };
}

async function main() {
  console.log(`Fetching forecast for Vestby (${LAT}, ${LON})...`);

  const forecast = await fetchForecast(LAT, LON);
  const updated = forecast.properties.meta.updated_at;
  console.log(`Forecast updated: ${updated}`);

  const groups = groupByDate(forecast.properties.timeseries);
  const rows: WeatherRow[] = [];

  for (const [date, steps] of groups) {
    // Skip partial days (first/last) if they have very few datapoints
    if (steps.length < 4) continue;
    rows.push(summarizeDay(date, steps));
  }

  console.log(`${rows.length} forecast days extracted`);

  for (const row of rows.slice(0, 3)) {
    console.log(
      `  ${row.date}: ${row.temp_min}–${row.temp_max}°C, ${row.precipitation_mm}mm, wind ${row.wind_speed}m/s [${row.weather_symbol}]`
    );
  }
  if (rows.length > 3) console.log(`  ... and ${rows.length - 3} more`);

  console.log("\nUpserting to Supabase...");
  await supabaseUpsert("weather_data", rows, "date,location,source");
  console.log("Done!");
}

main().catch(console.error);
