/**
 * npm run restore:drill -- --target staging --staging-ref <projektref>
 *
 * Icke-destruktiv verifiering av en ÅTERLÄST databas (Supabase PITR/backup →
 * staging-projekt). Körs mot kopian, aldrig mot produktion:
 *
 *   * vägrar om --target inte är exakt "staging";
 *   * kräver explicit staging-identitet (--staging-ref eller
 *     RESTORE_DRILL_STAGING_REF) som måste ingå i databas-URL:ens värdnamn;
 *   * vägrar om värdnamnet matchar produktionsprojektet
 *     (PRODUCTION_SUPABASE_PROJECT_REF eller värden i NEXT_PUBLIC_SUPABASE_URL /
 *     SUPABASE_DB_URL i din .env);
 *   * kör allt i en READ ONLY-transaktion – inga skrivningar är möjliga.
 *
 *   RESTORE_DRILL_DB_URL   Postgres-URL till den återlästa staging-databasen
 *
 * Kontroller: kärnschema + senaste migration, immutabilitetstriggrar,
 * tenantantal, ledger-checksumma (verifikationer + konteringar) och att
 * debet = kredit per företag. Skriver en JSON-rad efter "RESULT" som klistras
 * in i Ferva Admin → System → "Registrera genomförd restore drill".
 * Samma checksumma kan beräknas i produktionens SQL-editor (read-only) med
 * SQL:en i docs/runbooks/backup-restore.md för jämförelse.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

loadEnvFiles();

const REQUIRED_TABLES = [
  "businesses",
  "business_memberships",
  "business_settings",
  "customers",
  "invoices",
  "verifications",
  "accounting_entries",
  "audit_log",
  "platform_admins",
  "admin_audit_log",
];

const REQUIRED_TRIGGERS = [
  "verifications_immutable",
  "accounting_entries_immutable",
  "audit_log_immutable",
  "admin_audit_log_immutable",
  "invoice_issued_snapshots_immutable",
  "platform_admins_guard",
  "businesses_subscription_frozen",
];

interface DrillResult {
  target: "staging";
  stagingRef: string;
  host: string;
  ranAt: string;
  schemaOk: boolean;
  missingTables: string[];
  latestMigration: string | null;
  expectedMigration: string;
  migrationOk: boolean;
  immutabilityOk: boolean;
  missingTriggers: string[];
  tenantCount: number;
  membershipCount: number;
  verificationCount: number;
  entryCount: number;
  checksum: string;
  balancesOk: boolean;
  unbalancedBusinesses: number;
  durationMs: number;
  ok: boolean;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.target !== "staging") {
    fail("Vägrar: --target måste vara exakt 'staging'. Scriptet körs aldrig mot produktion.");
  }
  const stagingRef = (args.stagingRef ?? process.env.RESTORE_DRILL_STAGING_REF ?? "").trim();
  if (stagingRef.length < 6) {
    fail("Ange staging-identiteten explicit: --staging-ref <projektref> (eller RESTORE_DRILL_STAGING_REF).");
  }
  const dbUrl = process.env.RESTORE_DRILL_DB_URL?.trim();
  if (!dbUrl) fail("RESTORE_DRILL_DB_URL saknas (Postgres-URL till den återlästa staging-databasen).");

  const host = hostOf(dbUrl!);
  if (!host.includes(stagingRef)) {
    fail(`Vägrar: värdnamnet (${host}) innehåller inte staging-identiteten '${stagingRef}'.`);
  }
  for (const prodHost of productionHosts()) {
    if (prodHost && (host === prodHost || host.includes(prodHost) || prodHost.includes(host))) {
      fail(`Vägrar: värdnamnet (${host}) matchar produktionsprojektet (${prodHost}).`);
    }
  }
  if (/prod/i.test(host) || /prod/i.test(stagingRef)) {
    fail("Vägrar: värdnamn eller staging-identitet innehåller 'prod'.");
  }

  const { EXPECTED_MIGRATION_VERSION } = await import("../src/lib/storage/schema-version");
  const { getSqlClient } = await import("../src/lib/storage/executor");
  const started = Date.now();
  const client = await getSqlClient(dbUrl!);

  await client.query("begin isolation level repeatable read read only");
  try {
    const missingTables: string[] = [];
    for (const t of REQUIRED_TABLES) {
      const rows = await client.query(`select to_regclass($1) is not null as present`, [`public.${t}`]);
      if (!rows[0]?.present) missingTables.push(t);
    }
    const migRows = await client
      .query(`select version from supabase_migrations.schema_migrations order by version desc limit 1`)
      .catch(() => []);
    const latestMigration = migRows[0]?.version ? String(migRows[0].version) : null;

    const trigRows = await client.query(
      `select tgname from pg_trigger where not tgisinternal and tgenabled <> 'D'`
    );
    const present = new Set(trigRows.map((r) => String(r.tgname)));
    const missingTriggers = REQUIRED_TRIGGERS.filter((t) => !present.has(t));

    const counts = missingTables.length
      ? null
      : (
          await client.query(`
            select
              (select count(*)::int from public.businesses) as tenants,
              (select count(*)::int from public.business_memberships) as memberships,
              (select count(*)::int from public.verifications) as verifications,
              (select count(*)::int from public.accounting_entries) as entries`)
        )[0];

    let checksum = "";
    let unbalanced = 0;
    if (counts) {
      // Ordnad, deterministisk sammanfattning – samma SQL i runbooken för produktion.
      const sums = await client.query(`
        select business_id::text as business_id,
               count(*)::int as n,
               sum(debit)::text as debit,
               sum(credit)::text as credit,
               md5(string_agg(verification_id || ':' || position || ':' || account || ':' || debit || ':' || credit, ',' order by verification_id, position)) as digest
          from public.accounting_entries
         group by business_id
         order by business_id`);
      const h = createHash("sha256");
      for (const r of sums) {
        h.update(`${r.business_id}|${r.n}|${r.debit}|${r.credit}|${r.digest}\n`);
        if (String(r.debit) !== String(r.credit)) unbalanced++;
      }
      checksum = h.digest("hex").slice(0, 32);
    }

    const result: DrillResult = {
      target: "staging",
      stagingRef,
      host,
      ranAt: new Date().toISOString(),
      schemaOk: missingTables.length === 0,
      missingTables,
      latestMigration,
      expectedMigration: EXPECTED_MIGRATION_VERSION,
      migrationOk: latestMigration === EXPECTED_MIGRATION_VERSION,
      immutabilityOk: missingTriggers.length === 0,
      missingTriggers,
      tenantCount: Number(counts?.tenants ?? 0),
      membershipCount: Number(counts?.memberships ?? 0),
      verificationCount: Number(counts?.verifications ?? 0),
      entryCount: Number(counts?.entries ?? 0),
      checksum,
      balancesOk: unbalanced === 0,
      unbalancedBusinesses: unbalanced,
      durationMs: Date.now() - started,
      ok: false,
    };
    result.ok = result.schemaOk && result.migrationOk && result.immutabilityOk && result.balancesOk;

    console.log(`Restore drill mot ${host} (staging '${stagingRef}')`);
    console.log(`  schema:        ${result.schemaOk ? "OK" : `SAKNAS: ${missingTables.join(", ")}`}`);
    console.log(`  migration:     ${result.migrationOk ? "OK" : `${latestMigration ?? "okänd"} ≠ ${EXPECTED_MIGRATION_VERSION}`}`);
    console.log(`  immutabilitet: ${result.immutabilityOk ? "OK" : `SAKNAS: ${missingTriggers.join(", ")}`}`);
    console.log(`  tenants:       ${result.tenantCount} företag, ${result.membershipCount} medlemskap`);
    console.log(`  ledger:        ${result.verificationCount} verifikationer, ${result.entryCount} konteringar, checksumma ${checksum || "–"}`);
    console.log(`  balanser:      ${result.balancesOk ? "debet = kredit för alla företag" : `${unbalanced} företag obalanserade`}`);
    console.log(`  resultat:      ${result.ok ? "GODKÄND" : "UNDERKÄND"} (${result.durationMs} ms)`);
    console.log("RESULT");
    console.log(JSON.stringify(result));
    process.exitCode = result.ok ? 0 : 2;
  } finally {
    await client.query("rollback").catch(() => undefined);
  }
}

function productionHosts(): string[] {
  const hosts: string[] = [];
  const ref = process.env.PRODUCTION_SUPABASE_PROJECT_REF?.trim();
  if (ref) hosts.push(ref);
  for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_DB_URL", "DATABASE_URL", "POSTGRES_URL"]) {
    const v = process.env[key]?.trim();
    if (v) {
      try {
        hosts.push(hostOf(v));
      } catch {
        /* ignorera */
      }
    }
  }
  return hosts.filter(Boolean);
}

function hostOf(url: string): string {
  return new URL(url.replace(/^postgres(ql)?:\/\//, "http://")).hostname.toLowerCase();
}

function parseArgs(argv: string[]): { target?: string; stagingRef?: string } {
  const out: { target?: string; stagingRef?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--target") out.target = argv[++i];
    else if (argv[i] === "--staging-ref") out.stagingRef = argv[++i];
  }
  return out;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function loadEnvFiles(): void {
  for (const file of [".env.local", ".env"]) {
    const p = path.join(process.cwd(), file);
    if (!fs.existsSync(p)) continue;
    try {
      process.loadEnvFile(p);
    } catch {
      /* äldre Node utan loadEnvFile */
    }
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
