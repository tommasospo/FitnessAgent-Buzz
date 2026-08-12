import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Chiave dedicata per l'automazione Shortcuts -> qui. Mai la service_role sul telefono.
// Impostata con: supabase secrets set HEALTH_INGEST_API_KEY=... --project-ref ijtzitnkduovcsjahlkm
const API_KEY = Deno.env.get("HEALTH_INGEST_API_KEY")!;

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

function parseCsv(text: string): { header: string[]; rows: string[][] } {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.length > 0);
  const header = lines[0].split(",").map((h) => h.trim());
  const rows = lines.slice(1).map((l) => l.split(",").map((c) => c.trim()));
  return { header, rows };
}

function col(header: string[], row: string[], name: string): string | null {
  const idx = header.indexOf(name);
  if (idx === -1) return null;
  const v = row[idx];
  return v === undefined || v === "" ? null : v;
}

function colRichiesta(header: string[], row: string[], name: string): string {
  const v = col(header, row, name);
  if (v === null) throw new Response(`colonna richiesta mancante: "${name}" — controlla che sia il file giusto`, { status: 400 });
  return v;
}

function num(v: string | null): number | null {
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function kjToKcal(kj: number | null): number | null {
  return kj !== null ? Math.round((kj / 4.184) * 10) / 10 : null;
}

function toDate(dateTime: string): string {
  return dateTime.slice(0, 10);
}

function toIso(dateTime: string): string {
  const normalized = dateTime.length === 16 ? `${dateTime}:00` : dateTime;
  return normalized.replace(" ", "T");
}

function durataInMinuti(hms: string | null): number | null {
  if (!hms) return null;
  const [h, m, s] = hms.split(":").map(Number);
  if ([h, m, s].some((n) => Number.isNaN(n))) return null;
  return Math.round((h * 60 + m + s / 60) * 10) / 10;
}

async function gestisciNutrizione(header: string[], rows: string[][]) {
  const record = rows.map((row) => ({
    data: toDate(colRichiesta(header, row, "Date/Time")),
    kcal: kjToKcal(num(col(header, row, "Dietary Energy (kJ)"))),
    proteine_g: num(col(header, row, "Protein (g)")),
    carboidrati_g: num(col(header, row, "Carbohydrates (g)")),
    grassi_g: num(col(header, row, "Total Fat (g)")),
    fonte: "apple_health",
  }))
  const { error } = await supabase.from("diario_alimentare").upsert(record, { onConflict: "data" })
  if (error) throw error
  return record.length
}

async function gestisciAttivita(header: string[], rows: string[][]) {
  const record = rows.map((row) => ({
    data: toDate(colRichiesta(header, row, "Date/Time")),
    energia_attiva_kcal: kjToKcal(num(col(header, row, "Active Energy (kJ)"))),
    minuti_esercizio: num(col(header, row, "Apple Exercise Time (min)")),
    minuti_movimento: num(col(header, row, "Apple Move Time (min)")),
    battito_min: num(col(header, row, "Heart Rate [Min] (count/min)")),
    battito_max: num(col(header, row, "Heart Rate [Max] (count/min)")),
    battito_medio: num(col(header, row, "Heart Rate [Avg] (count/min)")),
    hrv_ms: num(col(header, row, "Heart Rate Variability (ms)")),
    battito_riposo: num(col(header, row, "Resting Heart Rate (count/min)")),
    passi: num(col(header, row, "Step Count (count)")),
    vo2_max: num(col(header, row, "VO2 Max (ml/(kg·min))")),
    distanza_km: num(col(header, row, "Walking + Running Distance (km)")),
    fonte: "apple_health",
  }))
  const { error } = await supabase.from("attivita_giornaliera").upsert(record, { onConflict: "data" })
  if (error) throw error

  for (const row of rows) {
    const peso = num(col(header, row, "Weight (kg)"))
    if (peso === null) continue
    const data = toDate(colRichiesta(header, row, "Date/Time"))
    const { data: esistente } = await supabase
      .from("metrica_corporea")
      .select("id")
      .eq("tipo", "peso")
      .gte("data", `${data}T00:00:00`)
      .lt("data", `${data}T23:59:59.999`)
      .maybeSingle()
    if (esistente) {
      await supabase.from("metrica_corporea").update({ valore: peso }).eq("id", esistente.id)
    } else {
      await supabase.from("metrica_corporea").insert({ tipo: "peso", valore: peso, data: `${data}T00:00:00`, fonte: "apple_health" })
    }
  }

  return record.length
}

async function gestisciAllenamento(header: string[], rows: string[][]) {
  const record = rows.map((row) => ({
    tipo: col(header, row, "Workout Type"),
    inizio: toIso(colRichiesta(header, row, "Start")),
    fine: toIso(colRichiesta(header, row, "End")),
    durata_minuti: durataInMinuti(col(header, row, "Duration")),
    energia_attiva_kcal: kjToKcal(num(col(header, row, "Active Energy (kJ)"))),
    battito_max: num(col(header, row, "Max. Heart Rate (count/min)")),
    battito_medio: num(col(header, row, "Avg. Heart Rate (count/min)")),
    distanza_km: num(col(header, row, "Distance (km)")),
    fonte: "apple_health",
  }))
  const { error } = await supabase.from("allenamento_rilevato").upsert(record, { onConflict: "tipo,inizio" })
  if (error) throw error
  return record.length
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 })
  }

  if (req.headers.get("x-api-key") !== API_KEY) {
    return new Response("Unauthorized", { status: 401 })
  }

  const url = new URL(req.url)
  const tipo = url.searchParams.get("tipo")

  const body = await req.text()
  const { header, rows } = parseCsv(body)

  if (rows.length === 0) {
    return new Response(JSON.stringify({ ok: true, righe: 0 }), { headers: { "Content-Type": "application/json" } })
  }

  try {
    let righe: number
    if (tipo === "nutrizione") righe = await gestisciNutrizione(header, rows)
    else if (tipo === "attivita") righe = await gestisciAttivita(header, rows)
    else if (tipo === "allenamento") righe = await gestisciAllenamento(header, rows)
    else return new Response("tipo sconosciuto: usa ?tipo=nutrizione|attivita|allenamento", { status: 400 })

    return new Response(JSON.stringify({ ok: true, righe }), { headers: { "Content-Type": "application/json" } })
  } catch (err) {
    if (err instanceof Response) return err
    return new Response(
      JSON.stringify({ ok: false, errore: String(err), colonne_ricevute: header, prima_riga: rows[0] }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    )
  }
})
