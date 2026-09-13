import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const script = fs.readFileSync(path.join(root, "scripts", "vercel-build.sh"), "utf8");
const vercelConfig = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8")) as {
  buildCommand?: string;
};

test("vercel.json bygger via vercel-build.sh, inte next build direkt", () => {
  assert.equal(vercelConfig.buildCommand, "bash scripts/vercel-build.sh");
});

test("migrationerna appliceras innan bygget", () => {
  const push = script.indexOf("db push");
  const build = script.indexOf("npm run build");
  assert.ok(push > 0, "skriptet ska köra supabase db push");
  assert.ok(build > 0, "skriptet ska bygga appen");
  assert.ok(push < build, "db push måste ligga före bygget");
});

test("ett misslyckat db push avbryter bygget", () => {
  // set -e gör att push-felet stoppar skriptet innan next build hinner köra,
  // så en deploy som inte kan migrera aldrig når trafik.
  assert.match(script, /set -euo pipefail/);
});

test("push sker bara i produktion och bara med explicit db-url", () => {
  assert.match(script, /VERCEL_ENV/);
  assert.match(script, /SUPABASE_MIGRATION_DB_URL/);
});

test("db push tar med migrationer som hamnat ur ordning", () => {
  // Två grenar som mergas samma dag kan ge en migration med äldre tidsstämpel
  // än den senast applicerade. Utan --include-all hoppas den tyst över.
  assert.match(script, /--include-all/);
  // --yes: en prompt skulle hänga bygget.
  assert.match(script, /--yes/);
});

test("inga hemligheter hårdkodade i deploy-skriptet", () => {
  assert.doesNotMatch(script, /postgres(ql)?:\/\/[^"'\s$]*:[^"'\s$]+@/);
  assert.doesNotMatch(script, /rgtbcsclibiokwgfqunm/);
});
