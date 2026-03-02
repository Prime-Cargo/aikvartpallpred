import { frostGet } from "../lib/frost.ts";

// Vestby, Norway: Torvuttaket 26, 1540 Vestby
const LAT = 59.6;
const LON = 10.7;

interface FrostSource {
  id: string;
  name: string;
  geometry: { coordinates: number[] };
  distance?: number;
  validFrom?: string;
  validTo?: string;
}

interface FrostResponse {
  data: FrostSource[];
}

async function findStations(elements: string, label: string) {
  console.log(`--- Stations with ${label} ---`);
  const res = await frostGet<FrostResponse>("/sources/v0.jsonld", {
    geometry: `nearest(POINT(${LON} ${LAT}))`,
    nearestmaxcount: "10",
    elements: elements,
  });

  for (const s of res.data) {
    const status = s.validTo ? `closed ${s.validTo}` : "active";
    console.log(`  ${s.id} - ${s.name} (${s.distance?.toFixed(1)}km, ${status})`);
  }
  return res.data;
}

async function main() {
  console.log(`Finding Frost stations near Vestby (${LAT}, ${LON})\n`);

  const [tempStations, precipStations, windStations] = await Promise.all([
    findStations("mean(air_temperature P1D)", "daily temperature"),
    findStations("sum(precipitation_amount P1D)", "daily precipitation"),
    findStations("mean(wind_speed P1D)", "daily wind speed"),
  ]);

  // Find stations that appear in both temp and precip results
  const tempIds = new Set(tempStations.map((s) => s.id));
  const precipIds = new Set(precipStations.map((s) => s.id));
  const windIds = new Set(windStations.map((s) => s.id));

  console.log("\n--- Stations with BOTH temperature AND precipitation ---");
  const combined = tempStations.filter((s) => precipIds.has(s.id));

  if (combined.length === 0) {
    console.log("  None found in top 10. You may need separate stations for temp and precip.");
    console.log(`\n  Closest temp station: ${tempStations[0]?.id} - ${tempStations[0]?.name}`);
    console.log(`  Closest precip station: ${precipStations[0]?.id} - ${precipStations[0]?.name}`);
  } else {
    for (const s of combined) {
      const hasWind = windIds.has(s.id) ? ", +wind" : "";
      const status = s.validTo ? `closed ${s.validTo}` : "active";
      console.log(`  ${s.id} - ${s.name} (${s.distance?.toFixed(1)}km, ${status}${hasWind})`);
    }
    console.log(`\n  Recommended: add FROST_STATION_ID=${combined[0]!.id} to .env`);
  }
}

main().catch(console.error);
