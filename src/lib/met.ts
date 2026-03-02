const LOCATIONFORECAST_URL =
  "https://api.met.no/weatherapi/locationforecast/2.0/compact";

const USER_AGENT = "aikvartpallpred/1.0 github.com/aikvartpallpred";

export interface ForecastTimestep {
  time: string;
  data: {
    instant: {
      details: {
        air_temperature: number;
        wind_speed: number;
        relative_humidity?: number;
        air_pressure_at_sea_level?: number;
      };
    };
    next_1_hours?: {
      summary: { symbol_code: string };
      details: { precipitation_amount: number };
    };
    next_6_hours?: {
      summary: { symbol_code: string };
      details: { precipitation_amount: number };
    };
  };
}

export interface ForecastResponse {
  properties: {
    meta: { updated_at: string };
    timeseries: ForecastTimestep[];
  };
}

export async function fetchForecast(
  lat: number,
  lon: number
): Promise<ForecastResponse> {
  const url = `${LOCATIONFORECAST_URL}?lat=${lat}&lon=${lon}`;
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
  });

  if (res.status === 429) {
    const retryAfter = Number(res.headers.get("Retry-After") || "5");
    console.log(`Rate limited, waiting ${retryAfter}s...`);
    await Bun.sleep(retryAfter * 1000);
    return fetchForecast(lat, lon);
  }

  if (!res.ok) {
    throw new Error(`MET API ${res.status}: ${await res.text()}`);
  }

  return res.json() as Promise<ForecastResponse>;
}
