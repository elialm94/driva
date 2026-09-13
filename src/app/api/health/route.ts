import { NextResponse } from "next/server";
import {
  supabaseUrl,
  supabaseAnonKey,
  supabaseDbUrl,
  supabaseServiceRoleKey,
  hasSupabaseEnv,
} from "@/lib/storage/config";
import { getSqlClient } from "@/lib/storage/executor";
import { EXPECTED_MIGRATION_VERSION } from "@/lib/storage/schema-version";
import { isStripeConfigured, stripeModeHint } from "@/lib/billing/config";
import { isSentryConfigured, appRelease } from "@/lib/observability/config";
import { platformMfaRequired } from "@/lib/platform/auth";

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
 * Endpointen är strikt läsande – schemaändringar körs aldrig från en oautentiserad
 * route.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Larmbara driftkontroller utan hemligheter eller kunddata: version,
 * migrationsläge, senaste cronkörning, webhookfel och om en restore drill
 * någonsin dokumenterats. Varningar fäller inte hälsan (annars larmflimmer)
 * men listas så att en extern monitor kan larma på dem.
 */
interface OpsChecks {
  release: string;
  migrations: { expected: string; applied?: string; behind: boolean };
  cron: { lastRunAt?: string; ageHours?: number; lastStatus?: string };
  stripe: { configured: boolean; mode: "test" | "live" | null; webhookFailures7d?: number };
  sentry: { configured: boolean };
  adminMfaRequired: boolean;
  backup: { drillVerified: boolean; lastDrillOn?: string };
  warnings: string[];
}

async function probeOps(dbUrl: string): Promise<OpsChecks> {
  const checks: OpsChecks = {
    release: appRelease(),
    migrations: { expected: EXPECTED_MIGRATION_VERSION, behind: false },
    cron: {},
    stripe: { configured: isStripeConfigured(), mode: stripeModeHint() },
    sentry: { configured: isSentryConfigured() },
    adminMfaRequired: platformMfaRequired(),
    backup: { drillVerified: false },
    warnings: [],
  };
  try {
    const client = await getSqlClient(dbUrl);
    const mig = await client.query(
      `select version from supabase_migrations.schema_migrations order by version desc limit 1`
    ).catch(() => []);
    const applied = mig[0]?.version ? String(mig[0].version) : undefined;
    checks.migrations.applied = applied;
    checks.migrations.behind = Boolean(applied) && applied! < EXPECTED_MIGRATION_VERSION;
    if (checks.migrations.behind) checks.warnings.push("migrations_behind");

    const opsPresent = await client.query(`select to_regclass('public.platform_ops_records') is not null as present`);
    if (opsPresent[0]?.present) {
      const cron = await client.query(
        `select created_at, status from public.platform_ops_records where kind = 'cron_run' order by created_at desc limit 1`
      );
      if (cron[0]) {
        const at = new Date(cron[0].created_at as string);
        checks.cron = {
          lastRunAt: at.toISOString(),
          ageHours: Math.round(((Date.now() - at.getTime()) / 3_600_000) * 10) / 10,
          lastStatus: String(cron[0].status),
        };
        if ((checks.cron.ageHours ?? 0) > 36) checks.warnings.push("cron_stale");
        if (checks.cron.lastStatus === "fel") checks.warnings.push("cron_failed");
      } else {
        checks.warnings.push("cron_never_ran");
      }
      const drill = await client.query(
        `select summary->>'performedOn' as performed_on, status from public.platform_ops_records
          where kind = 'restore_drill' order by created_at desc limit 1`
      );
      if (drill[0] && String(drill[0].status) === "ok") {
        checks.backup = { drillVerified: true, lastDrillOn: String(drill[0].performed_on ?? "") };
      } else {
        checks.warnings.push("restore_drill_unverified");
      }
    }
    const whPresent = await client.query(`select to_regclass('public.stripe_webhook_events') is not null as present`);
    if (whPresent[0]?.present) {
      const wh = await client.query(
        `select count(*)::int as n from public.stripe_webhook_events where status = 'fel' and received_at >= now() - interval '7 days'`
      );
      checks.stripe.webhookFailures7d = Number(wh[0]?.n ?? 0);
      if (checks.stripe.webhookFailures7d > 0) checks.warnings.push("stripe_webhook_failures");
    }
  } catch {
    checks.warnings.push("ops_probe_failed");
  }
  if (!checks.sentry.configured) checks.warnings.push("sentry_unconfigured");
  if (!checks.adminMfaRequired) checks.warnings.push("admin_mfa_not_required");
  return checks;
}

interface DbProbe {
  canConnect: boolean;
  hasAppRole: boolean;
  hasCoreTables: boolean;
  /** Tabeller som inloggade sidor läser – saknade = migrationer inte körda. */
  pageLoadTables?: Record<string, boolean>;
  hasDisabledAt?: boolean;
  hasWebsiteDesign?: boolean;
  hasWebsiteFooter?: boolean;
  error?: string;
}

const PAGE_LOAD_TABLES = [
  "businesses",
  "business_memberships",
  "business_settings",
  "customers",
  "quotes",
  "quote_versions",
  "invoices",
  "jobs",
  "work_locations",
  "job_work_entries",
  "reminders",
  "attention_states",
  "inbox_items",
  "supplier_payments",
  "payment_files",
  "support_tickets",
] as const;

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
    const pageLoadTables: Record<string, boolean> = {};
    for (const name of PAGE_LOAD_TABLES) {
      const rows = await client.query(`select to_regclass($1) is not null as present`, [`public.${name}`]);
      pageLoadTables[name] = Boolean(rows[0]?.present);
    }
    probe.pageLoadTables = pageLoadTables;
    const colRows = await client.query(
      `select exists (
         select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'businesses' and column_name = 'disabled_at'
       ) as present`
    );
    probe.hasDisabledAt = Boolean(colRows[0]?.present);
    const designRows = await client.query(
      `select exists (
         select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'websites' and column_name = 'draft_design'
       ) as present`
    );
    probe.hasWebsiteDesign = Boolean(designRows[0]?.present);
    const footerRows = await client.query(
      `select exists (
         select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'websites' and column_name = 'footer'
       ) as present`
    );
    probe.hasWebsiteFooter = Boolean(footerRows[0]?.present);
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
    RESEND_API_KEY: Boolean(process.env.RESEND_API_KEY?.trim()),
    RESEND_FROM_EMAIL: Boolean(
      process.env.RESEND_FROM_EMAIL?.trim() || process.env.MAIL_FROM?.trim() || process.env.RESEND_FROM?.trim()
    ),
    SEND_EMAIL_HOOK_SECRET: Boolean(process.env.SEND_EMAIL_HOOK_SECRET?.trim()),
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
  const ops = schemaReady && dbUrl ? await probeOps(dbUrl) : undefined;
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
      ...(ops ? { ops } : {}),
      ...(hint ? { hint } : {}),
    },
    { status: schemaReady ? 200 : 503 }
  );
}
