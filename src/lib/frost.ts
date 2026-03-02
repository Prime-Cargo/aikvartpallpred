const FROST_BASE = "https://frost.met.no";

function getAuth(): string {
  const id = process.env.FROST_ID;
  if (!id) throw new Error("FROST_ID not set in .env");
  return `Basic ${btoa(`${id}:`)}`;
}

export async function frostGet<T = unknown>(
  path: string,
  params?: Record<string, string>
): Promise<T> {
  const url = new URL(path, FROST_BASE);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }

  const res = await fetch(url, {
    headers: { Authorization: getAuth() },
  });

  if (res.status === 429) {
    const retryAfter = Number(res.headers.get("Retry-After") || "5");
    console.log(`Rate limited, waiting ${retryAfter}s...`);
    await Bun.sleep(retryAfter * 1000);
    return frostGet(path, params);
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Frost API ${res.status}: ${body}`);
  }

  return res.json() as Promise<T>;
}
