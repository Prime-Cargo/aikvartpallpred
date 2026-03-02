/**
 * Feature engineering for demand prediction.
 * 15 features: day-of-week (6 one-hot), month (sin/cos), weather (temp, precip, wind z-scored),
 * heavy rain flag, demand lags (7d avg, 30d avg).
 */

import { supabaseSelect } from "./supabase";
import { fetchForecast, type ForecastTimestep } from "./met";

// Vestby coordinates (for weather forecast)
const VESTBY_LAT = 59.60;
const VESTBY_LON = 10.72;

export const FEATURE_NAMES = [
  "dow_mon", "dow_tue", "dow_wed", "dow_thu", "dow_fri", "dow_sat",
  "month_sin", "month_cos",
  "temp_z", "precip_z", "wind_z",
  "heavy_rain",
  "lag_7d_avg", "lag_30d_avg",
] as const;

export interface Normalization {
  temp: { mean: number; std: number };
  precip: { mean: number; std: number };
  wind: { mean: number; std: number };
}

interface WeatherRow {
  date: string;
  temp_avg: number | null;
  precipitation_mm: number | null;
  wind_speed: number | null;
}

interface OrderRow {
  product_id: string;
  quantity: number;
  order_date: string;
}

export interface TrainingData {
  X: number[][];
  y: number[];
  normalization: Normalization;
  dateRange: { from: string; to: string; n_days: number };
}

function zScore(value: number, mean: number, std: number): number {
  return std > 0 ? (value - mean) / std : 0;
}

function dayOfWeekOneHot(date: Date): number[] {
  const dow = date.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  // Drop Sunday (index 0), encode Mon-Sat as 6 binary features
  return [1, 2, 3, 4, 5, 6].map((d) => (dow === d ? 1 : 0));
}

function monthCyclical(date: Date): [number, number] {
  const month = date.getMonth(); // 0-11
  const angle = (2 * Math.PI * month) / 12;
  return [Math.sin(angle), Math.cos(angle)];
}

/**
 * Gather training data for a single product: orders + weather joined by date.
 */
export async function gatherTrainingData(
  productId: string,
  from: string,
  to: string
): Promise<TrainingData | null> {
  // Fetch orders for this product in range
  const orders = await supabaseSelect<OrderRow>(
    "order_history",
    `product_id=eq.${productId}&order_date=gte.${from}&order_date=lte.${to}&select=product_id,quantity,order_date`
  );

  // Aggregate orders by date
  const ordersByDate = new Map<string, number>();
  for (const o of orders) {
    ordersByDate.set(o.order_date, (ordersByDate.get(o.order_date) ?? 0) + o.quantity);
  }

  // Fetch weather for the date range
  const weather = await supabaseSelect<WeatherRow>(
    "weather_data",
    `date=gte.${from}&date=lte.${to}&select=date,temp_avg,precipitation_mm,wind_speed&order=date.asc`
  );

  const weatherByDate = new Map<string, WeatherRow>();
  for (const w of weather) {
    weatherByDate.set(w.date, w);
  }

  // Build list of dates that have both order data and weather data
  const allDates = new Set([...ordersByDate.keys()]);
  // Also include dates with weather but zero orders (important for training)
  for (const w of weather) {
    allDates.add(w.date);
  }

  const sortedDates = [...allDates].sort();
  if (sortedDates.length < 30) return null;

  // Compute daily demand for lag features (all dates, 0 if no orders)
  const dailyDemand = new Map<string, number>();
  for (const d of sortedDates) {
    dailyDemand.set(d, ordersByDate.get(d) ?? 0);
  }

  // Compute normalization stats from weather
  const temps: number[] = [];
  const precips: number[] = [];
  const winds: number[] = [];
  for (const w of weather) {
    if (w.temp_avg !== null) temps.push(w.temp_avg);
    if (w.precipitation_mm !== null) precips.push(w.precipitation_mm);
    if (w.wind_speed !== null) winds.push(w.wind_speed);
  }

  const normalization: Normalization = {
    temp: computeStats(temps),
    precip: computeStats(precips),
    wind: computeStats(winds),
  };

  // Build feature matrix — skip first 30 days (need lags)
  const X: number[][] = [];
  const y: number[] = [];

  for (let i = 30; i < sortedDates.length; i++) {
    const dateStr = sortedDates[i]!;
    const w = weatherByDate.get(dateStr);
    if (!w || w.temp_avg === null) continue; // skip days with missing weather

    const date = new Date(dateStr);
    const dow = dayOfWeekOneHot(date);
    const [monthSin, monthCos] = monthCyclical(date);

    const tempZ = zScore(w.temp_avg ?? 0, normalization.temp.mean, normalization.temp.std);
    const precipZ = zScore(w.precipitation_mm ?? 0, normalization.precip.mean, normalization.precip.std);
    const windZ = zScore(w.wind_speed ?? 0, normalization.wind.mean, normalization.wind.std);
    const heavyRain = (w.precipitation_mm ?? 0) > 10 ? 1 : 0;

    // Lag features: average demand over past 7 and 30 days
    const lag7 = computeLagAvg(sortedDates, dailyDemand, i, 7);
    const lag30 = computeLagAvg(sortedDates, dailyDemand, i, 30);

    X.push([...dow, monthSin, monthCos, tempZ, precipZ, windZ, heavyRain, lag7, lag30]);
    y.push(dailyDemand.get(dateStr) ?? 0);
  }

  if (X.length < 30) return null;

  return {
    X,
    y,
    normalization,
    dateRange: { from: sortedDates[30]!, to: sortedDates[sortedDates.length - 1]!, n_days: X.length },
  };
}

function computeLagAvg(
  sortedDates: string[],
  dailyDemand: Map<string, number>,
  currentIdx: number,
  lagDays: number
): number {
  let sum = 0;
  let count = 0;
  for (let j = currentIdx - lagDays; j < currentIdx; j++) {
    if (j >= 0) {
      sum += dailyDemand.get(sortedDates[j]!) ?? 0;
      count++;
    }
  }
  return count > 0 ? sum / count : 0;
}

function computeStats(values: number[]): { mean: number; std: number } {
  if (values.length === 0) return { mean: 0, std: 1 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  const std = Math.sqrt(variance);
  return { mean, std: std > 0 ? std : 1 };
}

/**
 * Build a single feature vector for inference (prediction time).
 */
export async function buildFeatureVector(
  productId: string,
  targetDate: string,
  normalization: Normalization
): Promise<number[]> {
  const date = new Date(targetDate);
  const dow = dayOfWeekOneHot(date);
  const [monthSin, monthCos] = monthCyclical(date);

  // Get weather for the target date
  const weather = await getWeatherForDate(targetDate);
  const tempZ = zScore(weather.temp, normalization.temp.mean, normalization.temp.std);
  const precipZ = zScore(weather.precip, normalization.precip.mean, normalization.precip.std);
  const windZ = zScore(weather.wind, normalization.wind.mean, normalization.wind.std);
  const heavyRain = weather.precip > 10 ? 1 : 0;

  // Compute lag features from recent orders
  const lag7 = await computeRecentLagAvg(productId, targetDate, 7);
  const lag30 = await computeRecentLagAvg(productId, targetDate, 30);

  return [...dow, monthSin, monthCos, tempZ, precipZ, windZ, heavyRain, lag7, lag30];
}

interface WeatherSummary {
  temp: number;
  precip: number;
  wind: number;
}

/**
 * Get weather for a specific date:
 * - Past/today: query weather_data table
 * - Future (within forecast range ~10 days): use met.no forecast
 * - Beyond forecast range: use historical monthly average from weather_data
 */
export async function getWeatherForDate(targetDate: string): Promise<WeatherSummary> {
  const today = new Date().toISOString().slice(0, 10);
  const target = new Date(targetDate);
  const todayDate = new Date(today);
  const diffDays = Math.round((target.getTime() - todayDate.getTime()) / 86400000);

  // Past or today: query stored weather
  if (diffDays <= 0) {
    const rows = await supabaseSelect<WeatherRow>(
      "weather_data",
      `date=eq.${targetDate}&select=temp_avg,precipitation_mm,wind_speed&limit=1`
    );
    const first = rows[0];
    if (first && first.temp_avg !== null) {
      return {
        temp: first.temp_avg ?? 0,
        precip: first.precipitation_mm ?? 0,
        wind: first.wind_speed ?? 0,
      };
    }
    // Fall through to monthly average
  }

  // Future within forecast range (~10 days)
  if (diffDays > 0 && diffDays <= 10) {
    try {
      const forecast = await fetchForecast(VESTBY_LAT, VESTBY_LON);
      const daySteps = forecast.properties.timeseries.filter((ts: ForecastTimestep) =>
        ts.time.startsWith(targetDate)
      );
      if (daySteps.length > 0) {
        const temps = daySteps.map((s: ForecastTimestep) => s.data.instant.details.air_temperature);
        const winds = daySteps.map((s: ForecastTimestep) => s.data.instant.details.wind_speed);
        const precips = daySteps
          .map((s: ForecastTimestep) => s.data.next_1_hours?.details.precipitation_amount ?? s.data.next_6_hours?.details.precipitation_amount ?? 0);
        return {
          temp: temps.reduce((a: number, b: number) => a + b, 0) / temps.length,
          precip: precips.reduce((a: number, b: number) => a + b, 0),
          wind: winds.reduce((a: number, b: number) => a + b, 0) / winds.length,
        };
      }
    } catch {
      // Fall through to monthly average
    }
  }

  // Fallback: historical monthly average from weather_data
  return getHistoricalMonthlyAvg(target.getMonth() + 1);
}

async function getHistoricalMonthlyAvg(month: number): Promise<WeatherSummary> {
  // Fetch all weather data for this month across all years
  const monthStr = month.toString().padStart(2, "0");
  const rows = await supabaseSelect<WeatherRow>(
    "weather_data",
    `date=like.*-${monthStr}-*&select=temp_avg,precipitation_mm,wind_speed`
  );

  if (rows.length === 0) return { temp: 5, precip: 2, wind: 3 }; // safe defaults

  const temps = rows.filter((r) => r.temp_avg !== null).map((r) => r.temp_avg!);
  const precips = rows.filter((r) => r.precipitation_mm !== null).map((r) => r.precipitation_mm!);
  const winds = rows.filter((r) => r.wind_speed !== null).map((r) => r.wind_speed!);

  return {
    temp: temps.length > 0 ? temps.reduce((a, b) => a + b, 0) / temps.length : 5,
    precip: precips.length > 0 ? precips.reduce((a, b) => a + b, 0) / precips.length : 2,
    wind: winds.length > 0 ? winds.reduce((a, b) => a + b, 0) / winds.length : 3,
  };
}

async function computeRecentLagAvg(
  productId: string,
  targetDate: string,
  lagDays: number
): Promise<number> {
  const target = new Date(targetDate);
  const from = new Date(target);
  from.setDate(from.getDate() - lagDays);
  const fromStr = from.toISOString().slice(0, 10);
  const toStr = new Date(target.getTime() - 86400000).toISOString().slice(0, 10); // day before target

  const orders = await supabaseSelect<{ quantity: number }>(
    "order_history",
    `product_id=eq.${productId}&order_date=gte.${fromStr}&order_date=lte.${toStr}&select=quantity`
  );

  if (orders.length === 0) return 0;
  const total = orders.reduce((sum, o) => sum + o.quantity, 0);
  return total / lagDays;
}
