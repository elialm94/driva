/**
 * npm run platform:bootstrap – utse den FÖRSTA super-admin för Driva Admin.
 *
 * Körs manuellt av en driftansvarig, aldrig automatiskt. Kopplar en BEFINTLIG
 * Supabase-auth-användare (exakt user id) till plattformsrollen super_admin.
 * Ingen klient-sida, ingen publik flagga – bara detta skript eller SQL.
 *
 *   SUPABASE_DB_URL / DATABASE_URL      krävs (Postgres-anslutning)
 *   NEXT_PUBLIC_SUPABASE_URL            krävs
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY       krävs
 *   SUPABASE_SERVICE_ROLE_KEY           krävs (verifierar auth-användaren)
 *
 *   --user-id <uuid>     Supabase auth user id som ska bli super_admin
 *   --email <adress>     alternativ: slå upp user id via e-post (admin-API)
 *
 * Utan flaggor läses PLATFORM_SUPER_ADMIN_USER_ID från miljön.
 * Skriptet är idempotent: en redan aktiv super_admin lämnas orörd, en
 * inaktiverad rad återaktiveras, en admin-rad uppgraderas till super_admin.
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
    console.error("SUPABASE_SERVICE_ROLE_KEY krävs för att verifiera auth-användaren.");
    process.exit(1);
  }

  const args = parseArgs(process.argv.slice(2));
  const admin = createClient(supabaseEnv().url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  /* 1. Bestäm auth user id: flagga > env-variabel > e-postuppslag. */
  let userId = args.userId ?? process.env.PLATFORM_SUPER_ADMIN_USER_ID ?? null;
  if (!userId && args.email) {
    userId = await findUserByEmail(admin, args.email);
    if (!userId) {
      console.error(`Hittade ingen auth-användare med e-post ${args.email}.`);
      process.exit(1);
    }
  }
  if (!userId) {
    console.error(
      "Ange vem som ska bli super_admin: --user-id <uuid>, --email <adress> eller env PLATFORM_SUPER_ADMIN_USER_ID."
    );
    process.exit(1);
  }

  /* 2. Verifiera att användaren finns i Supabase Auth. */
  const found = await admin.auth.admin.getUserById(userId);
  if (found.error || !found.data.user) {
    console.error(`Auth-användaren ${userId} finns inte: ${found.error?.message ?? "okänd"}.`);
    process.exit(1);
  }
  const user = found.data.user;
  const email = user.email ?? "";
  const name =
    (typeof user.user_metadata?.full_name === "string" && user.user_metadata.full_name) ||
    (typeof user.user_metadata?.name === "string" && user.user_metadata.name) ||
    null;

  /* 3. Upsert platform_admins-raden (idempotent). */
  const { platformAdminByUserId, insertPlatformAdmin, updatePlatformAdminRow } = await import(
    "../src/lib/platform/store"
  );
  const { writeAdminAudit } = await import("../src/lib/platform/audit");

  const existing = await platformAdminByUserId(userId);
  if (existing && existing.role === "super_admin" && !existing.disabledAt) {
    console.log(`${email || userId} är redan aktiv super_admin – inget att göra.`);
    return;
  }
  if (existing) {
    await updatePlatformAdminRow(existing.id, { role: "super_admin", disabledAt: null, disabledBy: null });
    console.log(`Uppdaterade ${email || userId} till aktiv super_admin (var ${existing.role}${existing.disabledAt ? ", inaktiverad" : ""}).`);
  } else {
    await insertPlatformAdmin({
      id: crypto.randomUUID(),
      userId,
      role: "super_admin",
      email,
      name,
      createdAt: new Date().toISOString(),
      createdBy: null,
      disabledAt: null,
      disabledBy: null,
    });
    console.log(`Skapade super_admin för ${email || userId}.`);
  }

  await writeAdminAudit(
    { userId, email, role: "super_admin" },
    {
      action: "admin_bootstrap",
      targetType: "platform_admin",
      targetId: userId,
      metadata: { via: "scripts/platform-bootstrap.ts" },
    }
  );
  console.log("Klart. Logga in med användarens vanliga Supabase-inloggning och öppna /admin.");
}

function parseArgs(argv: string[]): { userId?: string; email?: string } {
  const out: { userId?: string; email?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--user-id") out.userId = argv[++i];
    else if (argv[i] === "--email") out.email = argv[++i];
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
      /* äldre Node utan loadEnvFile – hoppa över */
    }
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
