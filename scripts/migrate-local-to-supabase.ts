/**
 * npm run migrate:local-to-supabase – flytta den lokala JSON-databasen
 * (.data/db.json) till ett nytt företag i en riktig Supabase-databas.
 *
 *   --user-email <adress>   KRÄVS: ägarens inloggning (skapas om den saknas)
 *   --file <sökväg>         källa (standard: .data/db.json)
 *   --yes                   utför skrivningen (annars bara en förhandsvisning)
 *
 * Egenskaper:
 *   * Entitets-id:n bevaras exakt (offertlänkar/fakturalänkar överlever).
 *   * Samma commit-väg som appen: verifikationer/fakturor/betalningar går via
 *     databasens atomära RPC:er i nummerordning – obalans stoppar ALLT.
 *   * Validerar antal per samling + byte-exakta offertversioner/snapshots.
 *   * Körs aldrig automatiskt och vägrar mot företag som redan har data.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

loadEnvFiles();

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.userEmail) {
    console.error("Ange ägarens inloggning: --user-email agare@example.com");
    process.exit(1);
  }

  const { hasSupabaseEnv, supabaseEnv, supabaseServiceRoleKey, missingEnvMessage } = await import(
    "../src/lib/storage/config"
  );
  if (!hasSupabaseEnv()) {
    console.error(missingEnvMessage());
    process.exit(1);
  }

  /* 1. Läs och normalisera källan (samma normalisering som appen använder). */
  const file = args.file ?? path.join(process.cwd(), ".data", "db.json");
  if (!fs.existsSync(file)) {
    console.error(`Hittar inte källfilen: ${file}`);
    process.exit(1);
  }
  const { normalize } = await import("../src/lib/store");
  const state = normalize(JSON.parse(fs.readFileSync(file, "utf8")));

  console.log(`Källa: ${file}`);
  console.log(`Företag: ${state.settings.name} (${state.settings.orgNumber})`);
  console.log(
    `Innehåll: ${state.customers.length} kunder, ${state.quotes.length} offerter, ` +
      `${state.invoices.length} fakturor, ${state.verifications.length} verifikationer.`
  );

  if (!args.yes) {
    console.log("\nFörhandsvisning – ingen skrivning gjord. Kör igen med --yes för att migrera.");
    return;
  }

  /* 2. Ägaren i Supabase Auth (skapas med slumplösenord om den saknas). */
  const serviceRoleKey = supabaseServiceRoleKey();
  if (!serviceRoleKey) {
    console.error("SUPABASE_SERVICE_ROLE_KEY krävs för att slå upp/skapa användaren.");
    process.exit(1);
  }
  const admin = createClient(supabaseEnv().url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let userId: string | null = null;
  let printedPassword: string | null = null;
  const password = crypto.randomBytes(9).toString("base64url");
  const created = await admin.auth.admin.createUser({
    email: args.userEmail,
    password,
    email_confirm: true,
  });
  if (created.data.user) {
    userId = created.data.user.id;
    printedPassword = password;
  } else if (created.error?.code === "email_exists") {
    userId = await findUserByEmail(admin, args.userEmail);
  }
  if (!userId) {
    console.error(`Kunde inte skapa/hitta användaren: ${created.error?.message ?? "okänt fel"}`);
    process.exit(1);
  }

  /* 3. Nytt företag + import via appens commit-väg. */
  const { createBusinessWithOwner, sqlClient } = await import("../src/lib/storage/adapter-supabase");
  const { importStateIntoBusiness, validateImport, ImportPreconditionError } = await import(
    "../src/lib/storage/import-state"
  );

  const businessId = await createBusinessWithOwner({
    userId,
    name: state.settings.name,
    orgNumber: state.settings.orgNumber,
    email: state.settings.email,
    phone: state.settings.phone,
  });
  console.log(`\nSkapade företaget ${businessId}. Importerar …`);

  try {
    await importStateIntoBusiness(businessId, userId, state);
  } catch (e) {
    if (e instanceof ImportPreconditionError) {
      console.error(`Avbryter: ${e.message}`);
      process.exit(1);
    }
    throw e;
  }

  /* 4. Validering. */
  const report = await validateImport(businessId, state);
  console.log("");
  for (const row of report.rows) {
    console.log(`  ${row.ok ? "✓" : "✗"} ${row.label}: ${row.actual}/${row.expected}`);
  }
  if (!report.ok) {
    console.error("\nValideringen misslyckades – databasen innehåller migreringen, granska raderna ovan.");
    process.exit(1);
  }

  console.log("\nMigreringen är klar och validerad.");
  console.log(`  Ägare:   ${args.userEmail}`);
  if (printedPassword) console.log(`  Lösenord (nyskapad användare): ${printedPassword}`);
  console.log(`  Företag: ${businessId}`);

  const client = await sqlClient();
  await client.close();
}

function parseArgs(argv: string[]): { userEmail?: string; file?: string; yes: boolean } {
  const out: { userEmail?: string; file?: string; yes: boolean } = { yes: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--user-email") out.userEmail = argv[++i];
    else if (argv[i] === "--file") out.file = argv[++i];
    else if (argv[i] === "--yes") out.yes = true;
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
