process.env.DRIVA_TEST = "1";

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * Migrationsvakten i scripts/vercel-build.sh körs på riktigt här, med en
 * stubbad `npx` i PATH så att inget nätverk eller `next build` startas.
 *
 * Poängen: i produktion utan SUPABASE_MIGRATION_DB_URL ska bygget FALLA.
 * Tidigare varnade det och byggde vidare, vilket lämnade exakt samma
 * felläge öppet som fällde ferva.se (migration 53, terms_acceptances).
 */

const root = process.cwd();
const script = path.join(root, "scripts", "vercel-build.sh");
const source = readFileSync(script, "utf8");

interface Run {
  status: number;
  output: string;
}

/**
 * Kör skriptet med stubbad npx + npm i PATH. `npm run build` och
 * `npx supabase db push` blir alltså ekon, inte riktiga kommandon.
 */
function runBuild(env: Record<string, string>): Run {
  const stubs = path.join(root, "src", "lib", "storage", "__fixtures__", "build-stubs");
  try {
    const output = execFileSync("bash", [script], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        NODE_ENV: process.env.NODE_ENV,
        PATH: `${stubs}:${process.env.PATH ?? ""}`,
        HOME: process.env.HOME ?? "",
        ...env,
      },
    });
    return { status: 0, output };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? 1, output: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

test("produktion utan SUPABASE_MIGRATION_DB_URL avbryter bygget", () => {
  const run = runBuild({ VERCEL_ENV: "production" });
  assert.notEqual(run.status, 0, "bygget måste falla, inte varna");
  assert.match(run.output, /FEL: SUPABASE_MIGRATION_DB_URL är inte satt/);
  assert.match(run.output, /Settings → Environment Variables/);
  assert.match(run.output, /db\.<ref>\.supabase\.co:5432, inte poolaren/);
  assert.doesNotMatch(run.output, /\[build\] next build/, "next build får inte hinna starta");
});

test("tom sträng räknas som osatt", () => {
  const run = runBuild({ VERCEL_ENV: "production", SUPABASE_MIGRATION_DB_URL: "" });
  assert.notEqual(run.status, 0);
  assert.match(run.output, /FEL: SUPABASE_MIGRATION_DB_URL är inte satt/);
});

test("produktion med db-url migrerar och bygger vidare", () => {
  const run = runBuild({
    VERCEL_ENV: "production",
    SUPABASE_MIGRATION_DB_URL: "postgres://stub:stub@db.exempel.supabase.co:5432/postgres",
  });
  assert.equal(run.status, 0, run.output);
  assert.match(run.output, /\[stub npx\].* supabase db push/);
  assert.match(run.output, /Migrations up to date/);
  assert.match(run.output, /\[stub npm\] run build/);
});

test("preview och lokalt hoppar över migrationerna utan att falla", () => {
  const envs: Record<string, string>[] = [{ VERCEL_ENV: "preview" }, { VERCEL_ENV: "development" }, {}];
  for (const env of envs) {
    const run = runBuild(env);
    assert.equal(run.status, 0, run.output);
    assert.match(run.output, /skipping \(production only\)/);
    assert.match(run.output, /\[stub npm\] run build/);
    assert.doesNotMatch(run.output, /FEL:/);
  }
});

test("ingen escape-hatch som låter bygget fortsätta utan migrationer", () => {
  // En variabel av typen SKIP_MIGRATIONS skulle återskapa exakt det felläge
  // vakten finns för. Den ska inte gå att införa obemärkt.
  assert.doesNotMatch(source, /SKIP_MIGRATION/i);
  assert.doesNotMatch(source, /ALLOW_MISSING_MIGRATION/i);
  assert.doesNotMatch(source, /FORCE_BUILD/i);
  // Varningen som byggde vidare får inte komma tillbaka.
  assert.doesNotMatch(source, /WARNING: SUPABASE_MIGRATION_DB_URL/);
});
