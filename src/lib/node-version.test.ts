process.env.DRIVA_TEST = "1";

import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * CI, Vercel och den lokala maskinen ska köra samma Node-major. Utan pinning
 * väljer Vercel sin egen standard, och då kan ett bygge vara grönt i CI och
 * trasigt i produktion utan att något i repot ändrats.
 *
 * Tre källor måste peka på 22: package.json → engines.node, .nvmrc och
 * .github/workflows/ci.yml → node-version.
 */

const root = process.cwd();
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
  engines?: { node?: string };
};
const nvmrc = readFileSync(path.join(root, ".nvmrc"), "utf8").trim();
const ci = readFileSync(path.join(root, ".github", "workflows", "ci.yml"), "utf8");

test("package.json låser Node-majoren till 22", () => {
  assert.equal(pkg.engines?.node, ">=22.0.0 <23.0.0");
});

test(".nvmrc anger 22", () => {
  assert.equal(nvmrc, "22");
});

test("CI kör Node 22 i varje jobb", () => {
  const versions = Array.from(ci.matchAll(/node-version:\s*(\S+)/g)).map((m) => m[1].replace(/["']/g, ""));
  assert.ok(versions.length > 0, "ci.yml ska sätta node-version");
  for (const version of versions) assert.equal(version, "22");
});

test("den körande Noden är samma major", () => {
  assert.equal(process.versions.node.split(".")[0], nvmrc);
});
