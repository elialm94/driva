/**
 * npm run db:seed – skapa dev-/testanvändare + företag + demodata i en RIKTIG
 * Supabase-databas (kör migrationerna först: npx supabase db push).
 *
 *   SUPABASE_DB_URL / DATABASE_URL      krävs (Postgres-anslutning)
 *   NEXT_PUBLIC_SUPABASE_URL            krävs
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY       krävs
 *   SUPABASE_SERVICE_ROLE_KEY           krävs (skapar auth-användaren)
 *
 *   --email <adress>     inloggningsmejl (standard: agare@driva.test)
 *   --password <lösen>   lösenord (standard: slumpas och skrivs ut)
 *   --empty              skapa bara användare + tomt företag, ingen demodata
 *
 * Körs ALDRIG automatiskt – endast manuellt av en utvecklare. Vägrar köra
 * om företaget redan innehåller data.
 */
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

loadEnvFiles();

async function main() {
  // Import EFTER env-laddningen – storage/config läser process.env vid anrop.
  const { hasSupabaseEnv, supabaseEnv, supabaseServiceRoleKey, missingEnvMessage } = await import(
    "../src/lib/storage/config"
  );
  if (!hasSupabaseEnv()) {
    console.error(missingEnvMessage());
    process.exit(1);
  }
  const serviceRoleKey = supabaseServiceRoleKey();
  if (!serviceRoleKey) {
    console.error("SUPABASE_SERVICE_ROLE_KEY krävs för att skapa auth-användaren.");
    process.exit(1);
  }

  const args = parseArgs(process.argv.slice(2));
  const email = args.email ?? "agare@driva.test";
  const password = args.password ?? crypto.randomBytes(9).toString("base64url");

  const { createBusinessWithOwner, membershipsForUser, sqlClient } = await import(
    "../src/lib/storage/adapter-supabase"
  );
  const { importStateIntoBusiness, validateImport, ImportPreconditionError } = await import(
    "../src/lib/storage/import-state"
  );
  const { buildSeed } = await import("../src/lib/seed");

  /* 1. Auth-användare (service role, aldrig i klientkod). */
  const admin = createClient(supabaseEnv().url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let userId: string;
  let createdUser = false;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.data.user) {
    userId = created.data.user.id;
    createdUser = true;
  } else if (created.error?.code === "email_exists") {
    const found = await findUserByEmail(admin, email);
    if (!found) {
      console.error(`Användaren ${email} finns men kunde inte slås upp via admin-API:t.`);
      process.exit(1);
    }
    userId = found;
    console.log(`Användaren ${email} finns redan – återanvänder (lösenordet ändras inte).`);
  } else {
    console.error(`Kunde inte skapa användaren: ${created.error?.message}`);
    process.exit(1);
  }

  /* 2. Företag + ägarmedlemskap. */
  const seed = buildSeed();
  const memberships = await membershipsForUser(userId);
  let businessId: string;
  if (memberships.length > 0) {
    businessId = memberships[0].businessId;
    console.log(`Användaren har redan företaget ${businessId} – försöker importera dit.`);
  } else {
    businessId = await createBusinessWithOwner({
      userId,
      name: seed.settings.name,
      orgNumber: seed.settings.orgNumber,
      email: seed.settings.email,
      phone: seed.settings.phone,
    });
    console.log(`Skapade företaget ${businessId} (${seed.settings.name}).`);
  }

  /* 3. Demodata via samma commit-väg som appen (RPC:er, immutabilitet, RLS). */
  if (!args.empty) {
    try {
      await importStateIntoBusiness(businessId, userId, seed);
    } catch (e) {
      if (e instanceof ImportPreconditionError) {
        console.error(`Avbryter: ${e.message}`);
        process.exit(1);
      }
      throw e;
    }
    const report = await validateImport(businessId, seed);
    for (const row of report.rows) {
      const mark = row.ok ? "✓" : "✗";
      console.log(`  ${mark} ${row.label}: ${row.actual}/${row.expected}`);
    }
    if (!report.ok) {
      console.error("Valideringen misslyckades – se raderna ovan.");
      process.exit(1);
    }
  }

  console.log("\nKlart.");
  console.log(`  E-post:   ${email}`);
  if (createdUser) console.log(`  Lösenord: ${password}`);
  console.log(`  Företag:  ${businessId}`);

  const client = await sqlClient();
  await client.close();
}

function parseArgs(argv: string[]): { email?: string; password?: string; empty: boolean } {
  const out: { email?: string; password?: string; empty: boolean } = { empty: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--email") out.email = argv[++i];
    else if (argv[i] === "--password") out.password = argv[++i];
    else if (argv[i] === "--empty") out.empty = true;
  }
  return out;
}

async function findUserByEmail(
  admin: ReturnType<typeof createClient>,
  email: string
): Promise<string | null> {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return null;
    const hit = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (hit) return hit.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

/** Ladda .env.local/.env som Next gör – utan att skriva över satta variabler. */
function loadEnvFiles(): void {
  for (const file of [".env.local", ".env"]) {
    const p = path.join(process.cwd(), file);
    if (!fs.existsSync(p)) continue;
    try {
      process.loadEnvFile(p);
    } catch {
      /* äldre Node utan loadEnvFile – hoppa över */
    }
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
