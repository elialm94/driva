import { NextResponse } from "next/server";
import {
  supabaseUrl,
  supabaseAnonKey,
  supabaseDbUrl,
  supabaseServiceRoleKey,
  hasSupabaseEnv,
} from "@/lib/storage/config";
import { getSqlClient } from "@/lib/storage/executor";

/**
 * Driftdiagnostik för produktion (Vercel). Kräver INGEN inloggning så att den
 * fungerar även när appen i övrigt 500:ar – men läcker aldrig hemligheter eller
 * kunddata: bara vilka miljövariabler som är satta (namn, inte värden) och om
 * databasen svarar och migrationerna körts.
 *
 *   GET /api/health
 *
 * Svarar 200 när Supabase-miljön är komplett och schemat är på plats, annars
 * 503 med en `hint` som pekar på nästa åtgärd (sätt env / kör `supabase db push`).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface DbProbe {
  canConnect: boolean;
  hasAppRole: boolean;
  hasCoreTables: boolean;
  error?: string;
}

async function probeDatabase(dbUrl: string): Promise<DbProbe> {
  const probe: DbProbe = { canConnect: false, hasAppRole: false, hasCoreTables: false };
  try {
    const client = await getSqlClient(dbUrl);
    await client.query("select 1");
    probe.canConnect = true;
    const roleRows = await client.query(
      "select 1 from pg_roles where rolname = 'driva_app' limit 1"
    );
    probe.hasAppRole = roleRows.length > 0;
    const tableRows = await client.query(
      "select to_regclass('public.businesses') is not null as present"
    );
    probe.hasCoreTables = Boolean(tableRows[0]?.present);
  } catch (err) {
    // Aldrig kasta – health-endpointen ska alltid svara med JSON.
    probe.error = err instanceof Error ? err.message : String(err);
  }
  return probe;
}

export async function GET() {
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: Boolean(supabaseUrl()),
    // Täcker både NEXT_PUBLIC_SUPABASE_ANON_KEY och _PUBLISHABLE_KEY.
    supabaseAnonOrPublishableKey: Boolean(supabaseAnonKey()),
    // Täcker SUPABASE_DB_URL / DATABASE_URL / POSTGRES_URL*.
    databaseUrl: Boolean(supabaseDbUrl()),
    SUPABASE_SERVICE_ROLE_KEY: Boolean(supabaseServiceRoleKey()),
  };

  const complete = hasSupabaseEnv();

  if (!complete) {
    const missing = [
      !env.NEXT_PUBLIC_SUPABASE_URL && "NEXT_PUBLIC_SUPABASE_URL",
      !env.supabaseAnonOrPublishableKey &&
        "NEXT_PUBLIC_SUPABASE_ANON_KEY (eller NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)",
      !env.databaseUrl && "SUPABASE_DB_URL (eller DATABASE_URL / POSTGRES_URL)",
    ].filter(Boolean);
    return NextResponse.json(
      {
        status: "misconfigured",
        storageMode: "unavailable",
        env,
        missing,
        hint: "Supabase-miljön är ofullständig. Sätt miljövariablerna ovan i Vercel → Settings → Environment Variables (Production) och deploya om.",
      },
      { status: 503 }
    );
  }

  const dbUrl = supabaseDbUrl();
  const db = dbUrl ? await probeDatabase(dbUrl) : { canConnect: false, hasAppRole: false, hasCoreTables: false };

  const schemaReady = db.canConnect && db.hasAppRole && db.hasCoreTables;
  let hint: string | undefined;
  if (!db.canConnect) {
    hint =
      "Databasen går inte att nå. Kontrollera att databas-URL:en är Supabases Transaction pooler (port 6543) – direktanslutningen (5432) är IPv6 och når inte fram från Vercel.";
  } else if (!db.hasAppRole || !db.hasCoreTables) {
    hint =
      "Databasen svarar men schemat saknas – kör migrationerna mot projektet: `npx supabase link --project-ref <ref>` följt av `npx supabase db push`.";
  }

  return NextResponse.json(
    {
      status: schemaReady ? "ok" : "degraded",
      storageMode: "supabase",
      env,
      database: db,
      ...(hint ? { hint } : {}),
    },
    { status: schemaReady ? 200 : 503 }
  );
}
