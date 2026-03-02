function getConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY must be set in .env");
  return { url: url.replace(/\/$/, ""), key };
}

export async function supabaseSelect<T = unknown>(
  table: string,
  query?: string
): Promise<T[]> {
  const { url, key } = getConfig();
  const endpoint = `${url}/rest/v1/${table}${query ? `?${query}` : ""}`;
  const res = await fetch(endpoint, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) throw new Error(`Supabase SELECT ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T[]>;
}

export async function supabaseInsert<T = unknown>(
  table: string,
  row: T
): Promise<T> {
  const { url, key } = getConfig();
  const endpoint = `${url}/rest/v1/${table}`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`Supabase INSERT ${res.status}: ${await res.text()}`);
  const rows = (await res.json()) as T[];
  return rows[0] as T;
}

export async function supabasePatch<T = unknown>(
  table: string,
  query: string,
  patch: Partial<T>
): Promise<void> {
  const { url, key } = getConfig();
  const endpoint = `${url}/rest/v1/${table}?${query}`;
  const res = await fetch(endpoint, {
    method: "PATCH",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`Supabase PATCH ${res.status}: ${await res.text()}`);
}

export async function supabaseUpsert<T = unknown>(
  table: string,
  rows: T[],
  onConflict: string
): Promise<void> {
  const { url, key } = getConfig();
  const endpoint = `${url}/rest/v1/${table}`;

  // Batch in chunks of 500
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const res = await fetch(`${endpoint}?on_conflict=${onConflict}`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify(batch),
    });
    if (!res.ok) {
      throw new Error(`Supabase UPSERT ${res.status}: ${await res.text()}`);
    }
  }
}
